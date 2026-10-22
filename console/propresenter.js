// Songs from ProPresenter 7: its .pro song files, and the .probundle and .proplaylist files it exports, which are
// zips holding .pro files (and pictures and videos, left out). A .pro file is a Protocol Buffers message, read here
// by field number, with each slide's words as RTF (read by rtf.js). Only the words come in: groups as Lumen's colour-coded groups,
// arrangements as play orders, and the CCLI details; slide designs, backgrounds and media are left out. No DOM, so
// it is tested under Node (tests/propresenter.test.js).
import { rtfText } from './rtf.js';
import { presentation, tidy } from './songselect.js';
import { uid } from './slides.js';
import { isZip, unzip } from './zip.js';

// ---------- Protocol Buffers ----------
/** A message's fields as [number, value] in the order written: a number for a varint, bytes for anything with a
 * length (a string or a message inside this one); fixed-size numbers are skipped. Throws for bytes that aren't a
 * message. */
export function fields(b) {
  const out = [];
  let i = 0;
  const varint = () => {
    let n = 0, m = 1, c;
    do {
      if (i >= b.length) throw new Error('not a ProPresenter file');
      c = b[i++]; n += (c & 0x7f) * m; m *= 128;
    } while (c & 0x80);
    return n;
  };
  while (i < b.length) {
    const key = varint(), f = Math.floor(key / 8), wire = key % 8;
    if (!f) throw new Error('not a ProPresenter file');
    if (wire === 0) out.push([f, varint()]);
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) { const n = varint(); if (i + n > b.length) throw new Error('not a ProPresenter file'); out.push([f, b.subarray(i, i + n)]); i += n; }
    else throw new Error('not a ProPresenter file');
  }
  if (i > b.length) throw new Error('not a ProPresenter file');
  return out;
}
const all = (msg, f) => msg ? fields(msg).filter(([n, v]) => n === f && v instanceof Uint8Array).map(([, v]) => v) : [];
const one = (msg, f) => all(msg, f)[0];
const num = (msg, f) => msg ? fields(msg).find(([n, v]) => n === f && typeof v === 'number')?.[1] : undefined;
const str = b => b ? new TextDecoder().decode(b) : '';
/** A child message following a path of field numbers. */
const path = (msg, ...fs) => fs.reduce((m, f) => one(m, f), msg);
const uuid = msg => str(one(msg, 1)).toUpperCase(); // ProPresenter's UUID message holds the text in field 1

/** A slide's words as lines: each line trimmed, blank lines dropped. */
const lines = s => s.replace(/[\u2028\u2029\r]/g, '\n').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

// ---------- the song ----------
// A Presentation holds its name (field 3), the selected arrangement (10), its arrangements (11: uuid, name, group
// uuids in play order), its groups (12: a group, uuid and name, and the uuids of its slides in order), its slides
// (13: cues, each holding actions, one of them the slide) and its CCLI details (14: author, artist, title,
// publisher, copyright year, song number).

/** The words on one cue (a slide): the text of each of its text boxes, one after another. */
function cueText(cue) {
  const texts = [];
  for (const action of all(cue, 10)) {
    const slide = path(action, 23, 2, 1); // the action's slide, a presentation slide, its base slide
    for (const element of all(slide, 1)) {
      const text = path(element, 1, 13); // the slide element's graphic, its text
      if (!text) continue;
      const rtf = fields(text).find(([, v]) => v instanceof Uint8Array && str(v.subarray(0, 5)) === '{\\rtf');
      if (rtf) texts.push(lines(rtfText(new TextDecoder('latin1').decode(rtf[1]))));
    }
  }
  return texts.filter(Boolean).join('\n');
}

/** A song from a .pro file's bytes: its groups and slides, its arrangements (the one selected in ProPresenter
 * first, as that is the one Lumen plays) and its CCLI details. Throws when it holds no words. */
export function parsePro(bytes, fileName = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const cues = new Map(all(b, 13).map(c => [uuid(one(c, 1)), cueText(c)]));
  const groups = [], written = [], byUuid = new Map(), base = new Map(); // base: each group's name before numbering
  for (const cg of all(b, 12)) {
    const g = one(cg, 1);
    const slides = all(cg, 2).map(id => cues.get(uuid(id))).filter(Boolean);
    if (!slides.length) continue; // a blank group, or one holding only media
    const label = tidy(str(one(g, 2))) || 'Slides', words = slides.join('\n\n');
    // A copy of a group, under the same name with the same words, plays that group again rather than adding one.
    let ng = groups.find(x => base.get(x).toLowerCase() === label.toLowerCase() && x.slides.map(s => s.text).join('\n\n') === words);
    if (!ng) {
      let name = label, n = 2;
      while (groups.some(x => x.name.toLowerCase() === name.toLowerCase())) name = `${label} (${n++})`;
      ng = { id: uid(), name, slides: slides.map(text => ({ id: uid(), text })) };
      groups.push(ng); base.set(ng, label);
    }
    written.push(ng.id); byUuid.set(uuid(one(g, 1)), ng.id);
  }
  if (!groups.length) throw new Error('no words found');

  const ccli = one(b, 14), year = num(ccli, 5), publisher = tidy(str(one(ccli, 4)));
  const title = tidy(str(one(b, 3))) || tidy(str(one(ccli, 3))) || fileName.replace(/^.*[\\/]/, '').replace(/\.pro$/i, '');
  const p = presentation(title, groups, written, {
    author: str(one(ccli, 1)) || str(one(ccli, 2)),
    copyright: [year, publisher].filter(Boolean).join(' '),
    ccli: num(ccli, 6) ? String(num(ccli, 6)) : '',
  });

  const selected = uuid(one(b, 10));
  const arrangements = all(b, 11).map(a => ({
    uuid: uuid(one(a, 1)),
    name: tidy(str(one(a, 2))) || 'Arrangement',
    order: all(a, 3).map(id => byUuid.get(uuid(id))).filter(Boolean),
  })).filter(a => a.order.length);
  arrangements.sort((x, y) => (y.uuid === selected) - (x.uuid === selected));
  if (arrangements.length) p.arrangements = arrangements.map(({ name, order }) => ({ id: uid(), name, order }));
  return p;
}

const isPro = name => /\.pro$/i.test(name) && !/(^|\/)(__MACOSX|\._)/.test(name);

/** The songs in a ProPresenter file: a .pro file is one song, a .probundle or .proplaylist (a zip) the songs it
 * holds, in the order stored. Async, as a bundle's files may need unpacking. Throws when no song can be read. */
export async function parseProPresenter(bytes, fileName = '') {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isZip(b)) return [parsePro(b, fileName)];
  const songs = [];
  for (const f of await unzip(b, isPro)) {
    try { songs.push(parsePro(f.data, f.name)); } catch { /* a .pro with no words, such as a media-only one */ }
  }
  if (!songs.length) throw new Error('no ProPresenter songs found');
  return songs;
}

/** Whether a file, by its name, is one of ProPresenter's. */
export const isProPresenterFile = name => /\.(pro|probundle|proplaylist)$/i.test(name);
