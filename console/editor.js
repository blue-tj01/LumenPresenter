// The presentation editor.
import { $, toast } from './dom.js';
import { autoSecs, flat, getPres, save, savedTheme, state } from './library.js';
import { goLive, live } from './live.js';
import { renderMedia, storeSlideMedia } from './media.js';
import { groupColor, parseText, serialize, uid } from './slides.js';
import { themeOptions } from './themes.js';
import { renderAll } from './views.js';

// ---------- editor ----------
let editingId = null;
const SAMPLE_TEXT = '[Verse 1]\nFirst line\nSecond line\n\nThird line\nFourth line\n\n[Chorus]\nChorus line';
export function openEditor(id) {
  editingId = id;
  const p = id ? getPres(id) : null;
  $('#edName').value = p ? p.name : 'Untitled';
  $('#edText').value = p ? serialize(p) : SAMPLE_TEXT;
  $('#edOrder').value = p && p.order ? p.order.join(', ') : '';
  $('#edAdvance').value = autoSecs(p) || '';
  renderOrderChips();
  themeOptions($('#edTheme'), 'Theme: same as all songs', savedTheme(p)?.id);
  $('#editor').hidden = false; $('#edText').focus();
}
const readOrder = () => $('#edOrder').value.split(',').map(n => n.trim()).filter(Boolean);
// One button per group in the text; clicking appends it to the play order.
function renderOrderChips() {
  const box = $('#edOrderChips'); box.innerHTML = '';
  const names = [...new Set(parseText($('#edText').value).groups.map(g => g.name))];
  names.forEach(n => {
    const b = document.createElement('button');
    b.className = 'chip'; b.style.setProperty('--gc', groupColor(n)); b.textContent = '+ ' + n;
    b.onclick = () => { $('#edOrder').value = [...readOrder(), n].join(', '); };
    box.appendChild(b);
  });
}
export const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
// Each picture or video becomes its own slide at the cursor. A new presentation still holding the sample text
// becomes a slideshow instead.
async function addEditorImages(files) {
  files = [...files].filter(f => /^(image|video)\//.test(f.type));
  if (!files.length) return;
  toast(`Adding ${files.length} file${files.length > 1 ? 's' : ''}…`);
  const refs = [];
  for (const f of files) {
    try { refs.push((f.type.startsWith('video/') ? '@video: ' : '@image: ') + await storeSlideMedia(f)); }
    catch (e) { toast(`Could not add ${f.name}: ${e.message || 'read failed'}`); }
  }
  if (!refs.length) return;
  if (!Lumen.online) { save(); renderMedia(); }
  const ta = $('#edText'), block = refs.join('\n\n');
  if (!ta.value.trim() || ta.value === SAMPLE_TEXT) ta.value = '[Slideshow]\n' + block;
  else {
    const at = ta.selectionEnd;
    ta.value = (ta.value.slice(0, at) + '\n\n' + block + '\n\n' + ta.value.slice(at)).replace(/\n{3,}/g, '\n\n').trim();
  }
  if ($('#edName').value === 'Untitled' && ta.value.startsWith('[Slideshow]')) $('#edName').value = 'Slideshow';
  toast(`Added ${refs.length} slide${refs.length > 1 ? 's' : ''}`);
}
export function saveEditor() {
  const r = parseText($('#edText').value);
  const name = $('#edName').value.trim() || 'Untitled';
  const order = readOrder().map(n => r.groups.find(g => g.name.toLowerCase() === n.toLowerCase())?.name || n);
  const missing = order.filter(n => !r.groups.some(g => g.name === n));
  if (missing.length) toast(`Not in this song, skipped in the order: ${[...new Set(missing)].join(', ')}`);
  const themeId = $('#edTheme').value, advance = Math.max(0, +$('#edAdvance').value || 0);
  let p = editingId && getPres(editingId);
  if (p) Object.assign(p, { name, groups: r.groups, bg: r.bg, order });
  else { p = { id: uid(), name, groups: r.groups, bg: r.bg, order }; state.db.presentations.push(p); state.selectedId = p.id; }
  if (themeId) p.themeId = themeId; else delete p.themeId;
  if (advance) p.advance = advance; else delete p.advance;
  save(); $('#editor').hidden = true; renderAll();
  if (live.presId === editingId && live.slide) { const s = flat(getPres(editingId))[live.idx]; if (s) goLive(editingId, live.idx); }
}

/** Wire up the editor's buttons; called once the library has loaded. */
export function setupEditor() {
  $('#edSave').onclick = saveEditor;
  $('#edImages').onclick = () => $('#edImageFile').click();
  $('#edImageFile').onchange = e => { addEditorImages(e.target.files); e.target.value = ''; };
  $('#edText').ondragover = e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
  $('#edText').ondrop = e => { if (e.dataTransfer.files.length) { e.preventDefault(); addEditorImages(e.dataTransfer.files); } };
  $('#edCancel').onclick = () => { $('#editor').hidden = true; };
  $('#edText').addEventListener('input', renderOrderChips);
  $('#edOrderClear').onclick = () => { $('#edOrder').value = ''; };
}
