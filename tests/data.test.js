// Tests for electron/data.js: importing a library from another data folder. Run with: npm test
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { it } = require('node:test');
const { importDataFolder } = require('../electron/data.js');

function folder(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-data-'));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');

it('copies the library, settings and media over, keeping what was there', () => {
  const old = folder({ 'library.json': 'old library', 'settings.json': 'old token', 'media/aaaaaaaaaaaaaaaa.png': 'pic',
    'backups/library-20261001-120000.json': 'snapshot' });
  const app = folder({ 'library.json': 'fresh library', 'settings.json': 'fresh token', 'media/bbbbbbbbbbbbbbbb.mp4': 'clip' });
  const keep = importDataFolder(old, app, 42);
  assert.equal(read(app, 'library.json'), 'old library');
  assert.equal(read(app, 'settings.json'), 'old token');
  assert.equal(read(app, 'media/aaaaaaaaaaaaaaaa.png'), 'pic');
  assert.equal(read(app, 'media/bbbbbbbbbbbbbbbb.mp4'), 'clip');
  assert.equal(read(app, 'backups/library-20261001-120000.json'), 'snapshot');
  assert.equal(keep, path.join(app, 'backups', 'before-import-42'));
  assert.equal(read(keep, 'library.json'), 'fresh library');
  assert.equal(read(keep, 'settings.json'), 'fresh token');
  assert.equal(read(old, 'library.json'), 'old library'); // the source is left alone
});

it('refuses a folder with no library, or the folder already in use', () => {
  const app = folder({ 'library.json': 'x' });
  assert.throws(() => importDataFolder(folder({ 'notes.txt': 'x' }), app), /no Lumen library/);
  assert.throws(() => importDataFolder(app, app), /already using/);
});
