// Lumen Presenter desktop app: runs the server in this process and opens the operator console in a window.
// The pages are the same ones a browser gets, so another device can still open them over the network.
'use strict';
const fs = require('fs');
const path = require('path');
const electron = require('electron');
const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, powerSaveBlocker, session, shell } = electron;
const { LumenServer } = require('../server.js');
const { SCREENS, Screens } = require('./screens.js');
const { Updates } = require('./updates.js');
const { NdiOutput } = require('./ndi.js');
const { importDataFolder, isDataFolder } = require('./data.js');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(__dirname, 'icon.png');
// Output windows play a video's sound without first being clicked, as a projector window can't be.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// One settings folder whether Lumen is installed or run from the source (installed, its name would otherwise
// follow the product name): %APPDATA%\lumen-presenter on Windows, ~/.config/lumen-presenter on Linux.
app.setPath('userData', path.join(app.getPath('appData'), 'lumen-presenter'));

let srv = null, origin = '', consoleWin = null, screens = null, ndi = null, tray = null, quitting = false, awake = null, updates = null;

/** Where the library, media and settings live. Run from a copy of the source, it is the same ./data folder
 * `node server.js` uses, so an existing library carries straight over; installed, it is in the user's profile. */
function dataDir() {
  return process.env.LUMEN_DATA || (app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data'));
}

// ---------- this computer's settings (displays, keep awake), kept apart from the library ----------
const settingsPath = () => path.join(app.getPath('userData'), 'desktop.json');
const settings = { keepAwake: true, screens: {}, trayHintShown: false };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); } catch {}
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath() + '.tmp', JSON.stringify(settings, null, 2));
    fs.renameSync(settingsPath() + '.tmp', settingsPath());
  } catch (e) { console.error(`warning: could not save ${settingsPath()}: ${e.message}`); }
}

// ---------- bringing an existing library in ----------
/** Copy another data folder (the one next to server.js in a copy of the source, say) over this one, then restart
 * so the server loads it. */
async function importData() {
  const { canceled, filePaths } = await dialog.showOpenDialog(consoleWin, { title: 'Import Library From Folder',
    message: 'Choose the data folder of the Lumen you are moving from (the "data" folder next to server.js).',
    properties: ['openDirectory'] });
  if (canceled || !filePaths[0]) return;
  if (!isDataFolder(filePaths[0]) || path.resolve(filePaths[0]) === srv.store.dir) {
    dialog.showMessageBox(consoleWin, { type: 'warning', message: 'That folder has no other Lumen library in it.',
      detail: 'Choose the folder that contains lumen.db (or library.json) and a media folder.' });
    return;
  }
  const { response } = await dialog.showMessageBox(consoleWin, { type: 'question', buttons: ['Import and Restart', 'Cancel'],
    defaultId: 0, cancelId: 1, message: 'Replace this library with the one in that folder?',
    detail: `Its presentations, media, network token and signed-in devices are copied into ${srv.store.dir}, and ` +
      'Lumen restarts. The library here now is kept in its backups folder.' });
  if (response !== 0) return;
  await srv.close();
  try {
    importDataFolder(filePaths[0], srv.store.dir);
  } catch (e) {
    dialog.showErrorBox('The library could not be imported', e.message);
  }
  quitting = true;
  app.relaunch();
  app.exit(0);
}

// ---------- media folders ----------
async function pickFolder() {
  const { canceled, filePaths } = await dialog.showOpenDialog(consoleWin, { title: 'Add Media Folder',
    message: 'Choose a folder of pictures and videos. Lumen plays them from there, without copying them.',
    properties: ['openDirectory'] });
  return canceled ? '' : filePaths[0] || '';
}

async function addFolder() {
  const dir = await pickFolder();
  if (!dir) return;
  try { srv.folders.add(dir); } // the console hears about it and lists the folder
  catch (e) { dialog.showMessageBox(consoleWin, { type: 'warning', message: 'That folder can’t be added.', detail: e.message }); }
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: ICON }).show();
}

const sameOrigin = url => { try { return new URL(url).origin === origin; } catch { return false; } };

// Animations and video timing keep going in windows that are behind others or not focused.
const webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
  preload: path.join(__dirname, 'preload.js') };

/** Keep every window on Lumen's own pages: links elsewhere (a token link for another device) open in the
 * system browser. The console's Audience Output and Stage Display buttons bring up the full-screen window when
 * that screen has a display chosen, and an ordinary window otherwise. */
function guard(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) {
      const page = new URL(url).pathname.slice(1);
      const name = Object.keys(SCREENS).find(n => SCREENS[n].page === page);
      if (name && screens.show(name)) return { action: 'deny' };
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000000',
        icon: ICON, webPreferences } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => { if (!sameOrigin(url)) e.preventDefault(); });
}

function showConsole() {
  if (!consoleWin) return;
  if (consoleWin.isMinimized()) consoleWin.restore();
  consoleWin.show();
  consoleWin.focus();
}

function openConsole() {
  consoleWin = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Lumen Presenter',
    backgroundColor: '#14161b', show: false, icon: ICON, webPreferences });
  consoleWin.once('ready-to-show', () => consoleWin.show());
  consoleWin.on('close', e => {
    // With a screen still showing or NDI still sending, closing the console must not blank the output: Lumen
    // stays in the tray.
    if (quitting || (!Object.keys(screens.windows).length && !ndi.on)) return;
    e.preventDefault();
    consoleWin.hide();
    if (!settings.trayHintShown && process.platform === 'win32') {
      tray.displayBalloon({ title: 'Lumen is still running', iconType: 'info',
        content: 'The screens stay up. Click the Lumen icon here to bring the console back, or right-click it to quit.' });
      settings.trayHintShown = true;
      saveSettings();
    }
  });
  consoleWin.on('closed', () => { consoleWin = null; app.quit(); });
  consoleWin.loadURL(`${origin}/`);
}

// ---------- keep awake, start at sign-in ----------
function setKeepAwake(on) {
  settings.keepAwake = on;
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
}

// Run from the source folder, the login item must start Electron with this folder, not on its own.
const loginItem = () => app.isPackaged ? {} : { path: process.execPath, args: [ROOT] };
const canStartAtLogin = process.platform === 'win32' || process.platform === 'darwin';

// ---------- menus ----------
function screensMenu() {
  return [
    ...screens.menu(buildMenus),
    { type: 'separator' },
    ndi.menu(buildMenus),
    { type: 'separator' },
    { label: 'Identify Screens', click: () => screens.identify() },
    { type: 'separator' },
    { label: 'Keep Screens Awake', type: 'checkbox', checked: settings.keepAwake,
      click: item => { setKeepAwake(item.checked); saveSettings(); } },
    ...canStartAtLogin ? [{
      label: process.platform === 'win32' ? 'Start Lumen When Windows Starts' : 'Start Lumen at Login', type: 'checkbox',
      checked: app.getLoginItemSettings(loginItem()).openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked, ...loginItem() }),
    }] : [],
  ];
}

function buildMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...process.platform === 'darwin' ? [{ role: 'appMenu' }] : [],
    { label: 'File', submenu: [
      { label: 'Add Media Folder…', click: addFolder },
      { type: 'separator' },
      { label: 'Import Library From Folder…', click: importData },
      { label: 'Open Data Folder', click: () => shell.openPath(srv.store.dir) },
      ...process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Quit Lumen' }],
    ] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { label: 'Screens', submenu: screensMenu() },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [
      ...updates.menu(),
      { type: 'separator' },
      { label: 'Lumen on GitHub', click: () => shell.openExternal('https://github.com/blue-tj01/LumenPresenter') },
    ] },
  ]));
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Console', click: showConsole },
    { type: 'separator' },
    ...screensMenu(),
    { type: 'separator' },
    ...updates.state === 'ready' ? [...updates.menu(), { type: 'separator' }] : [],
    { label: 'Quit Lumen', click: () => app.quit() },
  ]));
}

async function start() {
  loadSettings();
  srv = new LumenServer({ port: Number(process.env.LUMEN_PORT) || 8642, data: dataDir() });
  try {
    await srv.listen();
  } catch (e) {
    dialog.showErrorBox('Lumen Presenter could not start', e.code === 'EADDRINUSE'
      ? `Port ${srv.port} is already in use. If Lumen's server (server.py or server.js) is still running in a ` +
        'terminal, close it and open Lumen Presenter again.'
      : e.message);
    app.exit(1);
    return;
  }
  origin = `http://127.0.0.1:${srv.port}`;
  console.log(`Lumen Presenter on ${origin}  (data: ${srv.store.dir})`);
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
    done(sameOrigin(wc.getURL()) && ['fullscreen', 'clipboard-sanitized-write'].includes(permission));
  });
  app.on('web-contents-created', (_, wc) => { if (['window', 'offscreen'].includes(wc.getType())) guard(wc); });
  // Only the console, on Lumen's own page, may open the folder picker.
  ipcMain.handle('lumen:pick-folder', e => e.sender === consoleWin?.webContents && sameOrigin(e.senderFrame.url) ? pickFolder() : '');

  updates = new Updates({ app, onChange: () => buildMenus(), notify });
  screens = new Screens({ electron, origin, webPreferences, settings, save: saveSettings, icon: ICON });
  ndi = new NdiOutput({ electron, origin, webPreferences, settings, save: saveSettings, onChange: () => buildMenus() });
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) electron.screen.on(ev, buildMenus);
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('Lumen Presenter');
  tray.on('click', showConsole);
  buildMenus();
  setKeepAwake(settings.keepAwake);

  openConsole();
  screens.place(); // screens chosen last time come straight back up on their displays
  if (settings.ndi.on) ndi.start();
  updates.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // one Lumen per computer: they would share the port and the data folder
} else {
  app.on('second-instance', showConsole);
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; ndi?.stop(); srv?.close(); });
}
