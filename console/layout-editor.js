// The layout editor: a theme's text boxes, shapes, pictures and videos placed on a canvas drawn by the screens'
// own renderer, with a layers list, an inspector, and every slide of a song shown with the theme along the
// bottom. It works on a copy, and the theme changes (and the projector with it) only on Save.
import { $, $$, toast } from './dom.js';
import { CREDITS_ELEMENT, H, mainText, resolveSlide, toRef, W } from './format.js';
import { alignFrame, BINDS, elementAt, elementName, history, moveFrame, newElement, parseColor, reorder,
  resizeFrame, rotation, snapLines, toColor, SAFE } from './layout-model.js';
import { findTemplate, flat, getPres, mediaUrl, save, slideBackground, state, templateFor } from './library.js';
import { broadcast } from './live.js';
import { storeSlideMedia } from './media.js';
import { uid } from './slides.js';
import { addTemplate, renderTheme } from './themes.js';
import { renderGrid } from './views.js';

let draft = null, hist = null, targetId = null, selId = null, presId = null, slideIdx = 0, scale = 0.4, drag = null;
let screen = null;
const els = () => draft.elements;
const sel = () => els().find(e => e.id === selId) || null;
const asTemplate = () => ({ layout: draft });
const SNAP_PX = 7; // how near, on screen, an edge comes to a line before it snaps
const DEFAULT_BG = { type: 'gradient', src: 'linear-gradient(160deg,#1b2030,#0d0f15)' };
const SAMPLE = { slide: { text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!' }, group: 'Verse 1',
  pres: { name: 'Song title', meta: { author: 'Written by', copyright: 'Copyright', ccli: '22025' } } };
const placesCredits = el => el.bind === 'pres.credits' || el.bind?.startsWith('pres.meta.');
/** The box showing the slide's words that the Theme tab edits; kept, since a theme can't lose it. */
const isMain = el => el === mainText(asTemplate()) && els().filter(e => e.type === 'text' && e.bind === 'slide.text').length < 2;

// ---------- opening and closing ----------
/** Open the editor on the theme the selected presentation shows with. */
export function openLayoutEditor() {
  const p = getPres(state.selectedId), t = templateFor(p);
  targetId = t.id || null;
  draft = structuredClone(t.layout);
  draft.elements.forEach(e => { e.id ||= uid(); });
  hist = history(draft);
  selId = mainText(asTemplate())?.id || null;
  presId = flat(p).some(s => !s.slide.layout) ? p.id : null;
  slideIdx = 0;
  const users = state.db.presentations.filter(q => templateFor(q) === t).length;
  $('#leTitle').textContent = `Theme: ${t.name || 'Default style'}`;
  $('#leUsers').textContent = `· used by ${users}`;
  $('#leUsers').title = `${users} presentation${users === 1 ? '' : 's'} show with this theme`;
  presOptions();
  $('#layoutEditor').hidden = false;
  fitCanvas(); renderAll();
}
function close() { $('#layoutEditor').hidden = true; draft = hist = null; drag = null; }
function cancel() {
  if (hist?.changed && !confirm('Throw away your changes to this theme?')) return;
  close();
}
// The theme is looked up again, since the library may have been reloaded from the server while the editor was open.
function saveLayout() {
  const t = targetId ? findTemplate(targetId) : state.db.baseTemplate;
  if (!t) { toast('That theme was deleted meanwhile: save it as a new one'); return; }
  t.layout = structuredClone(draft);
  save(); broadcast(); renderGrid(); renderTheme(); close();
  toast(`Saved theme “${t.name || 'Default style'}”`);
}
function saveAsNew() {
  const name = (prompt('Name for the new theme:', '') || '').trim(); if (!name) return;
  const base = (targetId ? findTemplate(targetId) : state.db.baseTemplate) || {};
  const { id: _i, name: _n, ...rest } = structuredClone(base);
  addTemplate({ ...rest, layout: structuredClone(draft), id: uid(), name });
  broadcast(); renderGrid(); close();
  toast(`Saved theme “${name}”`);
}

// ---------- the preview slide ----------
function presOptions() {
  const s = $('#lePres'); s.innerHTML = '';
  s.add(new Option('Sample words', ''));
  [...state.db.presentations].filter(p => flat(p).some(x => !x.slide.layout)).sort((a, b) => a.name.localeCompare(b.name))
    .forEach(p => s.add(new Option(p.name, p.id)));
  s.value = presId || '';
}
const binUrl = id => mediaUrl('bin:' + id);
/** The slides of the preview presentation drawn with the draft, each { slide, group, elements, bg }. */
function previewSlides() {
  const p = presId && getPres(presId);
  const list = p ? flat(p).filter(s => !s.slide.layout) : [SAMPLE];
  const pres = p || SAMPLE.pres;
  return list.map((s, index) => ({ ...s, elements: resolveSlide(s.slide, { template: asTemplate(), pres, group: s.group, index,
    count: list.length, bin: binUrl, licence: state.db.ccliLicence, showCredits: state.db.showCredits !== false }),
    bg: (p && slideBackground(p, s.slide)) || DEFAULT_BG }));
}

// ---------- drawing ----------
function fitCanvas() {
  const wrap = $('#leWrap'), w = wrap.clientWidth - 32, h = wrap.clientHeight - 32;
  if (w <= 0 || h <= 0) return;
  scale = Math.min(w / W, h / H);
  Object.assign($('#leCanvas').style, { width: W * scale + 'px', height: H * scale + 'px' });
  if (draft) renderOverlay();
}
function renderAll() { renderCanvas(); renderOverlay(); renderLayers(); renderInspector(); renderStrip(); renderButtons(); }
function renderButtons() { $('#leUndo').disabled = !hist.canUndo; $('#leRedo').disabled = !hist.canRedo; }
let frameReq = 0;
function renderCanvas() {
  cancelAnimationFrame(frameReq);
  frameReq = requestAnimationFrame(() => {
    const slides = previewSlides(), s = slides[Math.min(slideIdx, slides.length - 1)];
    PP.update(screen, { bg: s.bg, slide: { elements: s.elements } }, { animate: false, still: true });
  });
}

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const px = v => v * scale + 'px';
function renderOverlay(guides = { x: [], y: [] }) {
  const ov = $('#leOverlay'); ov.innerHTML = '';
  const safe = document.createElement('div'); safe.className = 'le-safe';
  Object.assign(safe.style, { left: px(SAFE.x), top: px(SAFE.y), width: px(SAFE.w), height: px(SAFE.h) });
  ov.appendChild(safe);
  for (const el of els()) {
    if (el.hidden) continue;
    const f = el.frame, d = document.createElement('div');
    d.className = 'le-box' + (el.id === selId ? ' sel' : '') + (el.locked ? ' locked' : '');
    Object.assign(d.style, { left: px(f.x), top: px(f.y), width: px(f.w), height: px(f.h),
      transform: f.rotate ? `rotate(${f.rotate}deg)` : '' });
    if (el.id === selId && !el.locked) {
      for (const h of HANDLES) { const i = document.createElement('i'); i.className = 'le-h le-' + h; i.dataset.handle = h; d.appendChild(i); }
      const r = document.createElement('i'); r.className = 'le-rot'; r.dataset.handle = 'rotate'; r.title = 'Rotate (Shift for 15° steps)';
      d.appendChild(r);
      const b = document.createElement('span'); b.className = 'le-badge';
      b.textContent = `${elementName(el)} · ${f.w} × ${f.h}` + (f.rotate ? ` · ${f.rotate}°` : '');
      d.appendChild(b);
    }
    ov.appendChild(d);
  }
  for (const x of guides.x) ov.insertAdjacentHTML('beforeend', `<div class="le-guide v" style="left:${px(x)}"></div>`);
  for (const y of guides.y) ov.insertAdjacentHTML('beforeend', `<div class="le-guide h" style="top:${px(y)}"></div>`);
}

const ICON = { text: 'T', image: '▣', video: '▶', shape: '■' };
function renderLayers() {
  const ul = $('#leLayers'); ul.innerHTML = '';
  if (state.db.showCredits !== false && !els().some(placesCredits)) {
    const li = document.createElement('li'); li.className = 'auto';
    li.innerHTML = '<span class="k">T</span><span class="n">Song credits<small>Last slide, automatic</small></span><button class="btn small-btn" title="Add the credits to the theme to move and style them">Place</button>';
    li.querySelector('button').onclick = () => {
      const el = { ...structuredClone(CREDITS_ELEMENT), id: uid(), name: 'Song credits' };
      els().push(el); selId = el.id; commit(); renderAll();
    };
    ul.appendChild(li);
  }
  [...els()].reverse().forEach(el => {
    const li = document.createElement('li');
    li.className = (el.id === selId ? 'sel' : '') + (el.hidden ? ' off' : '');
    li.draggable = true; li.dataset.id = el.id;
    const bound = el.type === 'text' && el.bind ? BINDS.find(([b]) => b === el.bind)?.[1] : '';
    const what = bound && el.name && bound.toLowerCase() !== el.name.toLowerCase() ? bound : '';
    const when = el.showOn === 'first' ? 'First slide' : el.showOn === 'last' ? 'Last slide' : '';
    li.innerHTML = `<span class="k"></span><span class="n"><span></span><small></small></span>` +
      `<button class="le-tog" data-k="hidden" title="Show or hide">${el.hidden ? '◌' : '👁'}</button>` +
      `<button class="le-tog" data-k="locked" title="Lock in place">${el.locked ? '🔒' : '🔓'}</button>`;
    li.querySelector('.k').textContent = el.type === 'shape' && el.kind === 'ellipse' ? '●' : ICON[el.type] || '?';
    li.querySelector('.n span').textContent = elementName(el);
    li.querySelector('small').textContent = [what, when].filter(Boolean).join(' · ');
    li.onclick = e => {
      const k = e.target.dataset.k;
      if (k) { if (el[k]) delete el[k]; else el[k] = true; commit(); renderAll(); return; }
      select(el.id);
    };
    li.ondragstart = e => { e.dataTransfer.setData('text/x-lumen-layer', el.id); e.dataTransfer.effectAllowed = 'move'; };
    li.ondragover = e => { if (e.dataTransfer.types.includes('text/x-lumen-layer')) { e.preventDefault(); li.classList.add('over'); } };
    li.ondragleave = () => li.classList.remove('over');
    li.ondrop = e => {
      e.preventDefault(); li.classList.remove('over');
      const id = e.dataTransfer.getData('text/x-lumen-layer'), from = els().findIndex(x => x.id === id), to = els().indexOf(el);
      if (from < 0 || from === to) return;
      const [moved] = els().splice(from, 1); els().splice(to, 0, moved);
      commit(); renderAll();
    };
    ul.appendChild(li);
  });
  ul.insertAdjacentHTML('beforeend', '<li class="bg"><span class="k">▦</span><span class="n">Background<small>From each song</small></span></li>');
}

let stripTimer;
function renderStrip() {
  clearTimeout(stripTimer);
  stripTimer = setTimeout(() => {
    const box = $('#leStrip'); box.innerHTML = '';
    const slides = previewSlides(), p = presId && getPres(presId);
    let shrunk = 0;
    slides.slice(0, 60).forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'le-thumb' + (i === slideIdx ? ' sel' : '');
      card.innerHTML = '<div></div><div class="cap"><span class="dot"></span><span></span></div>';
      card.querySelector('.dot').style.background = s.color || '#4f8cff';
      card.querySelector('.cap span:last-child').textContent = s.group;
      card.onclick = () => { slideIdx = i; renderCanvas(); $$('#leStrip .le-thumb').forEach((c, j) => c.classList.toggle('sel', j === i)); };
      box.appendChild(card);
      const scr = PP.createScreen(card.firstChild);
      PP.update(scr, { bg: s.bg, slide: { elements: s.elements } }, { animate: false, still: true });
      // The renderer shrinks words that don't fit their box: say so, with the size they came down to.
      const drawn = scr.querySelector('.pp-slideL').children;
      const small = s.elements.map((e, j) => e.type === 'text' && parseFloat(drawn[j]?.firstChild?.style.fontSize) < e.style.size
        ? parseFloat(drawn[j].firstChild.style.fontSize) : 0).filter(Boolean);
      if (small.length) {
        shrunk++;
        card.querySelector('.cap').insertAdjacentHTML('beforeend', '<span class="warn"></span>');
        card.querySelector('.warn').textContent = `· shrunk to ${Math.min(...small)} px`;
      }
    });
    $('#leStripH').textContent = (p ? `Every slide in ${p.name}` : 'Sample words')
      + (shrunk ? ` · ${shrunk} shrunk to fit` : '') + (slides.length > 60 ? ` · first 60 of ${slides.length}` : '');
  }, 150);
}

// ---------- the inspector ----------
const node = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const field = (label, input, cls = '') => node('label', { className: 'le-f ' + cls }, node('span', { textContent: label }), input);
// An input that changes the element as it is used, recording one undo step when it is let go of.
function input(type, value, apply, props = {}) {
  const i = node('input', { type, value: value ?? '', ...props });
  i.oninput = () => { apply(type === 'number' ? (i.value === '' ? null : +i.value) : i.value); live(); };
  i.onchange = () => { commit(); relabel(); };
  return i;
}
function choice(options, value, apply) {
  const s = node('select');
  options.forEach(([v, t]) => s.add(new Option(t, v)));
  s.value = value ?? '';
  s.onchange = () => { apply(s.value); commit(); renderAll(); };
  return s;
}
function check(label, on, apply) {
  const c = node('input', { type: 'checkbox', checked: !!on });
  c.onchange = () => { apply(c.checked); commit(); renderCanvas(); };
  return node('label', { className: 'le-chk' }, c, label);
}
function seg(options, value, apply) {
  const d = node('div', { className: 'seg' });
  options.forEach(([v, t]) => {
    const b = node('button', { textContent: t, className: v === value ? 'on' : '', type: 'button' });
    b.onclick = () => { apply(v); commit(); renderCanvas(); [...d.children].forEach(x => x.classList.toggle('on', x === b)); };
    d.append(b);
  });
  return d;
}
// A colour with an opacity, kept as one CSS colour; `none` (when given) is a checkbox for no colour at all.
function colour(value, apply, none) {
  const c = parseColor(value || '#000000');
  const pick = node('input', { type: 'color', value: c.hex });
  const pct = node('input', { type: 'number', min: 0, max: 100, step: 5, value: Math.round(c.alpha * 100), title: 'Opacity %' });
  const set = () => { apply(toColor(pick.value, Math.max(0, Math.min(100, +pct.value)) / 100)); live(); };
  pick.oninput = pct.oninput = set;
  pick.onchange = pct.onchange = () => commit();
  const row = node('div', { className: 'le-colour' }, pick, pct, node('span', { className: 'muted small', textContent: '%' }));
  if (!none) return row;
  const on = node('input', { type: 'checkbox', checked: !!value });
  const toggle = () => { pick.disabled = pct.disabled = !on.checked; };
  on.onchange = () => { if (on.checked) set(); else { apply(null); live(); } toggle(); commit(); };
  toggle();
  return node('div', { className: 'le-colour' }, node('label', { className: 'le-chk' }, on, none), row);
}
const fonts = () => [...$('#thFont').options].map(o => [o.value, o.textContent]);

function renderInspector() {
  const box = $('#leInspector'); box.innerHTML = '';
  const el = sel();
  if (!el) {
    box.append(node('p', { className: 'muted', textContent: 'Click something on the canvas or in the layers list to change it, or add a text box, shape, picture or video from the toolbar.' }),
      node('p', { className: 'muted small', textContent: 'Arrow keys nudge the selected element by 1 pixel (10 with Shift). Alt while dragging turns snapping off. Ctrl+Z undoes, Ctrl+D duplicates, Delete removes.' }));
    return;
  }
  const f = el.frame, st = el.style || {};
  const setF = k => v => { if (v == null) return; f[k] = Math.round(v); if (k === 'rotate' && !v) delete f.rotate; };
  const setS = k => v => { el.style = { ...el.style, [k]: v }; };
  const head = node('div', { className: 'le-head' },
    input('text', el.name || '', v => { if (v.trim()) el.name = v; else delete el.name; }, { placeholder: elementName({ ...el, name: '' }), className: 'le-name' }),
    node('button', { className: 'btn small-btn', textContent: 'Duplicate', title: 'Ctrl+D', onclick: duplicate }),
    node('button', { className: 'btn small-btn ghost danger', textContent: 'Delete', disabled: isMain(el),
      title: isMain(el) ? 'Every theme keeps a box for the slide’s words: hide it instead' : 'Delete', onclick: remove }));
  box.append(head);
  if (el.type === 'text') {
    box.append(field('Shows', choice(BINDS, el.bind || '', v => { if (v) el.bind = v; else { delete el.bind; el.content ||= 'Text'; } })));
    if (isMain(el)) box.lastChild.querySelector('select').disabled = true;
    if (!el.bind) box.append(field('Words', (() => {
      const t = node('textarea', { rows: 3, value: el.content || '', id: 'leContent' });
      t.oninput = () => { el.content = t.value; live(); }; t.onchange = () => { commit(); relabel(); };
      return t;
    })()));
  }
  box.append(node('div', { className: 'sub-h', textContent: 'Position' }),
    node('div', { className: 'le-grid4' }, field('X', input('number', f.x, setF('x'), { id: 'leX' })), field('Y', input('number', f.y, setF('y'), { id: 'leY' })),
      field('W', input('number', f.w, setF('w'), { id: 'leW', min: 20 })), field('H', input('number', f.h, setF('h'), { id: 'leH', min: 20 }))),
    node('div', { className: 'le-grid2' }, field('Rotate °', input('number', f.rotate || 0, setF('rotate'), { id: 'leR', min: -180, max: 180 })),
      field('Opacity %', input('number', Math.round((el.opacity ?? 1) * 100), v => { if (v == null || v >= 100) delete el.opacity; else el.opacity = Math.max(0, v) / 100; }, { min: 0, max: 100, step: 5 })),
      field('Show on', choice([['', 'Every slide'], ['first', 'First slide'], ['last', 'Last slide']], el.showOn || '', v => { if (v) el.showOn = v; else delete el.showOn; }))));
  if (el.type === 'text') {
    const fontList = fonts();
    if (!fontList.some(([v]) => v === st.font)) fontList.push([st.font, String(st.font).split(',')[0].replace(/'/g, '')]);
    box.append(node('div', { className: 'sub-h', textContent: 'Text' }),
      node('div', { className: 'le-grid2' }, field('Font', choice(fontList, st.font, setS('font'))), field('Size', input('number', st.size, v => v && setS('size')(v), { min: 10, max: 400 })),
        field('Colour', input('color', parseColor(st.color).hex, setS('color'))), field('Line height', input('number', st.lineHeight ?? 1.2, v => v && setS('lineHeight')(v), { min: 0.6, max: 3, step: 0.05 })),
        field('Letter spacing', input('number', st.letterSpacing || 0, v => setS('letterSpacing')(v || 0), { min: -20, max: 60 })),
        field('Padding', input('number', st.padding || 0, v => setS('padding')(v || 0), { min: 0, max: 300 }))),
      node('div', { className: 'le-checks' }, check('Bold', (st.weight || 400) >= 600, v => setS('weight')(v ? 700 : 400)), check('Italic', st.italic, setS('italic')),
        check('Capitals', st.upper, setS('upper')), check('Shadow', st.shadow, setS('shadow')),
        check('Outline', st.outline, v => setS('outline')(v ? { width: 3, color: '#000000' } : undefined))),
      node('div', { className: 'le-row le-segs' }, seg([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], st.align || 'center', setS('align')),
        seg([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], st.valign || 'middle', setS('valign'))),
      field('Too long for the box', choice([['shrink', 'Shrink to fit'], ['none', 'Leave as it is']], st.fit || 'shrink', setS('fit'))),
      field('Box behind the words', colour(el.fill, v => { if (v) el.fill = v; else delete el.fill; }, 'Fill')));
  }
  if (el.type === 'shape') {
    box.append(node('div', { className: 'sub-h', textContent: 'Shape' }),
      field('Kind', choice([['rect', 'Rectangle'], ['ellipse', 'Circle or oval']], el.kind || 'rect', v => { el.kind = v; })),
      field('Fill', colour(el.fill, v => { if (v) el.fill = v; else delete el.fill; }, 'Fill')),
      node('div', { className: 'le-grid2' },
        field('Border px', input('number', el.stroke?.width || 0, v => { if (v > 0) el.stroke = { color: '#ffffff', ...el.stroke, width: v }; else delete el.stroke; }, { min: 0, max: 60 })),
        field('Border colour', input('color', parseColor(el.stroke?.color || '#ffffff').hex, v => { el.stroke = { width: 2, ...el.stroke, color: v }; }))));
    if (el.kind !== 'ellipse') box.append(field('Rounded corners px', input('number', el.radius || 0, v => { if (v > 0) el.radius = v; else delete el.radius; }, { min: 0, max: 540 })));
  }
  if (el.type === 'image' || el.type === 'video') {
    const name = String(el.src || '').replace(/^(media|folder|bin):/, '').split('/').pop();
    const bin = state.db.media.filter(m => m.type === el.type);
    box.append(node('div', { className: 'sub-h', textContent: el.type === 'image' ? 'Picture' : 'Video' }),
      node('div', { className: 'le-row' }, node('span', { className: 'muted small le-src', textContent: name || 'None' }),
        node('button', { className: 'btn small-btn', textContent: 'Replace…', onclick: () => pickFile(el.type, ref => { el.src = ref; commit(); renderAll(); }) })));
    if (bin.length) box.append(field('From the media bin', choice([['', 'Choose…'], ...bin.map(m => [m.id, m.name])], '', id => {
      const m = bin.find(x => x.id === id); if (m) el.src = toRef(Lumen.online ? m.src : '#' + m.id);
    })));
    box.append(field('Fit', choice([['contain', 'Fit inside'], ['cover', 'Fill and crop'], ['stretch', 'Stretch']], el.fit || 'contain', v => { el.fit = v; })));
  }
}
// Only the position fields follow a drag, so the rest of the inspector keeps its place.
function syncFrameFields() {
  const f = sel()?.frame; if (!f) return;
  for (const [id, v] of [['#leX', f.x], ['#leY', f.y], ['#leW', f.w], ['#leH', f.h], ['#leR', f.rotate || 0]]) { const i = $(id); if (i) i.value = v; }
}

// The selected element's name in the layers list, changed in place: rebuilding the list as a field loses focus would
// swallow a click on it.
function relabel() {
  const li = selId && document.querySelector(`#leLayers li[data-id="${CSS.escape(selId)}"] .n span`);
  if (li) li.textContent = elementName(sel());
}

// ---------- changes ----------
function live() { renderCanvas(); renderOverlay(); }
function commit() { if (hist.push(draft)) renderButtons(); renderStrip(); }
function select(id) { selId = id; renderOverlay(); renderLayers(); renderInspector(); }
function restore(v) { if (!v) return; draft = v; if (!sel()) selId = null; renderAll(); }
function add(el) { els().push(el); selId = el.id; commit(); renderAll(); }
function duplicate() {
  const el = sel(); if (!el) return;
  const copy = { ...structuredClone(el), id: uid(), frame: { ...el.frame, x: el.frame.x + 40, y: el.frame.y + 40 } };
  delete copy.name; delete copy.locked;
  // A second box of the slide's words is rarely wanted: the copy starts as its own text.
  if (copy.bind === 'slide.text') { delete copy.bind; copy.content = 'Text'; }
  els().splice(els().indexOf(el) + 1, 0, copy); selId = copy.id; commit(); renderAll();
}
function remove() {
  const el = sel(); if (!el || isMain(el)) return;
  draft.elements = els().filter(e => e !== el); selId = null; commit(); renderAll();
}
function arrange(how) { if (selId) { draft.elements = reorder(els(), selId, how); commit(); renderAll(); } }
function align(how) { const el = sel(); if (el && !el.locked) { el.frame = alignFrame(el.frame, how); commit(); live(); syncFrameFields(); } }
function nudge(dx, dy) { const el = sel(); if (el && !el.locked) { el.frame = { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy }; commit(); live(); syncFrameFields(); } }

// A picture or video from a file: stored as the slides' media are, and handed back as a media reference.
let pickDone = null;
function pickFile(type, done) {
  const f = $('#leFile'); f.accept = type + '/*'; pickDone = done; f.click();
}
async function filePicked(e) {
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !pickDone) return;
  try { const ref = toRef(await storeSlideMedia(file)); if (!Lumen.online) save(); pickDone(ref); }
  catch (err) { toast(`Could not add ${file.name}: ${err.message || 'read failed'}`); }
  pickDone = null;
}

// ---------- the pointer on the canvas ----------
function toCanvas(e) {
  const r = $('#leCanvas').getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
function pointerDown(e) {
  if (e.button !== 0) return;
  const pt = toCanvas(e), handle = e.target.dataset.handle;
  let el = handle ? sel() : elementAt(els(), pt.x, pt.y);
  if (!handle) { if ((el?.id || null) !== selId) select(el?.id || null); }
  if (!el || el.locked) return;
  const others = els().filter(o => o !== el && !o.hidden).map(o => o.frame);
  drag = { el, handle: handle || 'move', start: pt, frame: { ...el.frame }, lines: snapLines(others) };
  $('#leOverlay').setPointerCapture(e.pointerId);
  e.preventDefault();
}
function pointerMove(e) {
  if (!drag) return;
  const pt = toCanvas(e), { el, handle, frame: f } = drag;
  let dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
  const within = e.altKey || f.rotate ? 0 : SNAP_PX / scale;
  let r;
  if (handle === 'move') r = moveFrame(f, dx, dy, drag.lines, e.altKey ? 0 : SNAP_PX / scale);
  else if (handle === 'rotate') {
    const deg = rotation(f, pt.x, pt.y, e.shiftKey ? 15 : 0);
    r = { frame: { ...f, rotate: deg }, guides: { x: [], y: [] } };
    if (!deg) delete r.frame.rotate;
  } else {
    // A turned element is resized along its own sides.
    const a = (f.rotate || 0) * Math.PI / 180;
    [dx, dy] = [dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)];
    r = resizeFrame(f, handle, dx, dy, { keepRatio: e.shiftKey || el.type === 'image', lines: drag.lines, within });
  }
  el.frame = r.frame; drag.moved = true;
  renderCanvas(); renderOverlay(r.guides); syncFrameFields();
}
function pointerUp() {
  if (!drag) return;
  const moved = drag.moved; drag = null;
  renderOverlay();
  if (moved) commit();
}

// ---------- keys ----------
function keyDown(e) {
  if ($('#layoutEditor').hidden) return;
  const mod = e.ctrlKey || e.metaKey, typing = e.target.matches('input, textarea, select');
  if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveLayout(); return; }
  if (typing) return;
  const k = e.key.toLowerCase(), step = e.shiftKey ? 10 : 1;
  const map = {
    z: mod && (() => restore(e.shiftKey ? hist.redo() : hist.undo())), y: mod && (() => restore(hist.redo())),
    d: mod && duplicate, delete: remove, backspace: remove,
    arrowleft: () => nudge(-step, 0), arrowright: () => nudge(step, 0), arrowup: () => nudge(0, -step), arrowdown: () => nudge(0, step),
  };
  if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); }
}

/** Wire up the layout editor; called once the library has loaded. */
export function setupLayoutEditor() {
  screen = PP.createScreen($('#leScreen'));
  $('#thLayout').onclick = openLayoutEditor;
  $('#leCancel').onclick = cancel;
  $('#leSave').onclick = saveLayout;
  $('#leSaveAs').onclick = saveAsNew;
  $('#leUndo').onclick = () => restore(hist.undo());
  $('#leRedo').onclick = () => restore(hist.redo());
  document.querySelectorAll('#layoutEditor [data-add]').forEach(b => b.onclick = () => {
    const type = b.dataset.add;
    if (type === 'image' || type === 'video') pickFile(type, ref => add(newElement(type, uid(), ref)));
    else add(newElement(type, uid()));
  });
  $('#leFile').onchange = filePicked;
  $('#leAlign').onchange = e => { align(e.target.value); e.target.value = ''; };
  $('#leOrder').onchange = e => { arrange(e.target.value); e.target.value = ''; };
  $('#lePres').onchange = e => { presId = e.target.value || null; slideIdx = 0; renderCanvas(); renderStrip(); };
  const ov = $('#leOverlay');
  ov.onpointerdown = pointerDown; ov.onpointermove = pointerMove; ov.onpointerup = ov.onpointercancel = pointerUp;
  ov.ondblclick = () => { const t = $('#leContent'); if (t) { t.focus(); t.select(); } };
  new ResizeObserver(fitCanvas).observe($('#leWrap'));
  document.addEventListener('keydown', keyDown, true);
}
