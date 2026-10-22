// Tests for console/easyworship.js and console/sqlite.js: reading EasyWorship song libraries, 2009's (Songs.DB and
// Songs.MB) and 6's (Songs.db and SongWords.db), into presentations.
// Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let ew;
before(async () => { ew = await import('../console/easyworship.js'); });

const words = p => p.groups.map(g => [g.name, g.slides.map(s => s.text)]);
const order = p => (p.arrangements[0]?.order || []).map(id => p.groups.find(g => g.id === id).name);

// ---------- a self-made EasyWorship library ----------
// Built here byte by byte in the shape EasyWorship 2009 saves Songs.DB (a Paradox table) and Songs.MB (its memo
// file), with the words of public-domain hymns.
const FIELDS = [['Title', 1, 50], ['Author', 1, 50], ['RecID', 4, 4], ['Copyright', 1, 100], ['Administrator', 1, 50],
  ['Words', 12, 50], ['Song Number', 1, 10]];
const LEADER = 40; // a memo field's leader: its size less the 10 bytes saying where the rest is

const ewRtf = text => '{\\rtf1\\ansi\\deff0\\deftab254{\\fonttbl{\\f0\\fnil\\fcharset1 Arial;}}' +
  '{\\colortbl\\red0\\green0\\blue0;\\red255\\green0\\blue0;}\\pard\\f0\\fs56 ' +
  text.split('\n').map(l => l.replace(/\u2019/g, "\\'92")).join('\\par\n') + '\\par\n}';

/** Songs.DB and Songs.MB for songs, each { Title, Author, ..., Words } with Words as plain text (written as RTF).
 * Long words go in a memo block of their own, short ones share a block; `tiny` words fit in the leader alone. */
function library(songs, { blockKb = 1 } = {}) {
  const recordSize = FIELDS.reduce((n, [, , size]) => n + size, 0), headerSize = 2048, blockSize = blockKb * 1024;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(recordSize, 0); header.writeUInt16LE(headerSize, 2); header[5] = blockKb;
  header.writeUInt32LE(songs.length, 6); header.writeUInt16LE(1, 0x0e); header.writeUInt16LE(FIELDS.length, 0x21);
  FIELDS.forEach(([, type, size], i) => { header[0x78 + i * 2] = type; header[0x79 + i * 2] = size; });
  let at = 0x78 + FIELDS.length * 2 + 4 + FIELDS.length * 4;
  at += header.write('songs.db\0', at, 'latin1') && 261;
  for (const [name] of FIELDS) at += header.write(name + '\0', at, 'latin1');

  const shared = Buffer.alloc(4096); shared[0] = 3; let used = 0, slot = 0; // a block of short memos, at 4096
  const mb = [Buffer.alloc(4096), shared]; // after the memo file's header block
  const memo = (text, tiny) => {
    const data = Buffer.from(text, 'latin1'), field = Buffer.alloc(LEADER + 10);
    data.copy(field, 0, 0, LEADER);
    field.writeUInt32LE(data.length, LEADER + 4); field.writeUInt16LE(1, LEADER + 8);
    if (tiny) return field;
    if (data.length > 200) {
      const block = Buffer.alloc(Math.ceil((data.length + 9) / 4096) * 4096);
      block[0] = 2; data.copy(block, 9);
      field.writeUInt32LE(mb.reduce((n, b) => n + b.length, 0), LEADER);
      mb.push(block);
    } else {
      const start = 20 + used; // in 16-byte units, after the slot table
      shared[12 + slot * 5] = start; data.copy(shared, start * 16);
      field.writeUInt32LE(4096 + slot, LEADER);
      used += Math.ceil(data.length / 16); slot++;
    }
    return field;
  };
  const records = songs.map(s => Buffer.concat(FIELDS.map(([name, type, size]) => {
    const v = Buffer.alloc(size);
    if (type === 1) v.write(s[name] || '', 'latin1');
    if (type === 4) v.writeUInt32LE(0x80000001);
    return type === 12 ? memo(s.tiny ? s.Words : ewRtf(s.Words), s.tiny) : v;
  })));
  // Records two to a block, the blocks chained in a different order from the one they are stored in.
  const blocks = [];
  for (let i = 0; i < records.length; i += 2) blocks.push(records.slice(i, i + 2));
  const stored = blocks.map(() => Buffer.alloc(blockSize)), place = blocks.map((_, i) => blocks.length - 1 - i);
  blocks.forEach((recs, i) => {
    const b = stored[place[i]];
    b.writeUInt16LE(i + 1 < blocks.length ? place[i + 1] + 1 : 0, 0);
    b.writeInt16LE((recs.length - 1) * recordSize, 4);
    recs.forEach((r, j) => r.copy(b, 6 + j * recordSize));
  });
  header.writeUInt16LE(place[0] + 1, 0x0e);
  return { db: Buffer.concat([header, ...stored]), mb: Buffer.concat(mb) };
}

const SONGS = [
  { Title: 'Amazing Grace', Author: 'John Newton', Copyright: 'Public Domain', 'Song Number': '22025',
    Words: 'Verse 1\nAmazing grace! How sweet the sound\nThat saved a wretch like me!\n\nI once was lost, but now am found;\n' +
      'Was blind, but now I see.\n\nVerse 2\n\u2019Twas grace that taught my heart to fear,\nAnd grace my fears relieved;' },
  { Title: 'Doxology', Author: 'Thomas Ken', Words: 'Praise God, from whom all blessings flow' },
  { Title: 'Holy, Holy, Holy', Author: 'Reginald Heber', Copyright: '1826', Administrator: 'Nobody',
    Words: 'Verse 1\nHoly, holy, holy! Lord God Almighty!\n\nChorus\nHoly, holy, holy!\n\nverse 2\nHoly, holy, holy! ' +
      'All the saints adore thee,\n\nCHORUS:\nHoly, holy, holy!\n\nChorus\nMerciful and mighty!' },
  { Title: 'Blank slide', Words: '', tiny: true },
  { Title: 'Short', Words: 'Just words', tiny: true },
];

// ---------- tests ----------
it('names sections from heading lines', () => {
  assert.deepEqual(['Verse 1', 'verse 2a', 'CHORUS:', 'Pre-chorus', 'Pre Chorus 2', 'End', 'Tag (x2)', 'Slide', 'Versed in grace', 'Chorus of angels'].map(ew.sectionName),
    ['Verse 1', 'Verse 2a', 'Chorus', 'Pre-Chorus', 'Pre-Chorus 2', 'Ending', 'Tag', 'Slides', '', '']);
});

it('reads songs from Songs.DB and Songs.MB, with their sections, slides and details', () => {
  const { db, mb } = library(SONGS);
  const { songs, cut, empty } = ew.parseEasyWorship(db, mb);
  assert.deepEqual(songs.map(s => s.name), ['Amazing Grace', 'Doxology', 'Holy, Holy, Holy', 'Short']);
  assert.deepEqual([cut, empty], [0, 1]); // the blank one
  const [grace, dox, holy, short] = songs;
  assert.deepEqual(words(grace), [
    ['Verse 1', ['Amazing grace! How sweet the sound\nThat saved a wretch like me!', 'I once was lost, but now am found;\nWas blind, but now I see.']],
    ['Verse 2', ['\u2019Twas grace that taught my heart to fear,\nAnd grace my fears relieved;']],
  ]);
  assert.deepEqual(grace.meta, { author: 'John Newton', copyright: 'Public Domain', ccli: '22025' });
  assert.deepEqual(words(dox), [['Slides', ['Praise God, from whom all blessings flow']]]);
  assert.deepEqual(holy.meta, { author: 'Reginald Heber', copyright: '1826, admin. by Nobody' });
  assert.deepEqual(words(short), [['Slides', ['Just words']]]);
  assert.ok(songs.every(p => p.id && p.groups.every(g => g.id && g.slides.every(s => s.id))));
});

it('plays a section sung again with the same words again, and numbers one with new words', () => {
  const { db, mb } = library(SONGS);
  const holy = ew.parseEasyWorship(db, mb).songs[2];
  assert.deepEqual(words(holy).map(w => w[0]), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus (2)']);
  assert.deepEqual(order(holy), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Chorus (2)']);
});

it('reads with bigger blocks, and without Songs.MB brings in only songs that fit in Songs.DB', () => {
  const { db, mb } = library(SONGS, { blockKb: 4 });
  assert.equal(ew.parseEasyWorship(db, mb).songs.length, 4);
  const alone = ew.parseEasyWorship(db);
  assert.deepEqual(alone.songs.map(s => s.name), ['Short']);
  assert.deepEqual([alone.cut, alone.empty], [3, 1]);
});

it('rejects files that are not an EasyWorship library', () => {
  assert.throws(() => ew.parseEasyWorship(Buffer.alloc(4096)));
  assert.throws(() => ew.parseEasyWorship(Buffer.from('SQLite format 3\0'.padEnd(4096, '\0'))));
  const { db } = library(SONGS);
  assert.ok(ew.isParadox(db) && !ew.isParadox(Buffer.alloc(100)));
  assert.equal(ew.parseEasyWorship(db, Buffer.alloc(10)).songs.length, 1); // a memo file that doesn't match: only the short song
});

// ---------- EasyWorship 6 ----------
// Songs.db and SongWords.db are written here with Node's own SQLite, with the tables EasyWorship 6 has and small
// pages, so long words run onto overflow pages and the tables need more than one level of pages.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** EasyWorship 6's RTF for a song: each [kind, text] a paragraph, kind 'head' (a section's name), 'slide' (a new
 * slide) or 'line'. */
const ew6Rtf = paras => '{\\rtf1\\ansi\\deff0\\sdeasyworship2\r\n{\\fonttbl{\\f0 Tahoma;}}\r\n{\\colortbl ;}\r\n' + paras.map(([kind, text]) =>
  `{\\pard${kind === 'head' ? '\\sdparawysiwghidden\\sdlistlevel-1' : kind === 'slide' ? '\\sdslidemarker' : ''}\\qc\\qdef` +
  `\\sdewparatemplatestyle101\\plain\\sdewtemplatestyle101\\fs108{\\*\\sdfsreal 54}{\\*\\sdfsdef 54}\\sdfsauto ${text || ''}\\par}\r\n`).join('') + '}';

function library6(songs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ew6-')), out = {};
  for (const [file, sql] of [['Songs.db', 'CREATE TABLE song ("rowid" integer PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE, song_item_uid text UNIQUE, ' +
      'title text NOT NULL, author text, copyright text, administrator text, description text, reference_number text, vendor_id integer)'],
    ['SongWords.db', 'CREATE TABLE word ("rowid" integer PRIMARY KEY NOT NULL UNIQUE, song_id integer, words rtf, slide_uids text)']]) {
    const db = new DatabaseSync(path.join(dir, file));
    db.exec('PRAGMA page_size = 1024'); db.exec(sql);
    if (file === 'Songs.db') {
      const add = db.prepare('INSERT INTO song (song_item_uid, title, author, copyright, administrator, reference_number, vendor_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
      songs.forEach((s, i) => add.run(`uid-${i}`, s.title, s.author || '', s.copyright || '', s.admin || '', s.ccli || '', -5));
    } else {
      const add = db.prepare('INSERT INTO word (song_id, words, slide_uids) VALUES (?, ?, ?)');
      songs.forEach((s, i) => s.paras && add.run(i + 1, ew6Rtf(s.paras), 'x'));
    }
    db.close();
    out[file] = fs.readFileSync(path.join(dir, file));
  }
  fs.rmSync(dir, { recursive: true });
  return out;
}

const FOUNT6 = { title: 'Come Thou Fount', author: 'Robert Robinson', copyright: 'Public Domain', ccli: '108389', paras: [
  ['head', 'Verse1'], ['line', 'Come, thou Fount of ev\\u8217?ry blessing,'], ['line', 'Tune my heart to sing thy grace;'],
  ['slide'], ['line', 'Streams of mercy, never ceasing,'], ['line', 'Call for songs of loudest praise.'],
  ['head', 'CHORUS'], ['line', 'Praise the mount!'],
  ['head', 'Instrumental'],
  ['head', 'Verse 2'], ['line', 'Here I raise my Ebenezer;'],
  ['head', 'Chorus'], ['line', 'Praise the mount!'],
  ['head', 'Spontaneous'], ['line', 'Hallelujah'],
] };

it('reads an EasyWorship 6 library from Songs.db and SongWords.db', async () => {
  const filler = Array.from({ length: 60 }, (_, i) => ({ title: `Notice ${i}`, paras: [['line', `Notice ${i} `.repeat(i % 7 ? 2 : 80)]] }));
  const files = library6([FOUNT6, { title: 'Video only' }, ...filler]);
  assert.equal(ew.easyWorship6Kind(files['Songs.db']), 'songs');
  assert.equal(ew.easyWorship6Kind(files['SongWords.db']), 'words');
  assert.equal(ew.easyWorship6Kind(library(SONGS).db), '');
  const { songs, empty } = ew.parseEasyWorship6(files['Songs.db'], files['SongWords.db']);
  assert.equal(empty, 1); // the video
  assert.equal(songs.length, 61);
  const fount = songs[0];
  assert.equal(fount.name, 'Come Thou Fount');
  assert.deepEqual(fount.meta, { author: 'Robert Robinson', copyright: 'Public Domain', ccli: '108389' });
  assert.deepEqual(words(fount), [
    ['Verse 1', ['Come, thou Fount of ev’ry blessing,\nTune my heart to sing thy grace;', 'Streams of mercy, never ceasing,\nCall for songs of loudest praise.']],
    ['Chorus', ['Praise the mount!']],
    ['Verse 2', ['Here I raise my Ebenezer;']],
    ['Spontaneous', ['Hallelujah']],
  ]); // a heading with no words under it is left out
  assert.deepEqual(order(fount), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Spontaneous']);
  assert.equal(songs[1].groups[0].slides[0].text, 'Notice 0 '.repeat(80).trim()); // a row that runs onto overflow pages
  assert.deepEqual(words(songs[2]), [['Slides', ['Notice 1 Notice 1']]]);
});

it('reads SQLite tables as SQLite writes them', async () => {
  const s = await import('../console/sqlite.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-')), file = path.join(dir, 't.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA page_size = 512; CREATE TABLE t (id INTEGER PRIMARY KEY, "a b" text, n integer, f real, z blob, CONSTRAINT x UNIQUE (n))');
  const add = db.prepare('INSERT INTO t (id, "a b", n, f, z) VALUES (?, ?, ?, ?, ?)');
  const values = [0, 1, -1, 127, -128, 300, -40000, 2 ** 31, -(2 ** 40), 2 ** 50];
  values.forEach((n, i) => add.run(i + 10, 'é'.repeat(i * 40), n, i / 3, Buffer.from([i, 255])));
  add.run(99, null, null, null, null);
  db.close();
  const bytes = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true });
  assert.deepEqual(s.tableNames(bytes), ['t']);
  const t = s.readSqlite(bytes).t;
  assert.deepEqual(t.columns, ['id', 'a b', 'n', 'f', 'z']);
  assert.deepEqual(t.rows.map(r => r.n), [...values, null]);
  assert.deepEqual(t.rows.map(r => r.id), [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 99]);
  assert.equal(t.rows[9]['a b'], 'é'.repeat(360));
  assert.equal(t.rows[3].f, 1);
  assert.deepEqual([...t.rows[2].z], [2, 255]);
  assert.throws(() => s.readSqlite(Buffer.alloc(200)));
});
