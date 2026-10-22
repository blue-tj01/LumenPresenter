// Tests for console/easyworship.js: reading an EasyWorship 2009 song library (Songs.DB and Songs.MB) into
// presentations.
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
