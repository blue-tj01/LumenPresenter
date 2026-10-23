// @ts-check
// Songs from CCLI SongSelect: its .usr files and its plain text (.txt) downloads, read into presentations with their
// writers, copyright and CCLI song number. No DOM, so it is tested under Node (tests/songselect.test.js).
import { uid } from './slides.js';

/** A file's bytes as text: UTF-16 or UTF-8 by its byte order mark, otherwise UTF-8, or Windows-1252 for the
 * older files that aren't valid UTF-8. */
export function decode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}

// SongSelect separates several writers or rights holders with "|".
export const list = s => String(s ?? '').split('|').map(v => v.trim()).filter(Boolean);
export const tidy = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** A presentation from SongSelect's sections, each [label, lines], in the order the file gives them. A section
 * that comes again with the same words is played again rather than copied; one with different words under the
 * same label is numbered on. */
function song(name, sections, meta) {
  const groups = [], order = [];
  for (const [label, lines] of sections) {
    const slides = splitSlides(lines);
    if (!slides.length) continue;
    const text = slides.join('\n\n');
    const same = groups.find(g => g.name.toLowerCase() === label.toLowerCase());
    if (same && same.slides.map(s => s.text).join('\n\n') === text) { order.push(same.id); continue; }
    let n = 2, groupName = label || 'Verse';
    while (groups.some(g => g.name.toLowerCase() === groupName.toLowerCase())) groupName = `${label} ${n++}`;
    const g = { id: uid(), name: groupName, slides: slides.map(t => ({ id: uid(), text: t })) };
    groups.push(g); order.push(g.id);
  }
  return presentation(name, groups, order, meta);
}
/** A song as a presentation: its groups, the order they play in (group ids), and its details (author, copyright,
 * ccli). The order becomes an arrangement only when it isn't the groups as written. Shared with the other song
 * importers (openlyrics.js). */
export function presentation(name, groups, order, meta) {
  const p = { id: uid(), name: tidy(name) || 'Untitled', groups, arrangements: [] };
  if (order.length !== groups.length || order.some((id, i) => groups[i].id !== id)) p.arrangements = [{ id: uid(), name: 'Default', order }];
  const m = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, tidy(v)]).filter(([, v]) => v));
  if (Object.keys(m).length) p.meta = m;
  return p;
}
/** A section's lines as slides of two lines each, like the hymns Lumen starts with: SongSelect gives a whole verse
 * at once, too much for one screen. A blank line inside a section also starts a new slide, and a line left over at
 * the end joins the slide before it. */
const LINES_PER_SLIDE = 2;
function splitSlides(lines) {
  const slides = []; let buf = [];
  const flush = () => {
    for (let i = 0; i < buf.length; i += LINES_PER_SLIDE) {
      const part = buf.slice(i, i + LINES_PER_SLIDE);
      if (i && part.length < LINES_PER_SLIDE) slides[slides.length - 1] += '\n' + part.join('\n');
      else slides.push(part.join('\n'));
    }
    buf = [];
  };
  for (const l of lines) { const t = l.trim(); if (t) buf.push(t); else flush(); }
  flush();
  return slides;
}

// ---------- .usr ----------
// An INI-style file: [S A<song number>] heads the song, then Title=, Author=, Copyright=, Fields= (the section
// labels) and Words= (each section's words), with /t between sections and /n between lines.
export function parseUsr(text) {
  const v = {}; let ccli = '';
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[S\s+A?([^\]]*)\]/i.exec(line);
    if (head) { ccli = head[1].trim(); continue; }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(line);
    if (kv) v[kv[1].toLowerCase()] = kv[2];
  }
  if (!v.title && !v.words) throw new Error('not a SongSelect .usr file');
  const labels = (v.fields || '').split('/t');
  const sections = (v.words || '').split('/t').map((w, i) => [tidy(labels[i]) || `Verse ${i + 1}`, w.split('/n')]);
  return song(v.title, sections, { author: list(v.author).join(', '), copyright: list(v.copyright).join('; '),
    ccli: /^\d+$/.test(ccli) ? ccli : '' });
}

// ---------- .txt ----------
// The title, then each section as a label line ("Verse 1", "Chorus", "Pre-Chorus 2") and its lines, then the
// footer: "CCLI Song # <n>", the writers, the copyright, the terms of use and "CCLI License # <n>".
const LABEL = /^(verse|chorus|pre-?chorus|bridge|tag|ending|intro|outro|refrain|interlude|instrumental|vamp|misc|coda|turnaround|channel|break|descant|prelude|postlude|rap|spoken|hook|response|choral)(\s*[-–]?\s*\d+[a-z]?)?(\s*\(.*\))?$/i;
const SONG_NO = /^ccli\s+song\s*(#|no\.?|number)?\s*:?\s*(\d+)/i;
const TERMS = /^(for use solely|ccli licen[cs]e|note:|www\.ccli\.com|all rights reserved)/i;
const RIGHTS = /^(©|\(c\)|copyright\b|public domain|words:|music:)/i;

export function parseTxt(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
  const first = lines.findIndex(l => l.trim());
  if (first < 0) throw new Error('the file is empty');
  const name = lines[first];
  // The footer starts at the song number or the copyright, taking in the writers' line above it, which some
  // downloads put first and set apart with a blank line. Every section of words starts with its label, so a line
  // with no label just above the footer belongs to it.
  let end = lines.findIndex((l, i) => i > first && (SONG_NO.test(l.trim()) || RIGHTS.test(l.trim())));
  if (end < 0) end = lines.length;
  else {
    let start = end;
    while (lines[start - 1]?.trim() && start - 1 > first) start--;
    if (!LABEL.test(lines[start].trim())) end = start;
    const head = lines[end].trim();
    let i = end - 1;
    while (i > first && !lines[i].trim()) i--;
    if ((SONG_NO.test(head) || RIGHTS.test(head)) && i - 1 > first + 1 && !lines[i - 1].trim() && !LABEL.test(lines[i].trim())) end = i;
  }
  const sections = []; let cur = null;
  for (const l of lines.slice(first + 1, end)) {
    const t = l.trim();
    if (LABEL.test(t)) { cur = [t.replace(/\s*\(.*\)$/, ''), []]; sections.push(cur); continue; }
    if (!cur) { if (!t) continue; cur = ['Verse', []]; sections.push(cur); }
    cur[1].push(t);
  }
  if (!sections.length) throw new Error('no words found');
  const footer = lines.slice(end).map(l => l.trim()).filter(Boolean);
  let ccli = '';
  const authors = [], rights = [];
  for (const l of footer) {
    const no = SONG_NO.exec(l);
    if (no) { ccli = no[2]; continue; }
    if (TERMS.test(l)) continue;
    if (RIGHTS.test(l) || authors.length) rights.push(l); else authors.push(...list(l));
  }
  return song(name, sections, { author: authors.join(', '), copyright: rights.join('; '), ccli });
}

/** A SongSelect file as a presentation, by its name: .usr, or .txt (and anything else) as the text download. */
export function parseSongSelect(filename, text) {
  return /\.usr$/i.test(filename) ? parseUsr(text) : parseTxt(text);
}

/** The presentation in `list` that is already this song: the same CCLI song number, or for a song without one,
 * the same title and no number either. */
export function findSame(list, p) {
  const ccli = p.meta?.ccli, name = p.name.toLowerCase();
  return list.find(q => ccli ? q.meta?.ccli === ccli : !q.meta?.ccli && String(q.name).toLowerCase() === name);
}
