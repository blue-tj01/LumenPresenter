// @ts-check
// Updates for the installed app. A new version downloads in the background and is installed when Lumen is next
// quit, never in the middle of a service; the menu offers to restart for it sooner.
'use strict';

const CHECK_EVERY = 6 * 60 * 60 * 1000;

class Updates {
  /** onChange is called whenever state changes, so the menus can be rebuilt. */
  constructor({ app, onChange, notify }) {
    this.app = app;
    this.onChange = onChange;
    this.notify = notify;
    this.state = 'idle'; // idle | checking | downloading | ready | latest | error | unavailable
    this.version = null;
    // Installed with the Windows installer or as an AppImage; a copy run from the source updates with git.
    this.supported = app.isPackaged && (process.platform === 'win32' || !!process.env.APPIMAGE);
    if (!this.supported) { this.state = 'unavailable'; return; }
    const { autoUpdater } = require('electron-updater');
    this.updater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: () => {}, warn: m => console.warn(`update: ${m}`), error: m => console.error(`update: ${m}`), debug: () => {} };
    autoUpdater.on('checking-for-update', () => this.set('checking'));
    autoUpdater.on('update-available', info => { this.version = info.version; this.set('downloading'); });
    autoUpdater.on('update-not-available', () => this.set(this.quiet ? 'idle' : 'latest'));
    autoUpdater.on('update-downloaded', info => {
      this.version = info.version;
      this.set('ready');
      this.notify(`Lumen ${info.version} is ready`, 'It will be installed the next time Lumen is closed.');
    });
    autoUpdater.on('error', e => { console.error(`update: ${e.message}`); this.set(this.quiet ? 'idle' : 'error'); });
  }

  set(state) { this.state = state; this.onChange(); }

  /** quiet: a background check, which only speaks up once an update is ready. */
  check(quiet = false) {
    if (!this.supported || ['checking', 'downloading', 'ready'].includes(this.state)) return;
    this.quiet = quiet;
    this.updater.checkForUpdates().catch(() => {});
  }

  start() {
    if (!this.supported) return;
    this.check(true);
    setInterval(() => this.check(true), CHECK_EVERY).unref();
  }

  restart() { this.updater.quitAndInstall(); }

  /** Menu items: what is happening, and the action that fits. */
  menu() {
    const v = this.app.getVersion();
    switch (this.state) {
      case 'unavailable': return [{ label: `Lumen ${v}`, enabled: false }];
      case 'checking': return [{ label: 'Checking for Updates…', enabled: false }];
      case 'downloading': return [{ label: `Downloading Lumen ${this.version}…`, enabled: false }];
      case 'ready': return [{ label: `Restart to Install Lumen ${this.version}`, click: () => this.restart() }];
      case 'latest': return [{ label: `Lumen ${v} is up to date`, enabled: false }, { label: 'Check for Updates', click: () => this.check() }];
      case 'error': return [{ label: 'Could not check for updates', enabled: false }, { label: 'Check for Updates', click: () => this.check() }];
      default: return [{ label: 'Check for Updates', click: () => this.check() }];
    }
  }
}

module.exports = { Updates };
