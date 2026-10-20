// The library in memory (presentations, playlist, themes, media list, messages), saving it, and looking things up
// in it. With the server the library lives there; localStorage is the store when running without it.
import { toast } from './dom.js';
import { BUILTIN_THEMES, DEFAULT_THEME } from './seed.js';
import { groupColor, splitSlide } from './slides.js';

/** What the modules share: the library, and the presentation selected in the console. */
export const state = { db: null, selectedId: null };

export const KEY = 'lumen.db.v1';

export const valid = d => d && Array.isArray(d.presentations);
export const normalize = d => ({ ...d, media: d.media || [], playlist: d.playlist || [], messages: d.messages || [],
  theme: { ...DEFAULT_THEME, ...d.theme },
  themes: (Array.isArray(d.themes) ? d.themes : BUILTIN_THEMES).map(t => ({ ...DEFAULT_THEME, ...t })) });

export const save = () => {
  const keep = { ...state.db, media: state.db.media.filter(m => !m.src.startsWith('blob:')) };
  Lumen.saveLibrary(keep);
  try { localStorage.setItem(KEY, JSON.stringify(keep)); }
  catch { if (!Lumen.online) toast('Storage full — large images are kept for this session only'); }
};


export const getPres = id => state.db.presentations.find(p => p.id === id);
const resolveMedia = src => src && src.startsWith('#') ? state.db.media.find(m => m.id === src.slice(1))?.src || null : src;
// A presentation's optional play order lists group names (a group may repeat, e.g. the chorus).
// Names that match no group are skipped; with no order the groups play as written.
const findGroup = (p, name) => p.groups.findIndex(g => g.name.toLowerCase() === name.toLowerCase());
export const arrangement = p => {
  const seq = (p.order || []).map(n => findGroup(p, n)).filter(gi => gi >= 0);
  return seq.length ? seq : p.groups.map((g, gi) => gi);
};
export const flat = p => p ? arrangement(p).flatMap(gi => { const g = p.groups[gi]; return g.slides.map((raw, si) => {
  const { text, image, video } = splitSlide(raw);
  return { text, image: resolveMedia(image), video: resolveMedia(video), group: g.name, gi, si, color: groupColor(g.name) };
}); }) : [];
export const slideSummary = s => s ? s.text || (s.video ? '[Video]' : s.image ? '[Image]' : '') : '';
export const isVideoPres = p => { const sl = flat(p); return sl.length > 0 && sl.every(s => s.video); };
// Every presentation uses the all-songs theme (a saved theme, or the default style) unless it picked its own.
export const findTheme = id => id ? state.db.themes.find(t => t.id === id) || null : null;
export const savedTheme = p => p ? findTheme(p.themeId) : null;
const baseTheme = () => findTheme(state.db.defaultThemeId) || state.db.theme;
export const themeFor = p => savedTheme(p) || baseTheme();
// A presentation can move on by itself every few seconds, looping from its last slide back to its first.
export const autoSecs = p => p && p.advance > 0 ? p.advance : 0;
