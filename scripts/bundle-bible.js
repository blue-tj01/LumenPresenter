// Make one of the translations that come with Lumen (bibles/<id>.json.gz) from a Zefania, OSIS or USFX file,
// keeping the 66 books. Usage: node scripts/bundle-bible.js <source.xml> bibles/<id>.json.gz
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const { parseBible } = require('../server/bible/formats.js');

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: node scripts/bundle-bible.js <source.xml> <out.json.gz>'); process.exit(1); }
const bible = parseBible(fs.readFileSync(src, 'utf8'));
const books = bible.books.filter(b => b.number <= 66).map(({ number, verses }) => ({ number, verses }));
fs.writeFileSync(out, zlib.gzipSync(JSON.stringify({ books }), { level: 9 }));
console.log(`${out}: ${books.length} books, ${books.reduce((n, b) => n + b.verses.length, 0)} verses`);
