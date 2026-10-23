// Shared 1920x1080 slide renderer used by the operator preview, thumbnails, the audience output and NDI. A slide
// arrives as a list of positioned elements, already resolved by the console (console/format.js).
(function () {
  const W = 1920, H = 1080;
  const FADE_MS = 450;

  const ro = new ResizeObserver(entries => entries.forEach(e => fit(e.target)));

  function fit(screen) {
    const inner = screen.firstElementChild;
    if (!inner) return;
    const w = screen.clientWidth, h = screen.clientHeight;
    const s = Math.min(w / W, h / H);
    inner.style.transform = `translate(${(w - W * s) / 2}px, ${(h - H * s) / 2}px) scale(${s})`;
  }

  // Layers, back to front: background, the slide's elements, props, message, logo.
  function createScreen(el) {
    el.classList.add('pp-screen');
    el.innerHTML = '<div class="pp-inner"><div class="pp-layer pp-bgL"></div><div class="pp-layer pp-slideL"></div>' +
      '<div class="pp-layer pp-propsL"></div><div class="pp-layer pp-msgL"></div><div class="pp-layer pp-logoL"></div></div>';
    el._pp = { bg: null, slide: [], msg: null, logo: null };
    ro.observe(el);
    fit(el);
    return el;
  }

  const bgKey = bg => bg ? bg.type + '|' + bg.src : '';
  // Library data can come from an imported file, so values never get spliced into markup or CSS text.
  const cssUrl = src => 'url("' + String(src).replace(/["\\\n\r\f]/g, c => '\\' + c.charCodeAt(0).toString(16) + ' ') + '")';

  function makeBg(bg, animate) {
    const d = document.createElement('div');
    d.className = 'pp-fill';
    if (bg.type === 'image') d.style.background = 'center/cover no-repeat ' + cssUrl(bg.src);
    else if (bg.type === 'video') {
      const v = document.createElement('video');
      Object.assign(v, { src: bg.src, autoplay: true, loop: true, muted: true, playsInline: true });
      d.appendChild(v);
    } else {
      d.style.background = bg.src;
      if (bg.type === 'motion' && animate) d.classList.add('pp-motion');
    }
    return d;
  }

  const FIT = { contain: 'contain', cover: 'cover', stretch: 'fill' };

  // One element of a slide, placed by its frame on the 1920x1080 canvas.
  function makeElement(e, opts) {
    const f = e.frame || { x: 0, y: 0, w: W, h: H };
    const d = document.createElement('div');
    d.className = 'pp-el pp-' + e.type;
    Object.assign(d.style, { left: f.x + 'px', top: f.y + 'px', width: f.w + 'px', height: f.h + 'px' });
    if (f.rotate) d.style.transform = `rotate(${f.rotate}deg)`;
    let inner;
    if (e.type === 'text') inner = makeText(d, e);
    else if (e.type === 'image') {
      inner = document.createElement('img'); inner.src = e.src; inner.alt = '';
      inner.style.objectFit = FIT[e.fit] || 'contain';
    } else if (e.type === 'video') inner = makeVideo(e, opts);
    else if (e.type === 'shape' && e.kind === 'line') {
      inner = document.createElement('div');
      const th = Math.max(1, e.thickness || 4);
      Object.assign(inner.style, { position: 'absolute', left: 0, right: 0, top: `calc(50% - ${th / 2}px)`, height: th + 'px',
        background: e.fill || '#fff', borderRadius: e.round ? th / 2 + 'px' : 0 });
    } else if (e.type === 'shape') {
      inner = document.createElement('div');
      Object.assign(inner.style, { width: '100%', height: '100%', boxSizing: 'border-box', background: e.fill || 'none',
        borderRadius: e.kind === 'ellipse' ? '50%' : (e.radius || 0) + 'px', border: e.stroke ? `${e.stroke.width || 2}px solid ${e.stroke.color || '#fff'}` : 'none' });
    }
    if (e.fill && e.type !== 'shape') d.style.background = e.fill;
    if (inner) { if (e.opacity != null) inner.style.opacity = e.opacity; d.appendChild(inner); }
    return d;
  }

  function makeText(d, e) {
    const t = e.style || {};
    const v = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.valign] || 'center';
    Object.assign(d.style, { justifyContent: v, textAlign: t.align || 'center', padding: (t.padding || 0) + 'px' });
    const span = document.createElement('div');
    span.className = 'pp-words';
    // Words with some of them bold, italic, underlined or coloured come as runs ({ text, bold, italic, underline,
    // color }), each drawn in its own span.
    if (Array.isArray(e.runs)) for (const r of e.runs) {
      const s = document.createElement('span');
      s.textContent = r.text;
      if (r.bold) s.style.fontWeight = 'bolder';
      if (r.italic) s.style.fontStyle = 'italic';
      if (r.underline) s.style.textDecoration = 'underline';
      if (r.color) s.style.color = r.color;
      span.appendChild(s);
    }
    else span.textContent = e.content;
    Object.assign(span.style, {
      fontFamily: t.font, fontSize: t.size + 'px', color: t.color, fontWeight: t.weight || 400,
      fontStyle: t.italic ? 'italic' : 'normal', textTransform: t.upper ? 'uppercase' : 'none',
      lineHeight: t.lineHeight || 1.2, letterSpacing: t.letterSpacing ? t.letterSpacing + 'px' : 'normal',
      textShadow: t.shadow ? '0 4px 22px rgba(0,0,0,.85),0 2px 4px rgba(0,0,0,.9)' : 'none',
    });
    if (t.outline) span.style.webkitTextStroke = `${t.outline.width || 2}px ${t.outline.color || '#000'}`;
    return span;
  }

  // A video that loops (a background, or a moving element) is muted; one that plays once is the slide's video,
  // kept in step across windows by the live state's clock, with its sound only where opts.sound says.
  function makeVideo(e, opts) {
    const v = document.createElement('video');
    v.style.objectFit = FIT[e.fit] || 'contain';
    if (e.loop !== false) {
      Object.assign(v, { src: e.src, autoplay: !opts.still, loop: true, muted: true, playsInline: true });
      return v;
    }
    // Thumbnails show the first frame. When it finishes it fades out to black rather than holding its last frame.
    v.classList.add('pp-once');
    Object.assign(v, { src: opts.still ? e.src + '#t=0.1' : e.src, muted: !opts.sound || !!e.muted, playsInline: true,
      preload: opts.still ? 'metadata' : 'auto' });
    v.addEventListener('ended', () => v.classList.add('pp-done'));
    return v;
  }

  // Shrink the words until they fit their box.
  function shrinkToFit(d, e) {
    const span = d.firstChild, t = e.style || {};
    if (t.fit === 'none') return;
    const f = e.frame || { w: W, h: H }, pad = t.padding || 0;
    const maxH = f.h - pad * 2, maxW = f.w - pad * 2;
    let size = t.size;
    while (size > 24 && (span.scrollHeight > maxH || span.scrollWidth > maxW)) {
      size -= 4;
      span.style.fontSize = size + 'px';
    }
  }

  // Slides saved in the live state before layouts (a restart after updating) still draw, from their theme.
  function legacyElements(sl, t) {
    if (!sl || sl.elements) return sl ? sl.elements : [];
    const out = [];
    if (sl.video) out.push({ type: 'video', src: sl.video, fit: 'contain', loop: false, fill: '#000' });
    else if (sl.image) out.push({ type: 'image', src: sl.image, fit: 'contain' });
    if (sl.text && t) {
      const m = t.margin || 110;
      out.push({ type: 'text', content: sl.text, frame: { x: m, y: m, w: W - 2 * m, h: H - 2 * m },
        style: { ...t, weight: t.bold ? 700 : 400, padding: 0 } });
    }
    return out;
  }

  // How a layer's old content leaves and the new arrives, by the live state's transition ({ type, ms }). The
  // translate and scale properties are animated rather than transform, so a rotated element keeps its rotation.
  // A type this copy doesn't know (from a newer Lumen) fades.
  const MOVES = {
    fade: { in: [{ opacity: 0 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0 }], easing: 'ease' },
    dip: { in: [{ opacity: 0 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0 }], easing: 'ease', dip: true },
    push: { in: [{ translate: W + 'px 0' }, { translate: '0 0' }], out: [{ translate: '0 0' }, { translate: -W + 'px 0' }], easing: 'ease-in-out' },
    zoom: { in: [{ opacity: 0, scale: '0.8' }, { opacity: 1, scale: '1' }], out: [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '1.15' }], easing: 'ease' },
  };
  const FADE = { type: 'fade', ms: FADE_MS };
  const playable = tr => tr && tr.type !== 'cut' && tr.ms > 0 ? tr : null;

  function swap(layer, key, current, build, tr) {
    if (current && current.key === key) return current;
    tr = playable(tr);
    const move = tr && (MOVES[tr.type] || MOVES.fade);
    // Dip to black: the old goes out in the first half, and the new comes in over black in the second.
    const half = move && move.dip ? tr.ms / 2 : tr && tr.ms;
    const old = current && current.el;
    let el = null;
    if (key) {
      el = build();
      layer.appendChild(el);
      if (move) el.animate(move.in, { duration: half, delay: move.dip ? half : 0, easing: move.easing, fill: 'backwards' });
    }
    if (old) {
      if (move) old.animate(move.out, { duration: half, easing: move.easing, fill: 'forwards' }).onfinish = () => old.remove();
      else old.remove();
    }
    return { key, el };
  }

  // Every window plays a live video from the same moment: play = { startAt (server ms), paused, pos (seconds) }.
  // A window opened late, or reloaded, joins it part-way through.
  function syncVideo(v, play, opts) {
    play = play || {};
    const now = window.Lumen ? Lumen.now() : Date.now();
    const at = play.paused ? play.pos || 0 : Math.max(0, (now - (play.startAt || now)) / 1000 + (play.pos || 0));
    const seek = () => {
      const t = isFinite(v.duration) ? Math.min(at, v.duration) : at;
      if (Math.abs(v.currentTime - t) > 0.4) v.currentTime = t;
    };
    if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
    const done = !play.paused && (v.ended || (isFinite(v.duration) && at >= v.duration));
    v.classList.toggle('pp-done', done);
    if (play.paused) { v.pause(); return; }
    if (done) return;
    v.play().catch(() => {
      // The browser blocks sound until someone interacts with this window: play silently until then.
      if (v.muted) return;
      v.muted = true; v.play().catch(() => {});
      if (opts.onMuted) opts.onMuted(v);
    });
  }

  // live = { bg, slide:{elements, play, stageText}, msg, logo, logoText, logoImg, transition:{type, ms} }. With
  // opts.fade, the background and slide change with the live transition (a fade in live state from before
  // transitions), and messages and the logo fade; without it, everything changes at once. With opts.wordsOnly (NDI
  // on a transparent background) the background, the slide's pictures, looping videos and the logo screen are left
  // out, so the words, the template's shapes, messages and a slide's own video are drawn.
  function update(screen, live, opts = {}) {
    const st = screen._pp, inner = screen.firstElementChild;
    const fade = opts.fade ? FADE : null, tr = opts.fade ? live.transition || FADE : null, animate = opts.animate !== false;
    const [bgL, slideL, , msgL, logoL] = inner.children;
    const t = live.theme;
    if (live.fonts) useFonts(live.fonts);

    const words = !!opts.wordsOnly;
    st.bg = swap(bgL, words ? '' : bgKey(live.bg), st.bg, () => makeBg(live.bg, animate), tr);

    // The slide's elements: one that is the same as before stays as it is (a picture under changing words, say),
    // and the rest change over.
    const sl = live.slide;
    // Words only still plays a slide's own video (one that plays once, such as a video in the playlist), without
    // its black backing, so it fades out to see-through when it ends.
    const els = legacyElements(sl, t).flatMap(e => !words || e.type === 'text' || e.type === 'shape' ? [e]
      : e.type === 'video' && e.loop === false ? [{ ...e, fill: undefined }] : []);
    const keyOf = e => JSON.stringify(e) + (e.type === 'video' && e.loop === false ? '|' + ((sl.play && sl.play.startAt) || '') : '');
    const old = st.slide, next = [];
    for (const e of els) {
      const key = keyOf(e), i = old.findIndex(o => o && o.key === key);
      if (i >= 0) { next.push(old[i]); old[i] = null; continue; }
      const item = swap(slideL, key, null, () => makeElement(e, opts), tr);
      item.e = e;
      if (e.type === 'text') shrinkToFit(item.el, e);
      next.push(item);
    }
    old.forEach(o => { if (o) swap(slideL, '', o, null, tr); });
    next.forEach(n => slideL.appendChild(n.el)); // stacking order, back to front
    st.slide = next;
    if (!opts.still) for (const n of next) {
      const v = n.el.querySelector('video.pp-once');
      if (v) syncVideo(v, sl.play, opts);
    }

    const mk = live.msg ? live.msg : '';
    st.msg = swap(msgL, mk, st.msg, () => {
      const d = document.createElement('div');
      d.className = 'pp-fill pp-msgwrap';
      d.innerHTML = '<div class="pp-msgbar"></div>';
      d.firstChild.textContent = live.msg;
      return d;
    }, fade);

    const lk = live.logo && !words ? 'logo|' + (live.logoImg || '') + (live.logoText || '') : '';
    st.logo = swap(logoL, lk, st.logo, () => {
      const d = document.createElement('div');
      d.className = 'pp-fill pp-logo';
      if (live.logoImg) { const img = document.createElement('img'); img.src = live.logoImg; img.alt = ''; d.appendChild(img); }
      else { d.innerHTML = '<div class="pp-logotext"></div>'; d.firstChild.textContent = live.logoText || ''; }
      return d;
    }, fade);
  }

  // Fonts uploaded to the library, loaded once in each window that draws slides: [{ family, src }]. Words drawn
  // before their font arrives are fitted to their boxes again once it has.
  const fonts = new Map();
  function useFonts(list) {
    if (!Array.isArray(list) || !window.FontFace) return;
    for (const f of list) {
      if (!f || !f.family || !f.src || fonts.get(f.family) === f.src) continue;
      fonts.set(f.family, f.src);
      const face = new FontFace(f.family, cssUrl(f.src));
      face.load().then(() => { document.fonts.add(face); document.querySelectorAll('.pp-screen').forEach(refit); }).catch(() => {});
    }
  }
  function refit(screen) {
    if (!screen._pp) return;
    for (const n of screen._pp.slide) if (n.e && n.e.type === 'text') {
      n.el.firstChild.style.fontSize = (n.e.style || {}).size + 'px';
      shrinkToFit(n.el, n.e);
    }
  }

  /** The slide's video that plays once, as the screen shows it, for its time and length. */
  const slideVideo = screen => screen.querySelector('.pp-slideL video.pp-once');

  window.PP = { W, H, createScreen, update, fit, cssUrl, slideVideo, useFonts };
})();
