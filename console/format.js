// @ts-check
// The library's slide format: presentations of groups of slides, templates, and layouts of positioned elements
// on a 1920×1080 canvas. Converts libraries saved before it (format 1), and resolves a slide into what a screen
// draws. No DOM, so it is tested under Node (tests/format.test.js).
import { splitSlide, uid } from './slides.js';
import { hasMarks, parseWords, plainWords } from './words.js';

export const FORMAT = 2;
export const W = 1920, H = 1080;

// ---------- media references ----------
// Presentations refer to media as one string: media:<file> (an upload), folder:<id>/<path> (a media folder),
// bin:<id> (the browser-only media bin), or a URL as it is.
export function toRef(src) {
  if (typeof src !== 'string') return src;
  let m;
  if ((m = /^\/?media\/(.+)$/.exec(src))) return `media:${m[1]}`;
  if ((m = /^\/?folders\/(.+)$/.exec(src))) return `folder:${m[1]}`;
  if (src.startsWith('#')) return `bin:${src.slice(1)}`;
  return src;
}
/** A reference as a URL a page can load; `bin` finds a media bin entry's URL by id.
 * @param {unknown} ref @param {(id: string) => string | null} [bin] */
export function refUrl(ref, bin = () => null) {
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('media:')) return `media/${ref.slice(6)}`;
  if (ref.startsWith('folder:')) return `folders/${ref.slice(7)}`;
  if (ref.startsWith('bin:')) return bin(ref.slice(4));
  return ref;
}
/** A reference as the text editor shows it, unchanged from before references had a scheme. */
export function legacyRef(ref) {
  if (typeof ref !== 'string') return ref;
  if (ref.startsWith('media:')) return `media/${ref.slice(6)}`;
  if (ref.startsWith('folder:')) return `folders/${ref.slice(7)}`;
  if (ref.startsWith('bin:')) return `#${ref.slice(4)}`;
  return ref;
}
const MEDIA_TYPES = ['image', 'video'];
const bgRef = bg => bg && MEDIA_TYPES.includes(bg.type) ? { ...bg, src: toRef(bg.src) } : bg || null;

/** Every media reference a slide uses, for checking whether a file is still needed. */
export function slideRefs(slide) {
  const refs = [];
  if (slide.media?.src) refs.push(slide.media.src);
  if (slide.background?.src) refs.push(slide.background.src);
  // A template's other layouts hold pictures and videos too.
  for (const layout of [slide.layout, ...(slide.layouts || []).map(l => l.layout)]) {
    for (const el of layout?.elements || []) if (el.src) refs.push(el.src);
  }
  return refs;
}

// ---------- templates ----------
// The text style the default template starts from; any style field left out takes these values.
export const TEXT_STYLE = { font: "'Segoe UI', system-ui, sans-serif", size: 92, color: '#ffffff', weight: 700,
  italic: false, upper: false, shadow: true, align: 'center', valign: 'middle', lineHeight: 1.2, padding: 0, fit: 'shrink' };
const MARGIN = 110;

/** A template with one text box showing the slide's words.
 * @param {{ id?: string, name?: string, margin?: number, [style: string]: any }} [opts] */
export function textTemplate({ id, name, margin = MARGIN, ...style } = {}) {
  const t = { layout: { elements: [{ id: 'text', type: 'text', name: 'Slide text', bind: 'slide.text',
    frame: { x: margin, y: margin, w: W - 2 * margin, h: H - 2 * margin }, style: { ...TEXT_STYLE, ...style } }] } };
  if (id) Object.assign(t, { id, name });
  return t;
}
/** The layout a slide shows with from its template: the one it picked by `layoutId` from the template's other
 * layouts ([{ id, name, layout }], such as a title or a scripture layout), or the template's main one. */
export const templateLayout = (template, layoutId) =>
  (layoutId && template?.layouts?.find(l => l.id === layoutId)?.layout) || template?.layout;
/** The text box a template's style controls edit: the first one showing the slide's words. */
export const mainText = t => t?.layout?.elements?.find(e => e.type === 'text' && e.bind === 'slide.text') || null;

// Themes before format 2, and the built-in ones a library started with.
const THEME_V1 = { font: "'Segoe UI', system-ui, sans-serif", size: 92, color: '#ffffff', bold: true, shadow: true,
  upper: false, align: 'center', valign: 'middle', margin: MARGIN, lineHeight: 1.2 };
export const BUILTIN_THEMES_V1 = [
  { id: 'classic', name: 'Classic', ...THEME_V1 },
  { id: 'lower-third', name: 'Lower third', ...THEME_V1, size: 64, valign: 'bottom', margin: 80 },
  { id: 'scripture', name: 'Scripture', ...THEME_V1, font: 'Georgia, serif', size: 68, bold: false, align: 'left' },
  { id: 'big-bold', name: 'Big & bold', ...THEME_V1, font: "Impact, 'Arial Black', sans-serif", size: 120, bold: false, upper: true },
];
export const DEFAULT_THEME_V1 = THEME_V1;

/** @param {Record<string, any>} [theme] */
function themeToTemplate(theme = {}) {
  const { id, name, bold, margin, font, size, color, shadow, upper, align, valign, lineHeight } = /** @type {Record<string, any>} */ ({ ...THEME_V1, ...theme });
  return textTemplate({ id, name, margin, font, size, color, shadow, upper, align, valign, lineHeight, weight: bold ? 700 : 400 });
}

// ---------- converting a format 1 library ----------
/** A presentation from format 1: slides as text with @image/@video lines, a play order of group names. */
export function migratePresentation(p) {
  let n = 0;
  const groups = (p.groups || []).map(g => ({ id: `g${++n}`, name: g.name, slides: (g.slides || []).map(raw => {
    const { text, image, video } = splitSlide(String(raw));
    const s = { id: `s${++n}`, text };
    if (video || image) s.media = { type: video ? 'video' : 'image', src: toRef(video || image) };
    return s;
  }) }));
  const { groups: _g, bg, order, themeId, ...rest } = p;
  const q = { ...rest, groups, arrangements: [] };
  if (bg) q.background = bgRef(bg);
  if (themeId) q.templateId = themeId;
  const ids = (order || []).map(name => groups.find(g => g.name.toLowerCase() === String(name).toLowerCase())?.id).filter(Boolean);
  if (ids.length) q.arrangements = [{ id: 'a1', name: 'Default', order: ids }];
  return q;
}

/** A library in this format, from any earlier one. A library from a newer Lumen is returned as it is. */
export function migrateLibrary(d) {
  if ((d.format || 1) >= FORMAT) return d;
  const { theme, themes, defaultThemeId, ...rest } = d;
  const lib = { ...rest, format: FORMAT,
    presentations: d.presentations.map(migratePresentation),
    baseTemplate: themeToTemplate(theme),
    templates: (Array.isArray(themes) ? themes : BUILTIN_THEMES_V1).map(themeToTemplate) };
  if (defaultThemeId) lib.defaultTemplateId = defaultThemeId;
  return lib;
}

// ---------- reading a presentation ----------
/** The groups in play order: the first arrangement, or every group as written. Missing groups are skipped. */
export function arrangement(p) {
  const order = (p.arrangements?.[0]?.order || []).map(id => p.groups.findIndex(g => g.id === id)).filter(gi => gi >= 0);
  return order.length ? order : p.groups.map((g, gi) => gi);
}

// ---------- song details ----------
// A song's details are kept in its meta: ccli (its CCLI song number), author (who wrote it, as one line) and
// copyright. The library's ccliLicence is the church's CCLI licence number.

/** The copyright line a song's licence asks to be shown with it: its title and writers, then its copyright, CCLI
 * song number and the church's licence number. Empty for a presentation with no song details. */
export function credits(pres, licence = '') {
  const m = pres?.meta || {};
  const [author, copyright, ccli] = [m.author, m.copyright, m.ccli].map(v => String(v ?? '').trim());
  if (!author && !copyright && !ccli) return '';
  licence = String(licence ?? '').trim();
  const who = [pres.name && `“${pres.name}”`, author].filter(Boolean).join(' · ');
  const rights = [copyright && (/^(©|\(c\)|public domain)/i.test(copyright) ? copyright : `© ${copyright}`),
    ccli && `CCLI Song # ${ccli}`, licence && `CCLI Licence # ${licence}`].filter(Boolean).join(' · ');
  return [who, rights].filter(Boolean).join('\n');
}
/** The credits a song shows on its last slide when its template doesn't place them itself. */
export const CREDITS_ELEMENT = { id: 'credits', type: 'text', name: 'Song credits', bind: 'pres.credits', showOn: 'last',
  frame: { x: MARGIN, y: H - 130, w: W - 2 * MARGIN, h: 100 },
  style: { ...TEXT_STYLE, size: 30, weight: 400, valign: 'bottom', lineHeight: 1.3 } };
const placesCredits = el => el.bind === 'pres.credits' || el.bind?.startsWith('pres.meta.');

// ---------- resolving what a screen draws ----------
// Words with formatting marks go out as runs to draw, with the plain words beside them.
const markedWords = content => hasMarks(content) ? { content: plainWords(content), runs: parseWords(content) } : { content };
const media = (ref, ctx) => refUrl(ref, ctx.bin);

/** What a text element shows: its own words, or the field it is bound to. */
function boundText(el, ctx) {
  if (!el.bind) return el.content || '';
  const v = { 'slide.text': ctx.slide?.text, 'slide.reference': ctx.slide?.reference, 'pres.name': ctx.pres?.name, 'group.name': ctx.group,
    'pres.meta.copyright': ctx.pres?.meta?.copyright, 'pres.meta.author': ctx.pres?.meta?.author,
    'pres.meta.ccli': ctx.pres?.meta?.ccli && `CCLI ${ctx.pres.meta.ccli}`,
    'pres.credits': credits(ctx.pres, ctx.licence) }[el.bind];
  return v || '';
}

/** A slide as the list of elements a screen draws, back to front: its picture or video, then the template's
 * elements (or the slide's own layout) with words filled in and media as URLs. A song's last slide also shows its
 * credits, with the church's CCLI `licence` number, unless the layout places them or `showCredits` is false. */
/** @param {any} slide @param {{ template?: any, pres?: any, group?: string, index?: number, count?: number,
 *   bin?: (id: string) => string | null, licence?: string, showCredits?: boolean }} [opts] */
export function resolveSlide(slide, { template, pres = null, group = '', index = 0, count = 1, bin, licence = '',
  showCredits = true } = {}) {
  const ctx = { slide, pres, group, bin, licence };
  const out = [];
  if (slide.media) {
    const src = media(slide.media.src, ctx);
    if (src) out.push(slide.media.type === 'video'
      ? { type: 'video', src, fit: 'contain', loop: false, muted: false, fill: '#000' }
      : { type: 'image', src, fit: 'contain' });
  }
  const shown = el => !el.hidden && (!el.showOn || el.showOn === 'all' || (el.showOn === 'first' && index === 0)
    || (el.showOn === 'last' && index === count - 1));
  const elements = (slide.layout || templateLayout(template, slide.layoutId))?.elements || [];
  const extra = showCredits && !elements.some(placesCredits) ? [CREDITS_ELEMENT] : [];
  for (const el of [...elements, ...extra]) {
    if (!shown(el)) continue;
    const { id: _i, name: _n, locked: _l, hidden: _h, showOn: _s, bind: _b, ...e } = el;
    if (el.type === 'text') {
      const content = boundText(el, ctx);
      if (!content) continue;
      const marked = markedWords(content);
      if (!marked.content.trim()) continue;
      out.push({ ...e, ...marked, style: { ...TEXT_STYLE, ...el.style } });
    } else if (el.type === 'image' || el.type === 'video') {
      const src = media(el.src, ctx);
      if (src) out.push({ ...e, src });
    } else out.push(e);
  }
  return out;
}

// ---------- the stage display ----------
// The stage display can have a layout of its own, made in the layout editor: text boxes showing what the stage
// display shows (the live slide's words, the next slide's, the clock...), with shapes and pictures around them.
// The stage page fills the words in itself, since the clock and timer change every second.
export const STAGE_BINDS = [['stage.current', 'Current slide'], ['stage.next', 'Next slide'], ['stage.group', 'Current group'],
  ['stage.clock', 'Clock'], ['stage.timer', 'Timer'], ['stage.message', 'Stage message']];
const stageText = (id, bind, frame, style) => ({ id, type: 'text', bind, frame, style: { ...TEXT_STYLE, shadow: false, ...style } });
/** A stage layout like the standard stage display, to start from. */
export const stageTemplate = () => ({ layout: { elements: [
  stageText('clock', 'stage.clock', { x: 60, y: 30, w: 600, h: 110 }, { font: 'ui-monospace, Consolas, monospace', size: 72, weight: 600, align: 'left' }),
  stageText('timer', 'stage.timer', { x: 1260, y: 30, w: 600, h: 110 }, { font: 'ui-monospace, Consolas, monospace', size: 72, weight: 600, align: 'right' }),
  { id: 'curbox', type: 'shape', kind: 'rect', frame: { x: 60, y: 170, w: 1800, h: 560 }, stroke: { width: 3, color: '#2b3550' }, radius: 16 },
  stageText('group', 'stage.group', { x: 90, y: 180, w: 1740, h: 50 }, { size: 26, color: '#ffcf7a', align: 'left', upper: true, letterSpacing: 3 }),
  stageText('current', 'stage.current', { x: 90, y: 230, w: 1740, h: 480 }, { size: 76, weight: 600 }),
  { id: 'nextbox', type: 'shape', kind: 'rect', frame: { x: 60, y: 760, w: 1800, h: 180 }, fill: '#12151c', radius: 16 },
  stageText('next', 'stage.next', { x: 90, y: 770, w: 1740, h: 160 }, { size: 44, weight: 400, color: '#9ec1ff', align: 'left' }),
  { ...stageText('message', 'stage.message', { x: 60, y: 960, w: 1800, h: 90 }, { size: 48 }), fill: '#ff3b4e' },
] }, background: { type: 'color', src: '#000000' } });
/** A stage layout as the stage page draws it: hidden elements left out, styles filled in, media as URLs. Text boxes
 * keep their bind for the page to fill in. */
/** @param {any} layout @param {{ bin?: (id: string) => string | null }} [opts] */
export function resolveStage(layout, { bin } = {}) {
  const out = [];
  for (const el of layout?.elements || []) {
    if (el.hidden) continue;
    const { id: _i, name: _n, locked: _l, hidden: _h, showOn: _s, ...e } = el;
    if (el.type === 'text') out.push({ ...e, ...markedWords(e.bind ? '' : e.content || ''), style: { ...TEXT_STYLE, ...el.style } });
    else if (el.type === 'image' || el.type === 'video') { const src = refUrl(el.src, bin); if (src) out.push({ ...e, src }); }
    else out.push(e);
  }
  return out;
}

/** The words of a slide for the stage display and the console: its text, or what its media is. */
export function slideSummary(slide) {
  if (!slide) return '';
  if (slide.text) return plainWords(slide.text);
  const words = (slide.layout?.elements || []).filter(e => e.type === 'text' && e.content).map(e => plainWords(e.content)).join('\n');
  return words || (slide.media?.type === 'video' ? '[Video]' : slide.media ? '[Image]' : '');
}

// ---------- the text editor ----------
/** A presentation as the text editor shows it: @bg, [Group] headings, slides with @image/@video lines, and
 * @slide: <id> · <its first words> for a slide with its own layout. */
export function toText(p) {
  let out = p.background && !/^(blob|data):/.test(p.background.src) ? `@bg: ${legacyRef(p.background.src)}\n` : '';
  out += p.groups.map(g => `[${g.name}]\n` + g.slides.map(s => {
    if (s.layout) {
      const first = slideSummary(s).split('\n')[0].trim();
      return `@slide: ${s.id}` + (first ? ` · ${first.length > 40 ? first.slice(0, 39) + '…' : first}` : '');
    }
    const line = s.media ? `@${s.media.type}: ${legacyRef(s.media.src)}` : '';
    return [s.text, line].filter(Boolean).join('\n');
  }).join('\n\n')).join('\n\n');
  return out;
}

/** The groups typed in the text editor, keeping the ids and settings of slides that were already there: a group
 * keeps its id when its name matches one before it, and each slide keeps the one at its position in that group. */
export function fromText(parsed, old = { groups: [] }) {
  const used = new Set(), byId = new Map(old.groups.flatMap(g => g.slides.map(s => [s.id, s])));
  const groups = parsed.groups.map(pg => {
    const og = old.groups.find(g => !used.has(g) && g.name.toLowerCase() === pg.name.toLowerCase());
    if (og) used.add(og);
    const slides = pg.slides.map((raw, si) => {
      const kept = /^@slide:\s*(\S+)(?:\s.*)?$/.exec(raw); // the words after the id are only a reminder
      if (kept) return byId.get(kept[1]) || null;
      const { text, image, video } = splitSlide(raw);
      const prev = og?.slides[si] && !og.slides[si].layout ? og.slides[si] : null;
      const s = { ...prev, id: prev?.id || uid(), text };
      delete s.media;
      if (video || image) s.media = { type: video ? 'video' : 'image', src: toRef(video || image) };
      return s;
    }).filter(Boolean);
    return { ...og, id: og?.id || uid(), name: pg.name, slides };
  });
  return { groups, background: bgRef(parsed.bg) };
}

/** Group ids for a play order typed as names; names that match no group are left out. */
export const orderIds = (groups, names) =>
  names.map(n => groups.find(g => g.name.toLowerCase() === n.toLowerCase())?.id).filter(Boolean);
