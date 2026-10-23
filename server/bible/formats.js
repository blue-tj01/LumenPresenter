// @ts-check
// Reading Bible files: Zefania XML, OSIS and USFX. Each becomes { name, abbrev, language, books: [{ number, name,
// verses: [[chapter, verse, text]] }] }, with footnotes, cross-references and headings left out.
'use strict';
const { KNOWN, fromName, fromOsis, fromUsfm, book } = require('./books.js');

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

/** Walk an XML document: open(name, attrs), close(name) and text(string), with namespace prefixes dropped and
 * element names in lower case. Enough XML for Bible files, which have no DTD-defined entities. */
function walk(xml, { open, close, text }) {
  let at = 0,
    m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(xml))) {
    if (m.index > at) text(decode(xml.slice(at, m.index)));
    at = TOKEN.lastIndex;
    if (m[1] !== undefined) {
      text(m[1]);
      continue;
    }
    if (m[3] === undefined) continue; // comment, processing instruction or doctype
    const name = m[3].slice(m[3].indexOf(':') + 1).toLowerCase();
    if (m[2]) {
      close(name);
      continue;
    }
    const attrs = {};
    let a;
    ATTR.lastIndex = 0;
    while ((a = ATTR.exec(m[4]))) attrs[a[1].slice(a[1].indexOf(':') + 1).toLowerCase()] = decode(a[2] ?? a[3]);
    open(name, attrs);
    if (m[5]) close(name);
  }
  if (at < xml.length) text(decode(xml.slice(at)));
}

const clean = s =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?’”)\]])/g, '$1')
    .replace(/([‘“([])\s+/g, '$1')
    .trim();

/** Collects verse text for the books of one file. */
class Collector {
  constructor() {
    this.books = [];
    this.byNumber = new Map();
    this.byName = new Map();
    this.cur = null;
    this.parts = [];
  }

  /** The book a file calls by this id or name; books this list doesn't know are numbered after the known ones. */
  book(number, name) {
    if (!number) number = this.byName.get(name) || KNOWN + 1 + this.byName.size;
    if (number > KNOWN) this.byName.set(name, number);
    let b = this.byNumber.get(number);
    if (!b) {
      b = { number, name: (name || '').trim() || book(number)?.name || `Book ${number}`, verses: [] };
      this.byNumber.set(number, b);
      this.books.push(b);
    }
    return b;
  }

  start(b, chapter, verse) {
    this.end();
    if (b && chapter > 0 && verse >= 0) this.cur = { b, chapter, verse };
  }
  add(s) {
    if (this.cur) this.parts.push(s);
  }
  end() {
    if (!this.cur) return;
    const { b, chapter, verse } = this.cur;
    const t = clean(this.parts.join(''));
    const last = b.verses[b.verses.length - 1];
    // A verse split by markup (or given twice) is joined up.
    if (last && last[0] === chapter && last[1] === verse) {
      if (t) last[2] = clean(`${last[2]} ${t}`);
    } else if (t) b.verses.push([chapter, verse, t]);
    this.cur = null;
    this.parts = [];
  }
  result(info) {
    this.end();
    const books = this.books.filter(b => b.verses.length).sort((a, b) => a.number - b.number);
    if (!books.length) throw new Error('no verses found in this file');
    return { ...info, books };
  }
}

const num = s => {
  const m = /\d+/.exec(String(s ?? ''));
  return m ? Number(m[0]) : 0;
};

/** Zefania XML: <XMLBIBLE biblename><BIBLEBOOK bnumber bname><CHAPTER cnumber><VERS vnumber>. */
function zefania(xml) {
  const c = new Collector();
  const info = { name: '', abbrev: '', language: '' };
  let b = null,
    chapter = 0,
    skip = 0,
    field = null;
  walk(xml, {
    open(name, a) {
      if (skip) {
        skip++;
        return;
      }
      if (name === 'xmlbible') info.name = a.biblename || '';
      else if (['title', 'identifier', 'language'].includes(name)) field = { name, text: '' };
      else if (name === 'biblebook') {
        const n = num(a.bnumber);
        b = c.book(n > 0 && n <= 66 ? n : fromName(a.bname || '') || fromName(a.bsname || ''), a.bname);
      } else if (name === 'chapter') chapter = num(a.cnumber);
      else if (name === 'vers') c.start(b, chapter, num(a.vnumber));
      else if (name === 'note' || name === 'caption' || name === 'xref') skip = 1;
      else if (name === 'br') c.add(' ');
    },
    close(name) {
      if (skip) {
        skip--;
        return;
      }
      if (field && name === field.name) {
        const key = { title: 'name', identifier: 'abbrev', language: 'language' }[name];
        if (!info[key] || key !== 'name') info[key] = field.text.trim();
        field = null;
      } else if (name === 'vers') c.end();
    },
    text(s) {
      if (skip) return;
      if (field) field.text += s;
      else c.add(s);
    },
  });
  return c.result(info);
}

/** OSIS: <div type="book" osisID>, and verses either as <verse osisID>…</verse> or as sID/eID milestones. */
function osis(xml) {
  const c = new Collector();
  const info = { name: '', abbrev: '', language: '' };
  let skip = 0,
    inHeader = false,
    field = null,
    open = null;
  walk(xml, {
    open(name, a) {
      if (skip) {
        skip++;
        return;
      }
      if (name === 'osistext') {
        info.language = a.lang || '';
        info.abbrev = (a.osisidwork || '').split('.').pop();
      } else if (name === 'header') inHeader = true;
      else if (inHeader) {
        if (name === 'title' && !info.name) field = { text: '' };
      } else if (name === 'verse' && !a.eid) {
        const id = String(a.osisid || a.sid || '').split(/\s+/)[0];
        const m = /^(?:[^:]+:)?([^.]+)\.(\d+)\.(\d+)/.exec(id);
        if (!m) return;
        const n = fromOsis(m[1]);
        c.start(c.book(n, n ? '' : m[1]), Number(m[2]), Number(m[3]));
        open = a.sid ? null : id;
      } else if (name === 'verse') c.end();
      else if (['note', 'title', 'rdg', 'speaker'].includes(name)) skip = 1;
      else if (name === 'lb' || name === 'l' || name === 'p') c.add(' ');
    },
    close(name) {
      if (skip) {
        skip--;
        return;
      }
      if (name === 'header') inHeader = false;
      else if (field && name === 'title') {
        info.name = field.text.trim();
        field = null;
      } else if (name === 'verse' && open) {
        c.end();
        open = null;
      } else if (name === 'div' || name === 'chapter') c.add(' ');
    },
    text(s) {
      if (skip) return;
      if (field) field.text += s;
      else if (!inHeader) c.add(s);
    },
  });
  return c.result(info);
}

/** USFX: <book id="GEN">, <c id="1"/>, <v id="1"/> … <ve/>, with notes in <f> and <x>. */
function usfx(xml) {
  const c = new Collector();
  const info = { name: '', abbrev: '', language: '' };
  let b = null,
    chapter = 0,
    skip = 0,
    lang = null;
  walk(xml, {
    open(name, a) {
      if (skip) {
        skip++;
        return;
      }
      if (name === 'languagecode') lang = '';
      else if (name === 'book') {
        c.end();
        const n = fromUsfm(a.id || '');
        b = n || !/^(FRT|BAK|OTH|GLO|INT|CNC|TDX|TOB?)$/.test(a.id || '') ? c.book(n, n ? '' : a.id) : null;
        chapter = 0;
      } else if (name === 'c') {
        c.end();
        chapter = num(a.id);
      } else if (name === 'v') c.start(b, chapter, num(a.id));
      else if (name === 've') c.end();
      else if (
        [
          'f',
          'x',
          'fe',
          'ef',
          'ex',
          'h',
          'toc',
          'id',
          'ide',
          'rem',
          's',
          'cl',
          'cp',
          'vp',
          'periph',
          'sts',
          'fig',
        ].includes(name)
      )
        skip = 1;
      else if (name === 'd')
        c.end(); // a psalm's title: part of no verse unless one starts inside it
      else if (name === 'p' || name === 'q' || name === 'b') c.add(' ');
    },
    close(name) {
      if (skip) {
        skip--;
        return;
      }
      if (name === 'languagecode') {
        info.language = lang.trim();
        lang = null;
      } else if (name === 'book') c.end();
      else if (name === 'p' || name === 'q') c.add(' ');
    },
    text(s) {
      if (skip) return;
      if (lang !== null) lang += s;
      else c.add(s);
    },
  });
  return c.result(info);
}

/** Read a Bible file of any supported format, told apart by its root element. */
function parseBible(xml) {
  const root = /<(?:[\w-]+:)?(xmlbible|osis|usfx)\b/i.exec(xml.slice(0, 4096));
  if (!root) throw new Error('not a Zefania, OSIS or USFX Bible file');
  const format = root[1].toLowerCase() === 'xmlbible' ? 'zefania' : root[1].toLowerCase();
  return { format, ...{ zefania, osis, usfx }[format](xml) };
}

module.exports = { parseBible, walk };
