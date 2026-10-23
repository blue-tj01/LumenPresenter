// @ts-check
// A small XML reader for song files, which runs in the console and under Node alike (the browser's DOMParser
// doesn't exist under Node). Enough XML for OpenLyrics and OpenSong: elements, attributes, text, CDATA and the
// standard entities; comments, processing instructions and doctypes are skipped.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s =>
  s.indexOf('&') < 0
    ? s
    : s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
          const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
          try {
            return String.fromCodePoint(n);
          } catch {
            return m;
          }
        }
        return ENTITIES[e.toLowerCase()] ?? m;
      });

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>|<(\/?)([^\s/>]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const local = name => name.slice(name.indexOf(':') + 1);

/** An XML document as a tree of { name, attrs, children }, each child an element or a string. Names lose their
 * namespace prefix. Returns the root element, or null when there is none. */
export function parseXml(xml) {
  const root = { name: '', attrs: {}, children: [] },
    stack = [root];
  const add = node => stack[stack.length - 1].children.push(node);
  let at = 0,
    m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(xml))) {
    if (m.index > at) add(decode(xml.slice(at, m.index)));
    at = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      add(m[1]);
      continue;
    }
    if (m[3] === undefined) continue; // a comment, processing instruction or doctype
    const name = local(m[3]);
    if (m[2]) {
      // a closing tag: close up to the element it names, if it is open
      const i = stack.findLastIndex(e => e.name === name);
      if (i > 0) stack.length = i;
      continue;
    }
    const el = { name, attrs: {}, children: [] };
    let a;
    ATTR.lastIndex = 0;
    while ((a = ATTR.exec(m[4]))) el.attrs[local(a[1])] = decode(a[2] ?? a[3]);
    add(el);
    if (!m[5]) stack.push(el);
  }
  if (at < xml.length) add(decode(xml.slice(at)));
  return root.children.find(c => typeof c === 'object') || null;
}

/** The child elements of an element, or those with a name. */
export const kids = (el, name) => (el?.children || []).filter(c => typeof c === 'object' && (!name || c.name === name));
/** The first child element with a name, following a path of names. */
export const child = (el, ...names) => names.reduce((e, n) => kids(e, n)[0], el);
/** All the text inside an element. */
export const text = el => (!el ? '' : typeof el === 'string' ? el : el.children.map(text).join(''));
