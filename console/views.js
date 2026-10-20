// The library list, playlist, slide grid and messages, and their controls.
import { $, $$, toast } from './dom.js';
import { openEditor } from './editor.js';
import { arrangement, autoSecs, flat, getPres, isVideoPres, save, slideBackground, state, templateFor } from './library.js';
import { broadcast, clear, goLive, live, quickSlide, step, toggleAuto, videoControl } from './live.js';
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
    li.querySelector('.nm').textContent = li.title = p.name;
    if (snippet) li.appendChild(highlighted(snippet));
    li.onclick = () => { state.selectedId = p.id; renderAll(); };
    li.ondblclick = () => { if (!state.db.playlist.includes(p.id)) { state.db.playlist.push(p.id); save(); renderPlaylist(); } };
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

let dragFrom = -1;
function renderPlaylist() {
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
    li.ondrop = e => { e.preventDefault(); if (dragFrom < 0) return; const [m] = state.db.playlist.splice(dragFrom, 1); state.db.playlist.splice(i, 0, m); dragFrom = -1; save(); renderPlaylist(); };
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
    + (autoSecs(p) ? ` · Auto-advance every ${autoSecs(p)}s, looping` : '') + ` · ${templateFor(p).name || 'Default style'}` : '';
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


export function renderAll() { renderLibrary(); renderPlaylist(); renderGrid(); renderTheme(); }

/** Wire up the library, playlist, slide grid, live controls, tabs and messages; called once the library has loaded. */
export function setupViews() {
  let typing;
  $('#libSearch').oninput = () => { clearTimeout(typing); typing = setTimeout(renderLibrary, 120); };
  $('#btnNewPres').onclick = () => openEditor(null);
  $('#btnEdit').onclick = () => state.selectedId && openEditor(state.selectedId);
  $('#btnAddPlaylist').onclick = () => { if (state.selectedId && !state.db.playlist.includes(state.selectedId)) { state.db.playlist.push(state.selectedId); save(); renderPlaylist(); toast('Added to playlist'); } };
  $('#btnDelete').onclick = () => {
    const p = getPres(state.selectedId); if (!p || !confirm(`Delete “${p.name}”?`)) return;
    state.db.presentations = state.db.presentations.filter(x => x !== p); state.db.playlist = state.db.playlist.filter(id => id !== p.id);
    if (live.presId === p.id) clear('slide');
    state.selectedId = state.db.playlist[0] || state.db.presentations[0]?.id; save(); renderAll();
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
