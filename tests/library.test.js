// Tests for server/library.js: the library in its SQLite database. Run with: npm test
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { it } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { Library } = require('../server/library.js');

function folder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-lib-'));
  fs.mkdirSync(path.join(dir, 'backups'));
  return dir;
}
const open = dir => new Library(dir, path.join(dir, 'backups'));
const song = (id, name, extra = {}) => ({ id, name, groups: [{ name: 'Verse 1', slides: ['Line'] }], bg: null, ...extra });

it('starts empty, and keeps a library exactly as saved', () => {
  const dir = folder();
  let lib = open(dir);
  assert.equal(lib.library, null);
  assert.equal(lib.rev, 0);
  const saved = { presentations: [song('a', 'Café'), song('b', 'Hymn', { order: ['Verse 1'], themeId: 't1' })],
    playlist: ['b', 'a'], themes: [{ id: 't1', name: 'Big' }], messages: ['Hi'], logoText: 'WELCOME', theme: { size: 80 },
    somethingNew: { kept: [1, 2, 3] } };
  assert.equal(lib.set(saved), 1);
  lib.close();
  lib = open(dir);
  assert.deepEqual(lib.library, saved);
  assert.equal(lib.rev, 1);
  lib.close();
});

it('writes only the presentations that changed, and drops removed ones and fields', () => {
  const dir = folder();
  const lib = open(dir);
  lib.set({ presentations: [song('a', 'One'), song('b', 'Two'), song('c', 'Three')], playlist: [], logoText: 'X' });
  const raw = new DatabaseSync(path.join(dir, 'lumen.db'));
  // Mark each stored row, so a row that is written again loses its mark.
  raw.exec("UPDATE presentations SET name = name || '*'");
  lib.set({ presentations: [song('a', 'One'), song('b', 'Two changed')], playlist: [] });
  const rows = raw.prepare('SELECT pos, id, name FROM presentations ORDER BY pos').all().map(r => ({ ...r }));
  assert.deepEqual(rows, [{ pos: 0, id: 'a', name: 'One*' }, { pos: 1, id: 'b', name: 'Two changed' }]);
  assert.deepEqual(raw.prepare("SELECT key FROM meta WHERE key LIKE 'library.%'").all().map(r => r.key), ['library.playlist']);
  raw.close();
  lib.close();
  const again = open(dir);
  assert.deepEqual(again.library, { presentations: [song('a', 'One'), song('b', 'Two changed')], playlist: [] });
  again.close();
});

it('copes with presentations the console never makes', () => {
  const dir = folder();
  const lib = open(dir);
  const odd = { presentations: [song('a', 'Same id'), song('a', 'Same id'), { name: 'No id' }, 'not an object'] };
  lib.set(odd);
  lib.close();
  const again = open(dir);
  assert.deepEqual(again.library, odd);
  again.close();
});

it('brings in a library.json from before the database, keeping it in backups', () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ rev: 7, saved: 1, library: { presentations: [song('a', 'Old')], playlist: ['a'] } }));
  const lib = open(dir);
  assert.equal(lib.rev, 7);
  assert.deepEqual(lib.library, { presentations: [song('a', 'Old')], playlist: ['a'] });
  assert.equal(fs.existsSync(path.join(dir, 'library.json')), false);
  const [kept] = fs.readdirSync(path.join(dir, 'backups'));
  assert.match(kept, /^before-database-\d{8}-\d{6}$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'backups', kept, 'library.json'))).rev, 7);
  lib.close();
});

it('keeps the library a copied-in library.json replaces', () => {
  const dir = folder();
  const lib = open(dir);
  lib.set({ presentations: [song('n', 'Newer')] });
  lib.close();
  fs.writeFileSync(path.join(dir, 'library.json'), JSON.stringify({ rev: 3, library: { presentations: [song('o', 'Copied in')] } }));
  const again = open(dir);
  assert.deepEqual(again.library.presentations.map(p => p.name), ['Copied in']);
  const [kept] = fs.readdirSync(path.join(dir, 'backups'));
  const replaced = JSON.parse(fs.readFileSync(path.join(dir, 'backups', kept, 'replaced-library.json')));
  assert.deepEqual(replaced.library.presentations.map(p => p.name), ['Newer']);
  again.close();
});

it('leaves the library alone when library.json is not a library', () => {
  const dir = folder();
  const lib = open(dir);
  lib.set({ presentations: [song('a', 'Mine')] });
  lib.close();
  fs.writeFileSync(path.join(dir, 'library.json'), '{ not json');
  const again = open(dir);
  assert.deepEqual(again.library.presentations.map(p => p.name), ['Mine']);
  again.close();
});

const hymn = (id, name, lines, meta) => ({ id, name, meta, groups: [{ id: 'g', name: 'Verse 1',
  slides: lines.map((text, i) => ({ id: `s${i}`, text })) }] });

it('searches titles, words and song details, best match first', () => {
  const dir = folder();
  const lib = open(dir);
  lib.set({ format: 2, presentations: [
    hymn('a', 'Amazing Grace', ['Amazing grace how sweet the sound\nThat saved a wretch like me'],
      { author: 'John Newton', copyright: 'Public Domain', ccli: '22025' }),
    hymn('b', 'How Great Thou Art', ['O Lord my God when I in awesome wonder'], { author: 'Stuart K. Hine', ccli: '14181' }),
    hymn('c', 'Notices', ['Coffee after the service', '@image: media:abc.jpg']),
  ] });
  assert.deepEqual(lib.search('grace').map(r => r.id), ['a']);
  assert.deepEqual(lib.search('how').map(r => r.id), ['b', 'a']); // the title counts most
  assert.deepEqual(lib.search('newt').map(r => r.id), ['a']);     // a word still being typed
  assert.deepEqual(lib.search('22025').map(r => r.id), ['a']);
  assert.deepEqual(lib.search('lord awesome').map(r => r.id), ['b']);
  assert.deepEqual(lib.search('lord grace'), []);
  assert.deepEqual(lib.search('am gr sw').map(r => r.id), ['a']);
  assert.deepEqual(lib.search('media abc'), [], 'media lines are not words');
  assert.deepEqual(lib.search('"NEAR( OR -'), []);
  assert.deepEqual(lib.search('  '), []);
  const [hit] = lib.search('wretch');
  assert.deepEqual(hit, { id: 'a', name: 'Amazing Grace',
    snippet: 'Amazing grace how sweet the sound / That saved a \u0002wretch\u0003…' });
  assert.equal(lib.search('stuart')[0].snippet, '\u0002Stuart\u0003 K. Hine');
  lib.close();
});

it('keeps the search index up to date, and builds it for a database from before search', () => {
  const dir = folder();
  let lib = open(dir);
  lib.set({ presentations: [song('a', 'Café'), song('b', 'Two')] });
  lib.set({ presentations: [song('b', 'Two renamed')] });
  assert.deepEqual(lib.search('cafe'), []);
  assert.deepEqual(lib.search('renamed').map(r => r.id), ['b']);
  assert.deepEqual(lib.search('line').map(r => r.id), ['b'], 'format 1 slides are searched too');
  lib.close();
  const raw = new DatabaseSync(path.join(dir, 'lumen.db'));
  raw.exec('DELETE FROM search');
  raw.close();
  lib = open(dir);
  assert.deepEqual(lib.search('two').map(r => r.id), ['b']);
  lib.close();
});
