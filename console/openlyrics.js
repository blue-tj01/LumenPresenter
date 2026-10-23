// @ts-check
// Songs from OpenLyrics files (what OpenLP exports, and other apps read) and OpenSong song files, read into
// presentations with their writers, copyright, CCLI song number and play order. Each verse keeps the slides it had
// in the app it came from. No DOM, so it is tested under Node (tests/openlyrics.test.js).
import { child, kids, parseXml, text } from './xml.js';
import { presentation, tidy } from './songselect.js';
import { uid } from './slides.js';

// The short verse names both formats use (v1, c, b, p2...) as Lumen's colour-coded group names.
const KINDS = { v: 'Verse', c: 'Chorus', b: 'Bridge', p: 'Pre-Chorus', t: 'Tag', i: 'Intro', e: 'Ending', o: 'Other' };
/** "v1" → "Verse 1", "c" → "Chorus", "v2a" → "Verse 2a"; a name that isn't a short code is kept as it is. */
export function groupName(code) {
  const m = /^([a-z])(\d*)([a-z]?)$/i.exec(String(code).trim());
  if (!m || !KINDS[m[1].toLowerCase()]) return tidy(code) || 'Verse';
  return [KINDS[m[1].toLowerCase()], m[2] + m[3]].filter(Boolean).join(' ');
}

/** A presentation from verses, each { key, slides } in the order written, played in `order` (keys; empty for as
 * written). Keys match case aside, and a key in the order with no verse is skipped. */
function build(name, verses, order, meta) {
  const groups = [], byKey = new Map();
  for (const { key, slides } of verses) {
    const kept = slides.map(s => s.split('\n').map(l => l.trim()).filter(Boolean).join('\n')).filter(Boolean);
    if (!kept.length) continue;
    const k = key.toLowerCase();
    const g = byKey.get(k);
    if (g) { g.slides.push(...kept.map(t => ({ id: uid(), text: t }))); continue; } // the same verse given in parts
    let label = groupName(key), n = 2;
    while (groups.some(x => x.name.toLowerCase() === label.toLowerCase())) label = `${groupName(key)} (${n++})`;
    const ng = { id: uid(), name: label, slides: kept.map(t => ({ id: uid(), text: t })) };
    groups.push(ng); byKey.set(k, ng);
  }
  if (!groups.length) throw new Error('no words found');
  const ids = order.map(k => byKey.get(k.toLowerCase())?.id).filter(Boolean);
  return presentation(name, groups, ids.length ? ids : groups.map(g => g.id), meta);
}

// ---------- OpenLyrics ----------
// <song><properties> holds <titles><title>, <authors><author>, <copyright>, <ccliNo> and <verseOrder> ("v1 c v2
// c"); <lyrics> holds a <verse name="v1"> for each verse, its <lines> each a slide, with <br/> between lines (or
// <line> elements, in files from before version 0.8). Chords, comments and formatting tags are left out, and only
// the first language a song is written in is read.
function linesText(el) {
  let out = '';
  for (const c of el.children) {
    if (typeof c === 'string') out += c.replace(/\s+/g, ' ');
    else if (c.name === 'br') out += '\n';
    else if (c.name === 'line') out += '\n' + linesText(c) + '\n';
    else if (c.name !== 'comment') out += linesText(c); // a chord or formatting tag keeps the words inside it
  }
  return out;
}

export function parseOpenLyrics(xml) {
  const song = typeof xml === 'string' ? parseXml(xml) : xml;
  if (song?.name !== 'song' || !child(song, 'lyrics')) throw new Error('not an OpenLyrics file');
  const props = child(song, 'properties');
  const verses = kids(child(song, 'lyrics'), 'verse').filter(v => !v.attrs.translit);
  const lang = verses.find(v => v.attrs.lang)?.attrs.lang;
  const authors = [...new Set(kids(child(props, 'authors'), 'author').map(a => tidy(text(a))).filter(Boolean))];
  return build(text(child(props, 'titles', 'title')),
    verses.filter(v => !v.attrs.lang || v.attrs.lang === lang)
      .map((v, i) => ({ key: v.attrs.name || `v${i + 1}`, slides: kids(v, 'lines').map(linesText) })),
    tidy(text(child(props, 'verseOrder'))).split(' ').filter(Boolean),
    { author: authors.join(', '), copyright: text(child(props, 'copyright')), ccli: digits(text(child(props, 'ccliNo'))) });
}

// ---------- OpenSong ----------
// <song> holds <title>, <author>, <copyright>, <ccli>, <presentation> (the order, "V1 C V2 C") and <lyrics>, in
// OpenSong's own text format: "[V1]" starts a section, words lines start with a space, chord lines with "." and
// comments with ";". A section such as [V] can hold several verses at once, each line starting with its verse's
// number. "||" or a blank line starts a new slide, and "|" a new line.
export function parseOpenSong(xml) {
  const song = typeof xml === 'string' ? parseXml(xml) : xml;
  if (song?.name !== 'song' || !child(song, 'lyrics') || kids(child(song, 'lyrics')).length) throw new Error('not an OpenSong file');
  const verses = [], byKey = new Map();
  let section = 'V', current = null;
  const verse = key => {
    let v = byKey.get(key);
    if (!v) { v = { key, slides: [''] }; byKey.set(key, v); verses.push(v); }
    return v;
  };
  const addLine = (v, line) => {
    for (const [i, part] of line.split('||').entries()) {
      if (i) v.slides.push('');
      const words = part.split('|').map(w => w.replace(/_/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      if (words) v.slides[v.slides.length - 1] += (v.slides[v.slides.length - 1] ? '\n' : '') + words;
    }
  };
  const inSection = () => verses.filter(v => v.key.length === section.length + 1 && v.key.startsWith(section) && /\d$/.test(v.key));
  const breakSlide = v => { if (v && v.slides[v.slides.length - 1]) v.slides.push(''); };
  for (const raw of text(child(song, 'lyrics')).replace(/\r/g, '').split('\n')) {
    const head = /^\s*\[([^\]]+)\]\s*$/.exec(raw);
    if (head) { section = head[1].trim(); current = null; continue; }
    if (/^[.;]/.test(raw)) continue; // chords and comments
    if (!raw.trim() || /^\s*-{2,}\s*$/.test(raw)) { breakSlide(current); inSection().forEach(breakSlide); continue; }
    const numbered = /^(\d)(\s.*|)$/.exec(raw);
    if (numbered) { addLine(verse(section + numbered[1]), numbered[2]); continue; }
    current = verse(section);
    addLine(current, raw);
  }
  return build(text(child(song, 'title')), verses, tidy(text(child(song, 'presentation'))).split(' ').filter(Boolean),
    { author: text(child(song, 'author')), copyright: text(child(song, 'copyright')), ccli: digits(text(child(song, 'ccli'))) });
}

const digits = s => /^\s*\d+\s*$/.test(s) ? s.trim() : '';

/** An OpenLyrics or OpenSong file, told apart by what it holds: OpenLyrics' words are in <verse> elements,
 * OpenSong's are text. Throws for anything else. */
export function parseSongXml(xml) {
  const song = parseXml(xml);
  if (song?.name !== 'song') throw new Error('not an OpenLyrics or OpenSong file');
  return kids(child(song, 'lyrics'), 'verse').length ? parseOpenLyrics(song) : parseOpenSong(song);
}

/** Whether a file's text is XML, which these readers take, rather than a SongSelect download. */
export const isXml = s => /^\s*</.test(s);
