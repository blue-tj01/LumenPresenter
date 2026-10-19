// Bringing a library in from another data folder, e.g. the one next to server.js in a copy of the source.
'use strict';
const fs = require('fs');
const path = require('path');

const FILES = ['library.json', 'live.json', 'settings.json'];
const DIRS = ['media', 'backups'];

const isDataFolder = dir => fs.existsSync(path.join(dir, 'library.json'));

/** Copy the library, live state, settings (token and signed-in devices), media and backups from one data folder
 * into another, first saving the files being replaced into to/backups/before-import-<time>. Media already in
 * `to` stays: the names are random, so nothing is overwritten. Returns where the old files were kept. */
function importDataFolder(from, to, now = Date.now()) {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) throw new Error('That is the data folder Lumen is already using.');
  if (!isDataFolder(from)) throw new Error('That folder has no Lumen library in it.');
  const keep = path.join(to, 'backups', `before-import-${now}`);
  fs.mkdirSync(keep, { recursive: true });
  for (const f of FILES) if (fs.existsSync(path.join(to, f))) fs.copyFileSync(path.join(to, f), path.join(keep, f));
  for (const f of [...FILES, ...DIRS]) {
    const src = path.join(from, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(to, f), { recursive: true, force: true });
  }
  return keep;
}

module.exports = { importDataFolder, isDataFolder };
