// Media folders: pictures and videos played from a folder on this computer, with no upload.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HttpError, bad, unquote } = require('./util.js');
const { mediaKind } = require('./media.js');

const FOLDER_DEPTH = 6;      // levels of subfolders listed in a media folder
const FOLDER_FILES = 5000;   // files listed per media folder
const FOLDER_SKIP = /^(?:\.|\$|~\$|System Volume Information$|node_modules$)/i; // hidden, system and lock files

/** Whether a path is inside a folder (a drive root such as E:\\ included). */
const inside = (child, dir) => child.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const folderId = dir => crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 12);

/** Folders on this computer whose pictures and videos Lumen plays where they are, with no upload: a shared
 * worship-loops folder, say. Those given with --media-folder are fixed; the rest are added and removed in the
 * console and kept in settings.json. Each is served under /folders/<id>/. */
class Folders {
  constructor(store, fixed, changed) {
    this.store = store;
    this.fixed = fixed.filter(Boolean).map(d => ({ id: folderId(d), path: path.resolve(d), fixed: true }));
    this.changed = changed;
    this.watchers = new Map(); // folder id -> fs.watch handle
    this.timer = null;
    if (!Array.isArray(store.settings.folders)) store.settings.folders = [];
  }

  list() {
    const seen = new Set();
    return [...this.fixed, ...this.store.settings.folders.map(f => ({ id: f.id, path: f.path, fixed: false }))]
      .filter(f => !seen.has(f.id) && seen.add(f.id));
  }

  get(id) { return this.list().find(f => f.id === id) || null; }

  add(dir) {
    if (typeof dir !== 'string' || !dir.trim()) throw bad('folder path missing');
    const full = path.resolve(dir.trim());
    let stat;
    try { stat = fs.statSync(full); } catch { throw bad(`no folder at ${full}`); }
    if (!stat.isDirectory()) throw bad(`${full} is not a folder`);
    if (full === this.store.dir || inside(full, this.store.dir) || inside(this.store.dir, full)) {
      throw bad('the data folder cannot be a media folder');
    }
    const id = folderId(full);
    if (!this.get(id)) this.store.saveSettings({ folders: [...this.store.settings.folders, { id, path: full }] });
    this.watch();
    return id;
  }

  remove(id) {
    if (this.fixed.some(f => f.id === id)) throw new HttpError(409, 'that folder is set with --media-folder');
    this.store.saveSettings({ folders: this.store.settings.folders.filter(f => f.id !== id) });
    this.watch();
  }

  /** The pictures and videos in a folder and its subfolders, as paths relative to it with / between parts. */
  async files(folder) {
    const out = [];
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const e of entries) {
        if (out.length >= FOLDER_FILES || FOLDER_SKIP.test(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < FOLDER_DEPTH) await walk(path.join(dir, e.name), r, depth + 1); continue; }
        const type = (e.isFile() || e.isSymbolicLink()) && mediaKind(e.name);
        if (type) out.push({ path: r, name: e.name, type });
      }
    };
    await walk(folder.path, '', 0);
    return out;
  }

  /** The file a /folders/<id>/<path> request names, or null. Only pictures and videos inside the folder are
   * served: no parent directories, links out of it, or Windows alternate streams (name:stream). */
  resolve(id, rel) {
    const folder = this.get(id);
    if (!folder) return null;
    const parts = rel.split('/').map(unquote);
    if (!parts.length || parts.some(x => !x || x === '.' || x === '..' || /[\\/:\0]/.test(x))) return null;
    if (!mediaKind(parts[parts.length - 1])) return null;
    try {
      const root = fs.realpathSync(folder.path);
      const file = fs.realpathSync(path.join(folder.path, ...parts));
      return inside(file, root) && mediaKind(file) ? file : null;
    } catch { return null; }
  }

  /** Tell the consoles when files are added, removed or renamed in any folder. */
  watch() {
    const ids = new Set(this.list().map(f => f.id));
    for (const [id, w] of this.watchers) if (!ids.has(id)) { w.close(); this.watchers.delete(id); }
    for (const f of this.list()) {
      if (this.watchers.has(f.id)) continue;
      try {
        const w = fs.watch(f.path, { recursive: true, persistent: false }, () => this.touched());
        w.on('error', () => { w.close(); this.watchers.delete(f.id); });
        this.watchers.set(f.id, w);
      } catch {} // missing, or watching unsupported here: the list still updates when the console asks
    }
    this.touched();
  }

  touched() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed(), 500);
    this.timer.unref();
  }

  close() {
    clearTimeout(this.timer);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}

module.exports = { Folders, inside, folderId };
