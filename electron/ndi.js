// Sends the audience output over the network as an NDI source, for vision mixers, streaming software and other
// computers to pick up without OBS in between. The output page is drawn in a hidden window and each frame goes
// to NDI as it is. Picture only: video sound still plays from this computer.
'use strict';
const ndiLib = require('./ndi-lib.js');

const SIZES = { '1280x720': '720p (1280×720)', '1920x1080': '1080p (1920×1080)', '3840x2160': '4K (3840×2160)' };
const RATES = [25, 30, 50, 60];
const DEFAULTS = { on: false, size: '1920x1080', fps: 30 };

/** The NDI library, or why it can't be used. */
function loadNdi() {
  try { return { ndi: ndiLib.open() }; }
  catch (e) { return { error: e.message, missing: e.code === 'NDI_MISSING' }; }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

class NdiOutput {
  /** onChange is called when what the menu shows changes (on, off, receivers connected). */
  constructor({ electron, origin, webPreferences, settings, save, onChange, load = loadNdi, name = 'Lumen Presenter',
    platform = process.platform }) {
    Object.assign(this, { electron, origin, webPreferences, settings, save, onChange, load, name, platform });
    this.settings.ndi = { ...DEFAULTS, ...this.settings.ndi };
    this.sender = null;
    this.win = null;
    this.frame = null;   // the latest picture, sent again until the page draws a new one
    this.sending = null; // the frame NDI is reading now
    this.receivers = 0;
    this.error = '';
  }

  get config() { return this.settings.ndi; }
  get on() { return !!this.sender; }

  /** The library, loaded once found. Until then it is looked for again each time, so NDI installed while Lumen
   * is open is found without restarting. */
  lib() {
    if (this.loaded === undefined || (this.loaded === null && this.missing)) {
      const { ndi, error, missing } = this.load();
      this.loaded = ndi || null;
      this.missing = !!missing;
      this.error = error || '';
    }
    return this.loaded;
  }

  /** Turn NDI on or off, and remember it for next time. */
  async set(on) {
    this.settings.ndi = { ...this.config, on };
    this.save();
    if (on) this.start(); else await this.stop();
  }

  /** Start sending (at launch, when it was on last time). False if NDI can't be used here. */
  start() {
    if (this.sender) return true;
    const ndi = this.lib();
    if (!ndi) { this.onChange(); return false; }
    try {
      this.sender = ndi.send({ name: this.name });
      this.error = '';
    } catch (e) {
      this.error = `NDI could not start: ${e.message}`;
      console.error(this.error);
      this.onChange();
      return false;
    }
    this.openPage();
    this.pump(this.sender);
    this.watch = setInterval(() => this.check(), 2000);
    this.watch.unref?.();
    this.onChange();
    return true;
  }

  async stop() {
    const sender = this.sender;
    if (!sender) return;
    this.sender = null;
    clearInterval(this.watch);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.frame = null;
    this.receivers = 0;
    this.onChange();
    // NDI may still be reading the last frame: the source closes once it has.
    await this.sending?.catch(() => {});
    sender.destroy();
  }

  /** Change the picture size or frame rate; a running output restarts with it. */
  async configure(change) {
    this.settings.ndi = { ...this.config, ...change };
    this.save();
    if (this.sender) { await this.stop(); this.start(); }
  }

  /** The output page, drawn off screen at the size NDI sends. */
  openPage() {
    const { BrowserWindow } = this.electron;
    const [width, height] = this.config.size.split('x').map(Number);
    const win = this.win = new BrowserWindow({ width, height, show: false, frame: false, backgroundColor: '#000000',
      webPreferences: { ...this.webPreferences, offscreen: { deviceScaleFactor: 1 } } });
    const wc = win.webContents;
    wc.setFrameRate(this.config.fps);
    wc.on('paint', (e, dirty, image) => {
      if (this.win === win && !image.isEmpty()) this.frame = { size: image.getSize(), data: image.toBitmap() };
    });
    win.on('closed', () => { if (this.win === win) this.win = null; });
    wc.loadURL(`${this.origin}/output.html?display`);
    this.check();
  }

  /** Send frames until this sender is stopped. NDI paces them to the frame rate, and the last picture goes out
   * again while the page is still, so receivers get a steady stream. */
  async pump(sender) {
    while (this.sender === sender) {
      const f = this.frame;
      if (!f) { await wait(1000 / this.config.fps); continue; }
      this.sending = sender.video({ ...f.size, fps: this.config.fps, data: f.data });
      try { await this.sending; }
      catch (e) { console.error(`NDI: ${e.message}`); await wait(1000); }
    }
  }

  /** How many receivers are watching, and whether the page should be quiet: video sound plays from the audience
   * output window when one is open, and from here only when NDI is the sole output. */
  check() {
    if (!this.sender) return;
    const n = this.sender.connections();
    if (n !== this.receivers) { this.receivers = n; this.onChange(); }
    const wc = this.win?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const isOutput = other => { try { return new URL(other.getURL()).pathname === '/output.html'; } catch { return false; } };
    const shown = this.electron.webContents.getAllWebContents()
      .some(other => other !== wc && !other.isDestroyed() && !other.isOffscreen() && isOutput(other));
    if (wc.isAudioMuted() !== shown) wc.setAudioMuted(shown);
  }

  /** The source name receivers list, such as 'STUDIO-PC (Lumen Presenter)'. */
  sourceName() {
    try { return this.sender?.sourcename() || this.name; } catch { return this.name; }
  }

  /** The NDI Output submenu. */
  menu(rebuild) {
    const then = fn => async () => { await fn(); rebuild(); };
    const available = this.lib() !== null;
    const get = ndiLib.download(this.platform);
    const Name = get.name[0].toUpperCase() + get.name.slice(1);
    const status = !available
      ? [{ label: this.missing ? `${Name} isn’t installed on this computer` : this.error, enabled: false },
        ...this.missing ? [{ label: `Get ${get.name}…`, click: () => this.electron.shell.openExternal(get.url) },
          { label: 'Look for NDI Again', click: then(() => this.lib()) }] : []]
      : this.error ? [{ label: this.error, enabled: false }]
      : this.on ? [{ label: `Sending as ${this.sourceName()}`, enabled: false },
        { label: this.receivers ? `Seen by ${this.receivers} receiver${this.receivers === 1 ? '' : 's'}` : 'No receivers yet', enabled: false }]
      : [];
    return { label: 'NDI Output', submenu: [
      { label: 'Send Audience Output over NDI', type: 'checkbox', checked: this.on, enabled: available,
        click: then(() => this.set(!this.on)) },
      ...status.length ? [{ type: 'separator' }, ...status] : [],
      { type: 'separator' },
      ...Object.entries(SIZES).map(([size, label]) => ({ label, type: 'radio', checked: this.config.size === size,
        click: then(() => this.configure({ size })) })),
      { type: 'separator' },
      ...RATES.map(fps => ({ label: `${fps} frames a second`, type: 'radio', checked: this.config.fps === fps,
        click: then(() => this.configure({ fps })) })),
    ] };
  }
}

module.exports = { NdiOutput, loadNdi, SIZES, RATES };
