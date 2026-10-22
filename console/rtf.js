// Plain words out of RTF text, the way song apps store a slide's formatted words (ProPresenter 7, EasyWorship).
// No DOM, so it runs under Node as well.

// Groups whose text isn't shown: tables of fonts and colours, styles, document info, pictures.
const HIDDEN = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'listtable', 'listoverridetable', 'header', 'footer', 'generator']);

/** The words in RTF text, as ProPresenter (and macOS) and EasyWorship write it: paragraphs and line breaks as new
 * lines, \'hh characters in the file's code page, \u characters, and every group of formatting left out. */
export function rtfText(rtf) {
  let out = '', page = 'windows-1252', bytes = [], skip = 0;
  const stack = [{ hidden: false, uc: 1 }];
  const flush = () => { if (bytes.length) { out += decodePage(bytes, page); bytes = []; } };
  const emit = s => { if (skip) { skip--; return; } if (!stack.at(-1).hidden) { flush(); out += s; } };
  const re = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([^\\{}\r\n]+)|[\r\n]/gyi;
  for (let m, first = false; (m = re.exec(rtf));) {
    const [, word, arg, hex, sym, brace, plain] = m, top = stack.at(-1), wasFirst = first;
    first = false;
    if (brace === '{') { stack.push({ ...top }); first = true; continue; }
    if (brace === '}') { if (stack.length > 1) stack.pop(); skip = 0; continue; }
    if (hex) {
      if (skip) { skip--; continue; }
      if (!top.hidden) bytes.push(parseInt(hex, 16));
      continue;
    }
    if (sym) {
      if (sym === '*') top.hidden = true;
      else if (sym === '\n' || sym === '\r') emit('\n'); // what Cocoa writes for a new paragraph
      else if (sym === '~') emit(' ');
      else if ('\\{}'.includes(sym)) emit(sym);
      continue; // \- (a soft hyphen) and the like show nothing
    }
    if (word) {
      const w = word.toLowerCase();
      if (wasFirst && HIDDEN.has(w)) top.hidden = true;
      else if (w === 'ansicpg' && arg) page = `windows-${arg}`;
      else if (w === 'mac') page = 'macintosh';
      else if (w === 'uc') top.uc = Number(arg) || 0;
      else if (w === 'u' && arg) { const n = Number(arg); emit(String.fromCharCode(n < 0 ? n + 65536 : n)); skip = top.uc; }
      else if (w === 'par' || w === 'line') emit('\n');
      else if (w === 'tab') emit(' ');
      continue;
    }
    if (plain) { if (skip) { const n = Math.min(skip, plain.length); skip -= n; emit(plain.slice(n)); } else emit(plain); }
  }
  flush();
  return out;
}
// Windows-1252's characters 0x80-0x9f (curly quotes, dashes and the like), which some TextDecoders read as Latin-1.
const CP1252 = '\u20ac\ufffd\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\ufffd\u017d\ufffd' +
  '\ufffd\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\ufffd\u017e\u0178';
/** Bytes as text in a Windows code page ("windows-1252") or another TextDecoder knows. */
export function decodePage(bytes, page = 'windows-1252') {
  if (page === 'windows-1252') return Array.from(bytes, c => c >= 0x80 && c < 0xa0 ? CP1252[c - 0x80] : String.fromCharCode(c)).join('');
  try { return new TextDecoder(page).decode(new Uint8Array(bytes)); }
  catch { return decodePage(bytes, 'windows-1252'); }
}
