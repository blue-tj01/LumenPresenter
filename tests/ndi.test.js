// Tests for electron/ndi.js and electron/ndi-lib.js: sending the audience output over NDI. Run with: npm test
// With LUMEN_NDI_LIB set to an NDI library (libndi.so.6, or the Windows DLL), one test also sends real frames.
'use strict';
const assert = require('assert/strict');
const path = require('path');
const { it } = require('node:test');
const EventEmitter = require('events');
const { NdiOutput, unpremultiply } = require('../electron/ndi.js');
const { candidates, open } = require('../electron/ndi-lib.js');

// ---------- finding the NDI library ----------
it('looks for NDI where NDI Tools puts it, then on the usual library path', () => {
  const dll = `Processing.NDI.Lib.${process.arch === 'ia32' ? 'x86' : 'x64'}.dll`;
  const dir = 'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6';
  const none = () => { throw new Error('ENOENT'); };
  assert.deepEqual(candidates({ NDI_RUNTIME_DIR_V6: dir }, 'win32', none), [`${dir}\\${dll}`, dll]);
  assert.deepEqual(candidates({}, 'linux'), ['libndi.so.6', 'libndi.so']);
  assert.deepEqual(candidates({ LUMEN_NDI_LIB: '/opt/ndi/libndi.so' }, 'linux'), ['/opt/ndi/libndi.so']);
});

it('finds NDI in its install folder when Lumen started before NDI was installed', () => {
  const dll = `Processing.NDI.Lib.${process.arch === 'ia32' ? 'x86' : 'x64'}.dll`;
  const list = dir => { assert.equal(dir, 'C:\\Program Files\\NDI'); return ['NDI 6 Tools', 'NDI 6 Runtime']; };
  const found = candidates({ ProgramFiles: 'C:\\Program Files', ProgramW6432: 'C:\\Program Files' }, 'win32', list);
  assert.equal(found[0], `C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\${dll}`);
  assert.ok(found.includes(`C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime\\${dll}`));
  assert.equal(found.at(-1), dll);
});

it('says when NDI is there but will not load, rather than that it is not installed', () => {
  const file = __filename; // any file that exists
  const koffi = { load() { throw new Error('%1 is not a valid Win32 application'); } };
  assert.throws(() => open({ env: { LUMEN_NDI_LIB: file }, koffi }),
    e => e.code === undefined && /installed but could not be loaded: %1 is not/.test(e.message));
});

it('says to install NDI Tools when there is no NDI library, or the NDI SDK on Linux', () => {
  const koffi = { load() { throw new Error('cannot open shared object file'); } };
  assert.throws(() => open({ env: {}, koffi, platform: 'win32' }),
    e => e.code === 'NDI_MISSING' && e.message === 'Install NDI Tools to send over NDI');
  assert.throws(() => open({ env: {}, koffi, platform: 'linux' }),
    e => e.code === 'NDI_MISSING' && e.message === 'Install the NDI SDK to send over NDI');
});

// ---------- the output, with stand-ins for Electron and NDI ----------
const tick = () => new Promise(r => setImmediate(r));

function fakeElectron() {
  const opened = [], external = [];
  const others = [];
  class WebContents extends EventEmitter {
    constructor(url = '', offscreen = true) { super(); this.url = url; this.offscreen = offscreen; this.muted = false; this.fps = 0; }
    setFrameRate(n) { this.fps = n; }
    loadURL(url) { this.url = url; }
    getURL() { return this.url; }
    isDestroyed() { return false; }
    isOffscreen() { return this.offscreen; }
    isAudioMuted() { return this.muted; }
    setAudioMuted(m) { this.muted = m; }
  }
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.destroyed = false; this.webContents = new WebContents(); opened.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const electron = { BrowserWindow, opened, others, WebContents,
    webContents: { getAllWebContents: () => [...opened.filter(w => !w.destroyed).map(w => w.webContents), ...others] },
    shell: { openExternal: url => external.push(url) }, external };
  return electron;
}

/** An NDI sender that records frames; each send waits until the test lets it finish, as NDI does to pace them. */
function fakeNdi() {
  const ndi = { senders: [], send({ name }) {
    const s = { name, frames: [], receivers: 0, destroyed: false, pending: null,
      video(frame) {
        assert.ok(!s.destroyed, 'no frames after destroy');
        s.frames.push(frame);
        return new Promise(resolve => { s.pending = () => { s.pending = null; resolve(); }; });
      },
      connections: () => s.receivers,
      sourcename: () => `STUDIO-PC (${name})`,
      destroy() { assert.ok(!s.pending, 'destroyed while NDI was reading a frame'); s.destroyed = true; },
    };
    ndi.senders.push(s);
    return s;
  } };
  return ndi;
}

function output({ settings = {}, load, platform = 'win32' } = {}) {
  const electron = fakeElectron(), ndi = fakeNdi();
  let saves = 0, changes = 0;
  const out = new NdiOutput({ electron, origin: 'http://127.0.0.1:8642', webPreferences: { sandbox: true }, settings,
    save: () => saves++, onChange: () => changes++, load: load || (() => ({ ndi })), platform });
  return { out, electron, ndi, settings, saves: () => saves, changes: () => changes };
}

const image = (width, height) => ({ isEmpty: () => false, getSize: () => ({ width, height }), toBitmap: () => Buffer.alloc(width * height * 4, 7) });

it('is off until turned on, with 1080p at 30 frames a second to start with', () => {
  const { out, settings } = output();
  assert.equal(out.on, false);
  assert.deepEqual(settings.ndi, { on: false, size: '1920x1080', fps: 30, alpha: false });
});

it('draws the audience output off screen and sends each picture over NDI', async () => {
  const { out, electron, ndi, settings, saves } = output();
  await out.set(true);
  assert.equal(out.on, true);
  assert.equal(settings.ndi.on, true);
  assert.equal(saves(), 1);
  const [win] = electron.opened;
  assert.equal(win.opts.width, 1920);
  assert.equal(win.opts.height, 1080);
  assert.equal(win.opts.show, false);
  assert.deepEqual(win.opts.webPreferences, { sandbox: true, offscreen: { deviceScaleFactor: 1 } });
  assert.equal(win.webContents.url, 'http://127.0.0.1:8642/output.html?display');
  assert.equal(win.webContents.fps, 30);

  const sender = ndi.senders[0];
  assert.equal(sender.name, 'Lumen Presenter');
  win.webContents.emit('paint', {}, {}, image(1920, 1080));
  await new Promise(r => setTimeout(r, 50));
  assert.equal(sender.frames.length, 1);
  assert.equal(sender.frames[0].width, 1920);
  assert.equal(sender.frames[0].height, 1080);
  assert.equal(sender.frames[0].fps, 30);
  assert.equal(sender.frames[0].data.length, 1920 * 1080 * 4);

  // While the page is still, the same picture goes out again, so receivers get a steady stream.
  sender.pending(); await tick();
  assert.equal(sender.frames.length, 2);
  assert.equal(sender.frames[1].data, sender.frames[0].data);
  const stopped = out.stop();
  sender.pending();
  await stopped;
});

it('closes the NDI source only once NDI has finished with the frame it is sending', async () => {
  const { out, electron, ndi } = output();
  await out.set(true);
  electron.opened[0].webContents.emit('paint', {}, {}, image(1280, 720));
  await new Promise(r => setTimeout(r, 50));
  const sender = ndi.senders[0];
  const stopped = out.set(false);
  assert.equal(out.on, false);
  assert.equal(electron.opened[0].destroyed, true);
  await tick();
  assert.equal(sender.destroyed, false);
  sender.pending();
  await stopped;
  assert.equal(sender.destroyed, true);
  assert.equal(sender.frames.length, 1, 'no more frames after it was turned off');
});

it('restarts at a new size or frame rate, and remembers it', async () => {
  const { out, electron, ndi, settings } = output();
  await out.set(true);
  const done = out.configure({ size: '1280x720', fps: 50 });
  await done;
  assert.deepEqual(settings.ndi, { on: true, size: '1280x720', fps: 50, alpha: false });
  assert.equal(ndi.senders.length, 2);
  assert.equal(ndi.senders[0].destroyed, true);
  const win = electron.opened[1];
  assert.equal(win.opts.width, 1280);
  assert.equal(win.webContents.fps, 50);
  await out.stop();

  // Changed while off, it is only remembered.
  await out.configure({ fps: 25 });
  assert.equal(ndi.senders.length, 2);
  assert.equal(settings.ndi.fps, 25);
});

it('sends only the words on a transparent background when asked, and remembers it', async () => {
  const { out, electron, ndi, settings } = output();
  await out.set(true);
  assert.equal(electron.opened[0].opts.transparent, false);
  assert.equal(electron.opened[0].opts.backgroundColor, '#000000');
  const toggle = () => out.menu(() => {}).submenu.find(i => i.label === 'Words Only, on a Transparent Background');
  assert.equal(toggle().checked, false);
  await toggle().click();
  assert.equal(settings.ndi.alpha, true);
  assert.equal(ndi.senders.length, 2, 'the source restarts with the new background');
  const win = electron.opened[1];
  assert.equal(win.opts.transparent, true);
  assert.equal(win.opts.backgroundColor, '#00000000');
  assert.equal(win.webContents.url, 'http://127.0.0.1:8642/output.html?display&alpha');
  assert.equal(toggle().checked, true);

  // Part-covered pixels go out with straight alpha, as NDI expects; clear and solid ones are unchanged.
  const px = Buffer.from([0, 0, 0, 0, 10, 20, 30, 255, 64, 32, 0, 128]);
  win.webContents.emit('paint', {}, {}, { isEmpty: () => false, getSize: () => ({ width: 3, height: 1 }), toBitmap: () => px });
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual([...ndi.senders[1].frames[0].data], [0, 0, 0, 0, 10, 20, 30, 255, 128, 64, 0, 128]);

  // Words only never plays video sound: there is no video on that page.
  out.check();
  assert.equal(win.webContents.muted, true);
  const stopped = out.stop();
  ndi.senders[1].pending();
  await stopped;
});

it('turns premultiplied pixels into straight alpha without going past full brightness', () => {
  assert.deepEqual([...unpremultiply(Buffer.from([255, 200, 100, 200, 1, 1, 1, 1]))], [255, 255, 128, 200, 255, 255, 255, 1]);
});

it('plays video sound only when no audience output window is open', async () => {
  const { out, electron } = output();
  await out.set(true);
  const page = electron.opened[0].webContents;
  assert.equal(page.muted, false);
  electron.others.push(new electron.WebContents('http://127.0.0.1:8642/output.html?display', false));
  out.check();
  assert.equal(page.muted, true);
  electron.others.length = 0;
  out.check();
  assert.equal(page.muted, false);
  await out.stop();
});

it('shows the source name and how many receivers are watching', async () => {
  const { out, ndi, changes } = output();
  await out.set(true);
  const status = () => out.menu(() => {}).submenu.filter(i => i.enabled === false).map(i => i.label);
  assert.deepEqual(status(), ['Sending as STUDIO-PC (Lumen Presenter)', 'No receivers yet']);
  const before = changes();
  ndi.senders[0].receivers = 2;
  out.check();
  assert.ok(changes() > before, 'the menu is rebuilt when receivers come and go');
  assert.deepEqual(status(), ['Sending as STUDIO-PC (Lumen Presenter)', 'Seen by 2 receivers']);
  await out.stop();
});

it('offers NDI Tools when NDI is not installed, and stays off', async () => {
  const { out, electron } = output({ load: () => ({ error: 'Install NDI Tools to send over NDI', missing: true }) });
  const menu = out.menu(() => {}).submenu;
  assert.equal(menu[0].enabled, false);
  assert.ok(menu.some(i => i.label === 'NDI Tools isn’t installed on this computer'));
  menu.find(i => i.label === 'Get NDI Tools…').click();
  assert.deepEqual(electron.external, ['https://ndi.video/tools/']);
  assert.ok(menu.some(i => i.label === 'Look for NDI Again'));
  assert.equal(out.start(), false);
  assert.equal(out.on, false);
  assert.equal(electron.opened.length, 0);
});

it('offers the NDI SDK on Linux, where there is no NDI Tools', () => {
  const { out, electron } = output({ platform: 'linux',
    load: () => ({ error: 'Install the NDI SDK to send over NDI', missing: true }) });
  const menu = out.menu(() => {}).submenu;
  assert.ok(menu.some(i => i.label === 'The NDI SDK isn’t installed on this computer'));
  menu.find(i => i.label === 'Get the NDI SDK…').click();
  assert.deepEqual(electron.external, ['https://ndi.video/for-developers/ndi-sdk/']);
});

it('finds NDI installed while Lumen is open', async () => {
  let installed = false;
  const ndi = fakeNdi();
  const { out } = output({ load: () => installed ? { ndi } : { error: 'Install NDI Tools to send over NDI', missing: true } });
  let rebuilt = 0;
  const again = out.menu(() => rebuilt++).submenu.find(i => i.label === 'Look for NDI Again');
  assert.equal(out.lib(), null);
  installed = true;
  await again.click();
  assert.equal(rebuilt, 1);
  assert.equal(out.menu(() => {}).submenu[0].enabled, true);
});

it('comes back on at launch when it was on last time', () => {
  const { out, ndi } = output({ settings: { ndi: { on: true, size: '1280x720', fps: 25 } } });
  assert.equal(out.config.on, true);
  assert.equal(out.start(), true);
  assert.equal(ndi.senders.length, 1);
  out.stop();
});

// ---------- the real NDI library, when there is one to test with ----------
it('sends frames through the NDI library', { skip: !process.env.LUMEN_NDI_LIB && 'set LUMEN_NDI_LIB to test with NDI' }, async () => {
  const ndi = open();
  assert.match(ndi.version, /NDI/);
  const sender = ndi.send({ name: 'Lumen Test' });
  assert.match(sender.sourcename(), /\(Lumen Test\)$/);
  assert.equal(sender.connections(), 0);
  const data = Buffer.alloc(64 * 36 * 4, 128);
  const start = Date.now();
  for (let i = 0; i < 6; i++) await sender.video({ width: 64, height: 36, fps: 30, data });
  assert.ok(Date.now() - start >= 100, 'NDI paces frames to the frame rate');
  await assert.rejects(sender.video({ width: 64, height: 36, fps: 30, data: Buffer.alloc(16) }), /smaller/);
  sender.destroy();
});
