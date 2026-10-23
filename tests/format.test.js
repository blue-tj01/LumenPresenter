// Tests for console/format.js: the slide format, converting older libraries, and resolving what a screen draws.
// Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let f;
before(async () => {
  f = await import('../console/format.js');
});

const V1 = () => ({
  presentations: [
    {
      id: 'p1',
      name: 'Song',
      bg: { type: 'image', src: 'media/abc.jpg' },
      order: ['Chorus', 'verse 1', 'Missing', 'Chorus'],
      themeId: 'big-bold',
      advance: 5,
      groups: [
        { name: 'Verse 1', slides: ['Line one\nLine two', '@image: #m1\nWith picture'] },
        { name: 'Chorus', slides: ['Sing'] },
      ],
    },
    { id: 'p2', name: 'Clip', groups: [{ name: 'Video', slides: ['@video: folders/f1/clips/a.mp4'] }], bg: null },
  ],
  playlist: ['p1'],
  theme: { size: 80, bold: false, margin: 60 },
  defaultThemeId: 'classic',
  themes: [
    {
      id: 'classic',
      name: 'Classic',
      font: 'Arial',
      size: 90,
      color: '#ffff00',
      bold: true,
      shadow: false,
      upper: true,
      align: 'left',
      valign: 'top',
      margin: 100,
      lineHeight: 1.3,
    },
  ],
  messages: ['Hi'],
  logoText: 'X',
});

it('converts a format 1 library, keeping everything it had', () => {
  const lib = f.migrateLibrary(V1());
  assert.equal(lib.format, 2);
  assert.deepEqual([lib.playlist, lib.messages, lib.logoText, lib.defaultTemplateId], [['p1'], ['Hi'], 'X', 'classic']);
  assert.equal('theme' in lib || 'themes' in lib || 'defaultThemeId' in lib, false);
  const [song, clip] = lib.presentations;
  assert.deepEqual(song.groups, [
    {
      id: 'g1',
      name: 'Verse 1',
      slides: [
        { id: 's2', text: 'Line one\nLine two' },
        { id: 's3', text: 'With picture', media: { type: 'image', src: 'bin:m1' } },
      ],
    },
    { id: 'g4', name: 'Chorus', slides: [{ id: 's5', text: 'Sing' }] },
  ]);
  assert.deepEqual(song.background, { type: 'image', src: 'media:abc.jpg' });
  assert.deepEqual(song.arrangements, [{ id: 'a1', name: 'Default', order: ['g4', 'g1', 'g4'] }]);
  assert.deepEqual(
    [song.templateId, song.advance, 'bg' in song, 'order' in song, 'themeId' in song],
    ['big-bold', 5, false, false, false],
  );
  assert.deepEqual(clip.groups[0].slides[0].media, { type: 'video', src: 'folder:f1/clips/a.mp4' });
  assert.deepEqual(clip.arrangements, []);
});

it('turns themes into templates with one text box in the same place and style', () => {
  const lib = f.migrateLibrary(V1());
  const [classic] = lib.templates;
  assert.deepEqual([classic.id, classic.name], ['classic', 'Classic']);
  assert.deepEqual(classic.layout.elements, [
    {
      id: 'text',
      type: 'text',
      name: 'Slide text',
      bind: 'slide.text',
      frame: { x: 100, y: 100, w: 1720, h: 880 },
      style: {
        ...f.TEXT_STYLE,
        font: 'Arial',
        size: 90,
        color: '#ffff00',
        weight: 700,
        shadow: false,
        upper: true,
        align: 'left',
        valign: 'top',
        lineHeight: 1.3,
      },
    },
  ]);
  const base = f.mainText(lib.baseTemplate);
  assert.deepEqual([base.frame.x, base.style.size, base.style.weight], [60, 80, 400]);
  // A library with no themes of its own gets the built-in ones.
  assert.deepEqual(
    f.migrateLibrary({ presentations: [] }).templates.map(t => t.id),
    ['classic', 'lower-third', 'scripture', 'big-bold'],
  );
});

it('leaves a library in this format, or a newer one, as it is', () => {
  const lib = f.migrateLibrary(V1());
  assert.equal(f.migrateLibrary(lib), lib);
  const newer = { format: 3, presentations: [] };
  assert.equal(f.migrateLibrary(newer), newer);
});

it('plays groups in the first arrangement, or as written', () => {
  const [song] = f.migrateLibrary(V1()).presentations;
  assert.deepEqual(f.arrangement(song), [1, 0, 1]);
  assert.deepEqual(f.arrangement({ ...song, arrangements: [] }), [0, 1]);
  assert.deepEqual(f.arrangement({ ...song, arrangements: [{ order: ['gone'] }] }), [0, 1]);
});

it('resolves a slide into what a screen draws, with words bound and media as URLs', () => {
  const template = f.textTemplate({ size: 70 });
  template.layout.elements.push({
    id: 'c',
    type: 'text',
    bind: 'pres.meta.copyright',
    showOn: 'last',
    frame: { x: 0, y: 1000, w: 1920, h: 80 },
    style: { size: 24 },
  });
  const pres = { meta: { copyright: 'Public Domain' } };
  const slide = { id: 's1', text: 'Hello', media: { type: 'video', src: 'media:v.mp4' } };
  const first = f.resolveSlide(slide, { template, pres, index: 0, count: 2 });
  assert.deepEqual(
    first.map(e => e.type),
    ['video', 'text'],
  );
  assert.deepEqual(first[0], {
    type: 'video',
    src: 'media/v.mp4',
    fit: 'contain',
    loop: false,
    muted: false,
    fill: '#000',
  });
  assert.equal(first[1].content, 'Hello');
  assert.equal(first[1].style.size, 70);
  assert.equal('bind' in first[1] || 'id' in first[1], false);
  const last = f.resolveSlide({ id: 's2', text: '' }, { template, pres, index: 1, count: 2 });
  assert.deepEqual(
    last.map(e => e.content),
    ['Public Domain'],
  ); // no words: no empty text box
  // A slide with its own layout ignores the template; media bin entries are looked up.
  const own = {
    id: 's3',
    layout: {
      elements: [
        { id: 'i', type: 'image', src: 'bin:m1', frame: { x: 1, y: 2, w: 3, h: 4 } },
        { id: 'h', type: 'image', src: 'bin:m2', hidden: true },
      ],
    },
  };
  assert.deepEqual(f.resolveSlide(own, { template, bin: id => (id === 'm1' ? 'data:image/png;base64,AA' : null) }), [
    { type: 'image', src: 'data:image/png;base64,AA', frame: { x: 1, y: 2, w: 3, h: 4 } },
  ]);
});

it('round-trips a presentation through the text editor, keeping slide ids and settings', () => {
  const [song] = f.migrateLibrary(V1()).presentations;
  song.groups[0].slides[0].notes = 'Slow';
  song.groups[0].slides.push(
    { id: 'own', layout: { elements: [] } },
    { id: 'own2', text: 'Youth night\nFriday', layout: { elements: [] } },
  );
  const text = f.toText(song);
  assert.equal(
    text,
    '@bg: media/abc.jpg\n[Verse 1]\nLine one\nLine two\n\nWith picture\n@image: #m1\n\n@slide: own\n\n' +
      '@slide: own2 · Youth night\n\n[Chorus]\nSing',
  );
  const parsed = {
    bg: { type: 'image', src: 'media/abc.jpg' },
    groups: [
      {
        name: 'Verse 1',
        slides: ['Line one fixed\nLine two', '@slide: own', 'New slide', '@slide: own2 · Youth night'],
      },
      { name: 'Bridge', slides: ['B'] },
    ],
  };
  const { groups, background } = f.fromText(parsed, song);
  assert.deepEqual(background, { type: 'image', src: 'media:abc.jpg' });
  assert.equal(groups[0].id, 'g1');
  assert.deepEqual(groups[0].slides[0], { id: 's2', text: 'Line one fixed\nLine two', notes: 'Slow' });
  assert.equal(groups[0].slides[1], song.groups[0].slides[2]); // the slide with its own layout, as it was
  assert.equal(groups[0].slides[2].text, 'New slide');
  assert.notEqual(groups[0].slides[2].id, 's3'); // position 2 held a laid-out slide, so this one is new
  assert.equal(groups[0].slides[3], song.groups[0].slides[3]); // its first words after the id change nothing
  assert.equal(groups[1].name, 'Bridge');
  assert.match(groups[1].id, /^[a-z0-9]+$/);
  assert.deepEqual(f.orderIds(groups, ['bridge', 'Nope', 'Verse 1']), [groups[1].id, 'g1']);
});

it('lists the media a slide uses, and reads references both ways', () => {
  assert.deepEqual(
    f.slideRefs({ media: { src: 'bin:a' }, background: { src: 'media:b' }, layout: { elements: [{ src: 'c' }, {}] } }),
    ['bin:a', 'media:b', 'c'],
  );
  for (const [legacy, ref] of [
    ['media/x.png', 'media:x.png'],
    ['folders/f/a b.mp4', 'folder:f/a b.mp4'],
    ['#id1', 'bin:id1'],
    ['https://e.com/a.png', 'https://e.com/a.png'],
  ]) {
    assert.equal(f.toRef(legacy), ref);
    assert.equal(f.legacyRef(ref), legacy);
  }
  assert.equal(f.refUrl('folder:f/a b.mp4'), 'folders/f/a b.mp4');
  assert.equal(f.slideSummary({ media: { type: 'video' } }), '[Video]');
  assert.equal(f.slideSummary({ layout: { elements: [{ type: 'text', content: 'Hi' }] } }), 'Hi');
});

it("shows a song's credits on its last slide, with the church's licence number", () => {
  const pres = { name: 'Amazing Grace', meta: { author: 'John Newton', copyright: 'Public Domain', ccli: '22025' } };
  assert.equal(
    f.credits(pres, '123456'),
    '“Amazing Grace” · John Newton\nPublic Domain · CCLI Song # 22025 · CCLI Licence # 123456',
  );
  assert.equal(f.credits({ name: 'X', meta: { copyright: '2004 sixsteps Music' } }), '“X”\n© 2004 sixsteps Music');
  assert.equal(f.credits({ name: 'Notices' }, '123456'), '', 'only songs with details have credits');
  const template = f.textTemplate();
  const draw = (index, opts = {}) =>
    f
      .resolveSlide({ id: 's', text: 'Words' }, { template, pres, index, count: 3, licence: '9', ...opts })
      .filter(e => e.type === 'text')
      .map(e => e.content);
  assert.deepEqual(draw(0), ['Words']);
  assert.deepEqual(draw(2), ['Words', f.credits(pres, '9')]);
  assert.deepEqual(draw(2, { showCredits: false }), ['Words']);
  // A template that places the details itself is left as it is.
  const own = {
    layout: {
      elements: [
        ...template.layout.elements,
        { id: 'c', type: 'text', bind: 'pres.meta.copyright', showOn: 'first', frame: { x: 0, y: 0, w: 100, h: 100 } },
      ],
    },
  };
  assert.deepEqual(draw(2, { template: own }), ['Words']);
  assert.deepEqual(draw(0, { template: own }), ['Words', 'Public Domain']);
});

it('sends formatted words to the screens as runs, with the plain words for everything else', () => {
  const template = f.textTemplate();
  const [words] = f.resolveSlide({ id: 's', text: 'Jesus is **{gold}Lord{/}**' }, { template, showCredits: false });
  assert.equal(words.content, 'Jesus is Lord');
  assert.deepEqual(words.runs, [{ text: 'Jesus is ' }, { text: 'Lord', bold: true, color: '#ffd54f' }]);
  const [plain] = f.resolveSlide({ id: 's', text: '5 * 3' }, { template, showCredits: false });
  assert.deepEqual([plain.content, 'runs' in plain], ['5 * 3', false]);
  assert.deepEqual(
    f.resolveSlide({ id: 's', text: '****' }, { template, showCredits: false }),
    [],
    'marks with no words draw nothing',
  );
  assert.equal(f.slideSummary({ text: 'Amazing **grace**' }), 'Amazing grace');
});

it("shows a slide with the theme layout it picked, or the theme's main one", () => {
  const template = f.textTemplate();
  template.layouts = [
    {
      id: 'title',
      name: 'Title',
      layout: {
        elements: [
          { id: 't', type: 'text', bind: 'pres.name', frame: { x: 0, y: 0, w: 1920, h: 300 }, style: { size: 140 } },
        ],
      },
    },
  ];
  const opts = { template, pres: { name: 'Easter Sunday' }, showCredits: false };
  assert.deepEqual(
    f.resolveSlide({ id: 's', text: 'Words', layoutId: 'title' }, opts).map(e => [e.content, e.style.size]),
    [['Easter Sunday', 140]],
  );
  assert.deepEqual(
    f.resolveSlide({ id: 's', text: 'Words' }, opts).map(e => e.content),
    ['Words'],
  );
  assert.deepEqual(
    f.resolveSlide({ id: 's', text: 'Words', layoutId: 'gone' }, opts).map(e => e.content),
    ['Words'],
  );
  assert.equal(f.templateLayout(template, 'title'), template.layouts[0].layout);
});

it('gives the stage display a layout like the standard one, ready for the stage page to fill in', () => {
  const t = f.stageTemplate();
  assert.deepEqual(
    t.layout.elements.filter(e => e.bind).map(e => e.bind),
    ['stage.clock', 'stage.timer', 'stage.group', 'stage.current', 'stage.next', 'stage.message'],
  );
  t.layout.elements.push(
    { id: 'logo', type: 'image', src: 'bin:m1', frame: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'off', type: 'text', content: 'Hidden', hidden: true },
    { id: 'own', type: 'text', content: '**Band:**', name: 'Label' },
  );
  const els = f.resolveStage(t.layout, { bin: id => `data:${id}` });
  const cur = els.find(e => e.bind === 'stage.current');
  assert.deepEqual([cur.content, cur.style.size, cur.style.lineHeight, 'id' in cur], ['', 76, 1.2, false]);
  assert.equal(els.find(e => e.type === 'image').src, 'data:m1');
  assert.deepEqual(
    els.filter(e => e.type === 'text' && !e.bind).map(e => [e.content, e.runs, 'name' in e]),
    [['Band:', [{ text: 'Band:', bold: true }], false]],
  );
});
