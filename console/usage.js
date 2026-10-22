// CCLI song use: which songs went live, and when, for the church's CCLI usage report. CCLI has no reporting API
// for an app like Lumen, so the report is a list to copy into CCLI's site, or a CSV file. No DOM, so it is tested
// under Node (tests/usage.test.js).
import { isoDate } from './services.js';

// library.usage holds one entry per song per service per day: { day, service, id, name, ccli, author, copyright }.
// A song counts once however many of its slides are shown, and again in another service the same day (morning
// and evening), but not again when the same service is gone back to.
const MAX_ENTRIES = 20000; // decades of weekly services; the oldest go first

/** Note that a presentation went live. Only songs with a CCLI song number are counted, since they are the ones
 * the licence covers. Returns whether a new use was noted. */
export function recordUse(lib, pres, { day = isoDate(new Date()), service = lib.serviceId || '' } = {}) {
  const ccli = String(pres?.meta?.ccli ?? '').trim();
  if (!ccli) return false;
  if (!Array.isArray(lib.usage)) lib.usage = [];
  if (lib.usage.some(u => u.day === day && u.service === service && u.id === pres.id)) return false;
  const m = pres.meta;
  lib.usage.push({ day, service, id: pres.id, name: String(pres.name ?? ''), ccli,
    author: String(m.author ?? '').trim(), copyright: String(m.copyright ?? '').trim() });
  if (lib.usage.length > MAX_ENTRIES) lib.usage.splice(0, lib.usage.length - MAX_ENTRIES);
  return true;
}

/** The songs used between two YYYY-MM-DD days (both included), most used first, then by title: { name, ccli,
 * author, copyright, count, days }. Uses are grouped by CCLI song number, so a song deleted and imported again
 * still adds up, and its details are the ones it had most recently. */
export function usageReport(usage, from, to) {
  const songs = new Map();
  for (const u of Array.isArray(usage) ? usage : []) {
    if (!u?.ccli || (from && u.day < from) || (to && u.day > to)) continue;
    const s = songs.get(u.ccli) || { name: '', ccli: u.ccli, author: '', copyright: '', count: 0, days: [], last: '' };
    s.count++;
    if (!s.days.includes(u.day)) s.days.push(u.day);
    if (u.day >= s.last) Object.assign(s, { last: u.day, name: u.name, author: u.author, copyright: u.copyright });
    songs.set(u.ccli, s);
  }
  return [...songs.values()].map(({ last: _last, ...s }) => ({ ...s, days: s.days.sort() }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const COLUMNS = ['Title', 'CCLI Song #', 'Writers', 'Copyright', 'Times used', 'Dates'];
const row = s => [s.name, s.ccli, s.author, s.copyright, String(s.count), s.days.join(' ')];

/** The report as a CSV file, for a spreadsheet. A cell that a spreadsheet would take for a formula is kept as
 * text. */
export function reportCsv(rows) {
  const cell = v => {
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return [COLUMNS, ...rows.map(row)].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** The report as tab-separated lines, which paste into a spreadsheet or a table as columns. */
export const reportText = rows => [COLUMNS, ...rows.map(row)].map(r => r.map(v => v.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
