// The layout editor: a theme's, or one slide's, text boxes, shapes, pictures and videos placed on a canvas drawn by
// the screens' own renderer, with a layers list, an inspector, its background, and every slide of a song shown along
// the bottom. It works on a copy, and the theme or slide changes (and the projector with it) only on Save.
import { $, $$, toast } from './dom.js';
import { CREDITS_ELEMENT, H, mainText, resolveSlide, templateLayout, toRef, W } from './format.js';
import { alignFrame, BINDS, designFrom, designWords, elementAt, elementName, gradient, history, moveFrame, newElement,
  parseColor, parseGradient, reorder, resizeFrame, rotation, snapLines, toColor, SAFE } from './layout-model.js';
import { bgUrl, findTemplate, flat, fontValue, getPres, mediaUrl, save, slideBackground, state, templateFor } from './library.js';
import { broadcast } from './live.js';
import { pickFont, storeSlideMedia } from './media.js';
import { uid } from './slides.js';
import { ADD_FONT, addTemplate, fontChoices, renderTheme } from './themes.js';
import { renderGrid } from './views.js';
import { wordBar } from './word-bar.js';

// doc is what is being edited, { layout, background, layouts }. In 'theme' mode targetId names the theme (null for
// the default style), and cur the layout of it being edited: '' for its main one, or the id of one of its other
// layouts. In 'slide' mode target is { presId, slideId, after }, after meaning a new slide to go after that one.
let doc = null, hist = null, mode = 'theme', targetId = null, target = null, cur = '';
let selId = null, presId = null, slideIdx = 0, scale = 0.4, drag = null;
let screen = null;
const BG = '__background'; // selId while the background is being edited
const curLayout = () => (cur && doc.layouts?.find(l => l.id === cur)?.layout) || doc.layout;
const els = () => curLayout().elements;
const sel = () => els().find(e => e.id === selId) || null;
const asTemplate = () => ({ layout: doc.layout, layouts: doc.layouts });
const SNAP_PX = 7; // how near, on screen, an edge comes to a line before it snaps
const DEFAULT_BG = { type: 'gradient', src: 'linear-gradient(160deg,#1b2030,#0d0f15)' };
const SAMPLE = { slide: { text: 'Amazing grace! How sweet the sound\nThat saved a wretch like me!' }, group: 'Verse 1',
  pres: { name: 'Song title', meta: { author: 'Written by', copyright: 'Copyright', ccli: '22025' } } };
const placesCredits = el => el.bind === 'pres.credits' || el.bind?.startsWith('pres.meta.');
/** The box showing the slide's words that the Theme tab edits; kept, since a theme can't lose it. */
const isMain = el => mode === 'theme' && !cur && el === mainText(asTemplate())
  && els().filter(e => e.type === 'text' && e.bind === 'slide.text').length < 2;

// ---------- opening and closing ----------
/** Open the editor on the theme the selected presentation shows with. */
export function openLayoutEditor() {
  const p = getPres(state.selectedId), t = templateFor(p);
  mode = 'theme'; targetId = t.id || null; target = null; cur = '';
  start({ layout: structuredClone(t.layout), background: structuredClone(t.background || null),
    layouts: structuredClone(t.layouts || []) });
  selId = mainText(asTemplate())?.id || null;
  presId = flat(p).some(s => !s.slide.layout) ? p.id : null;
  slideIdx = firstThemed();
  const users = state.db.presentations.filter(q => templateFor(q) === t).length;
  show(`Theme: ${t.name || 'Default style'}`, `· used by ${users}`,
    `${users} presentation${users === 1 ? '' : 's'} show with this theme`);
}
/** Open the editor on one slide of a presentation, to give it its own design; with `after`, on a new slide to go
 * after it. A slide without a design yet starts from its theme, with its words in the theme's text box. */
export function openSlideDesign(pid, slideId, { after = false } = {}) {
  const p = getPres(pid), at = flat(p).findIndex(s => s.slide.id === slideId);
  if (at < 0) return;
  const slide = after ? null : flat(p)[at].slide;
  mode = 'slide'; target = { presId: pid, slideId, after }; targetId = null; cur = '';
  const from = templateLayout(templateFor(p), (slide || flat(p)[at].slide).layoutId);
  start({ layout: slide?.layout ? structuredClone(slide.layout) : designFrom(from, slide?.text, uid),
    background: structuredClone(slide?.background || null) });
  selId = els().find(e => e.type === 'text' && !e.bind)?.id || null;
  presId = pid; slideIdx = after ? at + 1 : at;
  show(p.name, after ? '· a new slide with its own design' : `· slide ${at + 1}, its own design`,
    'Only this slide changes; the rest of the presentation keeps its theme');
}
function start(d) {
  doc = d;
  for (const layout of [doc.layout, ...(doc.layouts || []).map(l => l.layout)]) layout.elements.forEach(e => { e.id ||= uid(); });
  hist = history(doc);
}
function show(title, sub, tip) {
  $('#leTitle').textContent = title;
  $('#leUsers').textContent = sub; $('#leUsers').title = tip;
  $('#leSave').textContent = mode === 'theme' ? 'Save theme' : 'Save slide';
  $('#layoutEditor').classList.toggle('le-slide', mode === 'slide');
  presOptions();
  $('#layoutEditor').hidden = false;
  fitCanvas(); renderAll();
}
function close() { $('#layoutEditor').hidden = true; doc = hist = null; drag = null; }
function cancel() {
  if (hist?.changed && !confirm(`Throw away your changes to this ${mode}?`)) return;
  close();
}
function saveLayout() { if (mode === 'theme') saveTheme(); else saveSlide(); }
// The theme is looked up again, since the library may have been reloaded from the server while the editor was open.
function saveTheme() {
  const t = targetId ? findTemplate(targetId) : state.db.baseTemplate;
  if (!t) { toast('That theme was deleted meanwhile: save it as a new one'); return; }
  t.layout = structuredClone(doc.layout);
  if (doc.layouts.length) t.layouts = structuredClone(doc.layouts); else delete t.layouts;
  if (doc.background) t.background = structuredClone(doc.background); else delete t.background;
  save(); broadcast(); renderGrid(); renderTheme(); close();
  toast(`Saved theme “${t.name || 'Default style'}”`);
}
function saveAsNew() {
  const name = (prompt('Name for the new theme:', '') || '').trim(); if (!name) return;
  const base = (targetId ? findTemplate(targetId) : state.db.baseTemplate) || {};
  const { id: _i, name: _n, ...rest } = structuredClone(base);
  const t = { ...rest, layout: structuredClone(doc.layout), id: uid(), name };
  if (doc.layouts.length) t.layouts = structuredClone(doc.layouts); else delete t.layouts;
  if (doc.background) t.background = structuredClone(doc.background); else delete t.background;
  addTemplate(t);
  broadcast(); renderGrid(); close();
  toast(`Saved theme “${name}”`);
}

// A designed slide keeps its words as its text too, for search and the stage display, and to go back to if it
// uses its theme again. Its picture or video from the text editor stays as it was, behind the design.
function saveSlide() {
  const p = getPres(target.presId), g = p?.groups.find(x => x.slides.some(s => s.id === target.slideId));
  if (!g) { toast('That slide was removed meanwhile'); return; }
  const i = g.slides.findIndex(s => s.id === target.slideId);
  let slide = g.slides[i];
  if (target.after) { slide = { id: uid() }; g.slides.splice(i + 1, 0, slide); }
  slide.layout = structuredClone(doc.layout);
  if (doc.background) slide.background = structuredClone(doc.background); else delete slide.background;
  const words = designWords(doc.layout);
  if (words) slide.text = words; else delete slide.text;
  save(); broadcast(); renderGrid(); close();
  toast(target.after ? 'Added a designed slide' : 'Saved the slide’s design');
}
/** Give a designed slide back to its theme: it shows its words with the theme again. */
export function useThemeAgain(pid, slideId) {
  const slide = getPres(pid)?.groups.flatMap(g => g.slides).find(s => s.id === slideId);
  if (!slide?.layout || !confirm('Throw away this slide’s design and show its words with the theme again?')) return;
  delete slide.layout; delete slide.background;
  save(); broadcast(); renderGrid();
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
/** The slides of the preview presentation drawn with the draft, each { slide, group, elements, bg, other }. A theme
 * shows on the slides that use it; a slide's design shows in its place among the presentation's other slides. */
function previewSlides() {
  const p = presId && getPres(presId);
  const opts = { bin: binUrl, licence: state.db.ccliLicence, showCredits: state.db.showCredits !== false };
  if (mode === 'slide') {
    const list = flat(p).map(s => ({ ...s, other: true }));
    const mine = { layout: doc.layout, background: doc.background };
    if (target.after) list.splice(slideIdx, 0, { ...list[slideIdx - 1], slide: { id: '', ...mine }, other: false });
    else list.forEach(s => { if (s.slide.id === target.slideId) Object.assign(s, { slide: { ...s.slide, ...mine }, other: false }); });
    return list.map((s, index) => ({ ...s, elements: resolveSlide(s.slide, { ...opts, template: templateFor(p), pres: p,
      group: s.group, index, count: list.length }), bg: slideBackground(p, s.slide) || DEFAULT_BG }));
  }
  // Slides with their own design, or that show with another of the theme's layouts, show as they are, dimmed, so
  // none seems to go missing. Sample words stand in when no slide uses the layout being edited.
  const list = p ? flat(p).map(s => ({ ...s, other: !!s.slide.layout || layoutOf(s.slide) !== cur })) : [];
  const sample = { ...SAMPLE, sample: true, slide: { ...SAMPLE.slide, layoutId: cur || undefined } };
  if (!list.some(s => !s.other)) list.unshift(sample);
  return list.map((s, index) => ({ ...s, elements: resolveSlide(s.slide, { ...opts, template: asTemplate(), pres: p || SAMPLE.pres,
    group: s.group, index, count: list.length }),
    bg: bgUrl(s.slide.background || p?.background || (s.slide.layout ? null : doc.background)) || DEFAULT_BG }));
}
/** Which of the theme's layouts a slide shows with: '' for the main one. */
const layoutOf = slide => (slide.layoutId && doc.layouts?.some(l => l.id === slide.layoutId) ? slide.layoutId : '');
/** The first slide the theme shows on, to preview it with. */
const firstThemed = () => Math.max(0, previewSlides().findIndex(s => !s.other));

// ---------- drawing ----------
function fitCanvas() {
  const wrap = $('#leWrap'), w = wrap.clientWidth - 32, h = wrap.clientHeight - 32;
  if (w <= 0 || h <= 0) return;
  scale = Math.min(w / W, h / H);
  Object.assign($('#leCanvas').style, { width: W * scale + 'px', height: H * scale + 'px' });
  if (doc) renderOverlay();
}
function renderAll() { renderCanvas(); renderOverlay(); renderLayouts(); renderLayers(); renderInspector(); renderStrip(); renderButtons(); }
function renderButtons() { $('#leUndo').disabled = !hist.canUndo; $('#leRedo').disabled = !hist.canRedo; }
let frameReq = 0;
function renderCanvas() {
  cancelAnimationFrame(frameReq);
  frameReq = requestAnimationFrame(() => {
    if (!doc) return; // closed meanwhile
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

// A theme's layouts: its main one, which most slides show with, and others a slide can pick (a title, say).
function renderLayouts() {
  const ul = $('#leLayoutList'); ul.innerHTML = '';
  if (mode !== 'theme') return;
  const theme = targetId ? findTemplate(targetId) : state.db.baseTemplate;
  const uses = id => state.db.presentations.filter(p => templateFor(p) === theme)
    .reduce((n, p) => n + flat(p).filter(s => !s.slide.layout && (s.slide.layoutId || '') === id).length, 0);
  for (const l of [{ id: '', name: 'Main' }, ...doc.layouts]) {
    const li = node('li', { className: l.id === cur ? 'sel' : '' }, node('span', { className: 'k', textContent: '▤' }),
      node('span', { className: 'n' }, node('span', { textContent: l.name }),
        node('small', { textContent: l.id ? `${uses(l.id)} slides · right-click a slide to use it` : 'Every other slide' })));
    if (l.id && l.id === cur) li.append(
      node('button', { className: 'le-tog', textContent: '✎', title: 'Rename', onclick: e => { e.stopPropagation(); renameLayout(l); } }),
      node('button', { className: 'le-tog', textContent: '✕', title: 'Delete this layout', onclick: e => { e.stopPropagation(); deleteLayout(l); } }));
    li.onclick = () => { if (l.id !== cur) showLayout(l.id); };
    ul.appendChild(li);
  }
}
function showLayout(id) {
  cur = id; selId = null; slideIdx = firstThemed();
  renderAll();
}
function addLayout() {
  const name = (prompt('Name for the new layout, such as Title or Scripture:', '') || '').trim(); if (!name) return;
  // It starts as a copy of the one on screen, so it keeps the theme's look.
  const layout = structuredClone(curLayout());
  layout.elements.forEach(e => { e.id = uid(); });
  const l = { id: uid(), name, layout };
  doc.layouts.push(l); commit(); showLayout(l.id);
}
function renameLayout(l) {
  const name = (prompt('Name for this layout:', l.name) || '').trim();
  if (name && name !== l.name) { l.name = name; commit(); renderLayouts(); }
}
function deleteLayout(l) {
  if (!confirm(`Delete the “${l.name}” layout? Slides using it show with the main layout again.`)) return;
  doc.layouts = doc.layouts.filter(x => x !== l); commit(); showLayout('');
}

const ICON = { text: 'T', image: '▣', video: '▶', shape: '■' };
function renderLayers() {
  const ul = $('#leLayers'); ul.innerHTML = '';
  if (mode === 'theme' && state.db.showCredits !== false && !els().some(placesCredits)) {
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
    li.querySelector('.k').textContent = el.type === 'shape' && el.kind === 'ellipse' ? '●' : el.kind === 'line' ? '―' : ICON[el.type] || '?';
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
  const bg = document.createElement('li');
  bg.className = 'bg' + (selId === BG ? ' sel' : '');
  bg.innerHTML = '<span class="k">▦</span><span class="n">Background<small></small></span>';
  bg.querySelector('small').textContent = doc.background ? BG_KINDS.find(([k]) => k === doc.background.type)?.[1] || doc.background.type
    : mode === 'theme' ? 'Each song’s own' : 'The presentation’s';
  bg.onclick = () => select(BG);
  ul.appendChild(bg);
  const media = mode === 'slide' && previewSlides()[slideIdx]?.slide.media;
  if (media) ul.insertAdjacentHTML('beforeend', `<li class="bg"><span class="k">${media.type === 'video' ? '▶' : '▣'}</span>`
    + `<span class="n">The slide’s ${media.type === 'video' ? 'video' : 'picture'}<small>From its @${media.type} line</small></span></li>`);
}

let stripTimer;
function renderStrip() {
  clearTimeout(stripTimer);
  stripTimer = setTimeout(() => {
    if (!doc) return;
    const box = $('#leStrip'); box.innerHTML = '';
    const slides = previewSlides(), p = presId && getPres(presId);
    let shrunk = 0;
    slides.slice(0, 60).forEach((s, i) => {
      const card = document.createElement('div');
      card.className = 'le-thumb' + (i === slideIdx ? ' sel' : '') + (s.other ? ' other' : '');
      card.innerHTML = '<div></div><div class="cap"><span class="dot"></span><span></span></div>';
      card.querySelector('.dot').style.background = s.color || '#4f8cff';
      const which = mode !== 'theme' ? '' : s.slide.layout ? ' ✎' : doc.layouts.length && !s.sample
        ? ' · ' + (doc.layouts.find(l => l.id === layoutOf(s.slide))?.name || 'Main') : '';
      card.querySelector('.cap span:last-child').textContent = s.group + which;
      if (s.slide.layout) card.title = 'This slide has its own design, so the theme doesn’t change it';
      if (mode === 'theme' && !s.other) card.onclick = () => { slideIdx = i; renderCanvas(); $$('#leStrip .le-thumb').forEach((c, j) => c.classList.toggle('sel', j === i)); };
      box.appendChild(card);
      const scr = PP.createScreen(card.firstChild);
      PP.update(scr, { bg: s.bg, slide: { elements: s.elements } }, { animate: false, still: true });
      // The renderer shrinks words that don't fit their box: say so, with the size they came down to.
      const drawn = scr.querySelector('.pp-slideL').children;
      const small = s.elements.map((e, j) => e.type === 'text' && parseFloat(drawn[j]?.firstChild?.style.fontSize) < e.style.size
        ? parseFloat(drawn[j].firstChild.style.fontSize) : 0).filter(Boolean);
      if (small.length && !s.other) {
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
// A fill: none (when `none` names it), a colour with its opacity, or a two-colour gradient.
function paint(value, apply, none) {
  const g = parseGradient(value), kind = !value ? '' : g ? 'gradient' : 'color';
  const kinds = [...none ? [['', none]] : [], ['color', 'Colour'], ['gradient', 'Gradient']];
  const out = [choice(kinds, kind, v => {
    if (!v) apply(null);
    else if (v === 'color') apply(g ? g.from : value || '#ffffff');
    else if (v === 'gradient') apply(gradient({ angle: 90, from: g?.from || (value && parseColor(value).hex) || '#ffd54f', to: '#ff5a5a' }));
  })];
  if (kind === 'color') out.push(colour(value, apply));
  if (kind === 'gradient') {
    const upd = k => v => { if (v == null) return; g[k] = v; apply(gradient(g)); };
    out.push(node('div', { className: 'le-grid3' }, field('From', input('color', parseColor(g.from).hex, upd('from'))),
      field('To', input('color', parseColor(g.to).hex, upd('to'))), field('Angle °', input('number', g.angle, upd('angle'), { min: 0, max: 360, step: 15 }))));
  }
  return node('div', { className: 'le-paint' }, ...out);
}

function renderInspector() {
  const box = $('#leInspector'); box.innerHTML = '';
  if (selId === BG) return renderBackground(box);
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
    box.append(field('Shows', choice(BINDS.filter(([b]) => mode === 'theme' || b !== 'slide.text' || el.bind === b), el.bind || '', v => { if (v) el.bind = v; else { delete el.bind; el.content ||= 'Text'; } })));
    if (isMain(el)) box.lastChild.querySelector('select').disabled = true;
    // Not a label: a click on it would go to the formatting bar's first button.
    if (!el.bind) box.append(node('div', { className: 'le-f' }, node('span', { textContent: 'Words' }), (() => {
      const t = node('textarea', { rows: 4, value: el.content || '', id: 'leContent' });
      t.oninput = () => { el.content = t.value; live(); }; t.onchange = () => { commit(); relabel(); };
      return node('div', { className: 'le-words' }, wordBar(t, () => { commit(); relabel(); }), t);
    })()));
  }
  box.append(node('div', { className: 'sub-h', textContent: 'Position' }),
    node('div', { className: 'le-grid4' }, field('X', input('number', f.x, setF('x'), { id: 'leX' })), field('Y', input('number', f.y, setF('y'), { id: 'leY' })),
      field('W', input('number', f.w, setF('w'), { id: 'leW', min: 20 })), field('H', input('number', f.h, setF('h'), { id: 'leH', min: 20 }))),
    node('div', { className: 'le-grid2' }, field('Rotate °', input('number', f.rotate || 0, setF('rotate'), { id: 'leR', min: -180, max: 180 })),
      field('Opacity %', input('number', Math.round((el.opacity ?? 1) * 100), v => { if (v == null || v >= 100) delete el.opacity; else el.opacity = Math.max(0, v) / 100; }, { min: 0, max: 100, step: 5 })),
      field('Show on', choice([['', 'Every slide'], ['first', 'First slide'], ['last', 'Last slide']], el.showOn || '', v => { if (v) el.showOn = v; else delete el.showOn; }))));
  if (el.type === 'text') {
    const fontList = fontChoices();
    if (!fontList.some(([v]) => v === st.font)) fontList.push([st.font, String(st.font).split(',')[0].replace(/'/g, '')]);
    fontList.push([ADD_FONT, 'Add a font…']);
    const setFont = v => {
      if (v !== ADD_FONT) return setS('font')(v);
      pickFont(f => { el.style = { ...el.style, font: fontValue(f) }; commit(); renderAll(); });
    };
    box.append(node('div', { className: 'sub-h', textContent: 'Text' }),
      node('div', { className: 'le-grid2' }, field('Font', choice(fontList, st.font, setFont)), field('Size', input('number', st.size, v => v && setS('size')(v), { min: 10, max: 400 })),
        field('Colour', input('color', parseColor(st.color).hex, setS('color'))), field('Line height', input('number', st.lineHeight ?? 1.2, v => v && setS('lineHeight')(v), { min: 0.6, max: 3, step: 0.05 })),
        field('Letter spacing', input('number', st.letterSpacing || 0, v => setS('letterSpacing')(v || 0), { min: -20, max: 60 })),
        field('Padding', input('number', st.padding || 0, v => setS('padding')(v || 0), { min: 0, max: 300 }))),
      node('div', { className: 'le-checks' }, check('Bold', (st.weight || 400) >= 600, v => setS('weight')(v ? 700 : 400)), check('Italic', st.italic, setS('italic')),
        check('Capitals', st.upper, setS('upper')), check('Shadow', st.shadow, setS('shadow')),
        check('Outline', st.outline, v => setS('outline')(v ? { width: 3, color: '#000000' } : undefined))),
      node('div', { className: 'le-row le-segs' }, seg([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], st.align || 'center', setS('align')),
        seg([['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], st.valign || 'middle', setS('valign'))),
      field('Too long for the box', choice([['shrink', 'Shrink to fit'], ['none', 'Leave as it is']], st.fit || 'shrink', setS('fit'))),
      field('Box behind the words', paint(el.fill, v => { if (v) el.fill = v; else delete el.fill; }, 'None')));
  }
  if (el.type === 'shape' && el.kind === 'line') {
    box.append(node('div', { className: 'sub-h', textContent: 'Line' }),
      field('Colour', paint(el.fill || '#ffffff', v => { el.fill = v; })),
      node('div', { className: 'le-grid2' },
        field('Thickness px', input('number', el.thickness || 4, v => { if (v > 0) el.thickness = v; }, { min: 1, max: 200 })),
        node('div', { className: 'le-checks' }, check('Rounded ends', el.round, v => { if (v) el.round = true; else delete el.round; }))),
      node('p', { className: 'muted small', textContent: 'Turn it with the round handle, or Rotate above, for a slanted or upright line.' }));
  } else if (el.type === 'shape') {
    box.append(node('div', { className: 'sub-h', textContent: 'Shape' }),
      field('Kind', choice([['rect', 'Rectangle'], ['ellipse', 'Circle or oval']], el.kind || 'rect', v => { el.kind = v; })),
      field('Fill', paint(el.fill, v => { if (v) el.fill = v; else delete el.fill; }, 'None')),
      node('div', { className: 'le-grid2' },
        field('Border px', input('number', el.stroke?.width || 0, v => { if (v > 0) el.stroke = { color: '#ffffff', ...el.stroke, width: v }; else delete el.stroke; }, { min: 0, max: 60 })),
        field('Border colour', input('color', parseColor(el.stroke?.color || '#ffffff').hex, v => { el.stroke = { width: 2, ...el.stroke, color: v }; }))));
    if (el.kind !== 'ellipse') box.append(field('Rounded corners px', input('number', el.radius || 0, v => { if (v > 0) el.radius = v; else delete el.radius; }, { min: 0, max: 540 })));
  }
  if (el.type === 'image' || el.type === 'video') {
    box.append(node('div', { className: 'sub-h', textContent: el.type === 'image' ? 'Picture' : 'Video' }),
      ...mediaSource(el.type, el.src, ref => { el.src = ref; }));
    box.append(field('Fit', choice([['contain', 'Fit inside'], ['cover', 'Fill and crop'], ['stretch', 'Stretch']], el.fit || 'contain', v => { el.fit = v; })));
  }
}
// Which picture or video an element or background shows: its file's name, Replace… for a file, and the media bin.
function mediaSource(type, src, set) {
  const name = String(src || '').replace(/^(media|folder|bin):/, '').split('/').pop();
  const bin = state.db.media.filter(m => m.type === type);
  const out = [node('div', { className: 'le-row' }, node('span', { className: 'muted small le-src', textContent: name || 'None' }),
    node('button', { className: 'btn small-btn', textContent: src ? 'Replace…' : 'Choose a file…',
      onclick: () => pickFile(type, ref => { set(ref); commit(); renderAll(); }) }))];
  if (bin.length) out.push(field('From the media bin', choice([['', 'Choose…'], ...bin.map(m => [m.id, m.name])], '', id => {
    const m = bin.find(x => x.id === id); if (m) set(toRef(Lumen.online ? m.src : '#' + m.id));
  })));
  return out;
}

// ---------- the background ----------
const BG_KINDS = [['color', 'Colour'], ['gradient', 'Gradient'], ['image', 'Picture'], ['video', 'Video']];
// A theme's background shows behind songs that have none of their own; a slide's, behind that slide only.
function renderBackground(box) {
  const bg = doc.background, kind = bg?.type || '';
  const set = v => { doc.background = v; };
  box.append(node('div', { className: 'le-head' }, node('b', { textContent: 'Background' })),
    node('p', { className: 'muted small', textContent: mode === 'theme'
      ? 'Shown behind every presentation using this theme, unless it or its slide has a background of its own.'
      : 'Shown behind this slide only. Leave it as the presentation’s to use the presentation’s or its theme’s.' }),
    field('Kind', choice([['', mode === 'theme' ? 'None: each song’s own' : 'The presentation’s'], ...BG_KINDS], BG_KINDS.some(([k]) => k === kind) ? kind : '', v => {
      if (!v) set(null);
      else if (v === 'color') set({ type: 'color', src: parseGradient(bg?.src)?.from || (bg?.type === 'color' ? bg.src : '#1b2030') });
      else if (v === 'gradient') set({ type: 'gradient', src: gradient(bg?.type === 'color' ? { from: bg.src } : {}) });
      else if (v !== kind) pickFile(v, ref => { set({ type: v, src: ref }); commit(); renderAll(); });
    })));
  if (kind === 'color') box.append(field('Colour', input('color', parseColor(bg.src).hex, v => { bg.src = v; })));
  if (kind === 'gradient') {
    const g = parseGradient(bg.src) || { angle: 160, from: '#1b2030', to: '#0d0f15' };
    const upd = k => v => { if (v == null) return; g[k] = v; bg.src = gradient(g); };
    box.append(node('div', { className: 'le-grid2' }, field('From', input('color', parseColor(g.from).hex, upd('from'))),
      field('To', input('color', parseColor(g.to).hex, upd('to')))),
    field('Angle °', input('number', g.angle, upd('angle'), { min: 0, max: 360, step: 15 })));
  }
  if (kind === 'image' || kind === 'video') box.append(...mediaSource(kind, bg.src, ref => { bg.src = ref; }));
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
function commit() { if (hist.push(doc)) renderButtons(); renderStrip(); }
function select(id) { selId = id; renderOverlay(); renderLayers(); renderInspector(); }
function restore(v) {
  if (!v) return;
  doc = v;
  if (cur && !doc.layouts?.some(l => l.id === cur)) cur = '';
  if (!sel() && selId !== BG) selId = null;
  renderAll();
}
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
  doc.layout.elements = els().filter(e => e !== el); selId = null; commit(); renderAll();
}
function arrange(how) { if (sel()) { doc.layout.elements = reorder(els(), selId, how); commit(); renderAll(); } }
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
  $('#leAddLayout').onclick = addLayout;
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
  $('#lePres').onchange = e => { presId = e.target.value || null; slideIdx = firstThemed(); renderCanvas(); renderStrip(); };
  const ov = $('#leOverlay');
  ov.onpointerdown = pointerDown; ov.onpointermove = pointerMove; ov.onpointerup = ov.onpointercancel = pointerUp;
  ov.ondblclick = () => { const t = $('#leContent'); if (t) { t.focus(); t.select(); } };
  new ResizeObserver(fitCanvas).observe($('#leWrap'));
  document.addEventListener('keydown', keyDown, true);
}
