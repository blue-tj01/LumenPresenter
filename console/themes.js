// The theme pane: the all-songs theme, a presentation's own theme, and saved themes.
import { $, $$, toast } from './dom.js';
import { findTheme, getPres, save, savedTheme, state, themeFor } from './library.js';
import { broadcast } from './live.js';
import { DEFAULT_THEME } from './seed.js';
import { uid } from './slides.js';
import { renderGrid } from './views.js';

// The theme pane picks the all-songs theme and the selected presentation's own theme, and its controls
// edit whichever of those the selected presentation shows with.
export const themeOptions = (sel, first, value) => {
  sel.innerHTML = ''; sel.add(new Option(first, ''));
  state.db.themes.forEach(x => sel.add(new Option(x.name, x.id)));
  sel.value = value || '';
};
export function renderTheme() {
  const p = getPres(state.selectedId), t = themeFor(p);
  themeOptions($('#thAll'), 'Default style', findTheme(state.db.defaultThemeId)?.id);
  themeOptions($('#thSaved'), 'Same as all songs', savedTheme(p)?.id);
  $('#thSaved').disabled = !p;
  $('#thEditing').textContent = `Editing: ${t.name || 'Default style'}` + (t.id ? ' · changes apply to every song using it' : '');
  $('#thRename').disabled = $('#thDelete').disabled = !t.id;
  $('#thFont').value = t.font; $('#thSize').value = t.size; $('#thSizeV').textContent = t.size + 'px';
  $('#thColor').value = t.color; $('#thBold').checked = t.bold; $('#thShadow').checked = t.shadow; $('#thUpper').checked = t.upper;
  $$('#thAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === t.align));
  $$('#thVAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === t.valign));
  $('#logoText').value = state.db.logoText;
}
let themeTimer;
function setTheme(patch) {
  Object.assign(themeFor(getPres(state.selectedId)), patch); themeChanged();
}
function themeChanged() {
  save(); renderTheme(); broadcast();
  clearTimeout(themeTimer); themeTimer = setTimeout(renderGrid, 120);
}
function useTheme(id) {
  const p = getPres(state.selectedId); if (!p) return;
  if (id) p.themeId = id; else delete p.themeId;
  themeChanged();
}
function useThemeForAll(id) {
  if (id) state.db.defaultThemeId = id; else delete state.db.defaultThemeId;
  themeChanged();
}
// The new theme replaces whichever one the selected presentation was showing with.
function saveThemeAs() {
  const name = (prompt('Name for the new theme:', '') || '').trim(); if (!name) return;
  const p = getPres(state.selectedId);
  const { id: _id, name: _n, ...style } = themeFor(p);
  const t = { ...DEFAULT_THEME, ...style, id: uid(), name };
  state.db.themes.push(t);
  if (savedTheme(p)) useTheme(t.id); else useThemeForAll(t.id);
  toast(`Saved theme “${name}”`);
}
function renameTheme() {
  const t = themeFor(getPres(state.selectedId)); if (!t.id) return;
  const name = (prompt('Rename theme:', t.name) || '').trim(); if (!name) return;
  t.name = name; themeChanged();
}
function deleteTheme() {
  const t = themeFor(getPres(state.selectedId)); if (!t.id) return;
  const users = state.db.presentations.filter(p => p.themeId === t.id);
  const all = state.db.defaultThemeId === t.id;
  if (!confirm(`Delete theme “${t.name}”? ` + (all ? 'Songs will go back to the default style.'
    : `${users.length} presentation${users.length === 1 ? '' : 's'} using it will go back to the all-songs theme.`))) return;
  users.forEach(p => delete p.themeId);
  if (all) delete state.db.defaultThemeId;
  state.db.themes = state.db.themes.filter(x => x !== t); themeChanged();
}

/** Wire up the Theme tab; called once the library has loaded. */
export function setupThemes() {
  $('#thFont').onchange = e => setTheme({ font: e.target.value });
  $('#thSize').oninput = e => setTheme({ size: +e.target.value });
  $('#thColor').oninput = e => setTheme({ color: e.target.value });
  $('#thBold').onchange = e => setTheme({ bold: e.target.checked });
  $('#thShadow').onchange = e => setTheme({ shadow: e.target.checked });
  $('#thUpper').onchange = e => setTheme({ upper: e.target.checked });
  $$('#thAlign button').forEach(b => b.onclick = () => setTheme({ align: b.dataset.v }));
  $$('#thVAlign button').forEach(b => b.onclick = () => setTheme({ valign: b.dataset.v }));
  $('#thSaved').onchange = e => useTheme(e.target.value);
  $('#thAll').onchange = e => useThemeForAll(e.target.value);
  $('#thSaveAs').onclick = saveThemeAs;
  $('#thRename').onclick = renameTheme;
  $('#thDelete').onclick = deleteTheme;
  $('#logoText').oninput = e => { state.db.logoText = e.target.value; save(); broadcast(); };
}
