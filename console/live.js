// @ts-check
// What is on screen: the live state every output window shows, going live, moving through slides, clearing.
import { $ } from './dom.js';
import { resolveSlide, slideSummary } from './format.js';
import { autoSecs, flat, fontFaces, getPres, save, slideBackground, stageScreen, state, templateFor } from './library.js';
import { transitionFor } from './transitions.js';
import { recordUse } from './usage.js';
import { renderAll, renderLiveMarks } from './views.js';

// ---------- live state ----------
// autoAt is when the live slide auto-advances (shared clock), autoOff pauses that for the live presentation.
export const live = { presId: null, idx: -1, slide: null, bg: null, msg: null, logo: false, next: '',
  stageMsg: '', timer: { dur: 300, endAt: null, remaining: 300 }, autoAt: null, autoOff: false, _autoBgFrom: null };
const LIVE_KEYS = Object.keys(live);
export const adoptLive = l => LIVE_KEYS.forEach(k => { if (k in l) live[k] = l[k]; });
// Pick up where the output left off, so reloading the console never blanks the screen.


// The live slide is drawn again from the library each time it goes out, so a theme or text change shows at once.
function payload() {
  const sl = live.slide;
  if (sl?.quick) sl.elements = resolveSlide({ text: sl.stageText }, { template: templateFor(null) });
  else if (sl && live.presId) {
    const s = flat(getPres(live.presId))[live.idx];
    if (s) Object.assign(sl, { elements: s.elements, stageText: slideSummary(s.slide) });
  }
  return { ...live, logoText: state.db.logoText, fonts: fontFaces(), stage: stageScreen(), transition: transitionFor(getPres(live.presId), state.db) };
}
export function refreshLive() {
  PP.update(preview, payload(), { fade: true });
  renderLiveMarks();
}
export function broadcast() {
  Lumen.publish(payload());
  refreshLive();
}

// ---------- go live / navigation ----------
function nextTarget(presId, idx, dir) {
  const p = getPres(presId); const slides = flat(p);
  const n = idx + dir;
  if (n >= 0 && n < slides.length) return [presId, n];
  const pi = state.db.playlist.indexOf(presId);
  if (pi < 0) return null;
  const np = getPres(state.db.playlist[pi + dir]);
  if (!np) return null;
  const ns = flat(np);
  return ns.length ? [np.id, dir > 0 ? 0 : ns.length - 1] : null;
}
const loopTarget = (presId, idx) => [presId, (idx + 1) % flat(getPres(presId)).length];
export function goLive(presId, idx) {
  const p = getPres(presId); const s = flat(p)[idx];
  if (!s) return;
  if (live.presId !== presId || !live.slide) live.autoOff = false; // a pause lasts while this presentation stays live
  live.presId = presId; live.idx = idx; live.logo = false;
  // A video slide moves on when the video ends rather than on the clock.
  live.autoAt = autoSecs(p) && !s.video ? Lumen.now() + autoSecs(p) * 1000 : null;
  live.slide = { elements: s.elements, stageText: slideSummary(s.slide), label: `${p.name} — ${s.group}`, color: s.color };
  if (s.video) Object.assign(live.slide, { video: true, play: { startAt: Lumen.now(), paused: false, pos: 0 } });
  // The presentation's background (or the slide's own) goes up with it, unless the operator picked another since.
  const bg = slideBackground(p, s.slide), from = s.slide.background ? `${p.id}|${s.slide.id}` : p.id;
  if (bg && (!live.bg || live._autoBgFrom !== from)) { live.bg = bg; live._autoBgFrom = from; }
  const nt = autoSecs(p) ? loopTarget(presId, idx) : nextTarget(presId, idx, 1);
  live.next = nt ? slideSummary(flat(getPres(nt[0]))[nt[1]].slide) : '';
  if (state.selectedId !== presId) { state.selectedId = presId; renderAll(); }
  broadcast();
  if (recordUse(state.db, p)) save(); // for the CCLI usage report
  const el = $(`.slide[data-idx="${idx}"]`); if (el) revealSlide(el);
}
/** A slide typed in on the spot, in the all-songs template. */
export function quickSlide(text) {
  live.presId = null; live.idx = -1; live.logo = false; live.next = ''; live.autoAt = null;
  live.slide = { quick: true, stageText: text, label: 'Quick slide', color: '#555' };
  broadcast();
}
/** Live state saved before slides had layouts (after an update) is drawn again from the library. Returns whether
 * it changed. */
export function upgradeLive() {
  const sl = live.slide;
  if (!sl || sl.elements || sl.quick) return false;
  const s = flat(getPres(live.presId))[live.idx];
  const text = s ? s.text : sl.text || '';
  const elements = s ? s.elements : resolveSlide({ text, media: sl.video || sl.image
    ? { type: sl.video ? 'video' : 'image', src: sl.video || sl.image } : undefined }, { template: templateFor(null) });
  live.slide = { elements, stageText: s ? slideSummary(s.slide) : text, label: sl.label, color: sl.color,
    ...(s ? s.video : sl.video) ? { video: true, play: sl.play } : {} };
  return true;
}
// Scroll only the slide grid, never the page, so the live controls stay where the operator left them.
function revealSlide(el) {
  const grid = $('#slideGrid'), g = grid.getBoundingClientRect(), r = el.getBoundingClientRect();
  if (r.top < g.top) grid.scrollTop += r.top - g.top - 8;
  else if (r.bottom > g.bottom) grid.scrollTop += r.bottom - g.bottom + 8;
}
export function step(dir) {
  if (!live.presId) { if (state.selectedId && flat(getPres(state.selectedId)).length) goLive(state.selectedId, 0); return; }
  if (live.presId !== state.selectedId && dir > 0 && live.idx < 0) { goLive(state.selectedId, 0); return; }
  const t = nextTarget(live.presId, live.idx, dir);
  if (t) goLive(t[0], t[1]);
}
/** The first slide of the presentation dir places along the playlist from the live one (or the selected one),
 * skipping any with no slides. */
export function stepItem(dir) {
  const list = state.db.playlist;
  let i = list.indexOf(live.slide && live.presId ? live.presId : state.selectedId);
  if (i < 0) i = dir > 0 ? -1 : list.length;
  for (i += dir; i >= 0 && i < list.length; i += dir) {
    if (flat(getPres(list[i])).length) return goLive(list[i], 0);
  }
}
/** The first slide of the playlist's nth presentation, counting from 0. */
export function goItem(n) {
  const id = state.db.playlist[n];
  if (id && flat(getPres(id)).length) goLive(id, 0);
}
/** The nth slide (from 0, in play order) of the live presentation, or the selected one when nothing is live. */
export function goSlide(n) {
  const id = live.slide && live.presId ? live.presId : state.selectedId;
  if (id) goLive(id, n);
}
// Seconds into the live video, from its shared clock.
export const videoPos = play => play.paused ? play.pos : (Lumen.now() - play.startAt) / 1000 + play.pos;
export const liveVideoEl = () => live.slide && live.slide.video ? PP.slideVideo(preview) : null;
export function videoControl(what) {
  const play = live.slide && live.slide.video && live.slide.play;
  if (!play) return;
  const v = liveVideoEl(), dur = v && isFinite(v.duration) ? v.duration : Infinity;
  if (what === 'restart') live.slide.play = { startAt: Lumen.now(), paused: false, pos: 0 };
  else if (play.paused) { const pos = play.pos >= dur ? 0 : play.pos; live.slide.play = { startAt: Lumen.now(), paused: false, pos }; }
  else live.slide.play = { startAt: null, paused: true, pos: Math.min(videoPos(play), dur) };
  broadcast();
}
export function autoStep() {
  if (!live.slide || !autoSecs(getPres(live.presId))) return;
  const [id, i] = loopTarget(live.presId, live.idx);
  goLive(id, i);
}
export function toggleAuto() {
  const p = getPres(live.presId); if (!live.slide || !autoSecs(p)) return;
  live.autoOff = !live.autoOff;
  if (!live.autoOff && live.autoAt) live.autoAt = Lumen.now() + autoSecs(p) * 1000;
  broadcast();
}
// Seconds until the live slide auto-advances, or null when it won't.
export const autoRemaining = () => {
  if (!live.slide || live.autoOff || !autoSecs(getPres(live.presId))) return null;
  if (live.autoAt) return (live.autoAt - Lumen.now()) / 1000;
  const v = liveVideoEl(), play = live.slide.play;
  return v && play && !play.paused && isFinite(v.duration) ? v.duration - videoPos(play) : null;
};
export function clear(what) {
  if (what === 'all') { live.slide = null; live.bg = null; live.msg = null; live.logo = false; live.idx = -1; live.next = ''; live._autoBgFrom = null; }
  if (what === 'slide') { live.slide = null; live.idx = -1; live.next = ''; }
  if (what === 'bg') { live.bg = null; live._autoBgFrom = null; }
  if (what === 'msg') live.msg = null;
  if (what === 'logo') live.logo = !live.logo;
  broadcast();
}


const preview = PP.createScreen($('#preview'));
