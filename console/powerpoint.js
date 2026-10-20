// PowerPoint, Impress and PDF files as presentations: the server turns each slide into a picture, so the slides
// look exactly as they were made, and each picture becomes a slide.
import { $, errorBox, hideToast, toast } from './dom.js';
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

const WIDTH = 1920;
// PDFs are drawn here with pdf.js (vendor/pdfjs), so they need nothing installed on the computer running Lumen.
// Each page is uploaded as a picture, as the server's conversion would have made it.
async function pdfSlides(f) {
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise.catch(e => { task.destroy(); throw e; });
  const base = f.name.replace(/\.[^.]+$/, ''), slides = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      toast(`Converting ${f.name}: page ${i} of ${doc.numPages}…`, 0);
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH; canvas.height = Math.round(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      page.cleanup();
      const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
      slides.push((await Lumen.uploadMedia(new File([blob], `${base} ${i}.png`, { type: 'image/png' }))).src);
    }
  } catch (e) {
    slides.forEach(Lumen.deleteMedia); // the pages already uploaded
    throw e;
  } finally {
    task.destroy();
  }
  return { name: base, slides };
}

/** Import each file into the library, and into the playlist at `at` when given. */
export async function importSlides(files, at = null) {
  files = slideFiles(files);
  if (!files.length) return;
  if (!Lumen.online) { toast('Importing slides needs the server (the desktop app or server.js)'); return; }
  for (const f of files) {
    toast(`Converting ${f.name}… a long deck can take a minute`, 0);
    let r;
    const pdf = /\.pdf$/i.test(f.name);
    try { r = pdf ? await pdfSlides(f) : await Lumen.importSlides(f); } catch (e) {
      hideToast();
      errorBox(`Could not import ${f.name}`, pdf ? String(e.message || e)
        : `${e.message}\n\nThis is also in slides-import.log in Lumen's data folder${window.lumenDesktop ? ' (File → Open Data Folder)' : ''}.`);
      continue;
    }
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
