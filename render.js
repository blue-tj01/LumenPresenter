// Shared 1920x1080 slide renderer used by the operator preview, thumbnails and the audience output.
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

  function createScreen(el) {
    el.classList.add('pp-screen');
    el.innerHTML = '<div class="pp-inner"><div class="pp-layer pp-bgL"></div><div class="pp-layer pp-imgL"></div>' +
      '<div class="pp-layer pp-txtL"></div>' +
      '<div class="pp-layer pp-msgL"></div><div class="pp-layer pp-logoL"></div></div>';
    el._pp = { bg: null, img: null, txt: null, msg: null, logo: null };
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

  function makeText(text, t) {
    const d = document.createElement('div');
    d.className = 'pp-fill pp-text';
    const v = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[t.valign] || 'center';
    Object.assign(d.style, { justifyContent: v, textAlign: t.align, padding: t.margin + 'px' });
    const span = document.createElement('div');
    span.className = 'pp-words';
    span.textContent = text;
    Object.assign(span.style, {
      fontFamily: t.font, fontSize: t.size + 'px', color: t.color, fontWeight: t.bold ? 700 : 400,
      textTransform: t.upper ? 'uppercase' : 'none', lineHeight: t.lineHeight || 1.2,
      textShadow: t.shadow ? '0 4px 22px rgba(0,0,0,.85),0 2px 4px rgba(0,0,0,.9)' : 'none',
    });
    d.appendChild(span);
    return d;
  }

  // Shrink the font until the words fit inside the safe area.
  function shrinkToFit(d, t) {
    const span = d.firstChild;
    let size = t.size;
    const maxH = H - t.margin * 2, maxW = W - t.margin * 2;
    while (size > 24 && (span.scrollHeight > maxH || span.scrollWidth > maxW)) {
      size -= 4;
      span.style.fontSize = size + 'px';
    }
  }

  function swap(layer, key, current, build, fade) {
    if (current && current.key === key) return current;
    const old = current && current.el;
    let el = null;
    if (key) {
      el = build();
      if (fade) { el.style.opacity = 0; }
      layer.appendChild(el);
      if (fade) requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = `opacity ${FADE_MS}ms ease`; el.style.opacity = 1;
      }));
    }
    if (old) {
      if (fade) {
        old.style.transition = `opacity ${FADE_MS}ms ease`; old.style.opacity = 0;
        setTimeout(() => old.remove(), FADE_MS + 50);
      } else old.remove();
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

  // live = { bg, slide:{text, image, video, play}, msg, logo, theme, logoText, logoImg }
  function update(screen, live, opts = {}) {
    const st = screen._pp, inner = screen.firstElementChild;
    const fade = !!opts.fade, animate = opts.animate !== false;
    const [bgL, imgL, txtL, msgL, logoL] = inner.children;
    const t = live.theme;

    st.bg = swap(bgL, bgKey(live.bg), st.bg, () => makeBg(live.bg, animate), fade);

    // A slide's own picture or video sits over the background and under its text, letterboxed so nothing is cropped.
    const sl = live.slide || {};
    const ik = sl.video ? 'video|' + sl.video + '|' + ((sl.play && sl.play.startAt) || '') : sl.image || '';
    st.img = swap(imgL, ik, st.img, () => {
      const d = document.createElement('div');
      d.className = 'pp-fill pp-slideimg';
      if (sl.video) {
        const v = document.createElement('video');
        // Thumbnails show the first frame; only the audience output plays the sound.
        Object.assign(v, { src: opts.still ? sl.video + '#t=0.1' : sl.video, muted: !opts.sound, playsInline: true,
          preload: opts.still ? 'metadata' : 'auto' });
        // When it finishes it fades out to black rather than holding its last frame.
        d.classList.add('pp-slidevid');
        v.addEventListener('ended', () => v.classList.add('pp-done'));
        d.appendChild(v);
      } else {
        const img = document.createElement('img'); img.src = ik; img.alt = '';
        d.appendChild(img);
      }
      return d;
    }, fade);
    if (sl.video && !opts.still && st.img.el) syncVideo(st.img.el.firstChild, sl.play, opts);

    const tk = live.slide && live.slide.text ? live.slide.text + '§' + JSON.stringify(t) : '';
    st.txt = swap(txtL, tk, st.txt, () => makeText(live.slide.text, t), fade);
    if (st.txt.el && !st.txt.el._fit) { st.txt.el._fit = true; shrinkToFit(st.txt.el, t); }

    const mk = live.msg ? live.msg : '';
    st.msg = swap(msgL, mk, st.msg, () => {
      const d = document.createElement('div');
      d.className = 'pp-fill pp-msgwrap';
      d.innerHTML = '<div class="pp-msgbar"></div>';
      d.firstChild.textContent = live.msg;
      return d;
    }, fade);

    const lk = live.logo ? 'logo|' + (live.logoImg || '') + (live.logoText || '') : '';
    st.logo = swap(logoL, lk, st.logo, () => {
      const d = document.createElement('div');
      d.className = 'pp-fill pp-logo';
      if (live.logoImg) { const img = document.createElement('img'); img.src = live.logoImg; img.alt = ''; d.appendChild(img); }
      else { d.innerHTML = '<div class="pp-logotext"></div>'; d.firstChild.textContent = live.logoText || ''; }
      return d;
    }, fade);
  }

  window.PP = { W, H, createScreen, update, fit, cssUrl };
})();
