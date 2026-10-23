// Formatting single words in a slide's text, written into the words themselves so they stay plain text
// everywhere else (the text editor, search, imports): **bold**, *italic*, __underlined__, and {gold}a colour{/}
// by its name or as {#ffcc00}. A mark with no partner is shown as it is typed, and a backslash shows the next mark
// character as it is (\*). No DOM, so it is tested under Node (tests/words.test.js).

const TOKEN = /\\([\\*_{}])|\*\*|\*|__|\{(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})\}|\{\/\}/g;
const STYLE = { '**': 'bold', '*': 'italic', __: 'underline' };
/** Colours the formatting bar offers, by the names written in the words; any other CSS colour name works too. */
export const WORD_COLORS = { gold: '#ffd54f', red: '#ff5a5a', blue: '#5ab4ff', green: '#7ee081', purple: '#c792ff', white: '#ffffff' };

function tokens(src) {
  const out = [];
  let at = 0, m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    if (m.index > at) out.push({ text: src.slice(at, m.index) });
    if (m[1]) out.push({ text: m[1] });
    else if (m[2]) out.push({ open: m[2], raw: m[0] });
    else if (m[0] === '{/}') out.push({ close: true, raw: m[0] });
    else out.push({ toggle: m[0], raw: m[0] });
    at = TOKEN.lastIndex;
  }
  if (at < src.length) out.push({ text: src.slice(at) });
  return out;
}

/** Pair each mark with its partner; one left without a partner turns back into the characters typed. */
function pair(list) {
  const last = {}, opens = [];
  list.forEach((t, i) => {
    if (t.toggle) {
      if (last[t.toggle] != null) { list[last[t.toggle]].paired = t.paired = true; last[t.toggle] = null; }
      else last[t.toggle] = i;
    } else if (t.open) opens.push(i);
    else if (t.close && opens.length) { list[opens.pop()].paired = t.paired = true; }
  });
  return list.map(t => (t.raw && !t.paired ? { text: t.raw } : t));
}

/** The words as runs of text with the same formatting: [{ text, bold?, italic?, underline?, color? }]. */
export function parseWords(src) {
  src = String(src ?? '');
  const runs = [], on = { bold: false, italic: false, underline: false }, colors = [];
  for (const t of pair(tokens(src))) {
    if (t.toggle) { on[STYLE[t.toggle]] = !on[STYLE[t.toggle]]; continue; }
    if (t.open) { colors.push(t.open); continue; }
    if (t.close) { colors.pop(); continue; }
    const fmt = {};
    for (const k in on) if (on[k]) fmt[k] = true;
    if (colors.length) { const c = colors[colors.length - 1]; fmt.color = WORD_COLORS[c.toLowerCase()] || c; }
    const prev = runs[runs.length - 1];
    if (prev && JSON.stringify({ ...prev, text: '' }) === JSON.stringify({ ...fmt, text: '' })) prev.text += t.text;
    else runs.push({ text: t.text, ...fmt });
  }
  return runs;
}

/** Whether the words have any formatting marks. */
export const hasMarks = src => plainWords(src) !== String(src ?? '');
/** The words without their formatting marks, as a screen shows them. */
export function plainWords(src) { return parseWords(src).map(r => r.text).join(''); }

const MARK = { bold: ['**', '**'], italic: ['*', '*'], underline: ['__', '__'] };
/** Words with the formatting `kind` (bold, italic, underline or color, with `color`) put on the characters from
 * `start` to `end`, or taken off when they already have it. Returns { text, start, end }: the new words and where
 * the same characters are in them, for the selection. */
export function toggleMark(src, start, end, kind, color) {
  src = String(src ?? '');
  if (start > end) [start, end] = [end, start];
  // Leave the spaces at the ends of the selection outside the marks: "** word**" isn't bold in Markdown either.
  while (start < end && /\s/.test(src[start])) start++;
  while (end > start && /\s/.test(src[end - 1])) end--;
  if (start === end) return { text: src, start, end };
  const [open, close] = kind === 'color' ? [`{${color}}`, '{/}'] : MARK[kind];
  const before = src.slice(0, start), mid = src.slice(start, end), after = src.slice(end);
  // Already marked just outside or just inside the selection: take the marks off.
  const colorBefore = kind === 'color' && /\{(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})\}$/.exec(before);
  if (kind === 'color' ? colorBefore && after.startsWith(close) : before.endsWith(open) && after.startsWith(close)
    && !(kind === 'italic' && (before.endsWith('**') || after.startsWith('**')))) {
    const o = kind === 'color' ? colorBefore[0].length : open.length;
    if (kind !== 'color' || colorBefore[1] === color) {
      return { text: before.slice(0, -o) + mid + after.slice(close.length), start: start - o, end: end - o };
    }
    // Another colour: change it.
    return { text: before.slice(0, -o) + open + mid + after, start: start - o + open.length, end: end - o + open.length };
  }
  const innerColor = kind === 'color' && /^\{(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})\}([\s\S]*)\{\/\}$/.exec(mid);
  if (innerColor) {
    const words = innerColor[2];
    if (innerColor[1] === color) return { text: before + words + after, start, end: start + words.length };
    return { text: before + open + words + close + after, start: start + open.length, end: start + open.length + words.length };
  }
  if (kind !== 'color' && mid.startsWith(open) && mid.endsWith(close) && mid.length >= open.length + close.length
    && !(kind === 'italic' && mid.startsWith('**'))) {
    const words = mid.slice(open.length, mid.length - close.length);
    return { text: before + words + after, start, end: start + words.length };
  }
  // Marks don't reach across lines: each line of the selection gets its own.
  if (!mid.includes('\n')) return { text: before + open + mid + close + after, start: start + open.length, end: end + open.length };
  const marked = mid.split('\n').map(l => (l.trim() ? l.replace(/^(\s*)([\s\S]*?)(\s*)$/, `$1${open}$2${close}$3`) : l)).join('\n');
  return { text: before + marked + after, start, end: start + marked.length };
}
