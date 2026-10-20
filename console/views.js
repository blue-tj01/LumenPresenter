// The library list, services and their playlist, slide grid and messages, and their controls.
import { $, $$, toast } from './dom.js';
import { openEditor } from './editor.js';
import { arrangement, autoSecs, flat, getPres, isVideoPres, save, slideBackground, state, templateFor } from './library.js';
import { broadcast, clear, goLive, live, quickSlide, step, toggleAuto, videoControl } from './live.js';
import { addService, duplicateService, nextSunday, openService, removeService, serviceLabel, sortedServices, switchService, updateService } from './services.js';
import { decode, findSame, parseSongSelect } from './songselect.js';
import { slideFiles } from './powerpoint.js';
import { renderTheme } from './themes.js';

// With the server, search is the library database's song search, which ranks matches and shows the words that
// matched; without it, titles, words and song details are matched as typed.
let searchSeq = 0;
function localSearch(q) {
  const has = v => String(v ?? '').toLowerCase().includes(q);
  return state.db.presentations.filter(p => has(p.name) || has(p.meta?.author) || has(p.meta?.copyright) || has(p.meta?.ccli)
    || p.groups.some(g => g.slides.some(s => has(s.text)))).map(p => ({ id: p.id }));
}
async function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase(), seq = ++searchSeq;
  let results;
  if (!q) results = [...state.db.presentations].sort((a, b) => a.name.localeCompare(b.name)).map(p => ({ id: p.id }));
  else if (Lumen.online && !Lumen.outdated) {
    try { results = await Lumen.search(q); } catch { results = localSearch(q); }
    if (seq !== searchSeq) return; // a newer search has started
  } else results = localSearch(q);
  const ul = $('#libList'); ul.innerHTML = '';
  results.forEach(({ id, snippet }) => {
    const p = getPres(id); if (!p) return;
    const li = document.createElement('li');
    li.dataset.id = p.id;
    li.innerHTML = '<span class="ico">♪</span><span class="nm"></span>';
    if (isVideoPres(p)) li.firstChild.textContent = '▶';
    else if (p.kind === 'slides') li.firstChild.textContent = '▤';
    li.querySelector('.nm').textContent = li.title = p.name;
    if (snippet) li.appendChild(highlighted(snippet));
    li.onclick = () => { state.selectedId = p.id; renderAll(); };
    li.ondblclick = () => { if (!state.db.playlist.includes(p.id)) { state.db.playlist.push(p.id); save(); renderPlaylist(); } };
    li.draggable = true;
    li.ondragstart = e => { dragFrom = -1; e.dataTransfer.setData(PRES_DRAG, p.id); e.dataTransfer.effectAllowed = 'copy'; };
    ul.appendChild(li);
  });
  if (q && !ul.children.length) ul.innerHTML = '<li class="none muted small">No songs match</li>';
  markLists();
}
/** A search result's matching words, with each match (between \u0002 and \u0003) marked. */
function highlighted(snippet) {
  const el = document.createElement('span'); el.className = 'hit';
  snippet.split('\u0002').forEach((part, i) => {
    const [hit, rest] = i ? part.split('\u0003') : [null, part];
    if (hit) { const m = document.createElement('mark'); m.textContent = hit; el.appendChild(m); }
    if (rest) el.appendChild(document.createTextNode(rest));
  });
  el.title = el.textContent;
  return el;
}

function renderServices() {
  const sel = $('#svcSelect'); sel.innerHTML = '';
  for (const s of sortedServices(state.db)) sel.add(new Option(serviceLabel(s), s.id, false, s.id === state.db.serviceId));
  $('#svcDelete').disabled = state.db.services.length < 2;
}

/** Open a service: its playlist shows, and its first song is selected. */
function showService(id) {
  if (!switchService(state.db, id)) return;
  state.selectedId = state.db.playlist[0] || state.selectedId;
  save(); renderAll();
}

// The dialog for a new service, or renaming one: resolves with { name, date }, or null when cancelled.
function askService(title, { name, date }) {
  $('#svcDialogTitle').textContent = title;
  $('#svcName').value = name; $('#svcDate').value = date;
  $('#svcDialog').hidden = false; $('#svcName').select();
  return new Promise(done => {
    const close = v => { $('#svcDialog').hidden = true; $('#svcForm').onsubmit = $('#svcCancel').onclick = $('#svcDialog').onkeydown = null; done(v); };
    $('#svcForm').onsubmit = e => { e.preventDefault(); close({ name: $('#svcName').value.trim(), date: $('#svcDate').value }); };
    $('#svcCancel').onclick = () => close(null);
    $('#svcDialog').onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') close(null); };
  });
}

let dragFrom = -1;
const PRES_DRAG = 'application/x-lumen-presentation'; // a song dragged from the library
const fromLibrary = e => e.dataTransfer.types.includes(PRES_DRAG);
/** Put a song dragged from the library into the playlist at a place (the end if not given), or move it there if
 * it is already in it. */
function dropFromLibrary(e, at = state.db.playlist.length) {
  e.preventDefault(); e.stopPropagation();
  $$('#playList .drag-over').forEach(li => li.classList.remove('drag-over'));
  const id = e.dataTransfer.getData(PRES_DRAG);
  if (!getPres(id)) return;
  const was = state.db.playlist.indexOf(id);
  if (was >= 0) { state.db.playlist.splice(was, 1); if (was < at) at--; }
  state.db.playlist.splice(at, 0, id);
  state.selectedId = id;
  save(); renderAll();
}
function renderPlaylist() {
  renderServices();
  const ul = $('#playList'); ul.innerHTML = '';
  state.db.playlist = state.db.playlist.filter(getPres);
  state.db.playlist.forEach((id, i) => {
    const p = getPres(id);
    const li = document.createElement('li');
    li.dataset.id = id; li.draggable = true;
    li.innerHTML = `<span class="ico">${i + 1}</span>${isVideoPres(p) ? '<span class="kind">▶</span>' : ''}<span class="nm"></span><button class="x" title="Remove">✕</button>`;
    li.querySelector('.nm').textContent = li.title = p.name;
    li.onclick = e => { if (e.target.classList.contains('x')) { state.db.playlist.splice(i, 1); save(); renderPlaylist(); return; } state.selectedId = id; renderAll(); };
    li.ondragstart = () => { dragFrom = i; };
    li.ondragover = e => { e.preventDefault(); li.classList.add('drag-over'); };
    li.ondragleave = () => li.classList.remove('drag-over');
    li.ondrop = e => { if (fromLibrary(e)) return dropFromLibrary(e, i); e.preventDefault(); if (dragFrom < 0) return; const [m] = state.db.playlist.splice(dragFrom, 1); state.db.playlist.splice(i, 0, m); dragFrom = -1; save(); renderPlaylist(); };
    ul.appendChild(li);
  });
  markLists();
}

function markLists() {
  $$('#libList li, #playList li').forEach(li => {
    li.classList.toggle('sel', li.dataset.id === state.selectedId);
    li.classList.toggle('is-live', li.dataset.id === live.presId && !!live.slide);
  });
}

export function renderGrid() {
  const grid = $('#slideGrid'); grid.innerHTML = '';
  const p = getPres(state.selectedId);
  $('#presTitle').textContent = p ? p.name : 'No presentation selected';
  const slides = flat(p);
  const ordered = p && p.arrangements?.[0]?.order.length && arrangement(p).map(gi => p.groups[gi].name);
  $('#presMeta').textContent = p ? `${p.groups.length} groups · ${slides.length} slides` + (ordered ? ` · Order: ${ordered.join(', ')}` : '')
    + (autoSecs(p) ? ` · Auto-advance every ${autoSecs(p)}s, looping` : '') + ` · ${templateFor(p).name || 'Default style'}` + (p === state.preview ? ' · Not in the library: Add to library in the Bible tab keeps it' : '') : '';
  if (!p || !slides.length) { grid.innerHTML = '<div class="empty">No slides yet — click ✎ Edit to add some.</div>'; return; }
  // One continuous grid; each card's coloured label names its group.
  slides.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'slide'; card.dataset.idx = i;
    const scr = document.createElement('div'); card.appendChild(scr);
    const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.style.background = s.color;
    lbl.innerHTML = `<span class="n">${i + 1}</span><span></span>`; lbl.lastChild.textContent = s.group;
    card.appendChild(lbl);
    card.onclick = () => goLive(p.id, i);
    grid.appendChild(card);
    PP.createScreen(scr);
    PP.update(scr, { bg: slideBackground(p, s.slide) || { type: 'gradient', src: 'linear-gradient(160deg,#1b2030,#0d0f15)' }, slide: { elements: s.elements } }, { animate: false, still: true });
  });
  renderLiveMarks();
}

export function renderLiveMarks() {
  $$('.slide').forEach(el => el.classList.toggle('live', live.presId === state.selectedId && +el.dataset.idx === live.idx && !!live.slide));
  $$('.mitem').forEach(el => el.classList.toggle('live', !!live.bg && el.dataset.src === live.bg.src));
  $('#btnLogo').classList.toggle('on', live.logo);
  const vidLive = !!(live.slide && live.slide.video);
  $$('.vidctl').forEach(b => b.hidden = !vidLive);
  $('#btnAuto').hidden = !(live.slide && autoSecs(getPres(live.presId)));
  if (vidLive) $('#btnVidPlay').firstChild.textContent = live.slide.play && live.slide.play.paused ? '▶ Play' : '❚❚ Pause';
  $('#liveLabel').textContent = live.slide ? live.slide.label : (live.logo ? 'Logo' : '');
  markLists();
}


export function renderMessages() {
  const ul = $('#msgList'); ul.innerHTML = '';
  state.db.messages.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="nm"></span><button class="x" title="Delete">✕</button>';
    li.querySelector('.nm').textContent = m;
    li.classList.toggle('sel', live.msg === m);
    li.onclick = e => {
      if (e.target.classList.contains('x')) { state.db.messages.splice(i, 1); save(); renderMessages(); return; }
      live.msg = live.msg === m ? null : m; broadcast(); renderMessages();
    };
    ul.appendChild(li);
  });
}


/** Songs from CCLI SongSelect files (.usr or .txt) added to the library. A song already there, by its CCLI song
 * number (or its title, for one without), is left as it is. */
async function importSongs(files) {
  const added = [], kept = [], failed = [];
  for (const f of [...files]) { // a copy: the file input is cleared while these are read
    if (!/\.(usr|txt)$/i.test(f.name)) { failed.push(f.name); continue; }
    try {
      const p = parseSongSelect(f.name, decode(await f.arrayBuffer()));
      if (findSame([...state.db.presentations, ...added], p)) { kept.push(p.name); continue; }
      added.push(p);
    } catch { failed.push(f.name); }
  }
  if (added.length) {
    state.db.presentations.push(...added);
    state.selectedId = added[added.length - 1].id;
    save(); renderAll();
  }
  const n = (k, one) => `${k.length} ${one}${k.length === 1 ? '' : 's'}`;
  toast([added.length === 1 ? `Imported “${added[0].name}”` : added.length && `Imported ${n(added, 'song')}`,
    kept.length && `${kept.length === 1 ? `“${kept[0]}” is` : `${n(kept, 'song')} are`} already in the library`,
    failed.length && `${failed.length === 1 ? failed[0] : n(failed, 'file')} could not be read as SongSelect`]
    .filter(Boolean).join(' · ') || 'No songs found');
}

export function renderAll() { renderLibrary(); renderPlaylist(); renderGrid(); renderTheme(); }

/** Wire up the library, playlist, slide grid, live controls, tabs and messages; called once the library has loaded. */
export function setupViews() {
  let typing;
  $('#libSearch').oninput = () => { clearTimeout(typing); typing = setTimeout(renderLibrary, 120); };
  $('#btnNewPres').onclick = () => openEditor(null);
  $('#btnImportSongs').onclick = () => $('#songFile').click();
  $('#songFile').onchange = e => { importSongs(e.target.files); e.target.value = ''; };
  const songFiles = e => [...e.dataTransfer.items].some(i => i.kind === 'file');
  $('#libList').addEventListener('dragover', e => { if (songFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  $('#libList').addEventListener('drop', e => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const slides = slideFiles(e.dataTransfer.files), songs = [...e.dataTransfer.files].filter(f => !slides.includes(f));
    if (songs.length) importSongs(songs); // PowerPoint and PDF files are imported by powerpoint.js
  });
  $('#btnEdit').onclick = () => state.selectedId && openEditor(state.selectedId);
  $('#btnAddPlaylist').onclick = () => { if (state.selectedId && !state.db.playlist.includes(state.selectedId)) { state.db.playlist.push(state.selectedId); save(); renderPlaylist(); toast('Added to playlist'); } };
  $('#btnDelete').onclick = () => {
    const p = getPres(state.selectedId); if (!p || !confirm(`Delete “${p.name}”?`)) return;
    if (state.preview === p) state.preview = null;
    state.db.presentations = state.db.presentations.filter(x => x !== p); state.db.playlist = state.db.playlist.filter(id => id !== p.id);
    if (live.presId === p.id) clear('slide');
    state.selectedId = state.db.playlist[0] || state.db.presentations[0]?.id; save(); renderAll();
  };
  // Songs dragged from the library drop onto a playlist item (going in before it) or below the last one.
  $('#playList').addEventListener('dragover', e => { if (fromLibrary(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  $('#playList').addEventListener('drop', e => { if (fromLibrary(e)) dropFromLibrary(e); });
  $('#svcSelect').onchange = e => showService(e.target.value);
  $('#svcNew').onclick = async () => {
    const v = await askService('New service', { name: 'Service', date: nextSunday() });
    if (!v) return;
    addService(state.db, v); save(); renderAll(); toast(`Opened ${serviceLabel(openService(state.db))}`);
  };
  $('#svcDuplicate').onclick = () => {
    const s = duplicateService(state.db, state.db.serviceId);
    if (s) { save(); renderAll(); toast(`Copied to ${serviceLabel(s)}`); }
  };
  $('#svcEdit').onclick = async () => {
    const s = openService(state.db);
    const v = s && await askService('Rename service', s);
    if (!v) return;
    updateService(state.db, s.id, v); save(); renderAll();
  };
  $('#svcDelete').onclick = () => {
    const s = openService(state.db);
    if (!s || !confirm(`Delete the service “${serviceLabel(s)}”? Its songs stay in the library.`)) return;
    if (removeService(state.db, s.id)) showService(state.db.serviceId);
  };
  $('#thumbSize').oninput = e => $('#slideGrid').style.setProperty('--tw', e.target.value + 'px');

  $$('[data-clear]').forEach(b => b.onclick = () => clear(b.dataset.clear));
  $('#btnNext').onclick = () => step(1);
  $('#btnPrev').onclick = () => step(-1);
  $('#btnVidPlay').onclick = () => videoControl('toggle');
  $('#btnVidRestart').onclick = () => videoControl('restart');
  $('#btnAuto').onclick = toggleAuto;

  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
  });

  $('#msgShow').onclick = () => {
    const v = $('#msgInput').value.trim(); if (!v) return;
    if (!state.db.messages.includes(v)) state.db.messages.unshift(v);
    live.msg = v; $('#msgInput').value = ''; save(); broadcast(); renderMessages();
  };
  $('#msgInput').onkeydown = e => { if (e.key === 'Enter') $('#msgShow').click(); };
  $('#quickGo').onclick = () => {
    const v = $('#quickText').value.trim(); if (v) quickSlide(v);
  };
}
