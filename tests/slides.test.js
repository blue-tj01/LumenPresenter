// Tests for console/slides.js: turning the editor's text into groups of slides, and back. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let slides;
before(async () => { slides = await import('../console/slides.js'); });

it('splits text into named groups of slides', () => {
  const { groups, bg } = slides.parseText('[Verse 1]\nAmazing grace\nhow sweet\n\nThat saved\n\n[Chorus]\r\nMy chains\n\n\n[Empty]\n');
  assert.deepEqual(groups, [
    { name: 'Verse 1', slides: ['Amazing grace\nhow sweet', 'That saved'] },
    { name: 'Chorus', slides: ['My chains'] },
  ]);
  assert.equal(bg, null);
});

it('puts slides before any heading in a group called Slides, and reads the background line', () => {
  const r = slides.parseText('@bg: #112233\nWelcome\n\n[Notes]\nBe seated');
  assert.deepEqual(r.groups.map(g => g.name), ['Slides', 'Notes']);
  assert.deepEqual(r.bg, { type: 'color', src: '#112233' });
  assert.deepEqual(slides.parseText('@BG: /media/abc.mp4').bg, { type: 'video', src: '/media/abc.mp4' });
  assert.deepEqual(slides.parseText('@bg: linear-gradient(#000, #fff)').bg.type, 'gradient');
  assert.deepEqual(slides.parseText('@bg: photo.jpg').bg, { type: 'image', src: 'photo.jpg' });
});

it('takes picture and video lines out of a slide', () => {
  assert.deepEqual(slides.splitSlide('@image: #m1\nHello\n@VIDEO: /media/a.mp4'), { text: 'Hello', image: '#m1', video: '/media/a.mp4' });
  assert.deepEqual(slides.splitSlide('Just words'), { text: 'Just words', image: null, video: null });
});

it('colours groups by kind, and any other name the same each time', () => {
  assert.equal(slides.groupColor('Chorus 2'), '#d6334a');
  assert.equal(slides.groupColor('Pre-Chorus'), '#e67e22');
  assert.equal(slides.groupColor('Coda'), slides.groupColor('coda'));
  assert.match(slides.groupColor('Coda'), /^hsl\(\d+ 55% 45%\)$/);
});
