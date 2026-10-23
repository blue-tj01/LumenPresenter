// Tests for console/propresenter.js, console/zip.js and console/rtf.js: reading ProPresenter 7 songs (.pro files,
// and the .probundle and .proplaylist zips that hold them) into presentations.
// Run with: npm test
'use strict';
const assert = require('assert/strict');
const zlib = require('zlib');
const { it, before } = require('node:test');

let pp, zip, r;
before(async () => {
  pp = await import('../console/propresenter.js');
  zip = await import('../console/zip.js');
  r = await import('../console/rtf.js');
});

const words = p => p.groups.map(g => [g.name, g.slides.map(s => s.text)]);
const orders = p => p.arrangements.map(a => [a.name, a.order.map(id => p.groups.find(g => g.id === id).name)]);

// ---------- self-made ProPresenter files ----------
// The test files are built here, field by field, in the shape ProPresenter 7 saves them, with the words of
// public-domain hymns.
const varint = n => {
  const o = [];
  do {
    const c = n % 128;
    n = Math.floor(n / 128);
    o.push(n ? c | 128 : c);
  } while (n);
  return o;
};
/** One field: a number as a varint, a string or bytes (a message) with its length. */
const field = (f, v) => {
  if (typeof v === 'number') return [...varint(f * 8), ...varint(v)];
  const b = typeof v === 'string' ? [...Buffer.from(v)] : v;
  return [...varint(f * 8 + 2), ...varint(b.length), ...b];
};
const double = (f, n) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return [...varint(f * 8 + 1), ...b];
};
const msg = (...parts) => parts.flat();
const id = s => msg(field(1, s)); // ProPresenter's UUID message

const rtf = lines =>
  '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2758\n\\cocoatextscaling0\\cocoaplatform0' +
  '{\\fonttbl\\f0\\fnil\\fcharset0 HelveticaNeue;}\n{\\colortbl;\\red255\\green255\\blue255;}\n' +
  '{\\*\\expandedcolortbl;;}\n\\pard\\tx560\\pardirnatural\\qc\\partightenfactor0\n\n\\f0\\fs120 \\cf1 ' +
  lines.join('\\\n') +
  '}';
/** A slide (a cue) with one text box, or none for a blank slide: cue → action → slide → presentation slide →
 * base slide → slide element → graphic → text → RTF. */
const cue = (uuid, lines) => {
  const text = msg(field(3, msg(field(1, 'HelveticaNeue'))), field(5, rtf(lines || [])));
  const graphic = msg(field(1, id(uuid + '-text')), field(2, 'TextElement'), double(4, 1.5), field(13, text));
  const base = msg(lines ? field(1, msg(field(1, graphic))) : [], field(7, id(uuid + '-slide')));
  const action = msg(field(1, id(uuid + '-action')), field(23, msg(field(2, msg(field(1, base))))));
  return field(13, msg(field(1, id(uuid)), field(10, action)));
};
const group = (uuid, name, cues) =>
  field(12, msg(field(1, msg(field(1, id(uuid)), field(2, name))), ...cues.map(c => field(2, id(c)))));
const arrangement = (uuid, name, groups) =>
  field(11, msg(field(1, id(uuid)), field(2, name), ...groups.map(g => field(3, id(g)))));

// "Come, Thou Fount of Every Blessing" (Robert Robinson, 1758), with two arrangements, the second one selected.
const FOUNT = Buffer.from(
  msg(
    field(1, msg(field(1, 1), field(3, 1))),
    field(2, id('P-FOUNT')),
    field(3, 'Come Thou Fount'),
    field(10, id('a-short')),
    arrangement('a-full', 'Full', ['g-v1', 'g-c', 'g-v2', 'g-c', 'g-blank']),
    arrangement('a-short', 'Short', ['g-v1', 'g-v2', 'g-missing']),
    group('g-v1', 'Verse 1', ['c1', 'c2']),
    group('g-c', 'Chorus', ['c3']),
    group('g-v2', 'Verse 2', ['c4']),
    group('g-blank', '', ['c5']),
    cue('c1', ["Come, thou Fount of ev\\'92ry blessing,", '  Tune my heart to sing thy grace;']),
    cue('c2', ['Streams of mercy, never ceasing,', 'Call for songs of loudest praise.']),
    cue('c3', ["Praise the mount! I\\'92m fixed upon it,", "Mount of God\\u8217's redeeming love."]),
    cue('c4', ['Here I raise my Ebenezer;', "Hither by thy help I\\'92ve come;"]),
    cue('c5', null),
    field(
      14,
      msg(
        field(1, 'Robert Robinson'),
        field(3, 'Come Thou Fount'),
        field(4, 'Public Domain'),
        field(5, 1758),
        field(6, 1234567),
      ),
    ),
  ),
);

// "Holy, Holy, Holy" (Reginald Heber, 1826), with no arrangement and its chorus copied into a second group, as
// ProPresenter users often do; no CCLI details.
const HOLY = Buffer.from(
  msg(
    field(3, 'Holy Holy Holy'),
    group('h-v1', 'Verse 1', ['h1']),
    group('h-c1', 'Chorus', ['h2']),
    group('h-v2', 'Verse 2', ['h3']),
    group('h-c2', 'Chorus', ['h4']),
    group('h-c3', 'Chorus', ['h5']),
    cue('h1', ['Holy, holy, holy! Lord God Almighty!']),
    cue('h2', ['God in three persons, blessed Trinity!']),
    cue('h3', ['Holy, holy, holy! All the saints adore thee,']),
    cue('h4', ['God in three persons, blessed Trinity!']),
    cue('h5', ['Merciful and mighty!']),
  ),
);

/** A zip as ProPresenter writes one: each file stored with Zip64 sizes in its header, and a directory at the end
 * whose length is wrong. `deflate` instead compresses each file with its sizes after the data, as other tools do. */
function makeZip(files, { deflate = false } = {}) {
  const parts = [];
  for (const [name, content] of files) {
    const data = Buffer.from(content),
      packed = deflate ? zlib.deflateRawSync(data) : data;
    const n = Buffer.from(name),
      head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(45, 4);
    head.writeUInt16LE(deflate ? 8 : 0, 6);
    head.writeUInt16LE(deflate ? 8 : 0, 8);
    head.writeUInt16LE(n.length, 26);
    if (deflate) {
      parts.push(head, n, packed);
    } else {
      head.writeUInt32LE(0xffffffff, 18);
      head.writeUInt32LE(0xffffffff, 22);
      const extra = Buffer.alloc(20);
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(data.length), 4);
      extra.writeBigUInt64LE(BigInt(packed.length), 12);
      head.writeUInt16LE(extra.length, 28);
      parts.push(head, n, extra, packed);
    }
    if (deflate) {
      const d = Buffer.alloc(16);
      d.writeUInt32LE(0x08074b50, 0);
      d.writeUInt32LE(packed.length, 8);
      d.writeUInt32LE(data.length, 12);
      parts.push(d);
    }
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt32LE(0x1000, 12); // a directory that isn't there
  return Buffer.concat([...parts, end]);
}

// ---------- tests ----------
it('reads the words out of RTF', () => {
  assert.equal(r.rtfText(rtf(['First line', "Don\\'92t stop"])), 'First line\nDon’t stop');
  assert.equal(
    r.rtfText('{\\rtf1{\\info{\\title Hidden}}\\uc1 Caf\\u233 e\\par{\\*\\note gone}tab\\tab end \\{x\\}\\\\}'),
    'Café\ntab end {x}\\',
  );
  assert.equal(r.rtfText("{\\rtf1\\ansi\\ansicpg1251 \\'cf\\'f0\\'e8}"), 'При');
});

it('reads a .pro song with its groups, words and CCLI details', () => {
  const p = pp.parsePro(FOUNT);
  assert.equal(p.name, 'Come Thou Fount');
  assert.deepEqual(p.meta, { author: 'Robert Robinson', copyright: '1758 Public Domain', ccli: '1234567' });
  assert.deepEqual(words(p), [
    [
      'Verse 1',
      [
        'Come, thou Fount of ev’ry blessing,\nTune my heart to sing thy grace;',
        'Streams of mercy, never ceasing,\nCall for songs of loudest praise.',
      ],
    ],
    ['Chorus', ['Praise the mount! I’m fixed upon it,\nMount of God’s redeeming love.']],
    ['Verse 2', ['Here I raise my Ebenezer;\nHither by thy help I’ve come;']],
  ]); // the blank group is left out
  assert.ok(p.id && p.groups.every(g => g.id && g.slides.every(s => s.id)));
});

it('keeps every arrangement, the one selected in ProPresenter first', () => {
  assert.deepEqual(orders(pp.parsePro(FOUNT)), [
    ['Short', ['Verse 1', 'Verse 2']],
    ['Full', ['Verse 1', 'Chorus', 'Verse 2', 'Chorus']],
  ]);
});

it('plays a copied group again rather than adding it twice, when there is no arrangement', () => {
  const p = pp.parsePro(HOLY);
  assert.deepEqual(
    words(p).map(w => w[0]),
    ['Verse 1', 'Chorus', 'Verse 2', 'Chorus (2)'],
  );
  assert.deepEqual(orders(p), [['Default', ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Chorus (2)']]]);
  assert.equal(p.meta, undefined);
});

it('reads the songs in a .probundle, as ProPresenter zips them', async () => {
  const bundle = makeZip([
    ['Come Thou Fount.pro', FOUNT],
    ['Media/background.jpg', 'not a picture'],
  ]);
  const songs = await pp.parseProPresenter(bundle, 'Come Thou Fount.probundle');
  assert.deepEqual(
    songs.map(s => s.name),
    ['Come Thou Fount'],
  );
  assert.equal(songs[0].groups.length, 3);
});

it('reads every song in a deflated .proplaylist, and a bare .pro file', async () => {
  const list = makeZip(
    [
      ['data', 'playlist'],
      ['Holy.pro', HOLY],
      ['Fount.pro', FOUNT],
      ['__MACOSX/._Fount.pro', 'x'],
    ],
    { deflate: true },
  );
  assert.deepEqual(
    (await pp.parseProPresenter(list, 'Sunday.proplaylist')).map(s => s.name),
    ['Holy Holy Holy', 'Come Thou Fount'],
  );
  assert.deepEqual(
    (await pp.parseProPresenter(new Uint8Array(HOLY), 'Holy.pro')).map(s => s.name),
    ['Holy Holy Holy'],
  );
  assert.deepEqual(
    (await zip.unzip(list, n => n === 'data')).map(f => Buffer.from(f.data).toString()),
    ['playlist'],
  );
});

it('rejects files that hold no ProPresenter song', async () => {
  await assert.rejects(pp.parseProPresenter(Buffer.from('Amazing grace, how sweet the sound'), 'notes.pro'));
  await assert.rejects(pp.parseProPresenter(makeZip([['readme.txt', 'hello']]), 'x.probundle'));
  await assert.rejects(
    pp.parseProPresenter(
      Buffer.from(msg(field(3, 'Empty'), group('e', 'Verse 1', ['c']), cue('c', null))),
      'Empty.pro',
    ),
  );
  assert.ok(
    pp.isProPresenterFile('a.PROBUNDLE') && pp.isProPresenterFile('b.proplaylist') && !pp.isProPresenterFile('c.pro6'),
  );
});
