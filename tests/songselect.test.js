// Tests for console/songselect.js: reading CCLI SongSelect .usr and .txt files into presentations.
// Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let s;
before(async () => { s = await import('../console/songselect.js'); });

const words = p => p.groups.map(g => [g.name, g.slides.map(x => x.text)]);
const order = p => (p.arrangements[0]?.order || []).map(id => p.groups.find(g => g.id === id).name);

const USR = [
  '[File]', 'Type=SongSelect Import File', 'Version=3.0', '',
  '[S A22025]',
  'Title=Amazing Grace',
  'Author=John Newton | Edwin Othello Excell',
  'Copyright=Public Domain',
  'Admin=',
  'Themes=Grace/tSalvation',
  'Keys=G',
  'Fields=Verse 1/tVerse 2/tChorus/tChorus',
  'Words=Amazing grace how sweet the sound/nThat saved a wretch like me/t' +
    '\'Twas grace that taught my heart to fear/nAnd grace my fears relieved/t' +
    'My chains are gone/nI\'ve been set free/tMy chains are gone/nI\'ve been set free',
].join('\r\n');

it('reads a .usr file with its writers, copyright and song number', () => {
  const p = s.parseUsr(USR);
  assert.equal(p.name, 'Amazing Grace');
  assert.deepEqual(p.meta, { author: 'John Newton, Edwin Othello Excell', copyright: 'Public Domain', ccli: '22025' });
  assert.deepEqual(words(p), [
    ['Verse 1', ['Amazing grace how sweet the sound\nThat saved a wretch like me']],
    ['Verse 2', ['\'Twas grace that taught my heart to fear\nAnd grace my fears relieved']],
    ['Chorus', ['My chains are gone\nI\'ve been set free']],
  ]);
  // The chorus written out twice is one group, played twice.
  assert.deepEqual(order(p), ['Verse 1', 'Verse 2', 'Chorus', 'Chorus']);
  assert.ok(p.id && p.groups.every(g => g.id && g.slides.every(x => x.id)));
});

it('numbers a .usr section whose label comes again with other words, and names unlabelled ones', () => {
  const p = s.parseUsr('[S A123]\nTitle=X\nFields=Chorus/tChorus\nWords=One/tTwo/tThree');
  assert.deepEqual(words(p).map(w => w[0]), ['Chorus', 'Chorus 2', 'Verse 3']);
  assert.deepEqual(p.arrangements, []);
  assert.throws(() => s.parseUsr('just some text'), /not a SongSelect/);
});

const TXT = `Amazing Grace (My Chains Are Gone)

Verse 1
Amazing grace how sweet the sound
That saved a wretch like me

Chorus
My chains are gone
I've been set free

Verse 2
The Lord has promised good to me

Chorus
My chains are gone
I've been set free

Bridge (Repeat)
The earth shall soon dissolve like snow

CCLI Song # 4768151
Chris Tomlin | John Newton | Louie Giglio
© 2006 sixsteps Music; Vamos Publishing (Admin. by Capitol CMG Publishing)
For use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com
CCLI License # 1234567
`;

it('reads a SongSelect text download', () => {
  const p = s.parseTxt(TXT.replace(/\n/g, '\r\n'));
  assert.equal(p.name, 'Amazing Grace (My Chains Are Gone)');
  assert.deepEqual(p.meta, { author: 'Chris Tomlin, John Newton, Louie Giglio',
    copyright: '© 2006 sixsteps Music; Vamos Publishing (Admin. by Capitol CMG Publishing)', ccli: '4768151' });
  assert.deepEqual(words(p).map(w => w[0]), ['Verse 1', 'Chorus', 'Verse 2', 'Bridge']);
  assert.deepEqual(order(p), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus', 'Bridge']);
  assert.equal(p.groups[0].slides[0].text, 'Amazing grace how sweet the sound\nThat saved a wretch like me');
});

it('reads an older text download with the writers above the copyright and no song number', () => {
  const p = s.parseTxt('Holy Song\n\nVerse 1\nLine one\nLine two\n\nLine three\n\nA Writer, B Writer\n© 1999 Some Music\n');
  assert.deepEqual(words(p), [['Verse 1', ['Line one\nLine two', 'Line three']]]);
  assert.deepEqual(p.meta, { author: 'A Writer, B Writer', copyright: '© 1999 Some Music' });
});

it('puts words with no label in a verse, and refuses a file with none', () => {
  assert.deepEqual(words(s.parseTxt('Title\n\nJust words\n')), [['Verse', ['Just words']]]);
  assert.throws(() => s.parseTxt('Title only\n'), /no words/);
  assert.throws(() => s.parseTxt('\n\n'), /empty/);
});

it('picks the reader by file name', () => {
  assert.equal(s.parseSongSelect('song.USR', USR).meta.ccli, '22025');
  assert.equal(s.parseSongSelect('song.txt', TXT).meta.ccli, '4768151');
});

it('decodes UTF-8, UTF-16 and Windows-1252 files', () => {
  const text = 'Title=Ça Grâce';
  assert.equal(s.decode(new TextEncoder().encode('﻿' + text)), text);
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(s.decode(le), text);
  assert.equal(s.decode(Buffer.from(text, 'latin1')), text);
});

it('finds a song already in the library by its song number, or by title when it has none', () => {
  const lib = [{ name: 'Amazing Grace', meta: { ccli: '22025' } }, { name: 'Notices' }];
  assert.equal(s.findSame(lib, { name: 'Other name', meta: { ccli: '22025' } }), lib[0]);
  assert.equal(s.findSame(lib, { name: 'Amazing Grace', meta: { ccli: '1' } }), undefined);
  assert.equal(s.findSame(lib, { name: 'notices' }), lib[1]);
});
