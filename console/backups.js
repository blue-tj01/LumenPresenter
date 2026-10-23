// @ts-check
// The Library dialog: exporting the library to a file, importing one, putting a backup back, and starting over
// with the demo library. Everything that replaces the library asks first and keeps a backup of it.
import { $, toast } from './dom.js';
import { ask } from './dialog.js';
import { migrateLibrary } from './format.js';
import { keepCopy, normalize, save, state, valid } from './library.js';
import { seed } from './seed.js';

let adopt = () => {}; // show a library that replaced this one

const when = t =>
  new Date(t).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
const size = n => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`);
function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
}

async function renderBackups() {
  const ul = $('#backupList');
  ul.textContent = '';
  const note = (text, cls = 'none') => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    ul.append(li);
  };
  if (!Lumen.online) {
    note('Backups are kept by Lumen’s server. Without it, use Export to keep a copy.');
    return;
  }
  let list;
  try {
    list = await Lumen.backups();
  } catch (e) {
    note(`Could not list the backups: ${e.message}`);
    return;
  }
  if (!list.length) {
    note('No backups yet. The first is made 10 minutes after the library first changes.');
    return;
  }
  for (const b of list) {
    const li = document.createElement('li');
    const w = document.createElement('span');
    w.className = 'when';
    w.textContent = when(b.time);
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = `${ago(b.time)} · ${size(b.size)}`;
    const btn = document.createElement('button');
    btn.className = 'btn small-btn';
    btn.textContent = 'Restore…';
    btn.setAttribute('aria-label', `Restore the backup from ${when(b.time)}`);
    btn.onclick = () => restore(b);
    li.append(w, meta, btn);
    ul.append(li);
  }
}

async function restore(b) {
  if (
    !(await ask(
      `Put back the library as it was on ${when(b.time)}? Every screen changes to it. The library as it is now is kept as a backup, so this can be undone the same way.`,
      { title: 'Restore this backup?', ok: 'Restore' },
    ))
  )
    return;
  try {
    await Lumen.restoreBackup(b.name);
    toast(`Restored the library from ${when(b.time)}`);
    close();
  } catch (e) {
    toast(`Could not restore it: ${e.message}`, 6000);
  }
}

/** Replace the library with another, everywhere, keeping a backup of this one. */
async function replace(lib) {
  state.db = normalize(lib);
  const keep = { ...state.db, media: state.db.media.filter(m => !m.src.startsWith('blob:')) };
  if (Lumen.online) {
    try {
      await Lumen.replaceLibrary(keep);
    } catch (e) {
      toast(`Library not saved: ${e.message}`, 6000);
    }
    keepCopy(keep);
  } else save();
  adopt();
}

async function importFile(f) {
  let d;
  try {
    d = JSON.parse(await f.text());
    if (!valid(d)) throw 0;
  } catch {
    toast('That file is not a Lumen library');
    return;
  }
  const n = d.presentations.length;
  if (
    !(await ask(
      `Replace this library with the ${n} presentation${n === 1 ? '' : 's'} in “${f.name}”, on every screen? ${Lumen.online ? 'A backup of this one is kept first.' : 'Export this one first if you might want it back.'}`,
      { title: 'Import a library?', ok: 'Replace library', danger: true },
    ))
  )
    return;
  await replace({ ...seed(), ...migrateLibrary(d) });
  toast('Library imported');
  close();
}

async function startOver() {
  if (
    !(await ask(
      `Every song, service, theme and setting is replaced with the demo library, on every screen. ${Lumen.online ? 'A backup is kept first, and can be put back from this dialog.' : 'Without Lumen’s server there is no backup: export first if you might want it back.'}`,
      { title: 'Start over?', ok: 'Start over', danger: true, typed: 'START OVER' },
    ))
  )
    return;
  await replace(seed());
  toast('Started over with the demo library');
  close();
}

function exportFile() {
  const blob = new Blob(
    [JSON.stringify({ ...state.db, media: state.db.media.filter(m => !m.src.startsWith('blob:')) }, null, 2)],
    { type: 'application/json' },
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lumen-library-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}

function open() {
  $('#libDialog').hidden = false;
  renderBackups();
  $('#libClose').focus();
}
function close() {
  $('#libDialog').hidden = true;
  $('#btnLibrary').focus();
}

/** `onReplace` shows the library after it was replaced here. */
export function setupBackups(onReplace) {
  adopt = onReplace;
  $('#btnLibrary').onclick = open;
  $('#libClose').onclick = close;
  $('#libDialog').onkeydown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  };
  $('#libDialog').onmousedown = e => {
    if (e.target === $('#libDialog')) close();
  };
  $('#btnExport').onclick = exportFile;
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importFile(f);
  };
  $('#btnReset').onclick = startOver;
}
