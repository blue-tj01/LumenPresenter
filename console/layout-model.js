// @ts-check
// The layout editor's working parts that need no page: new elements, snapping, moving, resizing and rotating
// frames, finding the element under the pointer, arranging, colours, and undo. Tested under Node
// (tests/layout.test.js); console/layout-editor.js is the screen around them.
import { H, STAGE_BINDS, TEXT_STYLE, W } from './format.js';
import { plainWords } from './words.js';

// ---------- what a text box can show ----------
/** The fields a text box can show, as the inspector names them; '' is words typed into the box itself. */
export const BINDS = [
  ['slide.text', 'The slide’s words'],
  ['', 'Its own text'],
  ['pres.name', 'Song title'],
  ['group.name', 'Group name'],
  ['pres.credits', 'Song credits'],
  ['slide.reference', 'Bible reference'],
  ['pres.meta.author', 'Written by'],
  ['pres.meta.copyright', 'Copyright'],
  ['pres.meta.ccli', 'CCLI song number'],
];
const KIND = { text: 'Text', image: 'Picture', video: 'Video', shape: 'Shape' };
/** The name the layers list shows for an element: its own, else what it shows or what it is. */
export function elementName(el) {
  if (el.name) return el.name;
  if (el.type === 'text')
    return el.bind
      ? [...BINDS, ...STAGE_BINDS].find(([b]) => b === el.bind)?.[1] || 'Text'
      : plainWords(el.content).split('\n')[0].slice(0, 30) || 'Text';
  if (el.type === 'shape') return el.kind === 'ellipse' ? 'Circle' : el.kind === 'line' ? 'Line' : 'Box';
  return KIND[el.type] || el.type;
}

// ---------- new elements ----------
/** A new element of `type`, centred on the canvas. Pictures and videos take `src`, a media reference. */
export function newElement(type, id, src) {
  const box = (w, h) => ({ x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h });
  if (type === 'text')
    return { id, type, content: 'Text', frame: box(800, 200), style: { ...TEXT_STYLE, size: 72, shadow: false } };
  if (type === 'shape') return { id, type, kind: 'rect', frame: box(600, 300), fill: 'rgba(0, 0, 0, 0.5)', radius: 0 };
  if (type === 'ellipse')
    return { id, type: 'shape', kind: 'ellipse', frame: box(400, 400), fill: 'rgba(255, 255, 255, 0.2)' };
  // A line runs across its frame's middle, `thickness` pixels thick, so it is turned with the frame's rotation.
  if (type === 'line') return { id, type: 'shape', kind: 'line', frame: box(800, 40), fill: '#ffffff', thickness: 6 };
  if (type === 'image') return { id, type, src, fit: 'contain', frame: box(640, 360) };
  if (type === 'video') return { id, type, src, fit: 'cover', loop: true, muted: true, frame: box(640, 360) };
  throw new Error(`No element type ${type}`);
}

// ---------- snapping ----------
// Lines a moving edge or centre snaps to: the canvas's edges and middle, a 5% safe margin, and the other elements'
// edges and middles.
const SAFE_X = W * 0.05,
  SAFE_Y = H * 0.05;
export const SAFE = { x: SAFE_X, y: SAFE_Y, w: W - 2 * SAFE_X, h: H - 2 * SAFE_Y };
export function snapLines(others = []) {
  const xs = [0, SAFE_X, W / 2, W - SAFE_X, W],
    ys = [0, SAFE_Y, H / 2, H - SAFE_Y, H];
  for (const { x, y, w, h } of others) {
    xs.push(x, x + w / 2, x + w);
    ys.push(y, y + h / 2, y + h);
  }
  return { xs, ys };
}
// The closest line within `within` of any of `points`: how far to move, and the line, or null.
function nearest(points, lines, within) {
  let best = null;
  for (const p of points)
    for (const l of lines) {
      const d = l - p;
      if (Math.abs(d) <= within && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: l };
    }
  return best;
}

/** A frame moved by (dx, dy), its edges or middle snapped to `lines` within `within` canvas pixels. Returns the
 * frame and the guides to draw: { x: [lines], y: [lines] }. */
export function moveFrame(f, dx, dy, lines, within = 0) {
  const g = { ...f, x: Math.round(f.x + dx), y: Math.round(f.y + dy) },
    guides = { x: [], y: [] };
  if (!within) return { frame: g, guides };
  const sx = nearest([g.x, g.x + g.w / 2, g.x + g.w], lines.xs, within);
  const sy = nearest([g.y, g.y + g.h / 2, g.y + g.h], lines.ys, within);
  if (sx) {
    g.x = Math.round(g.x + sx.d);
    guides.x.push(sx.at);
  }
  if (sy) {
    g.y = Math.round(g.y + sy.d);
    guides.y.push(sy.at);
  }
  return { frame: g, guides };
}

// ---------- resizing ----------
const MIN = 20;
/** A frame resized by dragging `handle` ('n', 'se', 'w'…) by (dx, dy), its moving edges snapped to `lines`.
 * With `keepRatio` a corner keeps the frame's shape. Never smaller than 20 pixels a side. */
export function resizeFrame(f, handle, dx, dy, { keepRatio = false, lines = null, within = 0 } = {}) {
  let { x, y, w, h } = f;
  let l = x,
    r = x + w,
    t = y,
    b = y + h;
  const guides = { x: [], y: [] };
  const snap = (v, list, axis) => {
    const s = within && lines ? nearest([v], list, within) : null;
    if (s) guides[axis].push(s.at);
    return s ? s.at : v;
  };
  if (handle.includes('w')) l = snap(l + dx, lines?.xs, 'x');
  if (handle.includes('e')) r = snap(r + dx, lines?.xs, 'x');
  if (handle.includes('n')) t = snap(t + dy, lines?.ys, 'y');
  if (handle.includes('s')) b = snap(b + dy, lines?.ys, 'y');
  if (r - l < MIN) handle.includes('w') ? (l = r - MIN) : (r = l + MIN);
  if (b - t < MIN) handle.includes('n') ? (t = b - MIN) : (b = t + MIN);
  if (keepRatio && handle.length === 2 && w && h) {
    // The edge that moved further sets the size; the other follows, from the opposite corner.
    const ratio = w / h,
      nw = r - l,
      nh = b - t;
    if (nw / ratio >= nh) {
      const hh = nw / ratio;
      handle.includes('n') ? (t = b - hh) : (b = t + hh);
      guides.y = [];
    } else {
      const ww = nh * ratio;
      handle.includes('w') ? (l = r - ww) : (r = l + ww);
      guides.x = [];
    }
  }
  return { frame: { ...f, x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) }, guides };
}

/** The rotation, in whole degrees from -180 to 180, that points a frame's top at (px, py); with `step`, to the
 * nearest multiple of it. Close to upright snaps upright. */
export function rotation(f, px, py, step = 0) {
  const cx = f.x + f.w / 2,
    cy = f.y + f.h / 2;
  let deg = (Math.atan2(px - cx, cy - py) * 180) / Math.PI;
  if (step) deg = Math.round(deg / step) * step;
  else if (Math.abs(deg) < 3) deg = 0;
  deg = Math.round(deg);
  return deg === -180 ? 180 : deg;
}

// ---------- finding elements ----------
/** Whether canvas point (px, py) is inside an element's frame, allowing for its rotation. */
export function contains(el, px, py) {
  const f = el.frame || { x: 0, y: 0, w: W, h: H };
  const cx = f.x + f.w / 2,
    cy = f.y + f.h / 2,
    a = (-(f.rotate || 0) * Math.PI) / 180;
  const dx = px - cx,
    dy = py - cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a),
    ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= f.w / 2 && Math.abs(ry) <= f.h / 2;
}
/** The front-most element under a canvas point that can be picked (not hidden or locked), or null. */
export function elementAt(elements, px, py) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!el.hidden && !el.locked && contains(el, px, py)) return el;
  }
  return null;
}

// ---------- arranging ----------
/** The elements with the one `id` names moved: 'forward' or 'backward' one step, or to the 'front' or 'back'. */
export function reorder(elements, id, how) {
  const i = elements.findIndex(e => e.id === id);
  if (i < 0) return elements;
  const out = [...elements],
    [el] = out.splice(i, 1);
  const to = { front: out.length, back: 0, forward: Math.min(i + 1, out.length), backward: Math.max(i - 1, 0) }[how];
  out.splice(to ?? i, 0, el);
  return out;
}
/** A frame lined up with the canvas: 'left', 'center' or 'right', 'top', 'middle' or 'bottom'. */
export function alignFrame(f, how) {
  const g = { ...f };
  if (how === 'left') g.x = 0;
  if (how === 'center') g.x = Math.round((W - f.w) / 2);
  if (how === 'right') g.x = W - f.w;
  if (how === 'top') g.y = 0;
  if (how === 'middle') g.y = Math.round((H - f.h) / 2);
  if (how === 'bottom') g.y = H - f.h;
  return g;
}

// ---------- colours ----------
/** A CSS colour as the colour picker and an opacity take it: { hex: '#rrggbb', alpha: 0–1 }. Colours it doesn't
 * read (names, gradients) come back as white. */
export function parseColor(c) {
  let m;
  const hex = n => n.toString(16).padStart(2, '0');
  if (typeof c !== 'string') return { hex: '#ffffff', alpha: 1 };
  if ((m = /^#([0-9a-f]{3})$/i.exec(c.trim())))
    return {
      hex:
        '#' +
        [...m[1]]
          .map(d => d + d)
          .join('')
          .toLowerCase(),
      alpha: 1,
    };
  if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c.trim())))
    return { hex: '#' + m[1].toLowerCase(), alpha: m[2] ? +(parseInt(m[2], 16) / 255).toFixed(2) : 1 };
  if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/i.exec(c.trim()))) {
    const alpha = m[4] == null ? 1 : m[5] ? +m[4] / 100 : +m[4];
    return {
      hex: '#' + [m[1], m[2], m[3]].map(v => hex(Math.min(255, +v))).join(''),
      alpha: Math.max(0, Math.min(1, alpha)),
    };
  }
  return { hex: '#ffffff', alpha: 1 };
}
/** A colour from the picker's hex and an opacity: the hex when solid, else rgba(). */
export function toColor(hex, alpha = 1) {
  if (alpha >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${+alpha.toFixed(2)})`;
}

// ---------- undo ----------
/** Undo and redo over copies of a value, up to `limit` steps back. `push` records a change once it is finished
 * (the end of a drag, say); `undo` and `redo` return the value to show, or null when there's nothing to go to. */
export function history(start, limit = 100) {
  const copy = v => JSON.parse(JSON.stringify(v)),
    first = JSON.stringify(start);
  let past = [copy(start)],
    future = [];
  return {
    push(v) {
      const s = JSON.stringify(v);
      if (s === JSON.stringify(past.at(-1))) return false;
      past.push(JSON.parse(s));
      future = [];
      if (past.length > limit + 1) past.shift();
      return true;
    },
    undo() {
      if (past.length < 2) return null;
      future.push(past.pop());
      return copy(past.at(-1));
    },
    redo() {
      if (!future.length) return null;
      past.push(future.pop());
      return copy(past.at(-1));
    },
    get canUndo() {
      return past.length > 1;
    },
    get canRedo() {
      return future.length > 0;
    },
    /** Whether the value is now different from where it started. */
    get changed() {
      return JSON.stringify(past.at(-1)) !== first;
    },
  };
}

// ---------- designed slides ----------
/** A slide's own layout, started from its theme's: the boxes that showed the slide's words show them as their own
 * text (`words`, or "New slide"), so they can be edited there, and everything else is kept as it was. */
export function designFrom(layout, words, newId) {
  const elements = structuredClone(layout?.elements || []).map(e => {
    const el = { ...e, id: e.id || newId() };
    if (el.bind === 'slide.text') {
      delete el.bind;
      delete el.name;
      el.content = words || 'New slide';
    }
    return el;
  });
  return { elements };
}
/** The words a designed slide shows in its own text boxes, front to back, for search, the stage display and the
 * text it goes back to when it uses its theme again. */
export const designWords = layout =>
  (layout?.elements || [])
    .filter(e => e.type === 'text' && !e.bind && !e.hidden && (e.content || '').trim())
    .map(e => e.content.trim())
    .join('\n');

// ---------- backgrounds ----------
/** A two-colour linear gradient as the inspector edits it, { angle, from, to }, or null for any other kind. */
export function parseGradient(src) {
  const m =
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))(?:\s+0%)?\s*,\s*(#[0-9a-f]{3,8}|rgba?\([^)]*\))(?:\s+100%)?\s*\)$/i.exec(
      String(src || '').trim(),
    );
  return m ? { angle: +m[1], from: m[2], to: m[3] } : null;
}
export const gradient = ({ angle = 160, from = '#1b2030', to = '#0d0f15' } = {}) =>
  `linear-gradient(${angle}deg, ${from}, ${to})`;
