// @ts-check
// Services: saved, dated running orders, one of them open at a time. The open service's items are the playlist
// (library.playlist), so everything that works on the playlist works on it; the others wait in library.services.
// No DOM, so it is tested under Node (tests/services.test.js).
import { uid } from './slides.js';

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
/** YYYY-MM-DD for a date in local time. */
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
/** A YYYY-MM-DD date moved on by some days. */
export const addDays = (date, days) =>
  new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
/** The coming Sunday: today, if today is one. */
export const nextSunday = (from = new Date()) =>
  isoDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + ((7 - from.getDay()) % 7)));

export const findService = (lib, id) => lib.services.find(s => s.id === id) || null;
export const openService = lib => findService(lib, lib.serviceId);
/** Newest first, then by name. */
export const sortedServices = lib =>
  [...lib.services].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

/** "Sun 26 Oct 2026 · Morning service" */
export function serviceLabel(s) {
  const d = new Date(Date.parse(s.date + 'T00:00:00Z'));
  const day = d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return s.name ? `${day} · ${s.name}` : day;
}

/** Give a library its services: a library from before them gets one holding its playlist. The playlist is what
 * the console last edited, so it stays the open service's items. */
export function ensureServices(lib, today = new Date()) {
  const ids = new Set(lib.presentations.map(p => p.id));
  lib.services = (Array.isArray(lib.services) ? lib.services : [])
    .filter(s => s && typeof s === 'object' && s.id)
    .map(s => ({
      ...s,
      name: String(s.name ?? ''),
      date: validDate(s.date) ? s.date : nextSunday(today),
      items: (Array.isArray(s.items) ? s.items : []).filter(id => ids.has(id)),
    }));
  if (!lib.services.length) lib.services.push({ id: uid(), name: 'Service', date: nextSunday(today), items: [] });
  if (!openService(lib))
    lib.serviceId = sortedServices(lib).find(s => s.date <= nextSunday(today))?.id ?? sortedServices(lib).at(-1).id;
  if (!Array.isArray(lib.playlist)) lib.playlist = [];
  stashPlaylist(lib);
  return lib;
}

/** Keep the playlist in the open service, before saving or switching. */
export function stashPlaylist(lib) {
  const s = openService(lib);
  if (s) s.items = [...lib.playlist];
}

/** Open a service: its items become the playlist. */
export function switchService(lib, id) {
  const s = findService(lib, id);
  if (!s) return null;
  stashPlaylist(lib);
  lib.serviceId = s.id;
  lib.playlist = [...s.items];
  return s;
}

/** A new, empty service, opened. */
export function addService(lib, { name = 'Service', date = nextSunday() } = {}) {
  const s = { id: uid(), name, date: validDate(date) ? date : nextSunday(), items: [] };
  lib.services.push(s);
  return switchService(lib, s.id);
}

/** A copy of a service a week later, to build next week's from, opened. */
export function duplicateService(lib, id) {
  stashPlaylist(lib);
  const from = findService(lib, id);
  if (!from) return null;
  const s = { ...structuredClone(from), id: uid(), date: addDays(from.date, 7) };
  lib.services.push(s);
  return switchService(lib, s.id);
}

export function updateService(lib, id, { name, date }) {
  const s = findService(lib, id);
  if (!s) return null;
  if (name !== undefined) s.name = String(name).trim();
  if (date !== undefined && validDate(date)) s.date = date;
  return s;
}

/** Delete a service (its songs stay in the library). The last one cannot go. Opens the one dated nearest it. */
export function removeService(lib, id) {
  const s = findService(lib, id);
  if (!s || lib.services.length < 2) return false;
  stashPlaylist(lib);
  lib.services = lib.services.filter(x => x !== s);
  if (lib.serviceId === id) {
    const gap = x => Math.abs(Date.parse(x.date) - Date.parse(s.date));
    const near = lib.services.reduce((a, b) => (gap(b) < gap(a) ? b : a));
    lib.serviceId = near.id;
    lib.playlist = [...near.items];
  }
  return true;
}
