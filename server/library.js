// @ts-check
// The library, kept in an SQLite database (data/lumen.db): one row per presentation and one per service, so a large
// library is saved a row at a time, and room for more tables as Lumen grows. The rest of the library (playlist,
// themes, media list, messages, and any field Lumen adds later) is kept as named JSON values.
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { bad, nowMs, readJson, isObject } = require('./util.js');
const { plainWords } = require('../console/words.js'); // the words without their **bold** and {gold}colour{/} marks

const FILE = 'lumen.db';
const LEGACY = 'library.json'; // the library before it moved into the database

/** Schema changes, in order; the database's user_version says how many have been made. A change is SQL, or a
 * function given the database for one that needs more than SQL. */
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
   CREATE TABLE presentations (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, data TEXT NOT NULL) STRICT;
   CREATE INDEX presentations_id ON presentations (id);`,
  // Song search: one row per presentation, its rowid the presentation's row number. Accents and case are ignored,
  // and prefixes are indexed so a word matches while it is still being typed.
  `CREATE VIRTUAL TABLE search USING fts5 (name, author, copyright, ccli, lyrics,
     tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');`,
  `CREATE TABLE services (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, date TEXT, data TEXT NOT NULL) STRICT;
   CREATE INDEX services_date ON services (date);`,
  // Rows found by id rather than by place, so adding or moving one leaves the rest alone, each with the revision
  // that last changed it; and the presentations and services deleted lately, so a change made to one somewhere
  // else at the same time is noticed. A row keeps its number (the search index's rowid) as it was.
  db => {
    for (const [t, cols] of Object.entries(TABLES)) {
      const old = db.prepare(`SELECT pos, ${cols.join(', ')}, data FROM ${t} ORDER BY pos`).all();
      db.exec(`DROP TABLE ${t};
        CREATE TABLE ${t} (n INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, pos INTEGER NOT NULL,
          rev INTEGER NOT NULL DEFAULT 0, ${cols.filter(c => c !== 'id').map(c => `${c} TEXT`).join(', ')}, data TEXT NOT NULL) STRICT;`);
      const keys = new Set();
      const put = db.prepare(`INSERT INTO ${t} (n, key, pos, ${cols.filter(c => c !== 'id').join(', ')}, data) VALUES (?, ?, ?, ${cols.filter(c => c !== 'id').map(() => '?').join(', ')}, ?)`);
      old.forEach(r => {
        let x; try { x = JSON.parse(r.data); } catch { x = null; }
        put.run(r.pos, keyFor(x, keys, r.pos), r.pos, ...cols.filter(c => c !== 'id').map(c => r[c]), r.data);
      });
    }
    db.exec('CREATE TABLE removed (tbl TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY (tbl, id)) STRICT;');
  },
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
const COLS = Object.fromEntries(Object.entries(TABLES).map(([t, cols]) => [t, cols.filter(c => c !== 'id')]));
const TOMBSTONES = 5000; // deleted ids remembered, newest first, to notice a change made to one elsewhere

/** The key a row is found by: the item's id, or for one without a usable id (none, or one already taken) a key of
 * its own, which the console never names in a change. */
function keyFor(x, taken, n) {
  let key = isObject(x) && typeof x.id === 'string' && x.id && !x.id.startsWith('#') && !taken.has(x.id) ? x.id : null;
  if (key === null) for (let i = n; taken.has(key = `#${i}`); i++);
  taken.add(key);
  return key;
}

/** Whether `next` is `prev` with some keys taken out and new ones added at the end: an order a change need not
 * send, as anyone can work it out from what was removed and added. */
function appendOnly(prev, next) {
  const had = new Set(prev), has = new Set(next);
  const kept = prev.filter(k => has.has(k)), added = next.filter(k => !had.has(k));
  return next.length === kept.length + added.length && [...kept, ...added].every((k, i) => k === next[i]);
}

/** A list field (themes, media, fonts, messages, the playlist, the usage record) merged with one console's change
 * to it, {mode, put, remove, order}: items found by id ('id') or, for plain values, by the value itself ('value').
 * Items added or removed elsewhere stay as they are. Null when the field as kept here can't be read that way. */
function mergeField(cur, c, mode) {
  const keyOf = mode === 'id' ? x => (isObject(x) && typeof x.id === 'string' ? x.id : null) : x => JSON.stringify(x);
  const list = Array.isArray(cur) ? cur : [];
  const keys = list.map(keyOf);
  if (keys.includes(null) || new Set(keys).size !== keys.length) return null;
  const byKey = new Map(list.map((x, i) => [keys[i], x]));
  for (const k of Array.isArray(c.remove) ? c.remove : []) byKey.delete(k);
  const added = [];
  for (const x of Array.isArray(c.put) ? c.put : []) {
    const k = keyOf(x);
    if (k === null) return null;
    if (!byKey.has(k) && !keys.includes(k)) added.push(k);
    byKey.set(k, x);
  }
  const want = Array.isArray(c.order) ? c.order.filter(k => byKey.has(k)) : keys.filter(k => byKey.has(k));
  const order = [...new Set([...want, ...keys.filter(k => byKey.has(k)), ...added])];
  return order.map(k => byKey.get(k));
}

/** before-database-20261020-181500, in local time. */
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

class Library {
  constructor(dir, backupDir) {
    /** @type {any} the library as the console saves it, or null before the first save */
    this.library = null;
    this.path = path.join(dir, FILE);
    this.db = new DatabaseSync(this.path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
    this.migrate();
    this.load();
    this.reindex();
    this.importLegacy(path.join(dir, LEGACY), backupDir);
  }

  migrate() {
    const version = Number(this.db.prepare('PRAGMA user_version').get().user_version);
    if (version >= MIGRATIONS.length) return;
    this.transaction(() => {
      MIGRATIONS.slice(version).forEach(m => typeof m === 'function' ? m(this.db) : this.db.exec(m));
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

  /** The whole library, as the console saves it, kept in memory for reads: this.library, and each list's rows
   * by key (this.rows) in order (this.order). */
  load() {
    const meta = Object.fromEntries(this.db.prepare('SELECT key, value FROM meta').all().map(r => [r.key, String(r.value)]));
    this.rev = JSON.parse(meta.rev ?? '0');
    this.saved = JSON.parse(meta.saved ?? 'null');
    this.meta = {}; this.fields = {}; // the library's other fields, as saved JSON and as values
    for (const [k, v] of Object.entries(meta)) if (k.startsWith('library.')) { this.meta[k.slice(8)] = v; this.fields[k.slice(8)] = JSON.parse(v); }
    this.rows = {}; this.order = {};
    for (const t of Object.keys(TABLES)) {
      this.rows[t] = new Map(this.db.prepare(`SELECT n, key, rev, data FROM ${t} ORDER BY pos`).all()
        .map(r => [String(r.key), { n: Number(r.n), rev: Number(r.rev), json: String(r.data), value: JSON.parse(String(r.data)) }]));
      this.order[t] = [...this.rows[t].keys()];
    }
    this.compose();
  }

  /** this.library from the rows and fields. */
  compose() {
    if (this.saved === null) { this.library = null; return; }
    const library = { ...this.fields };
    for (const t of Object.keys(TABLES)) {
      if (t === 'presentations' || this.order[t].length) library[t] = this.order[t].map(k => this.rows[t].get(k).value);
    }
    this.library = library;
  }

  /** Replace the library; only presentations, services and fields that changed are written. Returns the new
   * revision. */
  set(library) {
    this.write(library, this.rev + 1, nowMs());
    return this.rev;
  }

  write(library, rev, saved) {
    const changes = { set: {}, unset: [] };
    for (const t of Object.keys(TABLES)) {
      const items = Array.isArray(library[t]) ? library[t] : [];
      const taken = new Set();
      const keyed = items.map((x, i) => [keyFor(x, taken, i), x]);
      const keep = new Set(keyed.map(([k]) => k));
      changes[t] = { put: keyed, remove: this.order[t].filter(k => !keep.has(k)), order: keyed.map(([k]) => k) };
    }
    for (const [k, v] of Object.entries(library)) if (!(k in TABLES && Array.isArray(v))) changes.set[k] = v ?? null;
    changes.unset = Object.keys(this.meta).filter(k => !(k in changes.set));
    this.transaction(() => this.apply(changes, rev, saved));
  }

  /** Changes made in one console since it last had the library at revision `base`: for each list, {put: [items],
   * remove: [ids], order: [ids]}, fields to set and unset, and list fields to merge (mergeField). A presentation or service changed or deleted here
   * since `base` is not touched, and is listed in `conflicts` instead; the rest is applied, the list's order
   * merged with items added elsewhere. Returns {rev, prev, conflicts, resend, applied}: `resend` names merged
   * fields to send whole instead, and `applied` is what changed, in the same form (merged fields as set), to send
   * to the other windows (or null when nothing did). */
  patch(changes, base) {
    const prev = this.rev;
    const conflicts = [];
    const out = { set: {}, unset: [] };
    let changed = false;
    const removedAt = this.db.prepare('SELECT rev FROM removed WHERE tbl = ? AND id = ?');
    for (const t of Object.keys(TABLES)) {
      const c = isObject(changes[t]) ? changes[t] : {};
      const rows = this.rows[t];
      const busy = (id, json) => {
        const r = rows.get(id);
        if (r) return r.rev > base && r.json !== json;
        return (removedAt.get(t, id)?.rev ?? -1) > base;
      };
      const put = [];
      for (const x of Array.isArray(c.put) ? c.put : []) {
        if (!isObject(x) || typeof x.id !== 'string' || !x.id || x.id.startsWith('#')) throw bad(`${t}: every item needs an id`);
        if (busy(x.id, JSON.stringify(x))) conflicts.push({ list: t, id: x.id, name: String(rows.get(x.id)?.value?.name ?? x.name ?? '') });
        else if (rows.get(x.id)?.json !== JSON.stringify(x)) put.push([x.id, x]);
      }
      const remove = [];
      for (const id of Array.isArray(c.remove) ? c.remove : []) {
        if (!rows.has(id)) continue;
        if (rows.get(id).rev > base) conflicts.push({ list: t, id, name: String(rows.get(id).value?.name ?? '') });
        else remove.push(id);
      }
      // The order asked for, less anything not there, then anything added elsewhere (or not named) where it was.
      const gone = new Set(remove);
      const exists = id => !gone.has(id) && (rows.has(id) || put.some(([k]) => k === id));
      const want = Array.isArray(c.order) ? c.order.filter((id, i, a) => typeof id === 'string' && exists(id) && a.indexOf(id) === i) : null;
      let order = want ?? this.order[t].filter(k => !gone.has(k));
      const named = new Set(order);
      order = [...order, ...this.order[t].filter(k => !gone.has(k) && !named.has(k)), ...new Set(put.map(([k]) => k).filter(k => !named.has(k) && !rows.has(k)))];
      const moved = order.length !== this.order[t].length || order.some((k, i) => k !== this.order[t][i]);
      if (put.length || remove.length || moved) {
        changed = true;
        // The order goes to the other windows only when they can't work it out (more than removing and appending).
        out[t] = { put: put.map(([, x]) => x), remove, ...(appendOnly(this.order[t], order) ? {} : { order }) };
        out[t]._apply = { put, remove, order };
      }
    }
    for (const [k, v] of Object.entries(isObject(changes.set) ? changes.set : {})) {
      if (k in TABLES || this.meta[k] === JSON.stringify(v ?? null)) continue;
      out.set[k] = v ?? null; changed = true;
    }
    // Lists kept as fields, merged an item at a time; one that can't be read that way is asked for whole.
    const resend = [];
    for (const [k, c] of Object.entries(isObject(changes.merge) ? changes.merge : {})) {
      if (k in TABLES || k in out.set || !isObject(c)) continue;
      const merged = mergeField(this.fields[k], c, c.mode === 'id' ? 'id' : 'value');
      if (merged === null) { resend.push(k); continue; }
      if (this.meta[k] !== JSON.stringify(merged)) { out.set[k] = merged; changed = true; }
    }
    for (const k of Array.isArray(changes.unset) ? changes.unset : []) {
      if (typeof k === 'string' && k in this.meta && !(k in out.set)) { out.unset.push(k); changed = true; }
    }
    if (!changed) return { rev: this.rev, prev, conflicts, resend, applied: null };
    const apply = { set: out.set, unset: out.unset };
    for (const t of Object.keys(TABLES)) if (out[t]) { apply[t] = out[t]._apply; delete out[t]._apply; }
    this.transaction(() => this.apply(apply, this.rev + 1, nowMs()));
    return { rev: this.rev, prev, conflicts, resend, applied: out };
  }

  /** Write changes, each list's as {put: [[key, item]], remove: [keys], order: [keys]}, as revision `rev`. */
  apply(changes, rev, saved) {
    for (const [t, cols] of Object.entries(COLS)) {
      const c = changes[t];
      if (!c) continue;
      const rows = this.rows[t];
      const insert = this.db.prepare(`INSERT INTO ${t} (key, pos, rev, ${cols.join(', ')}, data) VALUES (?, -1, ?, ${cols.map(() => '?').join(', ')}, ?)`);
      const update = this.db.prepare(`UPDATE ${t} SET rev = ?, ${cols.map(c => `${c} = ?`).join(', ')}, data = ? WHERE n = ?`);
      const forget = this.db.prepare('DELETE FROM removed WHERE tbl = ? AND id = ?');
      for (const [key, x] of c.put) {
        const json = JSON.stringify(x);
        const r = rows.get(key);
        if (r?.json === json) continue;
        const fields = cols.map(f => isObject(x) ? String(x[f] ?? '') : '');
        if (r) { update.run(rev, ...fields, json, r.n); Object.assign(r, { rev, json, value: JSON.parse(json) }); }
        else {
          const n = Number(insert.run(key, rev, ...fields, json).lastInsertRowid);
          rows.set(key, { n, rev, json, value: JSON.parse(json) });
          forget.run(t, key);
        }
        if (t === 'presentations') this.index(rows.get(key).n, x);
      }
      const del = this.db.prepare(`DELETE FROM ${t} WHERE n = ?`);
      const tomb = this.db.prepare('INSERT OR REPLACE INTO removed (tbl, id, rev) VALUES (?, ?, ?)');
      for (const key of c.remove) {
        const r = rows.get(key);
        if (!r) continue;
        del.run(r.n);
        if (t === 'presentations') this.db.prepare('DELETE FROM search WHERE rowid = ?').run(r.n);
        if (!key.startsWith('#')) tomb.run(t, key, rev);
        rows.delete(key);
      }
      const pos = this.db.prepare(`UPDATE ${t} SET pos = ? WHERE n = ?`);
      const old = new Map(this.order[t].map((k, i) => [k, i]));
      c.order.forEach((k, i) => { if (old.get(k) !== i || !old.has(k)) pos.run(i, rows.get(k).n); });
      this.order[t] = c.order;
    }
    const set = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(changes.set || {})) {
      const json = JSON.stringify(v ?? null);
      if (this.meta[k] !== json) { set.run(`library.${k}`, json); this.meta[k] = json; this.fields[k] = JSON.parse(json); }
    }
    for (const k of changes.unset || []) { this.db.prepare('DELETE FROM meta WHERE key = ?').run(`library.${k}`); delete this.meta[k]; delete this.fields[k]; }
    this.db.prepare('DELETE FROM removed WHERE rev <= (SELECT rev FROM removed ORDER BY rev DESC LIMIT 1 OFFSET ?)').run(TOMBSTONES);
    set.run('rev', JSON.stringify(rev));
    set.run('saved', JSON.stringify(saved));
    this.rev = rev;
    this.saved = saved;
    this.compose();
  }

  index(n, p) {
    this.db.prepare('DELETE FROM search WHERE rowid = ?').run(n);
    this.db.prepare('INSERT INTO search (rowid, name, author, copyright, ccli, lyrics) VALUES (?, ?, ?, ?, ?, ?)')
      .run(n, ...searchFields(p));
  }

  /** Build the search index again when it doesn't match the library: a database from before search, or one
   * changed by hand. */
  reindex() {
    const n = this.db.prepare('SELECT count(*) AS n FROM search').get().n;
    if (n === this.rows.presentations.size) return;
    this.transaction(() => {
      this.db.exec('DELETE FROM search');
      for (const r of this.rows.presentations.values()) this.index(r.n, r.value);
    });
  }

  /** Presentations matching the words typed, best first: [{id, name, snippet}], where the snippet is a line of
   * the words with each match between \u0002 and \u0003, or '' when only the name matched. */
  search(q, limit = MAX_RESULTS) {
    const match = searchQuery(q);
    if (!match || !this.library) return [];
    const rows = this.db.prepare(`SELECT p.data AS data, snippet(search, 4, ?, ?, '…', 10) AS lyrics,
        snippet(search, 1, ?, ?, '…', 10) AS author
      FROM search JOIN presentations p ON p.n = search.rowid
      WHERE search MATCH ? ORDER BY bm25(search, ${SEARCH_WEIGHTS.join(', ')}) LIMIT ?`)
      .all(...MARK, ...MARK, match, Math.max(1, Math.min(limit, MAX_RESULTS)));
    return rows.map(r => {
      const p = JSON.parse(String(r.data));
      const snippet = [r.author, r.lyrics].map(s => String(s ?? '')).find(s => s.includes(MARK[0])) || '';
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
