// Which display the audience output and stage display go full screen on, remembered between runs. The
// functions at the top don't need Electron, so the tests can run them under plain Node.
'use strict';

const SCREENS = {
  output: { page: 'output.html', label: 'Audience output' },
  stage: { page: 'stage.html', label: 'Stage display' },
};

/** What is saved about a display, to find it again next time. */
const remember = d => ({ id: d.id, label: d.label || '', width: d.size.width, height: d.size.height });

/** The connected display a saved one refers to: the same id, or failing that (ids can change when displays are
 * reconnected) the only display with the same name and size. */
function findDisplay(saved, displays) {
  if (!saved) return null;
  const same = displays.find(d => d.id === saved.id);
  if (same) return same;
  const alike = displays.filter(d => saved.label && d.label === saved.label &&
    d.size.width === saved.width && d.size.height === saved.height);
  return alike.length === 1 ? alike[0] : null;
}

/** '2: DELL U2419H (1920×1080)', numbered as Identify screens shows them. */
function displayName(d, i, primaryId) {
  return `${i + 1}: ${d.label || 'Display'} (${d.size.width}×${d.size.height})${d.id === primaryId ? ', main screen' : ''}`;
}

/** Opens each screen full screen on its chosen display, and follows displays being connected and unplugged. */
class Screens {
  constructor({ electron, origin, webPreferences, settings, save, icon }) {
    Object.assign(this, { electron, origin, webPreferences, settings, save, icon });
    this.windows = {}; // screen -> its full-screen window, while open
    const { screen } = electron;
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => this.place());
  }

  displays() { return this.electron.screen.getAllDisplays(); }

  /** The display a screen is set to, if it is connected now. */
  displayFor(name) { return findDisplay(this.settings.screens?.[name], this.displays()); }

  /** Choose the display for a screen, or null for an ordinary window. */
  assign(name, display) {
    this.settings.screens = { ...this.settings.screens, [name]: display ? remember(display) : null };
    this.save();
    if (!display) this.windows[name]?.close();
    this.place();
  }

  /** Bring a screen up: full screen on its display if it has one connected. False if it has none, so the
   * caller opens an ordinary window instead. */
  show(name) {
    const display = this.displayFor(name);
    if (!display) return false;
    const win = this.windows[name] || this.open(name, display);
    win.showInactive();
    return true;
  }

  /** Open every screen whose display is connected (at start, and when a display is plugged in), move open ones
   * to follow their display, and close any whose display was unplugged rather than let it land on the
   * operator's screen. */
  place() {
    for (const name of Object.keys(SCREENS)) {
      const display = this.displayFor(name), win = this.windows[name];
      if (!display) { win?.close(); continue; }
      if (!win) { this.open(name, display); continue; }
      this.fit(win, display);
    }
  }

  open(name, display) {
    const { BrowserWindow } = this.electron;
    const win = new BrowserWindow({ title: SCREENS[name].label, frame: false, show: false, backgroundColor: '#000000',
      autoHideMenuBar: true, icon: this.icon, webPreferences: this.webPreferences });
    this.windows[name] = win;
    win.on('closed', () => { if (this.windows[name] === win) delete this.windows[name]; });
    win.once('ready-to-show', () => { this.fit(win, display); win.showInactive(); });
    win.loadURL(`${this.origin}/${SCREENS[name].page}?display`);
    return win;
  }

  fit(win, display) {
    const primary = display.id === this.electron.screen.getPrimaryDisplay().id;
    win.setFullScreen(false);
    win.setBounds(display.bounds);
    win.setFullScreen(true);
    // Above notifications and other windows, unless it shares the operator's screen.
    win.setAlwaysOnTop(!primary, 'screen-saver');
  }

  /** Each display's number, big, for a few seconds. */
  identify() {
    const { BrowserWindow, screen } = this.electron;
    const primaryId = screen.getPrimaryDisplay().id;
    this.displays().forEach((d, i) => {
      const w = 360, h = 240;
      const win = new BrowserWindow({ x: Math.round(d.bounds.x + (d.bounds.width - w) / 2),
        y: Math.round(d.bounds.y + (d.bounds.height - h) / 2), width: w, height: h, frame: false, resizable: false,
        focusable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#14161b', show: false,
        webPreferences: this.webPreferences });
      const name = displayName(d, i, primaryId).replace(/^\d+: /, '').replace(/[<&]/g, c => ({ '<': '&lt;', '&': '&amp;' })[c]);
      const html = `<body style="margin:0;height:100vh;display:grid;place-content:center;text-align:center;color:#e6e8ee;
        font:15px system-ui,sans-serif;border:3px solid #4f7cff;box-sizing:border-box"><div style="font-size:120px;
        font-weight:700;line-height:1">${i + 1}</div><div>${name}</div></body>`;
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      win.once('ready-to-show', () => win.showInactive());
      setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 3000);
    });
  }

  /** The connected displays, and which each screen is set to, for the console's first-run setup:
   * {displays: [{id, name}], chosen: {output: id or null, stage: id or null}}. */
  summary() {
    const primaryId = this.electron.screen.getPrimaryDisplay().id;
    return {
      displays: this.displays().map((d, i) => ({ id: d.id, name: displayName(d, i, primaryId) })),
      chosen: Object.fromEntries(Object.keys(SCREENS).map(name => [name, this.displayFor(name)?.id ?? null])),
    };
  }

  /** Set a screen's display by its id, or null for an ordinary window. False for an unknown screen or display. */
  assignById(name, id) {
    if (!(name in SCREENS)) return false;
    const display = id === null ? null : this.displays().find(d => d.id === id);
    if (display === undefined) return false;
    this.assign(name, display);
    return true;
  }

  /** Menu items for choosing each screen's display. */
  menu(rebuild) {
    const { screen } = this.electron;
    const displays = this.displays(), primaryId = screen.getPrimaryDisplay().id;
    return Object.entries(SCREENS).map(([name, { label }]) => {
      const current = this.displayFor(name);
      const saved = this.settings.screens?.[name];
      const items = [
        { label: 'In a window', type: 'radio', checked: !saved, click: () => { this.assign(name, null); rebuild(); } },
        ...displays.map((d, i) => ({ label: `Full screen on ${displayName(d, i, primaryId)}`, type: 'radio',
          checked: current?.id === d.id, click: () => { this.assign(name, d); rebuild(); } })),
      ];
      if (saved && !current) {
        items.push({ label: `Full screen on ${saved.label || 'a display'} (not connected)`, type: 'radio', checked: true, enabled: false });
      }
      return { label, submenu: items };
    });
  }
}

module.exports = { SCREENS, Screens, findDisplay, displayName, remember };
