// The media bin, media folders on the computer running Lumen, and videos in the playlist.
import { $, $$, toast } from './dom.js';
import { readDataUrl } from './editor.js';
import { slideRefs, toRef } from './format.js';
import { save, state } from './library.js';
import { broadcast, live } from './live.js';
import { importSlides } from './powerpoint.js';
import { uid } from './slides.js';
import { renderAll, renderLiveMarks } from './views.js';

export function renderMedia() {
  const bin = $('#mediaBin'); bin.innerHTML = '';
  const folder = folders.find(f => f.id === mediaSource);
  $('#mediaHint').textContent = folder ? (folder.missing ? 'folder not found: is the drive connected?' : 'click to set background · plays from the folder, no upload')
    : 'click to set background · drop images/videos to add';
  $('#mediaSearch').hidden = !folder;
  $('#btnRemoveFolder').hidden = !folder || !foldersLocal || folder.fixed;
  $('#btnAddMedia').hidden = !!folder;
  if (folder) return renderFolder(folder, bin);
  state.db.media.forEach(m => {
    const d = document.createElement('div');
    d.className = 'mitem'; d.dataset.src = m.src;
    if (m.type === 'image') d.style.backgroundImage = PP.cssUrl(m.src);
    else if (m.type === 'video') {
      const v = document.createElement('video');
      Object.assign(v, { src: m.src, muted: true, loop: true, autoplay: true, playsInline: true });
      d.appendChild(v);
    }
    else { d.style.background = m.src; if (m.type === 'motion') d.classList.add('pp-motion'); }
    d.insertAdjacentHTML('beforeend', `<span></span>${m.builtin ? '' : '<button class="x" title="Remove">✕</button>'}` +
      (m.type === 'video' ? '<button class="pl" title="Add to playlist">＋ Playlist</button>' : ''));
    d.querySelector('span').textContent = m.name;
    d.onclick = e => {
      if (e.target.classList.contains('pl')) {
        addVideoToPlaylist(m.name.replace(/\.[^.]+$/, ''), Lumen.online ? m.src : '#' + m.id);
        save(); renderAll(); toast(`Added ${m.name} to the playlist`);
        return;
      }
      if (e.target.classList.contains('x')) {
        // Themes hold pictures and videos too, in the same layouts as slides.
        const refs = p => [p.background?.src, ...p.groups.flatMap(g => g.slides.flatMap(slideRefs))];
        const all = [...state.db.presentations.flatMap(refs), ...[state.db.baseTemplate, ...state.db.templates].flatMap(slideRefs)];
        if (all.includes('bin:' + m.id)) { toast(`“${m.name}” is used on a slide or theme — remove it there first`); return; }
        state.db.media = state.db.media.filter(x => x !== m); save(); renderMedia();
        const used = all.includes(toRef(m.src));
        if (!used) Lumen.deleteMedia(m.src);
        return;
      }
      live.bg = live.bg && live.bg.src === m.src ? null : { type: m.type, src: m.src };
      live._autoBgFrom = live.presId; broadcast();
    };
    bin.appendChild(d);
  });
  renderLiveMarks();
}

// ---------- media folders: pictures and videos played from a folder on the computer running Lumen ----------
let folders = [], foldersLocal = false;
let mediaSource = (() => { try { return localStorage.getItem('lumen.mediaSource') || ''; } catch { return ''; } })();
const folderSrc = (f, file) => `folders/${f.id}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
export async function loadFolders() {
  if (!Lumen.online) return;
  try { ({ folders, local: foldersLocal } = await Lumen.folders()); } catch { return; }
  const sel = $('#mediaSource');
  sel.innerHTML = '<option value="">Media bin</option>';
  for (const f of folders) {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = `📁 ${f.name}${f.missing ? ' (not found)' : ''}`; o.title = f.path || f.name;
    sel.append(o);
  }
  if (!folders.some(f => f.id === mediaSource)) mediaSource = '';
  sel.value = mediaSource;
  sel.hidden = !folders.length;
  $('#btnAddFolder').hidden = !foldersLocal;
  renderMedia();
}
function renderFolder(f, bin) {
  const q = $('#mediaSearch').value.trim().toLowerCase();
  const files = f.files.filter(x => !q || x.path.toLowerCase().includes(q));
  if (!files.length) {
    bin.insertAdjacentHTML('beforeend', `<span class="empty muted">${f.missing ? 'This folder can’t be found.' : q ? 'Nothing matches.' : 'No pictures or videos in this folder.'}</span>`);
  }
  for (const file of files) {
    const src = folderSrc(f, file);
    const d = document.createElement('div');
    d.className = 'mitem'; d.dataset.src = src; d.title = file.path;
    if (file.type === 'image') {
      const img = document.createElement('img'); img.loading = 'lazy'; img.src = src; img.alt = ''; d.append(img);
    } else {
      // Previews play only while pointed at, so a folder of loops doesn't decode them all at once.
      const v = document.createElement('video');
      Object.assign(v, { src: src + '#t=1', muted: true, loop: true, preload: 'metadata', playsInline: true });
      d.onmouseenter = () => v.play().catch(() => {}); d.onmouseleave = () => v.pause();
      d.append(v);
    }
    d.insertAdjacentHTML('beforeend', '<span></span>' + (file.type === 'video' ? '<button class="pl" title="Add to playlist">＋ Playlist</button>' : ''));
    d.querySelector('span').textContent = file.name;
    d.onclick = e => {
      if (e.target.classList.contains('pl')) {
        addVideoToPlaylist(file.name.replace(/\.[^.]+$/, ''), src);
        save(); renderAll(); toast(`Added ${file.name} to the playlist`);
        return;
      }
      live.bg = live.bg && live.bg.src === src ? null : { type: file.type, src };
      live._autoBgFrom = live.presId; broadcast();
    };
    bin.appendChild(d);
  }
  renderLiveMarks();
}
async function addFolder() {
  // The desktop app offers its folder picker; in a browser, the path is typed.
  const dir = window.lumenDesktop ? await window.lumenDesktop.pickFolder()
    : prompt('Full path of a folder on the computer running Lumen, e.g. D:\\Worship Loops', '');
  if (!dir || !dir.trim()) return;
  try {
    const { id } = await Lumen.setFolders({ add: dir.trim() });
    mediaSource = id; rememberSource(); await loadFolders();
    toast('Folder added — its pictures and videos play from where they are');
  } catch (e) { toast(`Folder not added: ${e.message}`); }
}
const rememberSource = () => { try { localStorage.setItem('lumen.mediaSource', mediaSource); } catch {} };

async function addMediaFiles(files) {
  files = [...files].filter(f => /^(image|video)\//.test(f.type));
  if (Lumen.online) {
    for (const f of files) {
      toast(`Uploading ${f.name}…`);
      try {
        const m = await Lumen.uploadMedia(f);
        state.db.media.push({ id: uid(), name: m.name, type: m.type, src: m.src }); save(); renderMedia(); toast(`Added ${m.name}`);
      } catch (e) { toast(`Upload failed: ${e.message}`); }
    }
    return;
  }
  files.forEach(f => {
    if (f.type.startsWith('video/')) {
      state.db.media.push({ id: uid(), name: f.name, type: 'video', src: URL.createObjectURL(f) });
      renderMedia();
    } else if (f.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = () => { state.db.media.push({ id: uid(), name: f.name, type: 'image', src: r.result }); save(); renderMedia(); };
      r.readAsDataURL(f);
    }
  });
  toast('Media added' + (files.some(f => f.type.startsWith('video/')) ? ' (videos last for this session)' : ''));
}

// Stores a picture or video and returns how a slide refers to it: its server path, or "#<id>" for a file kept
// in the media bin without the server (videos then last for this session only).
export async function storeSlideMedia(f) {
  if (Lumen.online) return (await Lumen.uploadMedia(f)).src;
  const video = f.type.startsWith('video/');
  const m = { id: uid(), name: f.name, type: video ? 'video' : 'image', src: video ? URL.createObjectURL(f) : await readDataUrl(f) };
  state.db.media.push(m);
  return '#' + m.id;
}
// A video in the playlist is a one-slide presentation, so it plays in turn and Next moves past it.
function addVideoToPlaylist(name, ref, at = state.db.playlist.length) {
  const p = { id: uid(), name, kind: 'media', groups: [{ id: uid(), name: 'Video', slides: [{ id: uid(), text: '', media: { type: 'video', src: toRef(ref) } }] }], arrangements: [] };
  state.db.presentations.push(p); state.db.playlist.splice(at, 0, p.id);
  return p;
}
async function addPlaylistVideos(files, at = state.db.playlist.length) {
  files = [...files].filter(f => f.type.startsWith('video/'));
  for (const f of files) {
    toast(`Adding ${f.name}…`);
    try { addVideoToPlaylist(f.name.replace(/\.[^.]+$/, ''), await storeSlideMedia(f), at++); }
    catch (e) { toast(`Could not add ${f.name}: ${e.message || 'read failed'}`); continue; }
    save(); renderAll(); renderMedia(); toast(`Added ${f.name} to the playlist`);
  }
}

/** Wire up the media bin, media folders, and dropping videos on the playlist; called once the library has loaded. */
export function setupMedia() {
  $('#btnAddVideo').onclick = () => $('#playlistFile').click();
  $('#playlistFile').onchange = e => { addPlaylistVideos(e.target.files); e.target.value = ''; };
  const pl = $('#playList');
  pl.ondragover = e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); pl.classList.add('drop'); } };
  pl.ondragleave = () => pl.classList.remove('drop');
  pl.ondrop = e => {
    pl.classList.remove('drop'); $$('#playList .drag-over').forEach(li => li.classList.remove('drag-over'));
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const li = e.target.closest('li'), at = li ? [...pl.children].indexOf(li) : state.db.playlist.length;
    addPlaylistVideos(e.dataTransfer.files, at);
    importSlides(e.dataTransfer.files, at);
  };

  $('#btnAddMedia').onclick = () => $('#mediaFile').click();
  $('#btnAddFolder').onclick = addFolder;
  $('#btnRemoveFolder').onclick = async () => {
    const f = folders.find(x => x.id === mediaSource);
    if (!f || !confirm(`Stop showing “${f.name}” in Lumen? The files stay where they are, but slides using them will go blank.`)) return;
    try { await Lumen.setFolders({ remove: f.id }); mediaSource = ''; rememberSource(); loadFolders(); }
    catch (e) { toast(`Folder not removed: ${e.message}`); }
  };
  $('#mediaSource').onchange = e => { mediaSource = e.target.value; $('#mediaSearch').value = ''; rememberSource(); renderMedia(); };
  $('#mediaSearch').oninput = () => renderMedia();
  Lumen.on('folders', loadFolders);
  $('#mediaFile').onchange = e => { addMediaFiles(e.target.files); e.target.value = ''; };
  const bin = $('#mediaBin');
  bin.ondragover = e => { e.preventDefault(); bin.classList.add('drop'); };
  bin.ondragleave = () => bin.classList.remove('drop');
  bin.ondrop = e => { e.preventDefault(); bin.classList.remove('drop'); addMediaFiles(e.dataTransfer.files); };
}
