// @ts-check
// Slide text: parsing what the editor holds into groups of slides, and back. No DOM, so it is tested under
// Node (tests/slides.test.js).

export const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- slide text parsing ----------
export function parseText(src) {
  const groups = [];
  let bg = null;
  let cur = null;
  let buf = [];
  const flush = () => {
    if (buf.join('').trim()) {
      if (!cur) {
        cur = { name: 'Slides', slides: [] };
        groups.push(cur);
      }
      cur.slides.push(buf.join('\n').trim());
    }
    buf = [];
  };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*\[(.+)\]\s*$/);
    const b = line.match(/^@bg:\s*(.+)$/i);
    if (b) {
      bg = toBg(b[1].trim());
      continue;
    }
    if (m) {
      flush();
      cur = { name: m[1].trim(), slides: [] };
      groups.push(cur);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  return { groups: groups.filter(g => g.slides.length), bg };
}
function toBg(v) {
  if (/^(#|rgb|hsl)/i.test(v)) return { type: 'color', src: v };
  if (/gradient\(/i.test(v)) return { type: 'gradient', src: v };
  if (/\.(mp4|webm|mov)(\?|$)/i.test(v)) return { type: 'video', src: v };
  return { type: 'image', src: v };
}
// A slide line "@image: <src>" puts a picture on that slide, and "@video: <src>" a video that plays once,
// with sound on the audience output. <src> is a URL, a server media path, or "#<id>" for a file kept in the
// media bin (how pictures and videos are stored when running without the server).
const MEDIA_LINE = /^@(image|video):\s*(.+)$/i;
export function splitSlide(raw) {
  const media = { image: null, video: null };
  const text = raw
    .split('\n')
    .filter(l => {
      const m = l.match(MEDIA_LINE);
      if (m) media[m[1].toLowerCase()] = m[2].trim();
      return !m;
    })
    .join('\n')
    .trim();
  return { text, ...media };
}
export function makePres(name, text) {
  const r = parseText(text);
  return { id: uid(), name, groups: r.groups, bg: r.bg };
}

export function groupColor(name) {
  const n = name.toLowerCase();
  if (n.startsWith('pre')) return '#e67e22';
  if (n.startsWith('verse')) return '#2f6fde';
  if (n.startsWith('chorus')) return '#d6334a';
  if (n.startsWith('bridge')) return '#8e44ad';
  if (n.startsWith('tag') || n.startsWith('ending') || n.startsWith('outro')) return '#27ae60';
  if (n.startsWith('intro')) return '#7f8c8d';
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 45%)`;
}
