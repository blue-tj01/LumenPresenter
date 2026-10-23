// @ts-check
// The Bible tab: pick a translation, type a reference or some words, and make slides of the passage.
import { $, toast } from './dom.js';
import { save, state } from './library.js';
import { goLive } from './live.js';
import { DEFAULTS, passagePresentation, scriptureTemplate } from './passage.js';
import { renderAll } from './views.js';
import { ask } from './dialog.js';

const PREFS = 'lumen.scripture';
let bibles = [],
  found = null,
  asked = 0,
  timer;

const prefs = () => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS)) };
  } catch {
    return { ...DEFAULTS };
  }
};
function keepPrefs(change) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), ...change }));
  } catch {}
}
const bible = () => bibles.find(b => b.id === $('#scBible').value);

export async function loadBibles() {
  if (!Lumen.online) return;
  try {
    bibles = (await Lumen.bibles()).bibles;
  } catch {
    return;
  }
  const sel = $('#scBible'),
    keep = sel.value || prefs().bible;
  sel.innerHTML = '';
  bibles.forEach(b => sel.add(new Option(`${b.abbrev} · ${b.name}`, b.id)));
  sel.value = bibles.some(b => b.id === keep) ? keep : bibles[0]?.id || '';
  renderBible();
}

function renderBible() {
  const b = bible();
  $('#scRemove').hidden = !b || b.bundled;
  if ($('#scQuery').value.trim()) find();
  else renderResults();
}

async function find() {
  const q = $('#scQuery').value,
    b = bible();
  if (!b || !q.trim()) {
    found = null;
    renderResults();
    return;
  }
  const n = ++asked;
  let r;
  try {
    r = await Lumen.scripture(b.id, q);
  } catch (e) {
    if (n === asked) {
      found = null;
      renderResults(e.message);
    }
    return;
  }
  if (n !== asked) return; // a newer search went out while this one was on its way
  found = { ...r, abbrev: b.abbrev };
  renderResults();
}

function renderResults(error = '') {
  const ul = $('#scResults');
  ul.innerHTML = '';
  const passage = found?.type === 'passage' && found.verses.length > 0;
  $('#scAdd').disabled = $('#scLive').disabled = !passage;
  const info = $('#scInfo');
  if (error) info.textContent = error;
  else if (!found) info.textContent = bible()?.rights ? `${bible().name} · ${bible().rights}` : '';
  else if (found.type === 'passage')
    info.textContent = found.verses.length
      ? `${found.reference} · ${found.abbrev}` + (found.more ? ' · shortened' : '')
      : 'No verses there in this translation';
  else
    info.textContent = found.verses.length
      ? `${found.verses.length}${found.verses.length >= 100 ? '+' : ''} verses found · click one to use it`
      : 'No verses found';
  for (const v of found?.verses || []) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> <span></span>';
    li.firstChild.textContent = found.type === 'passage' ? v.verse : v.ref;
    li.lastChild.textContent = v.text;
    if (found.type === 'search')
      li.onclick = () => {
        $('#scQuery').value = v.ref;
        find();
      };
    else li.classList.add('passage');
    ul.appendChild(li);
  }
}

function options() {
  const n = (sel, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(+$(sel).value) || d));
  return {
    versesPerSlide: n('#scPer', 1, 20, DEFAULTS.versesPerSlide),
    maxChars: n('#scChars', 40, 1000, DEFAULTS.maxChars),
    numbers: $('#scNumbers').checked,
  };
}

/** The passage as a presentation with the Scripture theme. */
function makePassage() {
  const opts = options();
  keepPrefs(opts);
  return passagePresentation(
    { reference: found.reference, verses: found.verses, bible: found.bible, abbrev: found.abbrev },
    opts,
    scriptureTemplate(state.db),
  );
}
const hasPassage = () => found?.type === 'passage' && found.verses.length > 0;
const isShowing = p => p?.scripture?.bible === found.bible && p.scripture.reference === found.reference;

/** Show the passage without adding it to the library: it replaces the last one shown this way, and is gone after a
 * reload unless Add to library keeps it. */
function showPassage() {
  if (!hasPassage()) return;
  state.preview = makePassage();
  save(); // the Scripture template may have gained its reference box
  goLive(state.preview.id, 0);
}

/** Keep the passage in the library: the one on screen if that is it, so it stays live, or else a new one. */
function addPassage() {
  if (!hasPassage()) return;
  let p = state.preview;
  if (isShowing(p)) state.preview = null;
  else p = makePassage();
  state.db.presentations.push(p);
  state.selectedId = p.id;
  save();
  renderAll();
  toast(`Added “${p.name}” to the library`);
}

async function importBible(file) {
  toast(`Importing ${file.name}…`);
  try {
    const { bible: b } = await Lumen.importBible(file);
    await loadBibles();
    $('#scBible').value = b.id;
    keepPrefs({ bible: b.id });
    renderBible();
    toast(`Added ${b.name}: ${b.books} books, ${b.verses.toLocaleString()} verses`);
  } catch (e) {
    toast(e.message);
  }
}

/** Wire up the Bible tab; called once the library has loaded. */
export function setupScripture() {
  const p = prefs();
  $('#scPer').value = p.versesPerSlide;
  $('#scChars').value = p.maxChars;
  $('#scNumbers').checked = p.numbers;
  if (!Lumen.online) {
    $('#scInfo').textContent = 'Scripture needs the Lumen server: start Lumen as the app or with node server.js.';
    for (const id of ['#scBible', '#scQuery', '#scImport', '#scAdd', '#scLive']) $(id).disabled = true;
    return;
  }
  $('#scBible').onchange = () => {
    keepPrefs({ bible: $('#scBible').value });
    renderBible();
  };
  $('#scQuery').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(find, 250);
  };
  $('#scQuery').onkeydown = e => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      find();
    }
  };
  $('#scAdd').onclick = addPassage;
  $('#scLive').onclick = showPassage;
  $('#scImport').onclick = () => $('#scFile').click();
  $('#scFile').onchange = e => {
    const f = e.target.files[0];
    if (f) importBible(f);
    e.target.value = '';
  };
  $('#scRemove').onclick = async () => {
    const b = bible();
    if (
      !b ||
      b.bundled ||
      !(await ask(`Remove ${b.name}? Slides already made from it stay.`, { ok: 'Remove', danger: true }))
    )
      return;
    try {
      await Lumen.deleteBible(b.id);
      await loadBibles();
    } catch (e) {
      toast(e.message);
    }
  };
  Lumen.on('bibles', loadBibles);
  loadBibles();
}
