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
    el.innerHTML = '<div class="pp-inner"><div class="pp-layer pp-bgL"></div><div class="pp-layer pp-txtL"></div>' +
      '<div class="pp-layer pp-msgL"></div><div class="pp-layer pp-logoL"></div></div>';
    el._pp = { bg: null, txt: null, msg: null, logo: null };
    ro.observe(el);
    fit(el);
    return el;
  }

  const bgKey = bg => bg ? bg.type + '|' + bg.src : '';

  function makeBg(bg, animate) {
    const d = document.createElement('div');
    d.className = 'pp-fill';
    if (bg.type === 'image') d.style.background = `center/cover no-repeat url("${bg.src}")`;
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
    d.style.cssText = `justify-content:${v};text-align:${t.align};padding:${t.margin}px;`;
    const span = document.createElement('div');
    span.className = 'pp-words';
    span.textContent = text;
    span.style.cssText = `font-family:${t.font};font-size:${t.size}px;color:${t.color};` +
      `font-weight:${t.bold ? 700 : 400};text-transform:${t.upper ? 'uppercase' : 'none'};` +
      `line-height:${t.lineHeight || 1.2};` +
      `text-shadow:${t.shadow ? '0 4px 22px rgba(0,0,0,.85),0 2px 4px rgba(0,0,0,.9)' : 'none'};`;
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

  // live = { bg, slide:{text}, msg, logo, theme, logoText, logoImg }
  function update(screen, live, opts = {}) {
    const st = screen._pp, inner = screen.firstElementChild;
    const fade = !!opts.fade, animate = opts.animate !== false;
    const [bgL, txtL, msgL, logoL] = inner.children;
    const t = live.theme;

    st.bg = swap(bgL, bgKey(live.bg), st.bg, () => makeBg(live.bg, animate), fade);

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
      if (live.logoImg) d.innerHTML = `<img src="${live.logoImg}" alt="">`;
      else { d.innerHTML = '<div class="pp-logotext"></div>'; d.firstChild.textContent = live.logoText || ''; }
      return d;
    }, fade);
  }

  window.PP = { W, H, createScreen, update, fit };
})();
