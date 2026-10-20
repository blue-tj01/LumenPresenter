// Lumen Presenter: operator console. Loads the library and live state, then wires the page up.
import { $, toast } from './dom.js';
import { saveEditor, setupEditor } from './editor.js';
import { getPres, KEY, normalize, save, state, valid } from './library.js';
import { adoptLive, broadcast, clear, refreshLive, step, upgradeLive } from './live.js';
import { loadFolders, renderMedia, setupMedia } from './media.js';
import { setupNetwork } from './network.js';
import { migrateLibrary } from './format.js';
import { setupScripture } from './scripture.js';
import { seed } from './seed.js';
import { renderTheme, setupThemes } from './themes.js';
import { setupTimer } from './timer.js';
import { renderAll, renderMessages, setupViews } from './views.js';

await Lumen.init();

let loadFailed = false;
state.db = Lumen.online ? await Lumen.loadLibrary().catch(() => { loadFailed = true; return null; }) : null;
const fresh = !valid(state.db) && !loadFailed; // nothing on the server yet: bring over this browser's library, or the demo
if (!valid(state.db)) { try { state.db = JSON.parse(localStorage.getItem(KEY)); } catch { state.db = null; } }
if (!valid(state.db)) state.db = seed();
state.db = normalize(state.db);

const restored = Lumen.online ? (await Lumen.getLive().catch(() => null))?.live : null;
if (restored) adoptLive(restored);
const upgraded = upgradeLive();
state.selectedId = (state.db.playlist[0] || state.db.presentations[0]?.id) ?? null;

setupViews(); setupEditor(); setupMedia(); setupThemes(); setupTimer(); setupNetwork(); setupScripture();

const popup = (url, name) => { const w = window.open(url, name, 'width=1280,height=760'); if (!w) toast('Allow pop-ups to open output windows'); else if (!Lumen.online) setTimeout(broadcast, 600); };
$('#btnOutput').onclick = () => popup('output.html', 'lumen-output');
$('#btnStage').onclick = () => popup('stage.html', 'lumen-stage');
$('#btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify({ ...state.db, media: state.db.media.filter(m => !m.src.startsWith('blob:')) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lumen-library.json'; a.click();
};
$('#btnImport').onclick = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => { const d = JSON.parse(t); if (!valid(d)) throw 0; state.db = normalize({ ...seed(), ...migrateLibrary(d) }); save(); state.selectedId = state.db.presentations[0]?.id; renderAll(); renderMedia(); renderMessages(); renderTheme(); toast('Library imported'); })
    .catch(() => toast('That file is not a Lumen library'));
  e.target.value = '';
};
$('#btnReset').onclick = () => { if (confirm('Reset library to the demo content? Your changes will be lost.')) { state.db = normalize(seed()); save(); state.selectedId = state.db.playlist[0]; clear('all'); renderAll(); renderMedia(); renderMessages(); renderTheme(); } };

document.addEventListener('keydown', e => {
  if (!$('#editor').hidden) { if (e.key === 'Escape') $('#editor').hidden = true; if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); } return; }
  if (e.target.matches('input, textarea, select')) return;
  const map = { ArrowRight: () => step(1), ArrowDown: () => step(1), ' ': () => step(1), PageDown: () => step(1),
    ArrowLeft: () => step(-1), ArrowUp: () => step(-1), PageUp: () => step(-1),
    F1: () => clear('all'), F2: () => clear('slide'), F3: () => clear('bg'), F4: () => clear('msg'), F6: () => clear('logo') };
  if (map[e.key]) { e.preventDefault(); map[e.key](); }
});

// ---------- server sync ----------
Lumen.on('hello', broadcast); // a same-browser window opened without the server
Lumen.on('error', toast);
Lumen.on('state', d => { adoptLive(d.live); refreshLive(); renderMessages(); }); // another operator console
Lumen.on('library', async () => {
  const d = await Lumen.loadLibrary().catch(() => null);
  if (!valid(d)) return;
  state.db = normalize(d);
  try { localStorage.setItem(KEY, JSON.stringify(state.db)); } catch {}
  if (!getPres(state.selectedId)) state.selectedId = state.db.playlist[0] || state.db.presentations[0]?.id;
  renderAll(); renderMedia(); renderMessages(); renderTheme(); refreshLive();
});
function renderStatus(s) {
  const el = $('#srvStatus');
  el.className = 'srv ' + (!s.online ? 'local' : s.streaming ? 'ok' : 'down');
  el.textContent = !s.online ? 'Local only' : s.streaming ? 'Server' : 'Reconnecting…';
  el.title = !s.online ? 'No Lumen server — library saved in this browser, output windows must be on this computer'
    : s.streaming ? 'Connected — library, media and live state are kept on the server'
    : 'Lost the server — output windows on this computer still follow along';
}
Lumen.on('status', renderStatus);
renderStatus({ online: Lumen.online, streaming: Lumen.streaming });

renderAll(); renderMedia(); renderMessages(); renderTheme(); loadFolders();
if (Lumen.online && !upgraded) refreshLive(); else broadcast();
if (fresh || !Lumen.online) save();
if (Lumen.outdated) setTimeout(() => toast('The server is older than this page. Restart Lumen to finish updating.'), 2500);
if (loadFailed) toast('Could not load the library from the server — showing this browser\'s copy');
