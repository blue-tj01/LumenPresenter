// PowerPoint, Impress and PDF files as presentations: the server turns each slide into a picture, so the slides
// look exactly as they were made, and each picture becomes a slide.
import { $, toast } from './dom.js';
import { toRef } from './format.js';
import { save, state } from './library.js';
import { uid } from './slides.js';
import { renderAll } from './views.js';

const SLIDE_FILE = /\.(pptx|ppt|ppsx|pps|odp|pdf)$/i;
export const slideFiles = files => [...files].filter(f => SLIDE_FILE.test(f.name));

/** A presentation of one picture per slide, on black so nothing shows around a slide of another shape. */
export const slidesPresentation = (name, srcs) => ({
  id: uid(), name, kind: 'slides', background: { type: 'color', src: '#000000' },
  groups: [{ id: uid(), name: 'Slides', slides: srcs.map(src => ({ id: uid(), text: '', media: { type: 'image', src: toRef(src) } })) }],
  arrangements: [],
});

/** Import each file into the library, and into the playlist at `at` when given. */
export async function importSlides(files, at = null) {
  files = slideFiles(files);
  if (!files.length) return;
  if (!Lumen.online) { toast('Importing slides needs the server (the desktop app or server.js)'); return; }
  for (const f of files) {
    toast(`Converting ${f.name}… a long deck can take a minute`);
    let r;
    try { r = await Lumen.importSlides(f); } catch (e) { toast(`Could not import ${f.name}: ${e.message}`); continue; }
    const p = slidesPresentation(r.name || 'Slides', r.slides);
    state.db.presentations.push(p);
    if (at !== null) state.db.playlist.splice(at++, 0, p.id);
    state.selectedId = p.id;
    save(); renderAll();
    toast(`Imported ${r.slides.length} slide${r.slides.length === 1 ? '' : 's'} from ${f.name}`);
  }
}

/** Wire up the library's import button and dropping files on the library; called once the library has loaded. */
export function setupPowerPoint() {
  $('#btnImportSlides').onclick = () => $('#slidesFile').click();
  $('#slidesFile').onchange = e => { importSlides(e.target.files); e.target.value = ''; };
  const lib = $('#libList');
  lib.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); lib.classList.add('drop'); } });
  lib.addEventListener('dragleave', () => lib.classList.remove('drop'));
  lib.addEventListener('drop', e => {
    lib.classList.remove('drop');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    importSlides(e.dataTransfer.files);
  });
}
