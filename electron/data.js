// @ts-check
// Bringing a library in from another data folder, e.g. the one next to server.js in a copy of the source.
'use strict';
const fs = require('fs');
const path = require('path');

// The library database (with the files SQLite keeps beside it while it is open), or library.json from before it.
const LIBRARY = ['lumen.db', 'lumen.db-wal', 'lumen.db-shm', 'library.json'];
const FILES = [...LIBRARY, 'live.json', 'settings.json'];
const DIRS = ['media', 'backups'];

const isDataFolder = dir => ['lumen.db', 'library.json'].some(f => fs.existsSync(path.join(dir, f)));

/** Copy the library, live state, settings (token and signed-in devices), media and backups from one data folder
 * into another, first saving the files being replaced into to/backups/before-import-<time>. Media already in
 * `to` stays: the names are random, so nothing is overwritten. Returns where the old files were kept. */
function importDataFolder(from, to, now = Date.now()) {
  from = path.resolve(from); to = path.resolve(to);
  if (from === to) throw new Error('That is the data folder Lumen is already using.');
  if (!isDataFolder(from)) throw new Error('That folder has no Lumen library in it.');
  const keep = path.join(to, 'backups', `before-import-${now}`);
  fs.mkdirSync(keep, { recursive: true });
  for (const f of FILES) {
    const file = path.join(to, f);
    if (!fs.existsSync(file)) continue;
    // The library here is moved aside, not just copied, so none of its files mix with the one coming in.
    if (LIBRARY.includes(f)) fs.renameSync(file, path.join(keep, f));
    else fs.copyFileSync(file, path.join(keep, f));
  }
  for (const f of [...FILES, ...DIRS]) {
    const src = path.join(from, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(to, f), { recursive: true, force: true });
  }
  return keep;
}

module.exports = { importDataFolder, isDataFolder };
