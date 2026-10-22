// The Theme tab: the all-songs template, a presentation's own template, and saved templates. The console still
// calls them themes; its controls edit the template's main text box.
import { $, $$, toast } from './dom.js';
import { mainText, textTemplate } from './format.js';
import { findTemplate, getPres, save, savedTemplate, state, templateFor, textStyle } from './library.js';
import { broadcast } from './live.js';
import { uid } from './slides.js';
import { cleanTransition, TRANSITIONS } from './transitions.js';
import { renderGrid } from './views.js';

// The pane picks the all-songs template and the selected presentation's own one, and its controls edit whichever
// of those the selected presentation shows with.
export const templateOptions = (sel, first, value) => {
  sel.innerHTML = ''; sel.add(new Option(first, ''));
  state.db.templates.forEach(x => sel.add(new Option(x.name, x.id)));
  sel.value = value || '';
};
export function renderTheme() {
  const p = getPres(state.selectedId), t = templateFor(p), s = textStyle(t);
  templateOptions($('#thAll'), 'Default style', findTemplate(state.db.defaultTemplateId)?.id);
  templateOptions($('#thSaved'), 'Same as all songs', savedTemplate(p)?.id);
  $('#thSaved').disabled = !p;
  $('#thEditing').textContent = `Editing: ${t.name || 'Default style'}` + (t.id ? ' · changes apply to every song using it' : '');
  $('#thRename').disabled = $('#thDelete').disabled = !t.id;
  $('#thFont').value = s.font; $('#thSize').value = s.size; $('#thSizeV').textContent = s.size + 'px';
  $('#thColor').value = s.color; $('#thBold').checked = s.weight >= 600; $('#thShadow').checked = s.shadow; $('#thUpper').checked = s.upper;
  $$('#thAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === s.align));
  $$('#thVAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === s.valign));
  $('#logoText').value = state.db.logoText;
  if (document.activeElement !== $('#ccliLicence')) $('#ccliLicence').value = state.db.ccliLicence || '';
  $('#showCredits').checked = state.db.showCredits !== false;
  transitionOptions($('#thTransition'), null, state.db.transition?.type || 'fade');
  if (document.activeElement !== $('#thTransSecs')) $('#thTransSecs').value = state.db.transition?.secs ?? '';
  $('#thTransSecs').placeholder = TRANSITIONS.find(t => t.id === $('#thTransition').value)?.secs ?? '';
  $('#thTransSecs').disabled = $('#thTransition').value === 'cut';
}
/** Fill a transition picker; `first` names the choice of none (the library's), if there is one. */
export const transitionOptions = (sel, first, value) => {
  sel.innerHTML = ''; if (first) sel.add(new Option(first, ''));
  TRANSITIONS.forEach(t => sel.add(new Option(first ? `Transition: ${t.name}` : t.name, t.id)));
  sel.value = value || '';
};
// The library's transition plays from the next slide on; the live slide isn't sent again for it.
function setTransition(patch) {
  const t = cleanTransition({ ...state.db.transition, type: state.db.transition?.type || 'fade', ...patch });
  if (t && !(t.type === 'fade' && !t.secs)) state.db.transition = t; else delete state.db.transition;
  save(); renderTheme();
}
// The church's CCLI licence number and whether songs show their credits; both change what the last slide shows.
function creditsChanged() {
  save(); broadcast();
  clearTimeout(themeTimer); themeTimer = setTimeout(renderGrid, 120);
}
let themeTimer;
function setStyle(patch) {
  const el = mainText(templateFor(getPres(state.selectedId)));
  if (!el) return;
  el.style = { ...el.style, ...patch }; themeChanged();
}
function themeChanged() {
  save(); renderTheme(); broadcast();
  clearTimeout(themeTimer); themeTimer = setTimeout(renderGrid, 120);
}
function useTemplate(id) {
  const p = getPres(state.selectedId); if (!p) return;
  if (id) p.templateId = id; else delete p.templateId;
  themeChanged();
}
function useTemplateForAll(id) {
  if (id) state.db.defaultTemplateId = id; else delete state.db.defaultTemplateId;
  themeChanged();
}
// The new template is a copy of whichever one the selected presentation was showing with, and replaces it.
function saveTemplateAs() {
  const name = (prompt('Name for the new theme:', '') || '').trim(); if (!name) return;
  const p = getPres(state.selectedId);
  const { id: _id, name: _n, ...rest } = templateFor(p);
  addTemplate({ ...textTemplate(), ...structuredClone(rest), id: uid(), name });
  toast(`Saved theme “${name}”`);
}
/** Add a new theme to the library, in place of the one the selected presentation was showing with. */
export function addTemplate(t) {
  state.db.templates.push(t);
  if (savedTemplate(getPres(state.selectedId))) useTemplate(t.id); else useTemplateForAll(t.id);
}
function renameTemplate() {
  const t = templateFor(getPres(state.selectedId)); if (!t.id) return;
  const name = (prompt('Rename theme:', t.name) || '').trim(); if (!name) return;
  t.name = name; themeChanged();
}
function deleteTemplate() {
  const t = templateFor(getPres(state.selectedId)); if (!t.id) return;
  const users = state.db.presentations.filter(p => p.templateId === t.id);
  const all = state.db.defaultTemplateId === t.id;
  if (!confirm(`Delete theme “${t.name}”? ` + (all ? 'Songs will go back to the default style.'
    : `${users.length} presentation${users.length === 1 ? '' : 's'} using it will go back to the all-songs theme.`))) return;
  users.forEach(p => delete p.templateId);
  if (all) delete state.db.defaultTemplateId;
  state.db.templates = state.db.templates.filter(x => x !== t); themeChanged();
}

/** Wire up the Theme tab; called once the library has loaded. */
export function setupThemes() {
  $('#thFont').onchange = e => setStyle({ font: e.target.value });
  $('#thSize').oninput = e => setStyle({ size: +e.target.value });
  $('#thColor').oninput = e => setStyle({ color: e.target.value });
  $('#thBold').onchange = e => setStyle({ weight: e.target.checked ? 700 : 400 });
  $('#thShadow').onchange = e => setStyle({ shadow: e.target.checked });
  $('#thUpper').onchange = e => setStyle({ upper: e.target.checked });
  $$('#thAlign button').forEach(b => b.onclick = () => setStyle({ align: b.dataset.v }));
  $$('#thVAlign button').forEach(b => b.onclick = () => setStyle({ valign: b.dataset.v }));
  $('#thSaved').onchange = e => useTemplate(e.target.value);
  $('#thAll').onchange = e => useTemplateForAll(e.target.value);
  $('#thSaveAs').onclick = saveTemplateAs;
  $('#thRename').onclick = renameTemplate;
  $('#thDelete').onclick = deleteTemplate;
  $('#logoText').oninput = e => { state.db.logoText = e.target.value; save(); broadcast(); };
  $('#ccliLicence').oninput = e => {
    const v = e.target.value.trim();
    if (v) state.db.ccliLicence = v; else delete state.db.ccliLicence;
    creditsChanged();
  };
  $('#thTransition').onchange = e => setTransition({ type: e.target.value });
  $('#thTransSecs').oninput = e => setTransition({ secs: e.target.value });
  $('#showCredits').onchange = e => {
    if (e.target.checked) delete state.db.showCredits; else state.db.showCredits = false;
    creditsChanged();
  };
}
