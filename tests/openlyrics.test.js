// Tests for console/openlyrics.js: reading OpenLyrics (OpenLP) and OpenSong song files into presentations.
// Run with: npm test
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { it, before } = require('node:test');

let o, x;
before(async () => {
  o = await import('../console/openlyrics.js');
  x = await import('../console/xml.js');
});

const words = p => p.groups.map(g => [g.name, g.slides.map(s => s.text)]);
const order = p => (p.arrangements[0]?.order || []).map(id => p.groups.find(g => g.id === id).name);
// Self-made files of public-domain hymns, in the shape OpenLP and OpenSong save them.
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

it('names groups from the short verse names', () => {
  assert.deepEqual(['v1', 'C', 'c2', 'b', 'p', 'e', 'i', 't1', 'o', 'v2a', 'Verse 3', ''].map(o.groupName), [
    'Verse 1',
    'Chorus',
    'Chorus 2',
    'Bridge',
    'Pre-Chorus',
    'Ending',
    'Intro',
    'Tag 1',
    'Other',
    'Verse 2a',
    'Verse 3',
    'Verse',
  ]);
});

it('reads an OpenLyrics file from OpenLP, keeping its slides and play order', () => {
  const p = o.parseSongXml(fixture('openlyrics-amazing-grace.xml'));
  assert.equal(p.name, 'Amazing Grace');
  assert.deepEqual(p.meta, { author: 'John Newton, Traditional', copyright: 'Public Domain', ccli: '22025' });
  assert.deepEqual(
    words(p).map(w => [w[0], w[1].length]),
    [
      ['Verse 1', 2],
      ['Verse 2', 2],
      ['Chorus', 1],
      ['Verse 3', 2],
    ],
  );
  assert.equal(p.groups[0].slides[0].text, 'Amazing grace! How sweet the sound\nThat saved a wretch like me!');
  assert.equal(p.groups[2].slides[0].text.split('\n').length, 4);
  assert.deepEqual(order(p), ['Verse 1', 'Verse 2', 'Chorus', 'Verse 3', 'Chorus']);
  assert.ok(p.id && p.groups.every(g => g.id && g.slides.every(s => s.id)));
});

it('leaves chords, comments and formatting out of OpenLyrics words, and reads older <line> files', () => {
  const p = o.parseOpenLyrics(`<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9">
    <properties><titles><title>Tune &amp; Words</title></titles></properties>
    <lyrics>
      <verse name="v1"><lines><comment>quietly</comment><chord root="G"/>First <tag name="it">line</tag> here<br/>
        <chord root="C">Sec</chord>ond line</lines></verse>
      <verse name="c"><lines><line>Old style one</line><line>Old style two</line></lines></verse>
    </lyrics></song>`);
  assert.equal(p.name, 'Tune & Words');
  assert.deepEqual(words(p), [
    ['Verse 1', ['First line here\nSecond line']],
    ['Chorus', ['Old style one\nOld style two']],
  ]);
  assert.deepEqual(p.arrangements, []);
  assert.equal(p.meta, undefined);
});

it("reads the first language of a song written in several, and skips verse names the order doesn't have", () => {
  const p =
    o.parseOpenLyrics(`<song><properties><titles><title>Two languages</title></titles><verseOrder>v1 x9 v1</verseOrder></properties>
    <lyrics>
      <verse name="v1" lang="en"><lines>Hello</lines></verse>
      <verse name="v1" lang="de"><lines>Hallo</lines></verse>
      <verse name="v1" lang="de" translit="en"><lines>Hallo</lines></verse>
    </lyrics></song>`);
  assert.deepEqual(words(p), [['Verse 1', ['Hello']]]);
  assert.deepEqual(order(p), ['Verse 1', 'Verse 1']);
});

it('reads an OpenSong file, its numbered verses split out and its chords left out', () => {
  const p = o.parseSongXml(fixture('opensong-holy-holy-holy'));
  assert.equal(p.name, 'Holy, Holy, Holy');
  assert.deepEqual(p.meta, { author: 'Reginald Heber', copyright: 'Public Domain', ccli: '1156' });
  assert.deepEqual(
    words(p).map(w => w[0]),
    ['Verse 1', 'Verse 2', 'Verse 3'],
  );
  assert.deepEqual(
    p.groups[0].slides.map(s => s.text),
    [
      'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;',
      'Holy, holy, holy, merciful and mighty!\nGod in three Persons, blessed Trinity!',
    ],
  );
  assert.match(p.groups[2].slides[1].text, /in love, and purity\.$/);
  assert.deepEqual(order(p), ['Verse 1', 'Verse 2', 'Verse 3', 'Verse 1']);
});

it('splits OpenSong sections into slides at || and blank lines', () => {
  const p = o.parseOpenSong(`<song><title>Slides</title><lyrics>[C]
 One||Two
 Three

 Four
[B]
 Bridge line
---
 After the break</lyrics></song>`);
  assert.deepEqual(words(p), [
    ['Chorus', ['One', 'Two\nThree', 'Four']],
    ['Bridge', ['Bridge line', 'After the break']],
  ]);
  assert.deepEqual(p.arrangements, []);
});

it('tells the formats apart, and refuses other files', () => {
  assert.equal(o.parseSongXml(fixture('openlyrics-amazing-grace.xml')).groups.length, 4);
  assert.equal(o.parseSongXml(fixture('opensong-holy-holy-holy')).groups.length, 3);
  assert.throws(() => o.parseSongXml('<bible><book/></bible>'), /not an OpenLyrics or OpenSong/);
  assert.throws(() => o.parseSongXml('<song><title>Empty</title><lyrics></lyrics></song>'), /no words/);
  assert.throws(() => o.parseOpenLyrics('<song><title>x</title></song>'), /not an OpenLyrics/);
  assert.ok(o.isXml('\n  <?xml version="1.0"?><song/>'));
  assert.ok(!o.isXml('Amazing Grace\n\nVerse 1'));
});

it('reads XML: entities, CDATA, attributes in either quotes, and namespaces', () => {
  const root = x.parseXml(
    `<?xml version="1.0"?><!-- note --><a:root xmlns:a="urn:x"><a:b k='v' n="&#233;">x &lt; y<![CDATA[ <raw> ]]></a:b><c/></a:root>`,
  );
  assert.equal(root.name, 'root');
  assert.deepEqual(x.child(root, 'b').attrs, { k: 'v', n: 'é' });
  assert.equal(x.text(root), 'x < y <raw> ');
  assert.equal(x.kids(root).length, 2);
  assert.equal(x.parseXml('just text'), null);
});
