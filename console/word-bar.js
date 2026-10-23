// The bar of formatting buttons over a box of slide words: bold, italic, underline and colours for the selected
// words, written as marks in the words (console/words.js). Ctrl+B, Ctrl+I and Ctrl+U work in the box too.
import { toggleMark, WORD_COLORS } from './words.js';

/** A formatting bar for `box` (a textarea); `changed` is called after the words change. */
export function wordBar(box, changed = () => {}) {
  const bar = document.createElement('div');
  bar.className = 'word-bar';
  const apply = (kind, color) => {
    const r = toggleMark(box.value, box.selectionStart, box.selectionEnd, kind, color);
    if (r.text === box.value) { box.focus(); return; }
    box.focus();
    // Through the browser's own editing where it can, so Ctrl+Z undoes it.
    box.setSelectionRange(0, box.value.length);
    if (!document.execCommand?.('insertText', false, r.text)) box.value = r.text;
    box.setSelectionRange(r.start, r.end);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    changed();
  };
  const button = (label, title, run, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'wb ' + cls; b.title = title; b.innerHTML = label;
    b.onmousedown = e => e.preventDefault(); // keep the selection in the box
    b.onclick = run;
    bar.appendChild(b);
    return b;
  };
  button('<b>B</b>', 'Bold the selected words (Ctrl+B)', () => apply('bold'));
  button('<i>I</i>', 'Italic (Ctrl+I)', () => apply('italic'));
  button('<u>U</u>', 'Underline (Ctrl+U)', () => apply('underline'));
  bar.insertAdjacentHTML('beforeend', '<span class="wb-sep"></span>');
  for (const [name, c] of Object.entries(WORD_COLORS)) {
    button('', `${name[0].toUpperCase() + name.slice(1)} words (click again to take it off)`, () => apply('color', name), 'wb-c').style.background = c;
  }
  const pick = document.createElement('input');
  pick.type = 'color'; pick.value = '#ff9800'; pick.title = 'Another colour';
  let sel = [0, 0];
  pick.onmousedown = pick.onfocus = () => { sel = [box.selectionStart, box.selectionEnd]; };
  pick.onchange = () => { box.setSelectionRange(...sel); apply('color', pick.value); };
  bar.appendChild(pick);
  const hint = document.createElement('span');
  hint.className = 'wb-hint'; hint.textContent = 'Select words, then pick a style';
  bar.appendChild(hint);
  box.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const kind = { b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()];
    if (kind) { e.preventDefault(); apply(kind); }
  });
  return bar;
}
