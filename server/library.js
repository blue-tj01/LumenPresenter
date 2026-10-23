// The library, kept in an SQLite database (data/lumen.db): one row per presentation and one per service, so a large
// library is saved a row at a time, and room for more tables as Lumen grows. The rest of the library (playlist,
// themes, media list, messages, and any field Lumen adds later) is kept as named JSON values.
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { nowMs, readJson, isObject } = require('./util.js');
const { plainWords } = require('../console/words.js'); // the words without their **bold** and {gold}colour{/} marks

const FILE = 'lumen.db';
const LEGACY = 'library.json'; // the library before it moved into the database

/** Schema changes, in order; the database's user_version says how many have been made. */
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
   CREATE TABLE presentations (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, data TEXT NOT NULL) STRICT;
   CREATE INDEX presentations_id ON presentations (id);`,
  // Song search: one row per presentation, its rowid the presentation's pos. Accents and case are ignored, and
  // prefixes are indexed so a word matches while it is still being typed.
  `CREATE VIRTUAL TABLE search USING fts5 (name, author, copyright, ccli, lyrics,
     tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');`,
  `CREATE TABLE services (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, date TEXT, data TEXT NOT NULL) STRICT;
   CREATE INDEX services_date ON services (date);`,
];
const SEARCH_WEIGHTS = [10, 4, 1, 4, 1]; // a match in the name counts most, then author or song number
const MARK = ['\u0002', '\u0003'];     // around matched words in a search result's snippet
const MAX_RESULTS = 100;

/** What search indexes of a presentation, in either library format. Media lines are left out of the words. */
function searchFields(p) {
  if (!isObject(p)) return ['', '', '', '', ''];
  const meta = isObject(p.meta) ? p.meta : {};
  const text = s => plainWords((typeof s === 'string' ? s : isObject(s) ? String(s.text ?? '') : '')
    .split('\n').filter(l => !l.trimStart().startsWith('@')).join('\n'));
  const lyrics = (Array.isArray(p.groups) ? p.groups : [])
    .flatMap(g => (isObject(g) && Array.isArray(g.slides) ? g.slides : []).map(text)).join('\n');
  return [p.name, meta.author, meta.copyright, meta.ccli, lyrics].map(v => String(v ?? ''));
}

/** Words as typed, as an FTS5 query: every word must match the start of a word, so a few letters of each is
 * enough. Quoting each word keeps FTS5's own syntax (AND, NEAR, column:, quotes) out of what people type. */
function searchQuery(q) {
  const words = String(q).match(/[\p{L}\p{N}]+/gu) || [];
  return words.map(w => `"${w}"*`).join(' ');
}

/** Lists in the library kept a row per item, with the fields copied into columns so they can be searched. A list
 * the library leaves out has no rows, and is left out again when it is read back (services, which older libraries
 * do not have, is optional). */
const TABLES = { presentations: ['id', 'name'], services: ['id', 'name', 'date'] };

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
    this.reindex();
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
    this.rows = {};
    for (const t of Object.keys(TABLES)) this.rows[t] = this.db.prepare(`SELECT data FROM ${t} ORDER BY pos`).all().map(r => r.data);
    if (this.saved === null) { this.library = null; return; }
    const library = {};
    for (const [k, v] of Object.entries(meta)) if (k.startsWith('library.')) library[k.slice(8)] = v;
    for (const [t, rows] of Object.entries(this.rows)) if (t === 'presentations' || rows.length) library[t] = rows.map(r => JSON.parse(r));
    this.library = library;
  }

  /** Replace the library; only presentations and services that changed are written. Returns the new revision. */
  set(library) {
    this.write(library, this.rev + 1, nowMs());
    return this.rev;
  }

  write(library, rev, saved) {
    const lists = Object.fromEntries(Object.keys(TABLES).map(t => [t, Array.isArray(library[t]) ? library[t] : []]));
    const rows = Object.fromEntries(Object.entries(lists).map(([t, items]) => [t, items.map(x => JSON.stringify(x))]));
    this.transaction(() => {
      for (const [t, cols] of Object.entries(TABLES)) {
        const put = this.db.prepare(`INSERT OR REPLACE INTO ${t} (pos, ${cols.join(', ')}, data) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`);
        rows[t].forEach((data, pos) => {
          if (this.rows?.[t]?.[pos] === data) return;
          const x = lists[t][pos];
          put.run(pos, ...cols.map(c => isObject(x) ? String(x[c] ?? '') : ''), data);
          if (t === 'presentations') this.index(pos, x);
        });
        this.db.prepare(`DELETE FROM ${t} WHERE pos >= ?`).run(rows[t].length);
      }
      this.db.prepare('DELETE FROM search WHERE rowid >= ?').run(rows.presentations.length);
      const set = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
      const keys = Object.keys(library).filter(k => !(k in TABLES && Array.isArray(library[k])));
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

  index(pos, p) {
    this.db.prepare('DELETE FROM search WHERE rowid = ?').run(pos);
    this.db.prepare('INSERT INTO search (rowid, name, author, copyright, ccli, lyrics) VALUES (?, ?, ?, ?, ?, ?)')
      .run(pos, ...searchFields(p));
  }

  /** Build the search index again when it doesn't match the library: a database from before search, or one
   * changed by hand. */
  reindex() {
    const n = this.db.prepare('SELECT count(*) AS n FROM search').get().n;
    if (n === this.rows.presentations.length) return;
    this.transaction(() => {
      this.db.exec('DELETE FROM search');
      (this.library?.presentations || []).forEach((p, pos) => this.index(pos, p));
    });
  }

  /** Presentations matching the words typed, best first: [{id, name, snippet}], where the snippet is a line of
   * the words with each match between \u0002 and \u0003, or '' when only the name matched. */
  search(q, limit = MAX_RESULTS) {
    const match = searchQuery(q);
    if (!match || !this.library) return [];
    const rows = this.db.prepare(`SELECT rowid AS pos, snippet(search, 4, ?, ?, '…', 10) AS lyrics,
        snippet(search, 1, ?, ?, '…', 10) AS author
      FROM search WHERE search MATCH ? ORDER BY bm25(search, ${SEARCH_WEIGHTS.join(', ')}) LIMIT ?`)
      .all(...MARK, ...MARK, match, Math.max(1, Math.min(limit, MAX_RESULTS)));
    return rows.map(r => {
      const p = this.library.presentations[r.pos];
      const snippet = [r.author, r.lyrics].find(s => s.includes(MARK[0])) || '';
      return isObject(p) ? { id: p.id, name: String(p.name ?? ''), snippet: snippet.replace(/\s*\n\s*/g, ' / ') } : null;
    }).filter(Boolean);
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

module.exports = { Library, FILE, LEGACY, searchQuery };
