// Bible translations in their own SQLite database (data/bibles.db), apart from the library so it stays small and
// its backups stay quick. Verses are indexed for full-text search. The translations that come with Lumen are
// added the first time they are used; others are imported from Zefania, OSIS or USFX files.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');
const { KNOWN, book, fromName, key } = require('./books.js');
const { parseBible } = require('./formats.js');
const { parseReference, formatReference } = require('./reference.js');

const FILE = 'bibles.db';
const BUNDLED_DIR = path.join(__dirname, '..', '..', 'bibles');
const MAX_PASSAGE = 400; // verses one reference may bring back
const MAX_RESULTS = 200;

/** The translations that come with Lumen, all in the public domain. Raise a version to replace the copy a data
 * folder already has. */
const BUNDLED = [
  { id: 'kjv', file: 'kjv.json.gz', version: 1, name: 'King James Version', abbrev: 'KJV', language: 'en',
    rights: 'Public domain' },
  { id: 'web', file: 'web.json.gz', version: 1, name: 'World English Bible', abbrev: 'WEB', language: 'en',
    rights: 'Public domain' },
  { id: 'bsb', file: 'bsb.json.gz', version: 1, name: 'Berean Standard Bible', abbrev: 'BSB', language: 'en',
    rights: 'Public domain' },
];

const MIGRATIONS = [
  `CREATE TABLE bibles (id TEXT PRIMARY KEY, name TEXT NOT NULL, abbrev TEXT NOT NULL, language TEXT NOT NULL,
     rights TEXT NOT NULL, format TEXT NOT NULL, bundled INTEGER NOT NULL, version INTEGER NOT NULL,
     added INTEGER NOT NULL) STRICT;
   CREATE TABLE books (bible TEXT NOT NULL REFERENCES bibles (id) ON DELETE CASCADE, number INTEGER NOT NULL,
     name TEXT NOT NULL, chapters INTEGER NOT NULL, PRIMARY KEY (bible, number)) STRICT;
   CREATE TABLE verses (id INTEGER PRIMARY KEY, bible TEXT NOT NULL, book INTEGER NOT NULL, chapter INTEGER NOT NULL,
     verse INTEGER NOT NULL, text TEXT NOT NULL) STRICT;
   CREATE UNIQUE INDEX verses_ref ON verses (bible, book, chapter, verse);
   CREATE VIRTUAL TABLE verses_fts USING fts5 (text, content = 'verses', content_rowid = 'id',
     tokenize = 'unicode61 remove_diacritics 2');`,
];

/** Words as a full-text query: every word must appear, the last one as the start of a word while it is being
 * typed. "In quotes" searches for the phrase. */
function ftsQuery(q) {
  const s = String(q).trim();
  const words = s.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) || [];
  if (!words.length) return null;
  const quoted = words.map(w => `"${w.replace(/’/g, "'")}"`);
  if (/^".*"$/.test(s) && words.length > 1) return `"${words.join(' ')}"`;
  if (!/[\s"]$/.test(q)) quoted[quoted.length - 1] += '*';
  return quoted.join(' ');
}

class Bibles {
  constructor(dir, bundledDir = BUNDLED_DIR) {
    this.bundledDir = bundledDir;
    this.db = new DatabaseSync(path.join(dir, FILE));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version < MIGRATIONS.length) {
      this.transaction(() => {
        MIGRATIONS.slice(version).forEach(sql => this.db.exec(sql));
        this.db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
      });
    }
  }

  /** Every translation: imported ones, and those that come with Lumen whether or not they have been used yet. */
  list() {
    const rows = this.db.prepare('SELECT id, name, abbrev, language, rights, bundled FROM bibles').all();
    const have = new Map(rows.map(r => [r.id, r]));
    const bundled = BUNDLED.filter(b => fs.existsSync(path.join(this.bundledDir, b.file)))
      .map(({ id, name, abbrev, language, rights }) => ({ id, name, abbrev, language, rights, bundled: true }));
    const imported = rows.filter(r => !r.bundled && !BUNDLED.some(b => b.id === r.id))
      .map(r => ({ ...r, bundled: false })).sort((a, b) => a.name.localeCompare(b.name));
    return [...bundled, ...imported].map(b => ({ ...b, ...(have.has(b.id) ? {} : { installed: false }) }));
  }

  /** A translation's row, adding it first if it comes with Lumen and isn't here yet (or is an older copy). */
  get(id) {
    const row = this.db.prepare('SELECT * FROM bibles WHERE id = ?').get(String(id));
    const b = BUNDLED.find(x => x.id === id);
    if (b && (!row || row.version < b.version)) {
      const file = path.join(this.bundledDir, b.file);
      if (!fs.existsSync(file)) return row || null;
      const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
      this.store(b.id, { ...data, name: b.name, abbrev: b.abbrev, language: b.language, rights: b.rights,
        format: 'bundled' }, { bundled: true, version: b.version });
      return this.db.prepare('SELECT * FROM bibles WHERE id = ?').get(b.id);
    }
    return row || null;
  }

  need(id) {
    if (!this.get(id)) throw Object.assign(new Error('no such translation'), { missing: true });
  }

  /** Import a Bible file (a Buffer, possibly gzipped); returns the new translation's entry. */
  import(buf, filename = '') {
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const bible = parseBible(decodeXml(buf));
    const base = path.basename(String(filename)).replace(/\.(xml|osis|usfx|zefania|gz)$/gi, '');
    if (!bible.name) bible.name = base || 'Imported Bible';
    if (!bible.abbrev) bible.abbrev = bible.name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 8);
    const slug = (bible.abbrev || bible.name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '').slice(0, 24) || 'bible';
    const taken = id => BUNDLED.some(b => b.id === id) || this.db.prepare('SELECT 1 FROM bibles WHERE id = ?').get(id);
    let id = slug;
    for (let n = 2; taken(id); n++) id = `${slug}-${n}`;
    this.store(id, { ...bible, rights: '' }, { bundled: false, version: 1 });
    const verses = bible.books.reduce((n, b) => n + b.verses.length, 0);
    return { id, name: bible.name, abbrev: bible.abbrev, language: bible.language, format: bible.format, verses,
      books: bible.books.length };
  }

  store(id, bible, { bundled, version }) {
    this.transaction(() => {
      this.drop(id);
      this.db.prepare('INSERT INTO bibles (id, name, abbrev, language, rights, format, bundled, version, added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, bible.name, bible.abbrev || '', bible.language || '', bible.rights || '', bible.format, bundled ? 1 : 0, version, Date.now());
      const addBook = this.db.prepare('INSERT INTO books (bible, number, name, chapters) VALUES (?, ?, ?, ?)');
      const addVerse = this.db.prepare('INSERT OR REPLACE INTO verses (bible, book, chapter, verse, text) VALUES (?, ?, ?, ?, ?)');
      for (const b of bible.books) {
        addBook.run(id, b.number, b.name || book(b.number)?.name || `Book ${b.number}`, Math.max(...b.verses.map(v => v[0])));
        for (const [chapter, verse, text] of b.verses) addVerse.run(id, b.number, chapter, verse, text);
      }
      this.db.prepare('INSERT INTO verses_fts (rowid, text) SELECT id, text FROM verses WHERE bible = ?').run(id);
    });
  }

  /** Remove an imported translation. The ones that come with Lumen stay. */
  remove(id) {
    if (BUNDLED.some(b => b.id === id)) throw new Error('the translations that come with Lumen cannot be removed');
    if (!this.db.prepare('SELECT 1 FROM bibles WHERE id = ?').get(id)) return false;
    this.transaction(() => this.drop(id));
    return true;
  }

  drop(id) {
    this.db.prepare("INSERT INTO verses_fts (verses_fts, rowid, text) SELECT 'delete', id, text FROM verses WHERE bible = ?").run(id);
    this.db.prepare('DELETE FROM verses WHERE bible = ?').run(id);
    this.db.prepare('DELETE FROM bibles WHERE id = ?').run(id);
  }

  books(id) {
    return this.db.prepare('SELECT number, name, chapters FROM books WHERE bible = ? ORDER BY number').all(id)
      .map(r => ({ ...r }));
  }

  /** A book's number from a name typed in a reference: this translation's own names first, then the usual English
   * names and abbreviations, then the start of a name if only one book has it. */
  findBook(id, name) {
    const k = key(name);
    const books = this.books(id);
    const own = books.find(b => key(b.name) === k);
    if (own) return own.number;
    const n = fromName(name);
    if (n && books.some(b => b.number === n)) return n;
    if (k.length < 2) return 0;
    const starts = books.filter(b => key(b.name).startsWith(k) || (b.number <= KNOWN && key(book(b.number).name).startsWith(k)));
    return starts.length === 1 ? starts[0].number : 0;
  }

  /** The verses a reference names, or null if the text is not a reference to this translation. */
  passage(id, text) {
    this.need(id);
    const refs = parseReference(text, name => this.findBook(id, name));
    if (!refs) return null;
    const q = this.db.prepare(`SELECT book, chapter, verse, text FROM verses WHERE bible = ? AND book = ?
      AND (chapter > ? OR (chapter = ? AND verse >= ?)) AND (chapter < ? OR (chapter = ? AND verse <= ?))
      ORDER BY chapter, verse LIMIT ${MAX_PASSAGE + 1}`);
    const end = this.db.prepare('SELECT max(verse) AS v FROM verses WHERE bible = ? AND book = ? AND chapter = ?');
    const all = this.books(id);
    const books = new Map(all.map(b => [b.number, b.name]));
    const verses = [], names = [];
    for (const { book: n, ranges } of refs) {
      const found = [];
      for (const [c1, v1, c2, v2] of ranges) {
        for (const r of q.all(id, n, c1, c1, v1 ?? 0, c2, c2, v2 ?? 1e9)) {
          if (!found.some(f => f.chapter === r.chapter && f.verse === r.verse)) found.push({ ...r });
        }
      }
      if (!found.length) continue;
      const ends = new Map();
      const chapterEnd = c => { if (!ends.has(c)) ends.set(c, end.get(id, n, c).v); return ends.get(c); };
      names.push(formatReference(books.get(n), found, chapterEnd, all.find(b => b.number === n).chapters === 1));
      for (const v of found) verses.push({ ...v, ref: `${books.get(n)} ${v.chapter}:${v.verse}` });
    }
    if (!verses.length) return { reference: '', verses: [] };
    return { reference: names.join('; '), verses: verses.slice(0, MAX_PASSAGE), more: verses.length > MAX_PASSAGE };
  }

  /** Verses containing every word of the query, best matches first. */
  search(id, q, limit = 100) {
    this.need(id);
    const match = ftsQuery(q);
    if (!match) return [];
    const n = Math.min(Math.max(1, limit | 0), MAX_RESULTS);
    const books = new Map(this.books(id).map(b => [b.number, b.name]));
    return this.db.prepare(`SELECT v.book, v.chapter, v.verse, v.text FROM verses_fts JOIN verses v ON v.id = verses_fts.rowid
      WHERE verses_fts MATCH ? AND v.bible = ? ORDER BY rank LIMIT ?`).all(match, id, n)
      .map(r => ({ ...r, ref: `${books.get(r.book)} ${r.chapter}:${r.verse}` }));
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { fn(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  close() {
    if (this.db.isOpen) this.db.close();
  }
}

/** An XML file's text, in whichever encoding its byte order mark or declaration says. */
function decodeXml(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  const decl = /^﻿?\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(buf.subarray(0, 200).toString('latin1'));
  const enc = decl ? decl[1].toLowerCase() : 'utf-8';
  try { return new TextDecoder(enc === 'utf8' ? 'utf-8' : enc).decode(buf); } catch { return buf.toString('utf8'); }
}

module.exports = { Bibles, BUNDLED, FILE, ftsQuery };
