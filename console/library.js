// The library in memory (presentations, services and the open one's playlist, templates, media list, messages), saving it, and looking things
// up in it. With the server the library lives there; this browser's copy (IndexedDB) is the store when running without it.
import { toast } from './dom.js';
import { arrangement, FORMAT, mainText, migrateLibrary, refUrl, resolveSlide, resolveStage, textTemplate, TEXT_STYLE } from './format.js';
import { BUILTIN_TEMPLATES } from './seed.js';
import { ensureServices, stashPlaylist } from './services.js';
import { groupColor } from './slides.js';

/** What the modules share: the library, the presentation selected in the console, and a passage the Bible tab put
 * on screen without adding it to the library (kept in memory only, until it is added or replaced). */
export const state = { db: null, selectedId: null, preview: null };

export const KEY = 'lumen.db.v1';

export const valid = d => d && Array.isArray(d.presentations);
/** A library in the current format, with every list it needs. A template missing its text box gets one back. */
export const normalize = d => {
  const lib = migrateLibrary(d);
  const fix = t => mainText(t) ? t : { ...textTemplate(), ...t, layout: textTemplate().layout };
  return ensureServices({ ...lib, media: lib.media || [], fonts: Array.isArray(lib.fonts) ? lib.fonts : [],
    playlist: lib.playlist || [], messages: lib.messages || [],
    baseTemplate: fix(lib.baseTemplate || textTemplate()),
    templates: (Array.isArray(lib.templates) ? lib.templates : BUILTIN_TEMPLATES()).map(fix) });
};
/** Saved by a newer Lumen: shown, but not saved over, so nothing it added is lost. */
export const newer = () => (state.db.format || 1) > FORMAT;

// This browser's copy of the library: the store without the server, and what the console shows when it can't reach
// the server. It is kept in IndexedDB, which holds far more than localStorage's few megabytes; localStorage is read
// for a copy saved by an earlier Lumen, and written where IndexedDB can't be used.
const IDB = 'lumen', STORE = 'library';
const openCopy = () => new Promise((res, rej) => {
  const r = indexedDB.open(IDB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
export async function loadCopy() {
  try {
    const db = await openCopy();
    const lib = await new Promise((res, rej) => { const q = db.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    db.close();
    if (valid(lib)) return lib;
  } catch {}
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
let copyTimer = null, copyLib = null;
/** Keep this library as the browser's copy: straight away without the server, a moment after the last change with it. */
export function keepCopy(lib, now = !Lumen.online) {
  copyLib = lib; clearTimeout(copyTimer); copyTimer = setTimeout(writeCopy, now ? 0 : 2000);
}
async function writeCopy() {
  const lib = copyLib; copyLib = null;
  if (!lib) return;
  try {
    const db = await openCopy();
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(lib, KEY); tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
    db.close();
    try { localStorage.removeItem(KEY); } catch {}
  } catch {
    try { localStorage.setItem(KEY, JSON.stringify(lib)); }
    catch { if (!Lumen.online) toast('Storage full — large images are kept for this session only'); }
  }
}

let warned = false;
export const save = () => {
  if (newer()) {
    if (!warned) toast('This library was saved by a newer Lumen. Restart Lumen to update before making changes.');
    warned = true;
    return;
  }
  stashPlaylist(state.db);
  const keep = { ...state.db, media: state.db.media.filter(m => !m.src.startsWith('blob:')) };
  Lumen.saveLibrary(keep);
  keepCopy(keep);
};


export const getPres = id => state.db.presentations.find(p => p.id === id) || (state.preview?.id === id ? state.preview : undefined);
const bin = id => state.db.media.find(m => m.id === id)?.src || null;
export const mediaUrl = ref => refUrl(ref, bin);
export { arrangement };
/** The slides of a presentation in play order, each with its group and what a screen draws for it. */
export const flat = p => {
  if (!p) return [];
  const list = arrangement(p).flatMap(gi => p.groups[gi].slides.map((slide, si) => ({ slide, group: p.groups[gi].name, gi, si,
    color: groupColor(p.groups[gi].name) })));
  const template = templateFor(p);
  return list.map((s, index) => ({ ...s, text: s.slide.text || '', video: s.slide.media?.type === 'video',
    elements: resolveSlide(s.slide, { template, pres: p, group: s.group, index, count: list.length, bin,
      licence: state.db.ccliLicence, showCredits: state.db.showCredits !== false }) }));
};
export const isVideoPres = p => { const sl = flat(p); return sl.length > 0 && sl.every(s => s.video); };
/** The stage display's own layout as the stage page draws it, or null for the standard stage display. */
export const stageScreen = () => state.db.stageLayout?.layout
  ? { elements: resolveStage(state.db.stageLayout.layout, { bin }), bg: bgUrl(state.db.stageLayout.background) } : null;
// Fonts uploaded to the library, { id, name, src }: a text style names one by its name, and every window that
// draws slides loads them (PP.useFonts).
export const fontValue = f => `'${f.name}', sans-serif`;
export const fontFaces = () => state.db.fonts.map(f => ({ family: f.name, src: mediaUrl(f.src) })).filter(f => f.src);
/** A background as a screen draws it, with a picture or video's reference as a URL. */
export const bgUrl = bg => {
  if (!bg) return null;
  const src = ['image', 'video'].includes(bg.type) ? mediaUrl(bg.src) : bg.src;
  return src ? { ...bg, src } : null;
};
/** The background a slide brings with it: its own, its presentation's, or its theme's. A video in the playlist
 * or an imported slide deck doesn't show with the theme, so it doesn't take the theme's background. */
export const slideBackground = (p, slide) =>
  bgUrl(slide?.background || p?.background || (p?.kind ? null : templateFor(p)?.background));
// Every presentation uses the all-songs template (a saved one, or the default style) unless it picked its own.
export const findTemplate = id => id ? state.db.templates.find(t => t.id === id) || null : null;
export const savedTemplate = p => p ? findTemplate(p.templateId) : null;
const baseTemplate = () => findTemplate(state.db.defaultTemplateId) || state.db.baseTemplate;
export const templateFor = p => savedTemplate(p) || baseTemplate();
/** The style of a template's main text box, with defaults filled in. */
export const textStyle = t => ({ ...TEXT_STYLE, ...mainText(t)?.style });
// A presentation can move on by itself every few seconds, looping from its last slide back to its first.
export const autoSecs = p => p && p.advance > 0 ? p.advance : 0;
