// The library, kept in an SQLite database (data/lumen.db): one row per presentation, so a large library is saved
// a presentation at a time, and room for more tables as Lumen grows. The rest of the library (playlist, themes,
// media list, messages, and any field Lumen adds later) is kept as named JSON values.
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { nowMs, readJson, isObject } = require('./util.js');

const FILE = 'lumen.db';
const LEGACY = 'library.json'; // the library before it moved into the database

/** Schema changes, in order; the database's user_version says how many have been made. */
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
   CREATE TABLE presentations (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, data TEXT NOT NULL) STRICT;
   CREATE INDEX presentations_id ON presentations (id);`,
];

/** before-database-20261020-181500, in local time. */
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

class Library {
  constructor(dir, backupDir) {
    this.path = path.join(dir, FILE);
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.load();
    this.importLegacy(path.join(dir, LEGACY), backupDir);
  }

  migrate() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version >= MIGRATIONS.length) return;
    this.transaction(() => {
      MIGRATIONS.slice(version).forEach(sql => this.db.exec(sql));
      this.db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    });
  }

  /** A library.json found at startup (from before the database, from the Python server, or copied in) becomes the
   * library. It is then moved to backups/before-database-<time>/, with the library it replaced beside it, so it
   * is clear which copy is current and nothing is lost. */
  importLegacy(file, backupDir) {
    if (!fs.existsSync(file)) return;
    const old = readJson(file);
    const keep = path.join(backupDir, `before-database-${stamp()}`);
    fs.mkdirSync(keep, { recursive: true });
    if (this.library !== null) fs.writeFileSync(path.join(keep, 'replaced-library.json'), this.snapshot());
    if (isObject(old) && isObject(old.library) && Array.isArray(old.library.presentations)) {
      this.write(old.library, old.rev ?? 0, old.saved ?? nowMs());
    }
    fs.renameSync(file, path.join(keep, LEGACY));
  }

  /** The whole library, as the console saves it, kept in memory for reads. */
  load() {
    const meta = Object.fromEntries(this.db.prepare('SELECT key, value FROM meta').all().map(r => [r.key, JSON.parse(r.value)]));
    this.rev = meta.rev ?? 0;
    this.saved = meta.saved ?? null;
    this.rows = this.db.prepare('SELECT data FROM presentations ORDER BY pos').all().map(r => r.data);
    if (this.saved === null) { this.library = null; return; }
    const library = {};
    for (const [k, v] of Object.entries(meta)) if (k.startsWith('library.')) library[k.slice(8)] = v;
    library.presentations = this.rows.map(r => JSON.parse(r));
    this.library = library;
  }

  /** Replace the library; only presentations that changed are written. Returns the new revision. */
  set(library) {
    this.write(library, this.rev + 1, nowMs());
    return this.rev;
  }

  write(library, rev, saved) {
    const rows = library.presentations.map(p => JSON.stringify(p));
    this.transaction(() => {
      const put = this.db.prepare('INSERT OR REPLACE INTO presentations (pos, id, name, data) VALUES (?, ?, ?, ?)');
      rows.forEach((data, pos) => {
        if (this.rows?.[pos] === data) return;
        const p = library.presentations[pos];
        put.run(pos, isObject(p) ? String(p.id ?? '') : '', isObject(p) ? String(p.name ?? '') : '', data);
      });
      this.db.prepare('DELETE FROM presentations WHERE pos >= ?').run(rows.length);
      const set = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      const keys = Object.keys(library).filter(k => k !== 'presentations');
      for (const k of keys) set.run(`library.${k}`, JSON.stringify(library[k] ?? null));
      const gone = this.db.prepare("SELECT key FROM meta WHERE key LIKE 'library.%'").all()
        .map(r => r.key).filter(k => !keys.includes(k.slice(8)));
      for (const k of gone) this.db.prepare('DELETE FROM meta WHERE key = ?').run(k);
      set.run('rev', JSON.stringify(rev));
      set.run('saved', JSON.stringify(saved));
    });
    this.rev = rev;
    this.saved = saved;
    this.rows = rows;
    this.library = library;
  }

  /** The library as one JSON document: what backups hold and what library.json used to. */
  snapshot() {
    return JSON.stringify({ rev: this.rev, saved: this.saved, library: this.library });
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { fn(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }
}

module.exports = { Library, FILE, LEGACY };
