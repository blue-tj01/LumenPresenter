// @ts-check
// Slide transitions: how the audience output, NDI and the console's live preview move from one slide to the next.
// The library sets one for every presentation (library.transition), and a presentation can pick its own
// (pres.transition); each is { type, secs }. The live state carries the one to play, and render.js plays it. No
// DOM, so it is tested under Node (tests/transitions.test.js).

/** The transitions, with how long each takes unless a length is set. */
export const TRANSITIONS = [
  { id: 'cut', name: 'Cut', secs: 0 },
  { id: 'fade', name: 'Fade', secs: 0.45 },
  { id: 'dip', name: 'Dip to black', secs: 0.8 },
  { id: 'push', name: 'Push', secs: 0.5 },
  { id: 'zoom', name: 'Zoom', secs: 0.5 },
];
const DEFAULT = 'fade';
const MAX_SECS = 5;
const find = id => TRANSITIONS.find(t => t.id === id);

/** A transition setting as saved: a known type, and a length in seconds only when one was given. Anything else
 * is null (not set). */
export function cleanTransition(t) {
  if (!t || !find(t.type)) return null;
  const secs = Math.round(Math.min(MAX_SECS, Math.max(0, +t.secs || 0)) * 100) / 100;
  return secs && t.type !== 'cut' ? { type: t.type, secs } : { type: t.type };
}

/** The transition a presentation plays with, as the live state carries it: { type, ms }. The presentation's own
 * type comes first, then the library's. A length set in the library applies to whichever type is used; without
 * one, each type takes its own time. */
export function transitionFor(pres, lib) {
  const own = cleanTransition(pres?.transition), all = cleanTransition(lib?.transition);
  const type = own?.type || all?.type || DEFAULT;
  const secs = type === 'cut' ? 0 : own?.secs ?? all?.secs ?? find(type).secs;
  return { type, ms: Math.round(secs * 1000) };
}
