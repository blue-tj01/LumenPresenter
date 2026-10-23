// @ts-check
// Songs from EasyWorship. EasyWorship 2009 and earlier keep their library in a Paradox database: Songs.DB holds
// each song's title, writers and copyright, with the start of its words, and Songs.MB (its memo file) holds the
// words in full. The words are RTF, a blank line between slides, with a slide that starts a section headed by its
// name ("Verse 1", "Chorus"). EasyWorship 6 and later keep it in SQLite (Songs.db and SongWords.db; see below).
// Only the words and details come in; backgrounds and fonts are left out. No DOM, so it is tested under Node
// (tests/easyworship.test.js).
import { decodePage, rtfText } from './rtf.js';
import { readSqlite, tableNames } from './sqlite.js';
import { presentation, tidy } from './songselect.js';
import { uid } from './slides.js';

// ---------- Paradox ----------
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const TEXT = 1,
  MEMO = 12; // the field types read here: a fixed-length string, and text kept in the memo file

/** Whether bytes are a Paradox table (as Songs.DB is), by its header: record and header sizes, and a known block size. */
export function isParadox(b) {
  return (
    b.length >= 2048 &&
    u16(b, 0) > 0 &&
    u16(b, 2) >= 0x78 &&
    u16(b, 2) <= b.length &&
    [1, 2, 3, 4, 8, 16, 32].includes(b[5]) &&
    b[4] === 0
  );
}

/** A Paradox table's records as objects by field name. A string is decoded (Windows-1252); a memo is { leader,
 * offset, size }: the first bytes of its text, and where the whole of it is in the memo file. Other fields are
 * left out. */
export function readParadox(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isParadox(b)) throw new Error('not a Paradox table');
  const recordSize = u16(b, 0),
    headerSize = u16(b, 2),
    blockSize = b[5] * 1024,
    count = u16(b, 0x21);
  // The field types and sizes, from 0x78, then (past a table of pointers and the table's name) their names.
  const types = Array.from({ length: count }, (_, i) => [b[0x78 + i * 2], b[0x79 + i * 2]]);
  let at = 0x78 + count * 2 + 4 + count * 4 + 261;
  const names = [];
  while (names.length < count && at < headerSize) {
    const end = b.indexOf(0, at);
    if (end < 0 || end > headerSize) break;
    names.push(decodePage(b.subarray(at, end)));
    at = end + 1;
  }
  if (names.length < count || recordSize < types.reduce((n, [, size]) => n + size, 0))
    throw new Error('not a Paradox table');

  const records = [],
    seen = new Set();
  // Blocks are chained: each starts with the next block's number, the previous one's, and the offset of its last record.
  for (let block = u16(b, 0x0e); block && !seen.has(block); block = u16(b, headerSize + (block - 1) * blockSize)) {
    seen.add(block);
    const start = headerSize + (block - 1) * blockSize;
    if (start + 6 > b.length) break;
    const last = (u16(b, start + 4) << 16) >> 16; // signed: -recordSize for an empty block
    for (let r = start + 6; r <= start + 6 + last && r + recordSize <= b.length; r += recordSize) {
      const rec = {};
      let f = r;
      types.forEach(([type, size], i) => {
        const v = b.subarray(f, f + size);
        if (type === TEXT) {
          const end = v.indexOf(0);
          rec[names[i]] = decodePage(end < 0 ? v : v.subarray(0, end));
        } else if (type === MEMO)
          rec[names[i]] = { leader: v.subarray(0, size - 10), offset: u32(v, size - 10), size: u32(v, size - 6) };
        f += size;
      });
      records.push(rec);
    }
  }
  return records;
}

/** A memo's bytes: from its leader when it is short enough to fit there, otherwise from the memo file (or as much
 * as the leader holds, without one). A memo file keeps a long text in a block of its own and packs short ones several to a block. */
export function readMemo(memo, mb) {
  if (!memo?.size) return new Uint8Array();
  if (!mb || memo.size <= memo.leader.length) return memo.leader.subarray(0, Math.min(memo.size, memo.leader.length));
  const block = memo.offset & ~0xff,
    index = memo.offset & 0xff;
  if (block + 12 > mb.length) throw new Error('the memo file does not go with this table');
  let start;
  if (mb[block] === 2) start = block + 9;
  else if (mb[block] === 3) start = block + mb[block + 12 + index * 5] * 16;
  else throw new Error('the memo file does not go with this table');
  if (start + memo.size > mb.length) throw new Error('the memo file does not go with this table');
  return mb.subarray(start, start + memo.size);
}

// ---------- the song ----------
// The section names EasyWorship users head slides with, as Lumen's group names.
const SECTION =
  /^(verse|chorus|pre[- ]?chorus|bridge|tag|intro|ending|end|outro|vamp|interlude|misc|slide)\s*(\d+[a-z]?)?\s*(\(.*\))?\s*:?$/i;
const NAMES = { prechorus: 'Pre-Chorus', end: 'Ending', slide: 'Slides' };
/** A heading line as a group name ("chorus 2" → "Chorus 2"), or '' for a line that isn't one. */
export function sectionName(line) {
  const m = SECTION.exec(line.trim());
  if (!m) return '';
  const word = m[1].toLowerCase().replace(/[- ]/g, '');
  return [NAMES[word] || word[0].toUpperCase() + word.slice(1), m[2]].filter(Boolean).join(' ');
}

/** A song from EasyWorship 2009's words (plain text, after the RTF): slides between blank lines, a slide whose
 * first line is a section name starting that section. */
export function songFromWords(title, words, meta = {}) {
  const sections = [];
  for (const block of words.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (!lines.length) continue;
    const name = sectionName(lines[0]);
    if (name) lines.shift();
    if (name || !sections.length) sections.push({ name: name || 'Slides', slides: [] });
    if (lines.length) sections.at(-1).slides.push(lines.join('\n'));
  }
  return songFromSections(title, sections, meta);
}

/** A song from its sections in the order written, each { name, slides }. A section sung again with the same words
 * plays again rather than being copied; one with different words under the same name is numbered on. */
function songFromSections(title, sections, meta) {
  const groups = [],
    order = [];
  for (const { name, slides } of sections) {
    if (!slides.length) continue;
    const text = slides.join('\n\n');
    const same = groups.find(g => g.base === name.toLowerCase() && g.slides.map(s => s.text).join('\n\n') === text);
    if (same) {
      order.push(same.id);
      continue;
    }
    let label = name,
      n = 2;
    while (groups.some(g => g.name.toLowerCase() === label.toLowerCase())) label = `${name} (${n++})`;
    const g = { id: uid(), name: label, base: name.toLowerCase(), slides: slides.map(t => ({ id: uid(), text: t })) };
    groups.push(g);
    order.push(g.id);
  }
  if (!groups.length) throw new Error('no words found');
  groups.forEach(g => delete g.base);
  return presentation(title, groups, order, meta);
}

const details = (author, copyright, admin, number) => ({
  author,
  copyright: [tidy(copyright), tidy(admin) && `admin. by ${tidy(admin)}`].filter(Boolean).join(', '),
  ccli: /^\s*\d+\s*$/.test(number || '') ? String(number).trim() : '',
});

/** The songs in an EasyWorship 2009 library: Songs.DB's bytes, and Songs.MB's (without it, only songs short enough
 * to fit in Songs.DB come in). Returns { songs, cut, empty }: cut counts the songs left out for want of Songs.MB,
 * empty those with no words (such as ones that only play a video) or whose words could not be read. */
export function parseEasyWorship(db, mb) {
  const memoFile = mb && (mb instanceof Uint8Array ? mb : new Uint8Array(mb));
  const records = readParadox(db);
  if (!records.length || !('Title' in records[0]) || !('Words' in records[0]))
    throw new Error('not an EasyWorship song library');
  const songs = [];
  let cut = 0,
    empty = 0;
  for (const r of records) {
    if (!memoFile && r.Words?.size > r.Words?.leader.length) {
      cut++;
      continue;
    }
    try {
      const raw = decodePage(readMemo(r.Words, memoFile)).replace(/\0/g, '');
      const words = /^\s*\{\\rtf/.test(raw) ? rtfText(raw) : raw;
      songs.push(songFromWords(r.Title, words, details(r.Author, r.Copyright, r.Administrator, r['Song Number'])));
    } catch {
      empty++;
    }
  }
  return { songs, cut, empty };
}

// ---------- EasyWorship 6 ----------
// EasyWorship 6 and later keep songs in SQLite: Songs.db's song table holds each song's title, author, copyright,
// administrator and reference_number (its CCLI song number), and SongWords.db's word table its words (song_id
// pointing at the song), as RTF with a paragraph per line. A paragraph marked \sdparawysiwghidden is a section's
// name ("Verse 1"), and one marked \sdslidemarker (with no words) starts a new slide. EasyWorship 7 keeps the same
// two files.

/** A song's sections from its EasyWorship 6 RTF, each { name, slides }. */
export function sectionsFromRtf6(rtf) {
  const sections = [];
  let slide = [];
  const endSlide = () => {
    if (slide.length) {
      if (!sections.length) sections.push({ name: 'Slides', slides: [] });
      sections.at(-1).slides.push(slide.join('\n'));
    }
    slide = [];
  };
  for (const [para] of rtf.matchAll(/\{\\pard(?:[^{}]|\{[^{}]*\})*\}/g)) {
    // each paragraph, a group of its own
    const words = rtfText(`{\\rtf1${para}}`).replace(/\s+/g, ' ').trim();
    if (/\\sdparawysiwghidden\b/.test(para)) {
      endSlide();
      sections.push({ name: sectionName(words) || words || 'Slides', slides: [] });
    } else if (/\\sdslidemarker\b/.test(para)) {
      endSlide();
      if (words) slide.push(words);
    } else if (words) slide.push(words);
  }
  endSlide();
  return sections;
}

/** The songs in an EasyWorship 6 or 7 library: Songs.db's bytes and SongWords.db's. Returns { songs, empty }: empty
 * counts songs with no words. */
export function parseEasyWorship6(songsDb, wordsDb) {
  const songs = readSqlite(songsDb, n => n === 'song').song,
    words = readSqlite(wordsDb, n => n === 'word').word;
  if (!songs || !words) throw new Error('not an EasyWorship 6 song library');
  const bySong = new Map(words.rows.map(w => [w.song_id, w.words]));
  const out = [];
  let empty = 0;
  for (const s of songs.rows) {
    try {
      const rtf = bySong.get(s.rowid);
      if (typeof rtf !== 'string') throw new Error('no words');
      const meta = details(s.author, s.copyright, s.administrator, s.reference_number);
      // Songs typed in EasyWorship 6 or later mark their sections and slides; older ones it brought in (and the
      // songs it comes with) are plain RTF laid out as in EasyWorship 2009.
      out.push(
        /\\sd(parawysiwghidden|slidemarker)\b/.test(rtf)
          ? songFromSections(s.title, sectionsFromRtf6(rtf), meta)
          : songFromWords(s.title, rtfText(rtf), meta),
      );
    } catch {
      empty++;
    }
  }
  return { songs: out, empty };
}

/** Which of EasyWorship 6's files a SQLite file is, by its tables: 'songs' (Songs.db), 'words' (SongWords.db) or ''. */
export function easyWorship6Kind(bytes) {
  try {
    const names = tableNames(bytes);
    return names.includes('song') ? 'songs' : names.includes('word') ? 'words' : '';
  } catch {
    return '';
  }
}
