// Tests for electron/screens.js: finding the chosen display again. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it } = require('node:test');
const { findDisplay, displayName, remember } = require('../electron/screens.js');

const display = (id, label, width = 1920, height = 1080) => ({ id, label, size: { width, height }, bounds: { x: 0, y: 0, width, height } });
const laptop = display(1, 'Built-in Retina Display', 1512, 982);
const projector = display(2, 'EPSON PJ');

it('finds the chosen display by id', () => {
  assert.equal(findDisplay(remember(projector), [laptop, projector]), projector);
});

it('finds it by name and size when its id changed after reconnecting', () => {
  assert.equal(findDisplay(remember(projector), [laptop, display(7, 'EPSON PJ')]).id, 7);
  assert.equal(findDisplay(remember(projector), [laptop, display(7, 'EPSON PJ', 1280, 720)]), null);
});

it('does not guess between two identical displays', () => {
  assert.equal(findDisplay(remember(projector), [laptop, display(7, 'EPSON PJ'), display(8, 'EPSON PJ')]), null);
});

it('finds nothing when the display is unplugged or none was chosen', () => {
  assert.equal(findDisplay(remember(projector), [laptop]), null);
  assert.equal(findDisplay(null, [laptop, projector]), null);
  assert.equal(findDisplay(remember(display(3, '')), [laptop, display(9, '')]), null); // no name to go on
});

it('names displays as Identify Screens numbers them', () => {
  assert.equal(displayName(laptop, 0, 1), '1: Built-in Retina Display (1512×982), main screen');
  assert.equal(displayName(display(2, ''), 1, 1), '2: Display (1920×1080)');
});

// ---------- the window manager, with a stand-in for Electron ----------
const EventEmitter = require('events');
const { Screens } = require('../electron/screens.js');

function fakeElectron(displays) {
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0],
  });
  const opened = [];
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.opts = opts; this.destroyed = false; opened.push(this); }
    loadURL(url) { this.url = url; this.emit('ready-to-show'); }
    showInactive() { this.visible = true; }
    setFullScreen(on) { this.fullScreen = on; }
    setBounds(b) { this.bounds = b; }
    setAlwaysOnTop(on) { this.top = on; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  return { screen, BrowserWindow, opened };
}

function manager(displays, settings = {}) {
  const electron = fakeElectron(displays);
  let saves = 0;
  const screens = new Screens({ electron, origin: 'http://127.0.0.1:8642', webPreferences: {}, settings, save: () => saves++ });
  return { electron, screens, settings, saves: () => saves };
}

it('opens a screen full screen on its display and keeps it above other windows', () => {
  const { screens, electron, saves } = manager([laptop, projector]);
  assert.equal(screens.show('output'), false); // no display chosen: the console opens an ordinary window
  screens.assign('output', projector);
  assert.equal(saves(), 1);
  const win = screens.windows.output;
  assert.equal(win.url, 'http://127.0.0.1:8642/output.html?display');
  assert.deepEqual([win.bounds, win.fullScreen, win.top, win.visible], [projector.bounds, true, true, true]);
  assert.equal(screens.show('output'), true);
  assert.equal(electron.opened.length, 1); // the button brings the same window up again
});

it('does not keep a screen on top of the operator\'s own display', () => {
  const { screens } = manager([laptop, projector]);
  screens.assign('stage', laptop);
  assert.equal(screens.windows.stage.top, false);
});

it('closes a screen when its display is unplugged and brings it back when it returns', () => {
  const displays = [laptop, projector];
  const { screens, electron } = manager(displays);
  screens.assign('output', projector);
  displays.pop();
  electron.screen.emit('display-removed');
  assert.equal(screens.windows.output, undefined); // not moved onto the operator's screen
  assert.equal(screens.show('output'), false);
  displays.push(display(5, 'EPSON PJ')); // reconnected, with a new id
  electron.screen.emit('display-added');
  assert.deepEqual(screens.windows.output.bounds, projector.bounds);
});

it('reopens the chosen screens at start and closes one set back to a window', () => {
  const { screens, settings } = manager([laptop, projector], { screens: { output: remember(projector) } });
  screens.place();
  const win = screens.windows.output;
  assert.ok(win);
  screens.assign('output', null);
  assert.equal(win.destroyed, true);
  assert.equal(settings.screens.output, null);
});
