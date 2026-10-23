// @ts-check
// First-run setup: on a new library, four short steps before the first service. Whether to keep the demo songs,
// where the audience output and stage display go, bringing songs in (with the church's CCLI licence number), and
// the look of the words. Each can be skipped, and Library… → Run setup again brings it back.
import { $, toast } from './dom.js';
import { flat, normalize, save, slideBackground, state } from './library.js';

const STEPS = ['welcome', 'screens', 'songs', 'look', 'done'];
let step = 0;
let onFinish = () => {};

const SAMPLE = {
  id: 'setup-sample',
  name: 'Amazing Grace',
  meta: { author: 'John Newton', copyright: 'Public Domain' },
  groups: [
    {
      id: 'g1',
      name: 'Verse 1',
      slides: [{ id: 's1', text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!' }],
    },
  ],
};
const FALLBACK_BG = { type: 'gradient', src: 'linear-gradient(160deg,#0f2027,#203a43,#2c5364)' };

/** Show the step, and its buttons. */
function show(i) {
  step = i;
  const name = STEPS[i];
  document.querySelectorAll('#setupDialog [data-step]').forEach(el => {
    /** @type {HTMLElement} */ (el).hidden = el.getAttribute('data-step') !== name;
  });
  $('#setupCount').textContent = i < STEPS.length - 1 ? `Step ${i + 1} of ${STEPS.length - 1}` : '';
  $('#setupBack').hidden = i === 0 || i === STEPS.length - 1;
  $('#setupSkip').hidden = i === STEPS.length - 1;
  $('#setupNext').textContent = i === 0 ? 'Keep the demo songs' : i === STEPS.length - 1 ? 'Start using Lumen' : 'Next';
  $('#setupEmpty').hidden = i !== 0;
  if (name === 'screens') renderScreens();
  if (name === 'songs') $('#setupLicence').value = state.db.ccliLicence || '';
  if (name === 'look') renderLooks();
  if (name === 'done') $('#setupSummary').textContent = summary();
  $('#setupNext').focus();
}

// ---------- screens ----------
async function renderScreens() {
  const desk = window.lumenDesktop?.displays ? await window.lumenDesktop.displays() : null;
  $('#setupScreensDesk').hidden = !desk;
  $('#setupScreensWeb').hidden = !!desk;
  if (!desk) return;
  for (const name of ['output', 'stage']) {
    const sel = $(`#setupScreen-${name}`);
    sel.textContent = '';
    sel.append(new Option('In a window I place myself', ''));
    desk.displays.forEach(d => sel.append(new Option(`Full screen on ${d.name}`, String(d.id))));
    sel.value = desk.chosen[name] === null ? '' : String(desk.chosen[name]);
    sel.onchange = async () => {
      const ok = await window.lumenDesktop.setScreen(name, sel.value === '' ? null : Number(sel.value));
      if (!ok) (toast('That display is not connected any more'), renderScreens());
    };
  }
  $('#setupNoSecond').hidden = desk.displays.length > 1;
}

// ---------- the look ----------
function renderLooks() {
  const box = $('#setupLooks');
  box.textContent = '';
  const choices = [{ id: '', name: 'Default style' }, ...state.db.templates.map(t => ({ id: t.id, name: t.name }))];
  for (const c of choices) {
    const pres = { ...SAMPLE, ...(c.id ? { templateId: c.id } : {}) };
    const [s] = flat(pres);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'setup-look';
    card.setAttribute('aria-pressed', String((state.db.defaultTemplateId || '') === c.id));
    card.innerHTML = '<div class="setup-look-screen"></div><span></span>';
    /** @type {HTMLElement} */ (card.lastChild).textContent = c.name;
    card.onclick = () => {
      if (c.id) state.db.defaultTemplateId = c.id;
      else delete state.db.defaultTemplateId;
      save();
      box.querySelectorAll('.setup-look').forEach(b => b.setAttribute('aria-pressed', String(b === card)));
      onFinish();
    };
    box.append(card);
    const scr = PP.createScreen(card.firstChild);
    PP.update(
      scr,
      { bg: slideBackground(pres, s?.slide) || FALLBACK_BG, slide: { elements: s?.elements || [] } },
      { animate: false, still: true },
    );
  }
}

function summary() {
  const n = state.db.presentations.length;
  const look = state.db.templates.find(t => t.id === state.db.defaultTemplateId)?.name || 'the default style';
  return `${n ? `${n} song${n === 1 ? '' : 's'} in the library` : 'An empty library'}, shown in ${look}.`;
}

function finish() {
  state.db.setupDone = true;
  save();
  $('#setupDialog').hidden = true;
  onFinish();
}

/** Open the setup, from the first step. */
export function openSetup() {
  $('#setupDialog').hidden = false;
  show(0);
}

/** Wire up the setup; `changed` redraws the console after a step changed the library. */
export function setupSetup(changed) {
  onFinish = changed;
  $('#setupNext').onclick = () => (step === STEPS.length - 1 ? finish() : show(step + 1));
  $('#setupBack').onclick = () => show(Math.max(0, step - 1));
  $('#setupSkip').onclick = finish;
  $('#setupEmpty').onclick = () => {
    // The demo hymns and their service go; the backgrounds and themes stay.
    state.db = normalize({ ...state.db, presentations: [], playlist: [], services: [] });
    state.selectedId = null;
    save();
    changed();
    show(1);
  };
  $('#setupIdentify').onclick = () => window.lumenDesktop?.identifyScreens?.();
  $('#setupImport').onclick = () => $('#songFile').click();
  $('#setupLicence').onchange = e => {
    const v = e.target.value.trim();
    if (v) state.db.ccliLicence = v;
    else delete state.db.ccliLicence;
    save();
    changed();
  };
  $('#setupDialog').onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') finish();
  };
}
