// Tests for server/bible: reading Bible files, references, the translations database and its API. Run with: npm test
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { describe, it, before, after } = require('node:test');
const { parseBible } = require('../server/bible/formats.js');
const { parseReference, formatReference } = require('../server/bible/reference.js');
const { fromName } = require('../server/bible/books.js');
const { Bibles, ftsQuery } = require('../server/bible/bibles.js');
const { LumenServer } = require('../server.js');

const ZEFANIA = `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="Test Bible" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <INFORMATION><title>Test Bible</title><identifier>TST</identifier><language>en</language></INFORMATION>
  <BIBLEBOOK bnumber="43" bname="Johannes">
    <CHAPTER cnumber="3">
      <CAPTION>Jesus and Nicodemus</CAPTION>
      <VERS vnumber="16">For God so loved the world,<NOTE>Or: so much</NOTE> that he gave his <STYLE css="x">only</STYLE> Son.</VERS>
      <VERS vnumber="17">God didn&apos;t send his Son &amp; condemn<BR/>the world.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="65" bname="Jude"><CHAPTER cnumber="1"><VERS vnumber="3">Beloved, contend for the faith.</VERS>
    <VERS vnumber="4">For certain men crept in.</VERS></CHAPTER></BIBLEBOOK>
</XMLBIBLE>`;

const OSIS = `<?xml version="1.0" encoding="UTF-8"?>
<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace"><osisText osisIDWork="Bible.en.MIL" xml:lang="en">
<header><work osisWork="MIL"><title>Milestone Version</title></work></header>
<div type="book" osisID="Ps"><chapter osisID="Ps.23" sID="Ps.23"/><title type="psalm" canonical="true">A Psalm of David.</title>
<verse osisID="Ps.23.1" sID="Ps.23.1"/>The <divineName>Lord</divineName> is my shepherd;<note type="x">Isa 40:11</note>
<l>I shall not want.</l><verse eID="Ps.23.1"/>
<verse osisID="Ps.23.2" sID="Ps.23.2"/>He makes me lie down.<verse eID="Ps.23.2"/></div>
<div type="book" osisID="Gen"><chapter osisID="Gen.1"><verse osisID="Gen.1.1">In the beginning <w lemma="x">God</w> created.</verse></chapter></div>
</osisText></osis>`;

const USFX = `<?xml version="1.0" encoding="UTF-8"?><usfx><languageCode>eng</languageCode>
<book id="FRT"><p>Preface text</p></book>
<book id="ROM"><id id="ROM">Romans</id><h>Romans</h><c id="8"/><s>More than conquerors</s>
<p><v id="28"/>We know that all things work together for good.<f caller="+"><fr>8:28 </fr><ft>Some manuscripts</ft></f><ve/>
<v id="29"/><wj>For whom he foreknew</wj>, he also predestined.<ve/></p>
<c id="9"/><d><v id="1"/>I tell the truth.</d><ve/></book></usfx>`;

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const verse = (bible, n, c, v) =>
  bible.books.find(b => b.number === n)?.verses.find(x => x[0] === c && x[1] === v)?.[2];

describe('reading Bible files', () => {
  it('reads Zefania, leaving notes and headings out', () => {
    const b = parseBible(ZEFANIA);
    assert.deepEqual([b.format, b.name, b.abbrev, b.language], ['zefania', 'Test Bible', 'TST', 'en']);
    assert.deepEqual(
      b.books.map(x => [x.number, x.name]),
      [
        [43, 'Johannes'],
        [65, 'Jude'],
      ],
    );
    assert.equal(verse(b, 43, 3, 16), 'For God so loved the world, that he gave his only Son.');
    assert.equal(verse(b, 43, 3, 17), "God didn't send his Son & condemn the world.");
  });

  it('reads OSIS, with milestone and container verses', () => {
    const b = parseBible(OSIS);
    assert.deepEqual([b.format, b.name, b.abbrev, b.language], ['osis', 'Milestone Version', 'MIL', 'en']);
    assert.deepEqual(
      b.books.map(x => x.number),
      [1, 19],
    ); // in Bible order
    assert.equal(verse(b, 19, 23, 1), 'The Lord is my shepherd; I shall not want.');
    assert.equal(verse(b, 19, 23, 2), 'He makes me lie down.');
    assert.equal(verse(b, 1, 1, 1), 'In the beginning God created.');
  });

  it('reads USFX, keeping a verse that starts in a title and leaving front matter out', () => {
    const b = parseBible(USFX);
    assert.deepEqual([b.format, b.language, b.books.map(x => x.number)], ['usfx', 'eng', [45]]);
    assert.equal(verse(b, 45, 8, 28), 'We know that all things work together for good.');
    assert.equal(verse(b, 45, 8, 29), 'For whom he foreknew, he also predestined.');
    assert.equal(verse(b, 45, 9, 1), 'I tell the truth.');
  });

  it('turns away other files', () => {
    assert.throws(() => parseBible('<html><body>Hi</body></html>'), /not a Zefania, OSIS or USFX/);
    assert.throws(() => parseBible('<XMLBIBLE biblename="Empty"></XMLBIBLE>'), /no verses/);
  });
});

describe('references', () => {
  const p = t => parseReference(t, fromName);
  it('reads the ways people write them', () => {
    assert.deepEqual(p('John 3:16'), [{ book: 43, ranges: [[3, 16, 3, 16]] }]);
    assert.deepEqual(p('jn 3.16-18'), [{ book: 43, ranges: [[3, 16, 3, 18]] }]);
    assert.deepEqual(p('1 Cor 13:4–7, 13'), [
      {
        book: 46,
        ranges: [
          [13, 4, 13, 7],
          [13, 13, 13, 13],
        ],
      },
    ]);
    assert.deepEqual(p('I John 4:8'), [{ book: 62, ranges: [[4, 8, 4, 8]] }]);
    assert.deepEqual(p('Ps 23; 24:1-3'), [
      {
        book: 19,
        ranges: [
          [23, null, 23, null],
          [24, 1, 24, 3],
        ],
      },
    ]);
    assert.deepEqual(p('Gen 1:1-2:3'), [{ book: 1, ranges: [[1, 1, 2, 3]] }]);
    assert.deepEqual(p('Gen 2-3'), [{ book: 1, ranges: [[2, null, 3, null]] }]);
    assert.deepEqual(p('Jude 3'), [{ book: 65, ranges: [[1, 3, 1, 3]] }]);
    assert.deepEqual(p('Song of Songs 2:1'), [{ book: 22, ranges: [[2, 1, 2, 1]] }]);
    assert.deepEqual(p('John 3:16; Rom 5:8'), [
      { book: 43, ranges: [[3, 16, 3, 16]] },
      { book: 45, ranges: [[5, 8, 5, 8]] },
    ]);
    assert.deepEqual(p('Job'), [{ book: 18, ranges: [[1, null, 1, null]] }]);
  });

  it('leaves words and nonsense to be searched for', () => {
    for (const t of ['love one another', 'John 3:16 love', '3:16', 'John 3:18-16', 'John 0:1', ''])
      assert.equal(p(t), null, t);
  });

  it('writes a reference back for the verses found', () => {
    const vs = list => list.map(([chapter, verse]) => ({ chapter, verse }));
    const ends = { 1: 31, 8: 39, 23: 6 };
    const end = c => ends[c] ?? 30;
    assert.equal(
      formatReference(
        'Romans',
        vs([
          [8, 28],
          [8, 29],
          [8, 31],
          [8, 32],
          [9, 1],
        ]),
        end,
      ),
      'Romans 8:28–29, 31–32; 9:1',
    );
    assert.equal(
      formatReference(
        'Psalms',
        vs([
          [23, 1],
          [23, 2],
          [23, 3],
          [23, 4],
          [23, 5],
          [23, 6],
        ]),
        end,
      ),
      'Psalm 23',
    );
    assert.equal(
      formatReference(
        'Genesis',
        vs([
          [1, 31],
          [2, 1],
          [2, 2],
        ]),
        end,
      ),
      'Genesis 1:31–2:2',
    );
    assert.equal(
      formatReference(
        'Jude',
        vs([
          [1, 3],
          [1, 4],
        ]),
        () => 25,
        true,
      ),
      'Jude 3–4',
    );
  });
});

describe('the translations database', () => {
  let dir, bundled, bibles;
  before(() => {
    dir = tmp('lumen-bible-');
    bundled = tmp('lumen-bundled-');
    // A small stand-in for a translation that comes with Lumen.
    const books = [
      {
        number: 43,
        verses: [
          [3, 16, 'For God so loved the world.'],
          [3, 17, 'For God sent not his Son to condemn.'],
        ],
      },
    ];
    fs.writeFileSync(path.join(bundled, 'kjv.json.gz'), zlib.gzipSync(JSON.stringify({ books })));
    bibles = new Bibles(dir, bundled);
  });
  after(() => bibles.close());

  it('lists the translations that come with Lumen before they are used, and adds one when it is', () => {
    assert.deepEqual(
      bibles.list().map(b => [b.id, b.bundled, b.installed]),
      [['kjv', true, false]],
    );
    const r = bibles.passage('kjv', 'John 3:16-17');
    assert.equal(r.reference, 'John 3:16–17');
    assert.deepEqual(
      r.verses.map(v => v.ref),
      ['John 3:16', 'John 3:17'],
    );
    assert.deepEqual(
      bibles.list().map(b => [b.id, b.installed]),
      [['kjv', undefined]],
    );
    assert.throws(() => bibles.remove('kjv'), /cannot be removed/);
    assert.throws(() => bibles.passage('nope', 'John 3:16'), /no such translation/);
  });

  it('imports files, finds passages by its own book names, and searches the words', () => {
    const a = bibles.import(Buffer.from(ZEFANIA), 'test.xml');
    assert.deepEqual([a.id, a.name, a.format, a.books, a.verses], ['tst', 'Test Bible', 'zefania', 2, 4]);
    const again = bibles.import(zlib.gzipSync(Buffer.from(ZEFANIA)), 'test.xml.gz');
    assert.equal(again.id, 'tst-2');
    assert.equal(bibles.passage('tst', 'Johannes 3:16').reference, 'Johannes 3:16');
    assert.equal(bibles.passage('tst', 'Jn 3').reference, 'Johannes 3:16–17'); // the usual names work too
    assert.equal(bibles.passage('tst', 'Jude 3-4').reference, 'Jude 3–4');
    assert.deepEqual(bibles.passage('tst', 'Gen 1:1'), null, 'a book this translation lacks is not a reference to it');
    assert.deepEqual(bibles.passage('tst', 'John 4:1'), { reference: '', verses: [] });
    assert.deepEqual(
      bibles.search('tst', 'loved world').map(v => v.ref),
      ['Johannes 3:16'],
    );
    assert.deepEqual(
      bibles.search('tst', 'condem').map(v => v.ref),
      ['Johannes 3:17'],
      'the last word as typed so far',
    );
    assert.deepEqual(
      bibles.search('tst', '"the faith"').map(v => v.ref),
      ['Jude 1:3'],
    );
    assert.deepEqual(
      bibles.search('kjv', 'condemn').map(v => v.ref),
      ['John 3:17'],
      'each translation searched alone',
    );
    assert.equal(bibles.remove('tst-2'), true);
    assert.equal(bibles.remove('tst-2'), false);
    assert.deepEqual(bibles.search('tst', 'condemn').length, 1, 'removing one leaves the other searchable');
    assert.deepEqual(
      bibles.list().map(b => b.id),
      ['kjv', 'tst'],
    );
  });

  it('builds safe full-text queries', () => {
    assert.equal(ftsQuery('love one anoth'), '"love" "one" "anoth"*');
    assert.equal(ftsQuery('"the faith"'), '"the faith"');
    assert.equal(ftsQuery('grace AND OR NEAR( "'), '"grace" "AND" "OR" "NEAR"');
    assert.equal(ftsQuery('!!'), null);
  });

  it('reads files in other encodings', () => {
    const latin = Buffer.from(
      ZEFANIA.replace('utf-8', 'ISO-8859-1')
        .replace('Test Bible"', 'Bíblia Test"')
        .replace('Test Bible<', 'Bíblia Test<'),
      'latin1',
    );
    assert.equal(bibles.import(latin, 'x.xml').name, 'Bíblia Test');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(OSIS.replace('UTF-8', 'UTF-16'), 'utf16le')]);
    assert.equal(bibles.import(utf16, 'y.xml').name, 'Milestone Version');
  });
});

describe('the scripture API', () => {
  let srv, port;
  const req = (method, p, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || 'null') }),
        );
      });
      r.on('error', reject);
      r.end(body);
    });
  before(async () => {
    srv = new LumenServer({ host: '127.0.0.1', port: 0, data: tmp('lumen-bible-srv-') });
    port = await srv.listen();
  });
  after(() => srv.close());

  it('imports a file, finds passages and words in it, and removes it', async () => {
    const xml = Buffer.from(ZEFANIA);
    assert.equal(
      (await req('POST', '/api/bibles', 'x', { 'Content-Type': 'text/plain', 'Content-Length': 1 })).status,
      400,
    );
    const bad = await req('POST', '/api/bibles', '<html/>', { 'Content-Type': 'application/xml', 'Content-Length': 7 });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /could not read that Bible/);
    const add = await req('POST', '/api/bibles', xml, {
      'Content-Type': 'text/xml',
      'Content-Length': xml.length,
      'X-Filename': 'test.xml',
    });
    assert.equal(add.status, 201);
    assert.equal(add.json.bible.id, 'tst');
    assert.ok((await req('GET', '/api/bibles')).json.bibles.some(b => b.id === 'tst' && !b.bundled));
    const passage = await req('GET', '/api/scripture?bible=tst&q=' + encodeURIComponent('John 3:16-17'));
    assert.deepEqual(
      [passage.json.type, passage.json.reference, passage.json.verses.length],
      ['passage', 'Johannes 3:16–17', 2],
    );
    const words = await req('GET', '/api/scripture?bible=tst&q=contend');
    assert.deepEqual([words.json.type, words.json.verses.map(v => v.ref)], ['search', ['Jude 1:3']]);
    assert.equal((await req('GET', '/api/scripture?bible=none&q=John+3:16')).status, 404);
    assert.equal((await req('DELETE', '/api/bibles/tst')).status, 200);
    assert.equal((await req('DELETE', '/api/bibles/tst')).status, 404);
    assert.equal((await req('DELETE', '/api/bibles/kjv')).status, 400);
  });

  it('comes with public-domain translations ready to use', async () => {
    const list = (await req('GET', '/api/bibles')).json.bibles;
    assert.deepEqual(
      list.filter(b => b.bundled).map(b => b.id),
      ['kjv', 'web', 'bsb'],
    );
    const r = (await req('GET', '/api/scripture?bible=kjv&q=' + encodeURIComponent('Jn 3:16'))).json;
    assert.equal(r.reference, 'John 3:16');
    assert.match(r.verses[0].text, /^For God so loved the world, that he gave his only begotten Son/);
  });
});
