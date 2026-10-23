// The presentation editor.
import { $, toast } from './dom.js';
import { fromText, orderIds, toText } from './format.js';
import { autoSecs, flat, getPres, save, savedTemplate, state } from './library.js';
import { goLive, live } from './live.js';
import { renderMedia, storeSlideMedia } from './media.js';
import { groupColor, parseText, uid } from './slides.js';
import { templateOptions, transitionOptions } from './themes.js';
import { cleanTransition } from './transitions.js';
import { wordBar } from './word-bar.js';
import { renderAll } from './views.js';

// ---------- editor ----------
let editingId = null;
const SAMPLE_TEXT = '[Verse 1]\nFirst line\nSecond line\n\nThird line\nFourth line\n\n[Chorus]\nChorus line';
export function openEditor(id) {
  editingId = id;
  const p = id ? getPres(id) : null;
  $('#edName').value = p ? p.name : 'Untitled';
  $('#edText').value = p ? toText(p) : SAMPLE_TEXT;
  const order = p?.arrangements?.[0]?.order || [];
  $('#edOrder').value = order.map(id => p.groups.find(g => g.id === id)?.name).filter(Boolean).join(', ');
  $('#edAdvance').value = autoSecs(p) || '';
  for (const [sel, k] of SONG_FIELDS) $(sel).value = p?.meta?.[k] || '';
  renderOrderChips();
  templateOptions($('#edTheme'), 'Theme: same as all songs', savedTemplate(p)?.id);
  transitionOptions($('#edTransition'), 'Transition: same as all songs', cleanTransition(p?.transition)?.type);
  $('#editor').hidden = false; $('#edText').focus();
}
// The song details a presentation keeps in its meta, shown on its last slide and found by search.
const SONG_FIELDS = [['#edAuthor', 'author'], ['#edCopyright', 'copyright'], ['#edCcli', 'ccli']];
// A song number pasted as "CCLI Song # 22025" keeps just the number.
const clean = (k, v) => k === 'ccli' ? v.trim().replace(/^ccli\s*(song)?\s*(#|no\.?|number)?\s*/i, '') : v.trim();
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
  const old = editingId && getPres(editingId);
  const { groups, background } = fromText(parseText($('#edText').value), old || undefined);
  const name = $('#edName').value.trim() || 'Untitled';
  const names = readOrder(), order = orderIds(groups, names);
  const missing = names.filter(n => !groups.some(g => g.name.toLowerCase() === n.toLowerCase()));
  if (missing.length) toast(`Not in this song, skipped in the order: ${[...new Set(missing)].join(', ')}`);
  const templateId = $('#edTheme').value, advance = Math.max(0, +$('#edAdvance').value || 0);
  // The play order typed here is the first arrangement (the one that plays); any others a song has are kept.
  const [first, ...rest] = old?.arrangements || [];
  const arrangements = order.length || rest.length ? [{ name: 'Default', ...first, id: first?.id || uid(), order }, ...rest] : [];
  let p = old;
  if (p) Object.assign(p, { name, groups, arrangements });
  else { p = { id: uid(), name, groups, arrangements }; state.db.presentations.push(p); state.selectedId = p.id; }
  if (background) p.background = background; else delete p.background;
  if (templateId) p.templateId = templateId; else delete p.templateId;
  if (advance) p.advance = advance; else delete p.advance;
  // A length the presentation has (from an imported file) is kept while its type stays the same.
  const transition = $('#edTransition').value;
  if (!transition) delete p.transition;
  else if (p.transition?.type !== transition) p.transition = { type: transition };
  const meta = { ...p.meta };
  for (const [sel, k] of SONG_FIELDS) { const v = clean(k, $(sel).value); if (v) meta[k] = v; else delete meta[k]; }
  if (Object.keys(meta).length) p.meta = meta; else delete p.meta;
  save(); $('#editor').hidden = true; renderAll();
  if (live.presId === editingId && live.slide) { const s = flat(getPres(editingId))[live.idx]; if (s) goLive(editingId, live.idx); }
}

/** Wire up the editor's buttons; called once the library has loaded. */
export function setupEditor() {
  $('#edSave').onclick = saveEditor;
  $('#edText').before(wordBar($('#edText')));
  $('#edImages').onclick = () => $('#edImageFile').click();
  $('#edImageFile').onchange = e => { addEditorImages(e.target.files); e.target.value = ''; };
  $('#edText').ondragover = e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
  $('#edText').ondrop = e => { if (e.dataTransfer.files.length) { e.preventDefault(); addEditorImages(e.dataTransfer.files); } };
  $('#edCancel').onclick = () => { $('#editor').hidden = true; };
  $('#edText').addEventListener('input', renderOrderChips);
  $('#edOrderClear').onclick = () => { $('#edOrder').value = ''; };
}
