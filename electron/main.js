// Lumen Presenter desktop app: runs the server in this process and opens the operator console in a window.
// The pages are the same ones a browser gets, so another device can still open them over the network.
'use strict';
const path = require('path');
const { app, BrowserWindow, dialog, session, shell } = require('electron');
const { LumenServer } = require('../server.js');

const ROOT = path.join(__dirname, '..');
// Output windows play a video's sound without first being clicked, as a projector window can't be.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let srv = null, origin = '', consoleWin = null;

/** Where the library, media and settings live. Run from a copy of the source, it is the same ./data folder
 * `node server.js` uses, so an existing library carries straight over; installed, it is in the user's profile. */
function dataDir() {
  return process.env.LUMEN_DATA || (app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data'));
}

const sameOrigin = url => { try { return new URL(url).origin === origin; } catch { return false; } };

const webPreferences = { contextIsolation: true, nodeIntegration: false, sandbox: true };

/** Keep every window on Lumen's own pages: links elsewhere (a token link for another device) open in the
 * system browser, and output or stage windows the console opens are allowed. */
function guard(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#000000', webPreferences } };
    }
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => { if (!sameOrigin(url)) e.preventDefault(); });
}

function openConsole() {
  consoleWin = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Lumen Presenter',
    backgroundColor: '#14161b', show: false, webPreferences });
  consoleWin.once('ready-to-show', () => consoleWin.show());
  consoleWin.on('closed', () => { consoleWin = null; app.quit(); }); // output windows go with it
  consoleWin.loadURL(`${origin}/`);
}

async function start() {
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
  app.on('web-contents-created', (_, wc) => { if (wc.getType() === 'window') guard(wc); });
  openConsole();
}

if (!app.requestSingleInstanceLock()) {
  app.quit(); // one Lumen per computer: they would share the port and the data folder
} else {
  app.on('second-instance', () => {
    if (!consoleWin) return;
    if (consoleWin.isMinimized()) consoleWin.restore();
    consoleWin.focus();
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { srv?.close(); });
}
