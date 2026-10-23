// @ts-check
// Lumen Presenter: operator console. Loads the library and live state, then wires the page up.
import { $, toast } from './dom.js';
import { setupBackups } from './backups.js';
import { rebaseUndo, resetUndo, undo } from './undo.js';
import { saveEditor, setupEditor } from './editor.js';
import { getPres, keepCopy, loadCopy, normalize, save, state, valid } from './library.js';
import { adoptLive, broadcast, clear, refreshLive, step, upgradeLive } from './live.js';
import { runCommand, setupControl } from './control.js';
import { loadFolders, renderMedia, setupMedia } from './media.js';
import { setupNetwork } from './network.js';
import { setupPowerPoint } from './powerpoint.js';
import { setupReport } from './report.js';
import { setupScripture } from './scripture.js';
import { openSetup, setupSetup } from './setup.js';
import { seed } from './seed.js';
import { setupLayoutEditor } from './layout-editor.js';
import { renderTheme, setupThemes } from './themes.js';
import { setupTimer } from './timer.js';
import { renderAll, renderMessages, setupViews } from './views.js';

await Lumen.init();

let loadFailed = false;
state.db = Lumen.online
  ? await Lumen.loadLibrary().catch(() => {
      loadFailed = true;
      return null;
    })
  : null;
const fresh = !valid(state.db) && !loadFailed; // nothing on the server yet: bring over this browser's library, or the demo
if (!valid(state.db)) state.db = await loadCopy();
const firstRun = !valid(state.db); // no library anywhere yet: the demo, and the first-run setup
if (!valid(state.db)) state.db = seed();
state.db = normalize(state.db);

const restored = Lumen.online ? (await Lumen.getLive().catch(() => null))?.live : null;
if (restored) adoptLive(restored);
const upgraded = upgradeLive();
resetUndo(state.db);
state.selectedId = (state.db.playlist[0] || state.db.presentations[0]?.id) ?? null;

setupViews();
setupEditor();
setupMedia();
setupThemes();
setupTimer();
setupNetwork();
setupControl();
setupScripture();
setupPowerPoint();
setupReport();
setupLayoutEditor();

const popup = (url, name) => {
  const w = window.open(url, name, 'width=1280,height=760');
  if (!w) toast('Allow pop-ups to open output windows');
  else if (!Lumen.online) setTimeout(broadcast, 600);
};
$('#btnOutput').onclick = () => popup('output.html', 'lumen-output');
$('#btnStage').onclick = () => popup('stage.html', 'lumen-stage');
setupBackups(() => {
  resetUndo(state.db);
  state.selectedId = state.db.playlist[0] || state.db.presentations[0]?.id;
  clear('all');
  renderAll();
  renderMedia();
  renderMessages();
  renderTheme();
});
setupSetup(() => {
  resetUndo(state.db);
  renderAll();
  renderMedia();
  renderMessages();
  renderTheme();
});
$('#btnSetup').onclick = () => {
  $('#libDialog').hidden = true;
  openSetup();
};

// Undo and redo, for every change to the library made here.
const undoRedo = again =>
  undo(
    state.db,
    () => {
      save();
      if (!getPres(state.selectedId)) state.selectedId = state.db.playlist[0] || state.db.presentations[0]?.id;
      renderAll();
      renderMedia();
      renderMessages();
      renderTheme();
      refreshLive();
    },
    again,
  );
$('#btnUndo').onclick = () => undoRedo(false);
$('#btnRedo').onclick = () => undoRedo(true);

document.addEventListener('keydown', e => {
  if (!$('#layoutEditor').hidden) return; // the layout editor has its own keys
  if (!$('#editor').hidden) {
    if (e.key === 'Escape') $('#editor').hidden = true;
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEditor();
    }
    return;
  }
  if (/** @type {HTMLElement} */ (e.target).matches('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    undoRedo(e.key.toLowerCase() === 'y' || e.shiftKey);
    return;
  }
  const map = {
    ArrowRight: () => step(1),
    ArrowDown: () => step(1),
    ' ': () => step(1),
    PageDown: () => step(1),
    ArrowLeft: () => step(-1),
    ArrowUp: () => step(-1),
    PageUp: () => step(-1),
    F1: () => clear('all'),
    F2: () => clear('slide'),
    F3: () => clear('bg'),
    F4: () => clear('msg'),
    F6: () => clear('logo'),
  };
  if (map[e.key]) {
    e.preventDefault();
    map[e.key]();
  }
});

// ---------- server sync ----------
Lumen.on('hello', broadcast); // a same-browser window opened without the server
Lumen.on('error', toast);
Lumen.on('state', d => {
  adoptLive(d.live);
  refreshLive();
  renderMessages();
}); // another operator console
// A tap on the phone remote, or a command from Companion or OSC; the server hands each one to a single console.
Lumen.on('remote', runCommand);
Lumen.on('library', async () => {
  const d = await Lumen.loadLibrary().catch(() => null);
  if (!valid(d)) return;
  adoptLibrary(d);
});
// A change saved by another console: just that, applied to the library here.
Lumen.on('changes', ch => adoptLibrary(Lumen.applyChanges({ ...state.db }, ch)));
// Songs or services another console changed while this one was changing them too: theirs is kept.
Lumen.on('conflict', list => {
  const names = list.map(c => (c.name ? `“${c.name}”` : c.list === 'services' ? 'a service' : 'a song'));
  toast(
    `${names.join(', ')} ${list.length > 1 ? 'were' : 'was'} changed on another screen at the same time, so that version was kept. Make your change again if it is still needed.`,
    9000,
  );
});
function adoptLibrary(d) {
  state.db = normalize(d);
  rebaseUndo(state.db);
  keepCopy(state.db);
  if (!getPres(state.selectedId)) state.selectedId = state.db.playlist[0] || state.db.presentations[0]?.id;
  renderAll();
  renderMedia();
  renderMessages();
  renderTheme();
  refreshLive();
}
function renderStatus(s) {
  const el = $('#srvStatus');
  el.className = 'srv ' + (!s.online ? 'local' : s.streaming ? 'ok' : 'down');
  el.textContent = !s.online ? 'Local only' : s.streaming ? 'Server' : 'Reconnecting…';
  el.title = !s.online
    ? 'No Lumen server — library saved in this browser, output windows must be on this computer'
    : s.streaming
      ? 'Connected — library, media and live state are kept on the server'
      : 'Lost the server — output windows on this computer still follow along';
}
Lumen.on('status', renderStatus);
renderStatus({ online: Lumen.online, streaming: Lumen.streaming });

renderAll();
renderMedia();
renderMessages();
renderTheme();
loadFolders();
if (Lumen.online && !upgraded) refreshLive();
else broadcast();
if (fresh || !Lumen.online) save();
if (Lumen.outdated)
  setTimeout(() => toast('The server is older than this page. Restart Lumen to finish updating.'), 2500);
if (firstRun && !state.db.setupDone) openSetup();
if (loadFailed) toast("Could not load the library from the server — showing this browser's copy");
