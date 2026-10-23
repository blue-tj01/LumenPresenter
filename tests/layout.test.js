// Tests for console/layout-model.js: the layout editor's snapping, resizing, rotating, picking, arranging, colours
// and undo. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let m;
before(async () => { m = await import('../console/layout-model.js'); });

it('names elements by what they show', () => {
  assert.equal(m.elementName({ type: 'text', bind: 'slide.text' }), 'The slide’s words');
  assert.equal(m.elementName({ type: 'text', content: 'Welcome\nto church' }), 'Welcome');
  assert.equal(m.elementName({ type: 'text', name: 'Lyrics', bind: 'slide.text' }), 'Lyrics');
  assert.equal(m.elementName({ type: 'shape', kind: 'ellipse' }), 'Circle');
  assert.equal(m.elementName({ type: 'image' }), 'Picture');
});

it('makes new elements centred on the canvas', () => {
  const t = m.newElement('text', 'e1');
  assert.deepEqual(t.frame, { x: 560, y: 440, w: 800, h: 200 });
  assert.equal(t.style.size, 72);
  assert.deepEqual(m.newElement('ellipse', 'e2').kind, 'ellipse');
  assert.equal(m.newElement('image', 'e3', 'media:a.png').src, 'media:a.png');
  assert.equal(m.newElement('video', 'e4', 'media:a.mp4').loop, true);
  assert.throws(() => m.newElement('ticker', 'e5'));
});

it('snaps a moved frame to the canvas middle and to other elements', () => {
  const lines = m.snapLines([{ x: 100, y: 100, w: 200, h: 100 }]);
  const f = { x: 0, y: 0, w: 400, h: 200 };
  // Its middle lands 6 px from the canvas middle (960): it snaps there.
  let r = m.moveFrame(f, 754, 500, lines, 10);
  assert.deepEqual([r.frame.x, r.guides.x], [760, [960]]);
  // Its top lands 4 px from the other element's bottom (200).
  r = m.moveFrame(f, 500, 196, lines, 10);
  assert.deepEqual([r.frame.y, r.guides.y], [200, [200]]);
  // Without snapping it moves exactly.
  r = m.moveFrame(f, 754, 196, lines, 0);
  assert.deepEqual([r.frame.x, r.frame.y, r.guides], [754, 196, { x: [], y: [] }]);
});

it('resizes from any handle, keeping a minimum size and, at a corner, the shape', () => {
  const f = { x: 100, y: 100, w: 400, h: 200 };
  assert.deepEqual(m.resizeFrame(f, 'e', 50, 999).frame, { x: 100, y: 100, w: 450, h: 200 });
  assert.deepEqual(m.resizeFrame(f, 'nw', 20, 30).frame, { x: 120, y: 130, w: 380, h: 170 });
  assert.deepEqual(m.resizeFrame(f, 'w', 500, 0).frame, { x: 480, y: 100, w: 20, h: 200 });
  assert.deepEqual(m.resizeFrame(f, 'se', 200, 0, { keepRatio: true }).frame, { x: 100, y: 100, w: 600, h: 300 });
  assert.deepEqual(m.resizeFrame(f, 'nw', -200, 0, { keepRatio: true }).frame, { x: -100, y: 0, w: 600, h: 300 });
  const lines = m.snapLines();
  const r = m.resizeFrame(f, 'e', 455, 0, { lines, within: 8 });
  assert.deepEqual([r.frame.w, r.guides.x], [860, [960]]);
});

it('rotates towards the pointer, snapping upright and to steps', () => {
  const f = { x: 0, y: 0, w: 200, h: 200 };
  assert.equal(m.rotation(f, 100, -100), 0);
  assert.equal(m.rotation(f, 300, 100), 90);
  assert.equal(m.rotation(f, 102, -100), 0);
  assert.equal(m.rotation(f, 100, 300), 180);
  assert.equal(m.rotation(f, 200, 0, 15), 45);
});

it('picks the front-most element under the pointer, skipping hidden and locked ones', () => {
  const els = [{ id: 'a', frame: { x: 0, y: 0, w: 500, h: 500 } }, { id: 'b', frame: { x: 100, y: 100, w: 100, h: 100 } },
    { id: 'c', frame: { x: 100, y: 100, w: 100, h: 100 }, locked: true }];
  assert.equal(m.elementAt(els, 150, 150).id, 'b');
  assert.equal(m.elementAt(els, 300, 300).id, 'a');
  assert.equal(m.elementAt(els, 900, 900), null);
  // A long thin box turned upright covers points above its middle, not beside it.
  const bar = { frame: { x: 0, y: 95, w: 200, h: 10, rotate: 90 } };
  assert.equal(m.contains(bar, 100, 20), true);
  assert.equal(m.contains(bar, 20, 100), false);
});

it('moves an element forward, backward, to the front and the back', () => {
  const els = ['a', 'b', 'c'].map(id => ({ id }));
  const ids = l => l.map(e => e.id).join('');
  assert.equal(ids(m.reorder(els, 'a', 'forward')), 'bac');
  assert.equal(ids(m.reorder(els, 'a', 'front')), 'bca');
  assert.equal(ids(m.reorder(els, 'c', 'back')), 'cab');
  assert.equal(ids(m.reorder(els, 'a', 'backward')), 'abc');
  assert.equal(ids(m.reorder(els, 'x', 'front')), 'abc');
});

it('lines frames up with the canvas', () => {
  const f = { x: 10, y: 10, w: 400, h: 200 };
  assert.deepEqual(m.alignFrame(f, 'center'), { x: 760, y: 10, w: 400, h: 200 });
  assert.deepEqual(m.alignFrame(f, 'bottom'), { x: 10, y: 880, w: 400, h: 200 });
  assert.deepEqual(m.alignFrame(f, 'right').x, 1520);
});

it('reads and writes colours with an opacity', () => {
  assert.deepEqual(m.parseColor('#FFF'), { hex: '#ffffff', alpha: 1 });
  assert.deepEqual(m.parseColor('#10203080'), { hex: '#102030', alpha: 0.5 });
  assert.deepEqual(m.parseColor('rgba(8, 10, 18, .55)'), { hex: '#080a12', alpha: 0.55 });
  assert.deepEqual(m.parseColor('rgb(255 0 0 / 50%)'), { hex: '#ff0000', alpha: 0.5 });
  assert.deepEqual(m.parseColor('linear-gradient(red, blue)'), { hex: '#ffffff', alpha: 1 });
  assert.equal(m.toColor('#ff0000'), '#ff0000');
  assert.equal(m.toColor('#080a12', 0.55), 'rgba(8, 10, 18, 0.55)');
});

it('undoes and redoes finished changes', () => {
  const h = m.history({ n: 1 });
  assert.equal(h.canUndo, false);
  assert.equal(h.push({ n: 1 }), false); // nothing changed
  h.push({ n: 2 }); h.push({ n: 3 });
  assert.deepEqual(h.undo(), { n: 2 });
  assert.deepEqual(h.undo(), { n: 1 });
  assert.equal(h.undo(), null);
  assert.equal(h.changed, false);
  assert.deepEqual(h.redo(), { n: 2 });
  h.push({ n: 9 });
  assert.equal(h.canRedo, false);
  assert.equal(h.changed, true);
  const v = h.undo(); v.n = 100;
  assert.deepEqual(h.redo(), { n: 9 }); // what it handed out is a copy
});

it('starts a slide design from its theme, with the words as its own text', () => {
  let n = 0;
  const layout = { elements: [{ id: 'text', type: 'text', name: 'Slide text', bind: 'slide.text', frame: { x: 1, y: 2, w: 3, h: 4 } },
    { id: 'credits', type: 'text', bind: 'pres.credits' }, { type: 'shape' }] };
  const d = m.designFrom(layout, 'Youth night\nFriday', () => 'n' + ++n);
  assert.deepEqual(d.elements[0], { id: 'text', type: 'text', content: 'Youth night\nFriday', frame: { x: 1, y: 2, w: 3, h: 4 } });
  assert.equal(d.elements[1].bind, 'pres.credits');
  assert.equal(d.elements[2].id, 'n1');
  assert.equal(layout.elements[0].bind, 'slide.text'); // the theme is untouched
  assert.equal(m.designFrom(layout, '', () => 'x').elements[0].content, 'New slide');
  d.elements.push({ type: 'text', content: '  ' }, { type: 'text', content: 'Hidden', hidden: true }, { type: 'text', content: 'All ages' });
  assert.equal(m.designWords(d), 'Youth night\nFriday\nAll ages');
});

it('reads and writes two-colour gradients', () => {
  assert.deepEqual(m.parseGradient('linear-gradient(160deg,#1b2030,#0d0f15)'), { angle: 160, from: '#1b2030', to: '#0d0f15' });
  assert.deepEqual(m.parseGradient('linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, #fff 100%)'), { angle: 90, from: 'rgba(0, 0, 0, 0.5)', to: '#fff' });
  assert.equal(m.parseGradient('linear-gradient(135deg,#ff7a45,#c2185b 55%,#3a0b4d)'), null);
  assert.equal(m.parseGradient('radial-gradient(#000, #fff)'), null);
  assert.equal(m.gradient({ angle: 45, from: '#000000', to: '#ffffff' }), 'linear-gradient(45deg, #000000, #ffffff)');
  assert.deepEqual(m.parseGradient(m.gradient()), { angle: 160, from: '#1b2030', to: '#0d0f15' });
});
