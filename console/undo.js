// @ts-check
// Undo and redo for the library: songs, services, themes, the playlist and the rest. Each step keeps only what
// changed (the songs and services before and after, and the other fields), so a long history of edits to a large
// library stays small. Changes saved within a moment of each other (a slider being dragged) are one step.
import { toast } from './dom.js';

const LISTS = ['presentations', 'services']; // kept an item at a time, as the server keeps them
const SKIP = new Set(['usage']);            // the CCLI usage record changes as songs go live: not an edit to undo
const LIMIT = 100;
const QUIET = 400; // ms with no save before the changes since the last step become a step

let snap = null;                // the library as of the last step
let undos = [], redos = [];
let timer = null, pending = null;

/** The library as its parts, as JSON: {lists: {name: {items: Map id → JSON, order}}, fields: Map}. */
function parts(lib) {
  const lists = {}, fields = new Map();
  for (const [k, v] of Object.entries(lib)) {
    if (SKIP.has(k)) continue;
    if (LISTS.includes(k) && Array.isArray(v)) lists[k] = { items: new Map(v.map(x => [x?.id, JSON.stringify(x)])), order: v.map(x => x?.id) };
    else fields.set(k, JSON.stringify(v ?? null));
  }
  return { lists, fields };
}

/** What changed from a to b: for each list, the items before and after (undefined where missing) and the orders
 * when they differ; for fields, before and after. Null if nothing did. */
function change(a, b) {
  const step = { lists: {}, fields: {} };
  let any = false;
  for (const name of new Set([...Object.keys(a.lists), ...Object.keys(b.lists)])) {
    const x = a.lists[name] || { items: new Map(), order: [] }, y = b.lists[name] || { items: new Map(), order: [] };
    const items = {};
    for (const id of new Set([...x.items.keys(), ...y.items.keys()])) {
      if (x.items.get(id) !== y.items.get(id)) items[id] = [x.items.get(id), y.items.get(id)];
    }
    const moved = x.order.length !== y.order.length || x.order.some((id, i) => id !== y.order[i]);
    if (Object.keys(items).length || moved) { step.lists[name] = { items, order: moved ? [x.order, y.order] : null }; any = true; }
  }
  for (const k of new Set([...a.fields.keys(), ...b.fields.keys()])) {
    if (a.fields.get(k) !== b.fields.get(k)) { step.fields[k] = [a.fields.get(k), b.fields.get(k)]; any = true; }
  }
  return any ? step : null;
}

/** Put one side of a step (0: before, 1: after) back into the library. */
function put(lib, step, side) {
  for (const [name, c] of Object.entries(step.lists)) {
    const byId = new Map((lib[name] || []).map(x => [x?.id, x]));
    for (const [id, pair] of Object.entries(c.items)) {
      if (pair[side] === undefined) byId.delete(id); else byId.set(id, JSON.parse(pair[side]));
    }
    const order = c.order ? c.order[side] : (lib[name] || []).map(x => x?.id).filter(id => byId.has(id));
    lib[name] = order.filter(id => byId.has(id)).map(id => byId.get(id));
  }
  for (const [k, pair] of Object.entries(step.fields)) {
    if (pair[side] === undefined) delete lib[k]; else lib[k] = JSON.parse(pair[side]);
  }
}

/** A few words naming what a step changed, for the note shown after undoing it. */
function describe(step) {
  // Songs first: deleting one also changes the services it was in.
  for (const name of LISTS) {
    const names = Object.values(step.lists[name]?.items || {})
      .map(([a, b]) => { try { return JSON.parse(b ?? a)?.name; } catch { return null; } }).filter(Boolean);
    if (names.length === 1) return `“${names[0]}”`;
    if (names.length > 1) return `changes to ${names.length} ${name === 'services' ? 'services' : 'songs'}`;
  }
  const k = Object.keys(step.fields)[0];
  return { templates: 'the themes', playlist: 'the playlist', messages: 'the messages', media: 'the media',
    baseTemplate: 'the theme', stageLayout: 'the stage display', fonts: 'the fonts' }[k] || 'the last change';
}

/** Start over from this library, forgetting the history (it was replaced: an import, a restore, starting over). */
export function resetUndo(lib) { clearTimeout(timer); pending = null; snap = parts(lib); undos = []; redos = []; }

/** Take a change made elsewhere (another console) as the new starting point, keeping the history. */
export function rebaseUndo(lib) { flush(); snap = parts(lib); }

/** The library was just changed here: note it, as a step once changes stop for a moment. */
export function noteChange(lib) {
  pending = lib; clearTimeout(timer); timer = setTimeout(flush, QUIET);
}
function flush() {
  clearTimeout(timer);
  if (!pending || !snap) return;
  const next = parts(pending); pending = null;
  const step = change(snap, next);
  snap = next;
  if (!step) return;
  undos.push(step); if (undos.length > LIMIT) undos.shift();
  redos = [];
}

export const canUndo = () => { flush(); return undos.length > 0; };
export const canRedo = () => { flush(); return redos.length > 0; };

/** Undo (or redo) the last step in `lib`, in place; `saved` saves and redraws it. */
export function undo(lib, saved, again = false) {
  flush();
  const from = again ? redos : undos, to = again ? undos : redos;
  const step = from.pop();
  if (!step) { toast(again ? 'Nothing to redo' : 'Nothing to undo'); return false; }
  put(lib, step, again ? 1 : 0);
  to.push(step);
  snap = parts(lib);
  saved();
  clearTimeout(timer); pending = null; // the save just made is this step, not a new one
  toast(`${again ? 'Redid' : 'Undid'} ${describe(step)}`);
  return true;
}
