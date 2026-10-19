// Lumen Presenter — operator console.
(async () => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10);
  const KEY = 'lumen.db.v1';

  // ---------- seed data (public-domain hymns) ----------
  const SEED_SONGS = [
    ['Amazing Grace', `[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!

I once was lost, but now am found;
Was blind, but now I see.

[Verse 2]
'Twas grace that taught my heart to fear,
And grace my fears relieved;

How precious did that grace appear
The hour I first believed.

[Verse 3]
Through many dangers, toils and snares,
I have already come;

'Tis grace hath brought me safe thus far,
And grace will lead me home.

[Verse 4]
When we've been there ten thousand years,
Bright shining as the sun,

We've no less days to sing God's praise
Than when we'd first begun.`],
    ['Holy, Holy, Holy', `[Verse 1]
Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;

Holy, holy, holy, merciful and mighty!
God in three Persons, blessed Trinity!

[Verse 2]
Holy, holy, holy! All the saints adore Thee,
Casting down their golden crowns around the glassy sea;

Cherubim and seraphim falling down before Thee,
Who wert, and art, and evermore shalt be.

[Ending]
Holy, holy, holy! Lord God Almighty!
All Thy works shall praise Thy name, in earth, and sky, and sea;

Holy, holy, holy; merciful and mighty!
God in three Persons, blessed Trinity!`],
    ['Be Thou My Vision', `[Verse 1]
Be Thou my Vision, O Lord of my heart;
Naught be all else to me, save that Thou art.

Thou my best Thought, by day or by night,
Waking or sleeping, Thy presence my light.

[Verse 2]
Be Thou my Wisdom, and Thou my true Word;
I ever with Thee and Thou with me, Lord;

Thou my great Father, I Thy true son;
Thou in me dwelling, and I with Thee one.

[Verse 3]
High King of Heaven, my victory won,
May I reach Heaven's joys, O bright Heaven's Sun!

Heart of my own heart, whatever befall,
Still be my Vision, O Ruler of all.`],
    ['Doxology', `[Chorus]
Praise God, from whom all blessings flow;
Praise Him, all creatures here below;

Praise Him above, ye heavenly host;
Praise Father, Son, and Holy Ghost.

[Tag]
Amen.`],
    ['Welcome & Announcements', `@bg: linear-gradient(135deg,#1e3c72,#2a5298)
[Intro]
Welcome!
We're glad you're here.

[Announcements]
Coffee & fellowship
after the service in the hall

Youth night
Friday · 7 PM

[Ending]
Have a great week!`]
  ];

  const BUILTIN_MEDIA = [
    { name: 'Black', type: 'color', src: '#000000' },
    { name: 'Midnight', type: 'gradient', src: 'linear-gradient(160deg,#0f2027,#203a43,#2c5364)' },
    { name: 'Sunrise', type: 'gradient', src: 'linear-gradient(135deg,#f7971e,#b2195e 60%,#3a1c71)' },
    { name: 'Deep Sea', type: 'gradient', src: 'radial-gradient(circle at 30% 20%,#1a6dff,#0b1a3d 70%)' },
    { name: 'Forest', type: 'gradient', src: 'linear-gradient(135deg,#134e5e,#71b280)' },
    { name: 'Aurora (motion)', type: 'motion', src: 'linear-gradient(-45deg,#0b3866,#2e1a5e,#0d6e6e,#1b2a6b)' },
    { name: 'Ember (motion)', type: 'motion', src: 'linear-gradient(-45deg,#3a0a0a,#8a2b06,#3d0f2e,#5c1a00)' },
    { name: 'Lavender (motion)', type: 'motion', src: 'linear-gradient(-45deg,#41295a,#2f0743,#5b3a8a,#1d1a4a)' },
  ];

  const DEFAULT_THEME = { font: "'Segoe UI', system-ui, sans-serif", size: 92, color: '#ffffff', bold: true, shadow: true,
    upper: false, align: 'center', valign: 'middle', margin: 110, lineHeight: 1.2 };
  // Saved themes a presentation can use instead of the default style. Fixed ids so every console agrees
  // on them before the library is first saved.
  const BUILTIN_THEMES = [
    { id: 'classic', name: 'Classic', ...DEFAULT_THEME },
    { id: 'lower-third', name: 'Lower third', ...DEFAULT_THEME, size: 64, valign: 'bottom', margin: 80 },
    { id: 'scripture', name: 'Scripture', ...DEFAULT_THEME, font: 'Georgia, serif', size: 68, bold: false, align: 'left' },
    { id: 'big-bold', name: 'Big & bold', ...DEFAULT_THEME, font: "Impact, 'Arial Black', sans-serif", size: 120, bold: false, upper: true },
  ];

  // ---------- slide text parsing ----------
  function parseText(src) {
    const groups = []; let bg = null; let cur = null; let buf = [];
    const flush = () => { if (buf.join('').trim()) { if (!cur) { cur = { name: 'Slides', slides: [] }; groups.push(cur); } cur.slides.push(buf.join('\n').trim()); } buf = []; };
    for (const raw of src.replace(/\r/g, '').split('\n')) {
      const line = raw.trimEnd();
      const m = line.match(/^\s*\[(.+)\]\s*$/);
      const b = line.match(/^@bg:\s*(.+)$/i);
      if (b) { bg = toBg(b[1].trim()); continue; }
      if (m) { flush(); cur = { name: m[1].trim(), slides: [] }; groups.push(cur); continue; }
      if (!line.trim()) { flush(); continue; }
      buf.push(line.trim());
    }
    flush();
    return { groups: groups.filter(g => g.slides.length), bg };
  }
  function toBg(v) {
    if (/^(#|rgb|hsl)/i.test(v)) return { type: 'color', src: v };
    if (/gradient\(/i.test(v)) return { type: 'gradient', src: v };
    if (/\.(mp4|webm|mov)(\?|$)/i.test(v)) return { type: 'video', src: v };
    return { type: 'image', src: v };
  }
  function serialize(p) {
    let out = p.bg && !p.bg.src.startsWith('blob:') && !p.bg.src.startsWith('data:') ? `@bg: ${p.bg.src}\n` : '';
    out += p.groups.map(g => `[${g.name}]\n` + g.slides.join('\n\n')).join('\n\n');
    return out;
  }
  // A slide line "@image: <src>" puts a picture on that slide. <src> is a URL, a server media path,
  // or "#<id>" for a picture kept in the media bin (how pictures are stored when running without the server).
  const IMAGE_LINE = /^@image:\s*(.+)$/i;
  function splitSlide(raw) {
    let image = null;
    const text = raw.split('\n').filter(l => { const m = l.match(IMAGE_LINE); if (m) image = m[1].trim(); return !m; }).join('\n').trim();
    return { text, image };
  }
  function makePres(name, text) { const r = parseText(text); return { id: uid(), name, groups: r.groups, bg: r.bg }; }

  function groupColor(name) {
    const n = name.toLowerCase();
    if (n.startsWith('pre')) return '#e67e22';
    if (n.startsWith('verse')) return '#2f6fde';
    if (n.startsWith('chorus')) return '#d6334a';
    if (n.startsWith('bridge')) return '#8e44ad';
    if (n.startsWith('tag') || n.startsWith('ending') || n.startsWith('outro')) return '#27ae60';
    if (n.startsWith('intro')) return '#7f8c8d';
    let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 45%)`;
  }

  // ---------- persistence ----------
  function seed() {
    const pres = SEED_SONGS.map(([n, t]) => makePres(n, t));
    return {
      presentations: pres,
      playlist: [pres[4].id, pres[0].id, pres[2].id, pres[3].id],
      media: BUILTIN_MEDIA.map(m => ({ id: uid(), builtin: true, ...m })),
      theme: { ...DEFAULT_THEME },
      themes: BUILTIN_THEMES.map(t => ({ ...t })),
      messages: ['Welcome! Please silence your phones.', 'Nursery parents: please come to the nursery.', 'The parking lot lights are on — car ABC-123.'],
      logoText: 'WELCOME',
    };
  }
  // With the server the library lives there; localStorage is the store when running without it.
  const online = await Lumen.init();
  const valid = d => d && Array.isArray(d.presentations);
  const normalize = d => ({ ...d, media: d.media || [], playlist: d.playlist || [], messages: d.messages || [],
    theme: { ...DEFAULT_THEME, ...d.theme },
    themes: (Array.isArray(d.themes) ? d.themes : BUILTIN_THEMES).map(t => ({ ...DEFAULT_THEME, ...t })) });
  let loadFailed = false;
  let db = online ? await Lumen.loadLibrary().catch(() => { loadFailed = true; return null; }) : null;
  const fresh = !valid(db) && !loadFailed; // nothing on the server yet: bring over this browser's library, or the demo
  if (!valid(db)) { try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; } }
  if (!valid(db)) db = seed();
  db = normalize(db);
  const save = () => {
    const keep = { ...db, media: db.media.filter(m => !m.src.startsWith('blob:')) };
    Lumen.saveLibrary(keep);
    try { localStorage.setItem(KEY, JSON.stringify(keep)); }
    catch { if (!online) toast('Storage full — large images are kept for this session only'); }
  };

  // ---------- live state ----------
  const live = { presId: null, idx: -1, slide: null, bg: null, msg: null, logo: false, next: '',
    stageMsg: '', timer: { dur: 300, endAt: null, remaining: 300 }, _autoBgFrom: null };
  const LIVE_KEYS = Object.keys(live);
  const adoptLive = l => LIVE_KEYS.forEach(k => { if (k in l) live[k] = l[k]; });
  // Pick up where the output left off, so reloading the console never blanks the screen.
  const restored = online ? (await Lumen.getLive().catch(() => null))?.live : null;
  if (restored) adoptLive(restored);
  let selectedId = (db.playlist[0] || db.presentations[0]?.id) ?? null;

  const getPres = id => db.presentations.find(p => p.id === id);
  const resolveImage = src => src && src.startsWith('#') ? db.media.find(m => m.id === src.slice(1))?.src || null : src;
  const flat = p => p ? p.groups.flatMap((g, gi) => g.slides.map((raw, si) => {
    const { text, image } = splitSlide(raw);
    return { text, image: resolveImage(image), group: g.name, gi, si, color: groupColor(g.name) };
  })) : [];
  // A presentation's saved theme, or the default style when it has none (or its theme was deleted).
  const savedTheme = p => p && p.themeId ? db.themes.find(t => t.id === p.themeId) : null;
  const themeFor = p => savedTheme(p) || db.theme;
  const slideSummary = s => s ? s.text || (s.image ? '[Image]' : '') : '';

  function payload() {
    return { ...live, theme: themeFor(getPres(live.presId)), logoText: db.logoText };
  }
  function refreshLive() {
    PP.update(preview, payload(), { fade: true });
    renderLiveMarks();
  }
  function broadcast() {
    Lumen.publish(payload());
    refreshLive();
  }

  // ---------- go live / navigation ----------
  function nextTarget(presId, idx, dir) {
    const p = getPres(presId); const slides = flat(p);
    const n = idx + dir;
    if (n >= 0 && n < slides.length) return [presId, n];
    const pi = db.playlist.indexOf(presId);
    if (pi < 0) return null;
    const np = getPres(db.playlist[pi + dir]);
    if (!np) return null;
    const ns = flat(np);
    return ns.length ? [np.id, dir > 0 ? 0 : ns.length - 1] : null;
  }
  function goLive(presId, idx) {
    const p = getPres(presId); const s = flat(p)[idx];
    if (!s) return;
    live.presId = presId; live.idx = idx; live.logo = false;
    live.slide = { text: s.text, image: s.image, label: `${p.name} — ${s.group}`, color: s.color };
    if (p.bg && (!live.bg || live._autoBgFrom !== p.id)) { live.bg = p.bg; live._autoBgFrom = p.id; }
    const nt = nextTarget(presId, idx, 1);
    live.next = nt ? slideSummary(flat(getPres(nt[0]))[nt[1]]) : '';
    if (selectedId !== presId) { selectedId = presId; renderAll(); }
    broadcast();
    const el = $(`.slide[data-idx="${idx}"]`); if (el) revealSlide(el);
  }
  // Scroll only the slide grid, never the page, so the live controls stay where the operator left them.
  function revealSlide(el) {
    const grid = $('#slideGrid'), g = grid.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.top < g.top) grid.scrollTop += r.top - g.top - 8;
    else if (r.bottom > g.bottom) grid.scrollTop += r.bottom - g.bottom + 8;
  }
  function step(dir) {
    if (!live.presId) { if (selectedId && flat(getPres(selectedId)).length) goLive(selectedId, 0); return; }
    if (live.presId !== selectedId && dir > 0 && live.idx < 0) { goLive(selectedId, 0); return; }
    const t = nextTarget(live.presId, live.idx, dir);
    if (t) goLive(t[0], t[1]);
  }
  function clear(what) {
    if (what === 'all') { live.slide = null; live.bg = null; live.msg = null; live.logo = false; live.idx = -1; live.next = ''; live._autoBgFrom = null; }
    if (what === 'slide') { live.slide = null; live.idx = -1; live.next = ''; }
    if (what === 'bg') { live.bg = null; live._autoBgFrom = null; }
    if (what === 'msg') live.msg = null;
    if (what === 'logo') live.logo = !live.logo;
    broadcast();
  }

  // ---------- rendering ----------
  const preview = PP.createScreen($('#preview'));

  function renderLibrary() {
    const q = $('#libSearch').value.toLowerCase();
    const ul = $('#libList'); ul.innerHTML = '';
    db.presentations.filter(p => !q || p.name.toLowerCase().includes(q) || p.groups.some(g => g.slides.some(s => s.toLowerCase().includes(q))))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(p => {
        const li = document.createElement('li');
        li.dataset.id = p.id;
        li.innerHTML = '<span class="ico">♪</span><span class="nm"></span>';
        li.querySelector('.nm').textContent = li.title = p.name;
        li.onclick = () => { selectedId = p.id; renderAll(); };
        li.ondblclick = () => { if (!db.playlist.includes(p.id)) { db.playlist.push(p.id); save(); renderPlaylist(); } };
        ul.appendChild(li);
      });
    markLists();
  }

  let dragFrom = -1;
  function renderPlaylist() {
    const ul = $('#playList'); ul.innerHTML = '';
    db.playlist = db.playlist.filter(getPres);
    db.playlist.forEach((id, i) => {
      const p = getPres(id);
      const li = document.createElement('li');
      li.dataset.id = id; li.draggable = true;
      li.innerHTML = `<span class="ico">${i + 1}</span><span class="nm"></span><button class="x" title="Remove">✕</button>`;
      li.querySelector('.nm').textContent = li.title = p.name;
      li.onclick = e => { if (e.target.classList.contains('x')) { db.playlist.splice(i, 1); save(); renderPlaylist(); return; } selectedId = id; renderAll(); };
      li.ondragstart = () => { dragFrom = i; };
      li.ondragover = e => { e.preventDefault(); li.classList.add('drag-over'); };
      li.ondragleave = () => li.classList.remove('drag-over');
      li.ondrop = e => { e.preventDefault(); if (dragFrom < 0) return; const [m] = db.playlist.splice(dragFrom, 1); db.playlist.splice(i, 0, m); dragFrom = -1; save(); renderPlaylist(); };
      ul.appendChild(li);
    });
    markLists();
  }

  function markLists() {
    $$('#libList li, #playList li').forEach(li => {
      li.classList.toggle('sel', li.dataset.id === selectedId);
      li.classList.toggle('is-live', li.dataset.id === live.presId && !!live.slide);
    });
  }

  function renderGrid() {
    const grid = $('#slideGrid'); grid.innerHTML = '';
    const p = getPres(selectedId);
    $('#presTitle').textContent = p ? p.name : 'No presentation selected';
    const slides = flat(p);
    $('#presMeta').textContent = p ? `${p.groups.length} groups · ${slides.length} slides · ${savedTheme(p)?.name || 'Default style'}` : '';
    if (!p || !slides.length) { grid.innerHTML = '<div class="empty">No slides yet — click ✎ Edit to add some.</div>'; return; }
    let lastGroup = -1;
    slides.forEach((s, i) => {
      if (s.gi !== lastGroup) {
        lastGroup = s.gi;
        const h = document.createElement('div'); h.className = 'group-h'; h.style.setProperty('--gc', s.color); h.textContent = s.group;
        grid.appendChild(h);
      }
      const card = document.createElement('div');
      card.className = 'slide'; card.dataset.idx = i;
      const scr = document.createElement('div'); card.appendChild(scr);
      const lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.style.background = s.color;
      lbl.innerHTML = `<span class="n">${i + 1}</span><span></span>`; lbl.lastChild.textContent = s.group;
      card.appendChild(lbl);
      card.onclick = () => goLive(p.id, i);
      grid.appendChild(card);
      PP.createScreen(scr);
      PP.update(scr, { bg: p.bg || { type: 'gradient', src: 'linear-gradient(160deg,#1b2030,#0d0f15)' }, slide: { text: s.text, image: s.image }, theme: themeFor(p) }, { animate: false });
    });
    renderLiveMarks();
  }

  function renderLiveMarks() {
    $$('.slide').forEach(el => el.classList.toggle('live', live.presId === selectedId && +el.dataset.idx === live.idx && !!live.slide));
    $$('.mitem').forEach(el => el.classList.toggle('live', !!live.bg && el.dataset.src === live.bg.src));
    $('#btnLogo').classList.toggle('on', live.logo);
    $('#liveLabel').textContent = live.slide ? live.slide.label : (live.logo ? 'Logo' : '');
    markLists();
  }

  function renderMedia() {
    const bin = $('#mediaBin'); bin.innerHTML = '';
    db.media.forEach(m => {
      const d = document.createElement('div');
      d.className = 'mitem'; d.dataset.src = m.src;
      if (m.type === 'image') d.style.backgroundImage = PP.cssUrl(m.src);
      else if (m.type === 'video') {
        const v = document.createElement('video');
        Object.assign(v, { src: m.src, muted: true, loop: true, autoplay: true, playsInline: true });
        d.appendChild(v);
      }
      else { d.style.background = m.src; if (m.type === 'motion') d.classList.add('pp-motion'); }
      d.insertAdjacentHTML('beforeend', `<span></span>${m.builtin ? '' : '<button class="x" title="Remove">✕</button>'}`);
      d.querySelector('span').textContent = m.name;
      d.onclick = e => {
        if (e.target.classList.contains('x')) {
          const onSlide = db.presentations.some(p => p.groups.some(g => g.slides.some(s => s.includes('#' + m.id))));
          if (onSlide) { toast(`“${m.name}” is used on a slide — remove it there first`); return; }
          db.media = db.media.filter(x => x !== m); save(); renderMedia();
          const used = db.presentations.some(p => (p.bg && p.bg.src === m.src) || p.groups.some(g => g.slides.some(s => s.includes(m.src))));
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

  async function addMediaFiles(files) {
    files = [...files].filter(f => /^(image|video)\//.test(f.type));
    if (online) {
      for (const f of files) {
        toast(`Uploading ${f.name}…`);
        try {
          const m = await Lumen.uploadMedia(f);
          db.media.push({ id: uid(), name: m.name, type: m.type, src: m.src }); save(); renderMedia(); toast(`Added ${m.name}`);
        } catch (e) { toast(`Upload failed: ${e.message}`); }
      }
      return;
    }
    files.forEach(f => {
      if (f.type.startsWith('video/')) {
        db.media.push({ id: uid(), name: f.name, type: 'video', src: URL.createObjectURL(f) });
        renderMedia();
      } else if (f.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = () => { db.media.push({ id: uid(), name: f.name, type: 'image', src: r.result }); save(); renderMedia(); };
        r.readAsDataURL(f);
      }
    });
    toast('Media added' + (files.some(f => f.type.startsWith('video/')) ? ' (videos last for this session)' : ''));
  }

  function renderMessages() {
    const ul = $('#msgList'); ul.innerHTML = '';
    db.messages.forEach((m, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="nm"></span><button class="x" title="Delete">✕</button>';
      li.querySelector('.nm').textContent = m;
      li.classList.toggle('sel', live.msg === m);
      li.onclick = e => {
        if (e.target.classList.contains('x')) { db.messages.splice(i, 1); save(); renderMessages(); return; }
        live.msg = live.msg === m ? null : m; broadcast(); renderMessages();
      };
      ul.appendChild(li);
    });
  }

  // The theme pane edits the selected presentation's theme: its saved theme, or the default style.
  function renderTheme() {
    const p = getPres(selectedId), saved = savedTheme(p), t = saved || db.theme;
    $('#thFor').textContent = p ? `Theme for “${p.name}”` : 'Default style';
    const sel = $('#thSaved'); sel.innerHTML = '';
    sel.add(new Option('Default style', ''));
    db.themes.forEach(x => sel.add(new Option(x.name, x.id)));
    sel.value = saved ? saved.id : ''; sel.disabled = !p;
    $('#thRename').disabled = $('#thDelete').disabled = !saved;
    $('#thFont').value = t.font; $('#thSize').value = t.size; $('#thSizeV').textContent = t.size + 'px';
    $('#thColor').value = t.color; $('#thBold').checked = t.bold; $('#thShadow').checked = t.shadow; $('#thUpper').checked = t.upper;
    $$('#thAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === t.align));
    $$('#thVAlign button').forEach(b => b.classList.toggle('on', b.dataset.v === t.valign));
    $('#logoText').value = db.logoText;
  }
  let themeTimer;
  function setTheme(patch) {
    Object.assign(savedTheme(getPres(selectedId)) || db.theme, patch); themeChanged();
  }
  function themeChanged() {
    save(); renderTheme(); broadcast();
    clearTimeout(themeTimer); themeTimer = setTimeout(renderGrid, 120);
  }
  function useTheme(id) {
    const p = getPres(selectedId); if (!p) return;
    if (id) p.themeId = id; else delete p.themeId;
    themeChanged();
  }
  function saveThemeAs() {
    const name = (prompt('Name for the new theme:', '') || '').trim(); if (!name) return;
    const { id: _id, name: _n, ...style } = savedTheme(getPres(selectedId)) || db.theme;
    const t = { ...DEFAULT_THEME, ...style, id: uid(), name };
    db.themes.push(t);
    if (getPres(selectedId)) useTheme(t.id); else themeChanged();
    toast(`Saved theme “${name}”`);
  }
  function renameTheme() {
    const t = savedTheme(getPres(selectedId)); if (!t) return;
    const name = (prompt('Rename theme:', t.name) || '').trim(); if (!name) return;
    t.name = name; themeChanged();
  }
  function deleteTheme() {
    const t = savedTheme(getPres(selectedId)); if (!t) return;
    const users = db.presentations.filter(p => p.themeId === t.id);
    if (!confirm(`Delete theme “${t.name}”? ${users.length} presentation${users.length === 1 ? '' : 's'} using it will go back to the default style.`)) return;
    users.forEach(p => delete p.themeId);
    db.themes = db.themes.filter(x => x !== t); themeChanged();
  }

  function renderAll() { renderLibrary(); renderPlaylist(); renderGrid(); renderTheme(); }

  // ---------- editor ----------
  let editingId = null;
  const SAMPLE_TEXT = '[Verse 1]\nFirst line\nSecond line\n\nThird line\nFourth line\n\n[Chorus]\nChorus line';
  function openEditor(id) {
    editingId = id;
    const p = id ? getPres(id) : null;
    $('#edName').value = p ? p.name : 'Untitled';
    $('#edText').value = p ? serialize(p) : SAMPLE_TEXT;
    $('#editor').hidden = false; $('#edText').focus();
  }
  const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  // Each picture becomes its own slide at the cursor. A new presentation still holding the sample text
  // becomes a slideshow instead.
  async function addEditorImages(files) {
    files = [...files].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    toast(`Adding ${files.length} image${files.length > 1 ? 's' : ''}…`);
    const refs = [];
    for (const f of files) {
      try {
        if (online) refs.push((await Lumen.uploadMedia(f)).src);
        else {
          const m = { id: uid(), name: f.name, type: 'image', src: await readDataUrl(f) };
          db.media.push(m); refs.push('#' + m.id);
        }
      } catch (e) { toast(`Could not add ${f.name}: ${e.message || 'read failed'}`); }
    }
    if (!refs.length) return;
    if (!online) { save(); renderMedia(); }
    const ta = $('#edText'), block = refs.map(r => '@image: ' + r).join('\n\n');
    if (!ta.value.trim() || ta.value === SAMPLE_TEXT) ta.value = '[Slideshow]\n' + block;
    else {
      const at = ta.selectionEnd;
      ta.value = (ta.value.slice(0, at) + '\n\n' + block + '\n\n' + ta.value.slice(at)).replace(/\n{3,}/g, '\n\n').trim();
    }
    if ($('#edName').value === 'Untitled' && ta.value.startsWith('[Slideshow]')) $('#edName').value = 'Slideshow';
    toast(`Added ${refs.length} image slide${refs.length > 1 ? 's' : ''}`);
  }
  function saveEditor() {
    const r = parseText($('#edText').value);
    const name = $('#edName').value.trim() || 'Untitled';
    if (editingId && getPres(editingId)) Object.assign(getPres(editingId), { name, groups: r.groups, bg: r.bg });
    else { const p = { id: uid(), name, groups: r.groups, bg: r.bg }; db.presentations.push(p); selectedId = p.id; }
    save(); $('#editor').hidden = true; renderAll();
    if (live.presId === editingId && live.slide) { const s = flat(getPres(editingId))[live.idx]; if (s) goLive(editingId, live.idx); }
  }

  // ---------- timer & clock ----------
  const fmt = sec => { const neg = sec < 0; sec = Math.abs(Math.round(sec)); const m = Math.floor(sec / 60), s = sec % 60; return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'); };
  const timerRemaining = () => live.timer.endAt ? (live.timer.endAt - Lumen.now()) / 1000 : live.timer.remaining;
  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const r = timerRemaining();
    $('#timerBig').textContent = fmt(r); $('#timerBig').classList.toggle('neg', r < 0);
  }, 250);

  // ---------- toast ----------
  let tt;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2200); }

  // ---------- wire up ----------
  const popup = (url, name) => { const w = window.open(url, name, 'width=1280,height=760'); if (!w) toast('Allow pop-ups to open output windows'); else if (!online) setTimeout(broadcast, 600); };
  $('#btnOutput').onclick = () => popup('output.html', 'lumen-output');
  $('#btnStage').onclick = () => popup('stage.html', 'lumen-stage');
  $('#btnExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ ...db, media: db.media.filter(m => !m.src.startsWith('blob:')) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lumen-library.json'; a.click();
  };
  $('#btnImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => { const d = JSON.parse(t); if (!d.presentations) throw 0; db = { ...seed(), ...d }; save(); selectedId = db.presentations[0]?.id; renderAll(); renderMedia(); renderMessages(); renderTheme(); toast('Library imported'); })
      .catch(() => toast('That file is not a Lumen library'));
    e.target.value = '';
  };
  $('#btnReset').onclick = () => { if (confirm('Reset library to the demo content? Your changes will be lost.')) { db = seed(); save(); selectedId = db.playlist[0]; clear('all'); renderAll(); renderMedia(); renderMessages(); renderTheme(); } };

  $('#libSearch').oninput = renderLibrary;
  $('#btnNewPres').onclick = () => openEditor(null);
  $('#btnEdit').onclick = () => selectedId && openEditor(selectedId);
  $('#btnAddPlaylist').onclick = () => { if (selectedId && !db.playlist.includes(selectedId)) { db.playlist.push(selectedId); save(); renderPlaylist(); toast('Added to playlist'); } };
  $('#btnDelete').onclick = () => {
    const p = getPres(selectedId); if (!p || !confirm(`Delete “${p.name}”?`)) return;
    db.presentations = db.presentations.filter(x => x !== p); db.playlist = db.playlist.filter(id => id !== p.id);
    if (live.presId === p.id) clear('slide');
    selectedId = db.playlist[0] || db.presentations[0]?.id; save(); renderAll();
  };
  $('#thumbSize').oninput = e => $('#slideGrid').style.setProperty('--tw', e.target.value + 'px');

  $('#edSave').onclick = saveEditor;
  $('#edImages').onclick = () => $('#edImageFile').click();
  $('#edImageFile').onchange = e => { addEditorImages(e.target.files); e.target.value = ''; };
  $('#edText').ondragover = e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
  $('#edText').ondrop = e => { if (e.dataTransfer.files.length) { e.preventDefault(); addEditorImages(e.dataTransfer.files); } };
  $('#edCancel').onclick = () => { $('#editor').hidden = true; };

  $$('[data-clear]').forEach(b => b.onclick = () => clear(b.dataset.clear));
  $('#btnNext').onclick = () => step(1);
  $('#btnPrev').onclick = () => step(-1);

  $$('.tabs button').forEach(b => b.onclick = () => {
    $$('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
  });

  $('#thFont').onchange = e => setTheme({ font: e.target.value });
  $('#thSize').oninput = e => setTheme({ size: +e.target.value });
  $('#thColor').oninput = e => setTheme({ color: e.target.value });
  $('#thBold').onchange = e => setTheme({ bold: e.target.checked });
  $('#thShadow').onchange = e => setTheme({ shadow: e.target.checked });
  $('#thUpper').onchange = e => setTheme({ upper: e.target.checked });
  $$('#thAlign button').forEach(b => b.onclick = () => setTheme({ align: b.dataset.v }));
  $$('#thVAlign button').forEach(b => b.onclick = () => setTheme({ valign: b.dataset.v }));
  $('#thSaved').onchange = e => useTheme(e.target.value);
  $('#thSaveAs').onclick = saveThemeAs;
  $('#thRename').onclick = renameTheme;
  $('#thDelete').onclick = deleteTheme;
  $('#logoText').oninput = e => { db.logoText = e.target.value; save(); broadcast(); };

  $('#msgShow').onclick = () => {
    const v = $('#msgInput').value.trim(); if (!v) return;
    if (!db.messages.includes(v)) db.messages.unshift(v);
    live.msg = v; $('#msgInput').value = ''; save(); broadcast(); renderMessages();
  };
  $('#msgInput').onkeydown = e => { if (e.key === 'Enter') $('#msgShow').click(); };
  $('#quickGo').onclick = () => {
    const v = $('#quickText').value.trim(); if (!v) return;
    live.presId = null; live.idx = -1; live.logo = false; live.next = '';
    live.slide = { text: v, label: 'Quick slide', color: '#555' }; broadcast();
  };

  $('#timerSet').onclick = () => { const s = Math.max(0, +$('#timerMin').value) * 60; live.timer = { dur: s, endAt: null, remaining: s }; broadcast(); };
  $('#timerStart').onclick = () => { if (!live.timer.endAt) { live.timer.endAt = Lumen.now() + live.timer.remaining * 1000; broadcast(); } };
  $('#timerPause').onclick = () => { if (live.timer.endAt) { live.timer.remaining = timerRemaining(); live.timer.endAt = null; broadcast(); } };
  $('#timerReset').onclick = () => { live.timer = { dur: live.timer.dur, endAt: null, remaining: live.timer.dur }; broadcast(); };
  $('#stageSend').onclick = () => { live.stageMsg = $('#stageInput').value.trim(); broadcast(); toast('Sent to stage'); };
  $('#stageInput').onkeydown = e => { if (e.key === 'Enter') $('#stageSend').click(); };
  $('#stageClear').onclick = () => { live.stageMsg = ''; $('#stageInput').value = ''; broadcast(); };

  $('#btnAddMedia').onclick = () => $('#mediaFile').click();
  $('#mediaFile').onchange = e => { addMediaFiles(e.target.files); e.target.value = ''; };
  const bin = $('#mediaBin');
  bin.ondragover = e => { e.preventDefault(); bin.classList.add('drop'); };
  bin.ondragleave = () => bin.classList.remove('drop');
  bin.ondrop = e => { e.preventDefault(); bin.classList.remove('drop'); addMediaFiles(e.dataTransfer.files); };

  document.addEventListener('keydown', e => {
    if (!$('#editor').hidden) { if (e.key === 'Escape') $('#editor').hidden = true; if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); } return; }
    if (e.target.matches('input, textarea, select')) return;
    const map = { ArrowRight: () => step(1), ArrowDown: () => step(1), ' ': () => step(1), PageDown: () => step(1),
      ArrowLeft: () => step(-1), ArrowUp: () => step(-1), PageUp: () => step(-1),
      F1: () => clear('all'), F2: () => clear('slide'), F3: () => clear('bg'), F4: () => clear('msg'), F6: () => clear('logo') };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  });

  // ---------- server sync ----------
  Lumen.on('hello', broadcast); // a same-browser window opened without the server
  Lumen.on('error', toast);
  Lumen.on('state', d => { adoptLive(d.live); refreshLive(); renderMessages(); }); // another operator console
  Lumen.on('library', async () => {
    const d = await Lumen.loadLibrary().catch(() => null);
    if (!valid(d)) return;
    db = normalize(d);
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
    if (!getPres(selectedId)) selectedId = db.playlist[0] || db.presentations[0]?.id;
    renderAll(); renderMedia(); renderMessages(); renderTheme(); refreshLive();
  });
  function renderStatus(s) {
    const el = $('#srvStatus');
    el.className = 'srv ' + (!s.online ? 'local' : s.streaming ? 'ok' : 'down');
    el.textContent = !s.online ? 'Local only' : s.streaming ? 'Server' : 'Reconnecting…';
    el.title = !s.online ? 'No Lumen server — library saved in this browser, output windows must be on this computer'
      : s.streaming ? 'Connected — library, media and live state are kept on the server'
      : 'Lost the server — output windows on this computer still follow along';
  }
  Lumen.on('status', renderStatus);
  renderStatus({ online, streaming: Lumen.streaming });

  renderAll(); renderMedia(); renderMessages(); renderTheme();
  if (online) refreshLive(); else broadcast();
  if (fresh || !online) save();
  if (loadFailed) toast('Could not load the library from the server — showing this browser\'s copy');
})();
