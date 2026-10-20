// Bible passages as slides: verses packed onto slides, a verse too long for one slide split where it reads
// naturally, and the Scripture template with a box for the reference. No DOM, so it is tested under Node
// (tests/passage.test.js).
import { H, mainText, TEXT_STYLE, textTemplate, W } from './format.js';
import { uid } from './slides.js';

export const DEFAULTS = { maxChars: 220, versesPerSlide: 1, numbers: false };

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** 16 as ¹⁶, to put a verse number in front of its words. */
export const superscript = n => String(n).replace(/\d/g, d => SUP[d]);

// Where a long verse may be broken, best first: after a sentence, after ; : or a dash, after a comma, at a space.
const BREAKS = [/[.?!][’”'")\]]*\s/g, /[;:—–][’”'")\]]*\s/g, /,[’”'")\]]*\s/g, /\s/g];

/** Text cut into parts of at most `max` characters (where a word allows), as even as the breaks allow. */
export function splitText(text, max) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > max) {
    const left = Math.ceil(rest.length / max);
    const target = rest.length / left;
    const lo = Math.floor(target * 0.6), hi = Math.min(max, Math.ceil(target * 1.4), rest.length - 1);
    let cut = -1;
    for (const re of BREAKS) {
      let best = -1, m;
      re.lastIndex = 0;
      while ((m = re.exec(rest))) {
        const at = m.index + m[0].length; // the next part starts here
        if (at - 1 > hi) break;
        if (at - 1 >= lo && (best < 0 || Math.abs(at - target) < Math.abs(best - target))) best = at;
      }
      if (best > 0) { cut = best; break; }
    }
    if (cut < 0) { // no space where one was wanted: the last one that fits, or a hard break
      const sp = rest.lastIndexOf(' ', max);
      cut = sp > 0 ? sp + 1 : max;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** "Romans 8:28", "Romans 8:28–30", "Genesis 1:31–2:2" for verses that carry their own `ref` ("Romans 8:28"). */
export function versesRef(vs) {
  const a = vs[0], z = vs[vs.length - 1];
  if (vs.length === 1 || (a.chapter === z.chapter && a.verse === z.verse)) return a.ref;
  return a.chapter === z.chapter ? `${a.ref}–${z.verse}` : `${a.ref}–${z.chapter}:${z.verse}`;
}

/** The passage's verses as groups of slides: up to versesPerSlide verses on a slide while they fit in maxChars,
 * and a longer verse on slides of its own. Each group is named for its verses; each slide carries the reference. */
export function passageGroups(verses, { maxChars = DEFAULTS.maxChars, versesPerSlide = DEFAULTS.versesPerSlide,
  numbers = DEFAULTS.numbers, abbrev = '' } = {}) {
  const words = v => numbers ? `${superscript(v.verse)}${v.text}` : v.text;
  const chunks = [];
  let cur = null;
  for (const v of verses) {
    const t = words(v);
    const fits = cur && cur.verses.length < versesPerSlide && cur.verses[0].book === v.book
      && cur.text.length + 1 + t.length <= maxChars;
    if (fits) { cur.verses.push(v); cur.text += ` ${t}`; continue; }
    cur = { verses: [v], text: t };
    chunks.push(cur);
  }
  return chunks.map(c => {
    const name = versesRef(c.verses);
    const reference = abbrev ? `${name} ${abbrev}` : name;
    return { id: uid(), name, slides: splitText(c.text, maxChars).map(text => ({ id: uid(), text, reference })) };
  });
}

/** A presentation of a passage, as the Scripture search makes it. */
export function passagePresentation({ reference, verses, bible = '', abbrev = '' }, opts = {}, templateId = null) {
  const p = { id: uid(), name: abbrev ? `${reference} (${abbrev})` : reference,
    groups: passageGroups(verses, { ...opts, abbrev }), arrangements: [], scripture: { bible, reference } };
  if (templateId) p.templateId = templateId;
  return p;
}

/** The reference box the Scripture template gets: small, under the verse, in the margin below the words. */
export function referenceElement(main) {
  const f = main?.frame || { x: 110, y: 110, w: W - 220, h: H - 220 };
  const bottom = f.y + f.h;
  return { id: 'reference', type: 'text', name: 'Reference', bind: 'slide.reference',
    frame: { x: f.x, y: Math.min(bottom + 10, H - 90), w: f.w, h: 70 },
    style: { ...TEXT_STYLE, font: main?.style?.font || TEXT_STYLE.font, color: main?.style?.color || TEXT_STYLE.color,
      size: 40, weight: 400, italic: true, align: 'right', valign: 'bottom' } };
}

/** The library's Scripture template, made if it has none, with a reference box added if it lacks one. Songs
 * using the template are unchanged: the box shows only on slides that carry a reference. Returns its id. */
export function scriptureTemplate(lib) {
  let t = lib.templates.find(x => x.id === 'scripture') || lib.templates.find(x => /scripture/i.test(x.name || ''));
  if (!t) {
    t = { ...textTemplate({ font: 'Georgia, serif', size: 68, weight: 400, align: 'left' }), id: 'scripture', name: 'Scripture' };
    lib.templates.push(t);
  }
  const els = t.layout.elements;
  if (!els.some(e => e.bind === 'slide.reference')) els.push(referenceElement(mainText(t)));
  return t.id;
}
