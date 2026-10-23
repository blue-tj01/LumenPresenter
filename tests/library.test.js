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
  const rows = raw.prepare('SELECT pos, key AS id, name FROM presentations ORDER BY pos').all().map(r => ({ ...r }));
  assert.deepEqual(rows, [{ pos: 0, id: 'a', name: 'One*' }, { pos: 1, id: 'b', name: 'Two changed' }]);
  assert.deepEqual(raw.prepare("SELECT key FROM meta WHERE key LIKE 'library.%'").all().map(r => r.key), ['library.playlist']);
  raw.close();
  lib.close();
  const again = open(dir);
  assert.deepEqual(again.library, { presentations: [song('a', 'One'), song('b', 'Two changed')], playlist: [] });
  again.close();
});

it('keeps services a row each, writing only the ones that changed', () => {
  const dir = folder();
  const lib = open(dir);
  const svc = (id, name, date, items) => ({ id, name, date, items });
  lib.set({ presentations: [song('a', 'One')], playlist: ['a'], serviceId: 's2',
    services: [svc('s1', 'Morning', '2026-10-18', ['a']), svc('s2', 'Morning', '2026-10-25', ['a'])] });
  const raw = new DatabaseSync(path.join(dir, 'lumen.db'));
  raw.exec("UPDATE services SET name = name || '*'");
  const saved = { presentations: [song('a', 'One')], playlist: [], serviceId: 's2',
    services: [svc('s1', 'Morning', '2026-10-18', ['a']), svc('s2', 'Evening', '2026-10-25', [])] };
  lib.set(saved);
  assert.deepEqual(raw.prepare('SELECT pos, key AS id, name, date FROM services ORDER BY pos').all().map(r => ({ ...r })),
    [{ pos: 0, id: 's1', name: 'Morning*', date: '2026-10-18' }, { pos: 1, id: 's2', name: 'Evening', date: '2026-10-25' }]);
  assert.equal(raw.prepare("SELECT count(*) AS n FROM meta WHERE key = 'library.services'").get().n, 0);
  lib.close();
  let again = open(dir);
  assert.deepEqual(again.library, saved);
  // A library without services (saved by an older console) leaves none behind.
  again.set({ presentations: [song('a', 'One')], playlist: [] });
  assert.equal(raw.prepare('SELECT count(*) AS n FROM services').get().n, 0);
  raw.close();
  again.close();
  again = open(dir);
  assert.deepEqual(again.library, { presentations: [song('a', 'One')], playlist: [] });
  again.close();
});

it('adds the services table to a database made before it', () => {
  const dir = folder();
  const old = new DatabaseSync(path.join(dir, 'lumen.db'));
  old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE presentations (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, data TEXT NOT NULL) STRICT;
    PRAGMA user_version = 1;`);
  old.prepare('INSERT INTO meta VALUES (?, ?)').run('saved', '1');
  old.prepare('INSERT INTO meta VALUES (?, ?)').run('library.playlist', '["a"]');
  old.prepare('INSERT INTO presentations VALUES (0, ?, ?, ?)').run('a', 'One', JSON.stringify(song('a', 'One')));
  old.close();
  const lib = open(dir);
  assert.deepEqual(lib.library, { presentations: [song('a', 'One')], playlist: ['a'] });
  lib.set({ ...lib.library, services: [{ id: 's1', name: 'Service', date: '2026-10-25', items: ['a'] }] });
  lib.close();
  assert.deepEqual(open(dir).library.services, [{ id: 's1', name: 'Service', date: '2026-10-25', items: ['a'] }]);
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
    hymn('d', 'Formatted', ['Jesus is {gold}**Lord**{/}']),
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
  assert.deepEqual(lib.search('gold'), [], 'formatting marks are not words');
  assert.equal(lib.search('is lord')[0].snippet, 'Jesus \u0002is\u0003 \u0002Lord\u0003');
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

it('applies one console’s changes, merging the order with songs added elsewhere', () => {
  const dir = folder();
  const lib = open(dir);
  lib.set({ presentations: [song('a', 'One'), song('b', 'Two'), song('c', 'Three')], playlist: ['a'] });
  const raw = new DatabaseSync(path.join(dir, 'lumen.db'));
  raw.exec("UPDATE presentations SET name = name || '*'");
  // Another console adds a song at revision 2; this one, still at 1, renames b, deletes c and adds d.
  assert.equal(lib.patch({ presentations: { put: [song('x', 'Elsewhere')] } }, 1).rev, 2);
  const r = lib.patch({ presentations: { put: [song('b', 'Two renamed'), song('d', 'New')], remove: ['c'],
    order: ['d', 'a', 'b'] }, set: { playlist: ['a', 'b'] } }, 1);
  assert.deepEqual([r.rev, r.prev, r.conflicts], [3, 2, []]);
  assert.deepEqual(lib.library.presentations.map(p => p.id), ['d', 'a', 'b', 'x']);
  assert.deepEqual(lib.library.playlist, ['a', 'b']);
  assert.deepEqual(r.applied.presentations.remove, ['c']);
  assert.deepEqual(r.applied.presentations.order, ['d', 'a', 'b', 'x']);
  assert.deepEqual(r.applied.set, { playlist: ['a', 'b'] });
  // Only the rows that changed were written; a.
  assert.equal(raw.prepare("SELECT name FROM presentations WHERE key = 'a'").get().name, 'One*');
  assert.deepEqual(lib.search('renamed').map(x => x.id), ['b']);
  assert.deepEqual(lib.search('three'), []);
  // Nothing new: no revision.
  assert.equal(lib.patch({ presentations: { put: [song('a', 'One')] } }, 3).applied, null);
  assert.equal(lib.rev, 3);
  raw.close();
  lib.close();
  assert.deepEqual(open(dir).library.presentations.map(p => p.name), ['New', 'One', 'Two renamed', 'Elsewhere']);
});

it('keeps a change made elsewhere since the console last loaded, and says so', () => {
  const dir = folder();
  const lib = open(dir);
  lib.set({ presentations: [song('a', 'One'), song('b', 'Two'), song('c', 'Three')] });
  lib.patch({ presentations: { put: [song('a', 'One (theirs)')], remove: ['c'] } }, 1);
  // Edits to a (changed since) and c (deleted since) are refused; b goes through.
  const r = lib.patch({ presentations: { put: [song('a', 'One (mine)'), song('b', 'Two (mine)'), song('c', 'Three (mine)')] } }, 1);
  assert.deepEqual(r.conflicts.map(c => [c.id, c.name]), [['a', 'One (theirs)'], ['c', 'Three (mine)']]);
  assert.deepEqual(lib.library.presentations.map(p => p.name), ['One (theirs)', 'Two (mine)']);
  // Deleting a song someone changed since is refused too; the same change made twice is not a conflict.
  const d = lib.patch({ presentations: { remove: ['a'], put: [song('b', 'Two (mine)')] } }, 1);
  assert.deepEqual(d.conflicts.map(c => c.id), ['a']);
  // Once loaded again, changes go through.
  assert.deepEqual(lib.patch({ presentations: { put: [song('a', 'One (mine)')] } }, lib.rev).conflicts, []);
  assert.throws(() => lib.patch({ presentations: { put: [{ name: 'No id' }] } }, lib.rev), /needs an id/);
  lib.close();
});

it('moves a database from rows by place to rows by id, keeping its search', () => {
  const dir = folder();
  const old = new DatabaseSync(path.join(dir, 'lumen.db'));
  old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE presentations (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, data TEXT NOT NULL) STRICT;
    CREATE VIRTUAL TABLE search USING fts5 (name, author, copyright, ccli, lyrics, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3');
    CREATE TABLE services (pos INTEGER PRIMARY KEY, id TEXT, name TEXT, date TEXT, data TEXT NOT NULL) STRICT;
    PRAGMA user_version = 3;`);
  old.prepare('INSERT INTO meta VALUES (?, ?)').run('saved', '1');
  old.prepare('INSERT INTO meta VALUES (?, ?)').run('rev', '4');
  const rows = [song('a', 'One'), song('a', 'Same id'), { name: 'No id' }, song('b', 'Two')];
  rows.forEach((p, i) => {
    old.prepare('INSERT INTO presentations VALUES (?, ?, ?, ?)').run(i, p.id ?? '', p.name, JSON.stringify(p));
    old.prepare('INSERT INTO search (rowid, name) VALUES (?, ?)').run(i, p.name);
  });
  old.prepare('INSERT INTO services VALUES (0, ?, ?, ?, ?)').run('s1', 'Morning', '2026-10-25', JSON.stringify({ id: 's1', name: 'Morning' }));
  old.close();
  const lib = open(dir);
  assert.deepEqual(lib.library, { presentations: rows, services: [{ id: 's1', name: 'Morning' }] });
  assert.equal(lib.rev, 4);
  assert.deepEqual(lib.search('two').map(r => r.id), ['b']);
  assert.deepEqual(lib.patch({ presentations: { put: [song('b', 'Two again')] } }, 4).conflicts, []);
  lib.close();
  assert.deepEqual(open(dir).library.presentations, [...rows.slice(0, 3), song('b', 'Two again')]);
});

it('merges themes, media and other list fields an item at a time', () => {
  const dir = folder();
  const lib = open(dir);
  const theme = (id, name) => ({ id, name, size: 80 });
  lib.set({ presentations: [], templates: [theme('t1', 'One')], media: [], messages: ['Hi'], usage: [{ day: '2026-10-18', id: 'a' }] });
  // Two consoles at revision 1: one adds a theme, a picture and a message; the other renames a theme, adds a
  // picture and notes a song used.
  lib.patch({ merge: { templates: { mode: 'id', put: [theme('t2', 'Two')], remove: [] },
    media: { mode: 'id', put: [{ id: 'm1', src: 'media/a.png' }], remove: [] },
    messages: { mode: 'value', put: ['Welcome'], remove: [], order: ['"Welcome"', '"Hi"'] } } }, 1);
  const r = lib.patch({ merge: { templates: { mode: 'id', put: [theme('t1', 'One renamed')], remove: [] },
    media: { mode: 'id', put: [{ id: 'm2', src: 'media/b.png' }], remove: [] },
    usage: { mode: 'value', put: [{ day: '2026-10-25', id: 'a' }], remove: [] } } }, 1);
  assert.deepEqual(r.resend, []);
  assert.deepEqual(lib.library.templates.map(t => t.name), ['One renamed', 'Two']);
  assert.deepEqual(lib.library.media.map(m => m.id), ['m1', 'm2']);
  assert.deepEqual(lib.library.messages, ['Welcome', 'Hi']);
  assert.deepEqual(lib.library.usage.map(u => u.day), ['2026-10-18', '2026-10-25']);
  assert.deepEqual(r.applied.set.media.map(m => m.id), ['m1', 'm2']); // the merged list, for the other windows
  // Removing one, and a field that can't be read by id, which is asked for whole.
  lib.set({ ...lib.library, fonts: [{ name: 'No id' }, { name: 'No id' }] });
  const d = lib.patch({ merge: { media: { mode: 'id', put: [], remove: ['m1'] }, fonts: { mode: 'id', put: [{ id: 'f' }], remove: [] } } }, lib.rev);
  assert.deepEqual(lib.library.media.map(m => m.id), ['m2']);
  assert.deepEqual(d.resend, ['fonts']);
  lib.close();
});
