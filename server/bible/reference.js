// @ts-check
// Bible references as people type them ("John 3:16-18", "1 Cor 13:4-7, 13", "Ps 23; 24:1", "Jude 3"), and as
// Lumen writes them back ("John 3:16–18").
'use strict';
const { ONE_CHAPTER, book } = require('./books.js');

const BOOK = /^((?:[1-4]\s*|(?:iii|ii|i|first|second|third|1st|2nd|3rd)\s+)?[^\d\s:;,.–—-][^\d:;,–—-]*?)\.?\s*(\d[\s\S]*)?$/i;
const PIECE = /^(\d+)(?:[:.](\d+))?[a-c]?(?:\s*[-–—]\s*(\d+)(?:[:.](\d+))?[a-c]?)?$/i;

/** The passages a reference names, as [{ book, ranges: [[chapter, verse, toChapter, toVerse]] }], where a null
 * verse is the start or end of its chapter. findBook(name) gives a book's number, or 0. Null if the text is not a
 * reference, so it can be searched for as words instead. */
function parseReference(text, findBook) {
  const out = [];
  let cur = null;
  for (const segment of String(text).trim().split(';')) {
    const seg = segment.trim();
    if (!seg) return null;
    let nums = seg;
    const m = /^\d/.test(seg) && cur && !/^[1-4]\s*[^\d\s:.,–—-]/.test(seg) ? null : BOOK.exec(seg);
    if (m) {
      const n = findBook(m[1].trim());
      if (!n) return null;
      cur = out[out.length - 1]?.book === n ? out[out.length - 1] : { book: n, ranges: [] };
      if (cur !== out[out.length - 1]) out.push(cur);
      if (!m[2]) { cur.ranges.push([1, null, 1, null]); continue; } // a book on its own: its first chapter
      nums = m[2];
    } else if (!cur) return null;
    const one = ONE_CHAPTER.has(book(cur.book)?.osis);
    let chapter = one ? 1 : null, verses = one;
    for (const raw of nums.split(',')) {
      const p = PIECE.exec(raw.trim().replace(/\s*([:.])\s*/g, '$1'));
      if (!p) return null;
      const [a, b, c, d] = p.slice(1).map(x => x === undefined ? null : Number(x));
      let range;
      if (b !== null) { // 3:16, 3:16-18, 3:16-4:2
        chapter = a; verses = true;
        range = d !== null ? [a, b, c, d] : [a, b, a, c ?? b];
      } else if (d !== null) range = [a, null, c, d]; // 3-4:2
      else if (verses && chapter) range = [chapter, a, chapter, c ?? a]; // a verse after 3:16, or in a one-chapter book
      else { range = [a, null, c ?? a, null]; chapter = c ?? a; } // 23, 1-2
      const [c1, v1, c2, v2] = range;
      if ([c1, c2, v1 ?? 1, v2 ?? 1].some(x => x < 1) || c2 < c1 || (c2 === c1 && v1 !== null && v2 !== null && v2 < v1)) return null;
      cur.ranges.push(range);
    }
  }
  return out.length ? out : null;
}

/** "John 3:16–18", "Romans 8:28, 31–39", "Psalm 23", "Jude 3" for the verses found, in order. chapterEnd(chapter)
 * is the last verse of that chapter, so a whole chapter is written as just its number.
 * @param {string} name @param {any[]} verses @param {(chapter: number) => number} [chapterEnd] @param {boolean} [oneChapter] */
function formatReference(name, verses, chapterEnd = () => 0, oneChapter = false) {
  const runs = [];
  for (const v of verses) {
    const r = runs[runs.length - 1];
    const next = r && ((v.chapter === r.to.chapter && v.verse === r.to.verse + 1)
      || (v.chapter === r.to.chapter + 1 && v.verse <= 1 && r.to.verse === chapterEnd(r.to.chapter)));
    if (next) r.to = v; else runs.push({ from: v, to: v });
  }
  const chapters = new Set(verses.map(v => v.chapter));
  const title = name === 'Psalms' && chapters.size === 1 ? 'Psalm' : name;
  let out = '', last = null;
  for (const { from, to } of runs) {
    const whole = from.verse <= 1 && to.verse === chapterEnd(to.chapter);
    let s;
    if (whole && oneChapter) s = '';
    else if (oneChapter) s = from.verse === to.verse ? `${from.verse}` : `${from.verse}–${to.verse}`;
    else if (whole) s = from.chapter === to.chapter ? `${from.chapter}` : `${from.chapter}–${to.chapter}`;
    else if (from.chapter !== to.chapter) s = `${from.chapter}:${from.verse}–${to.chapter}:${to.verse}`;
    else {
      const vs = from.verse === to.verse ? `${from.verse}` : `${from.verse}–${to.verse}`;
      s = last === from.chapter ? vs : `${from.chapter}:${vs}`;
      if (last === from.chapter) { out += `, ${s}`; last = to.chapter; continue; }
    }
    out += out ? `${oneChapter ? ',' : ';'} ${s}` : s;
    last = whole ? null : to.chapter;
  }
  return out ? `${title} ${out}` : title;
}

module.exports = { parseReference, formatReference };
