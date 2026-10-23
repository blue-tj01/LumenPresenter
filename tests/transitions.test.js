// Tests for console/transitions.js: which slide transition plays, and for how long. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let t;
before(async () => {
  t = await import('../console/transitions.js');
});

it('fades by default, for as long as a fade takes', () => {
  assert.deepEqual(t.transitionFor(null, {}), { type: 'fade', ms: 450 });
  assert.deepEqual(t.transitionFor({ name: 'Song' }, undefined), { type: 'fade', ms: 450 });
});

it("plays the presentation's own transition before the library's", () => {
  const lib = { transition: { type: 'push' } };
  assert.deepEqual(t.transitionFor({}, lib), { type: 'push', ms: 500 });
  assert.deepEqual(t.transitionFor({ transition: { type: 'dip' } }, lib), { type: 'dip', ms: 800 });
  assert.deepEqual(t.transitionFor({ transition: { type: 'cut' } }, lib), { type: 'cut', ms: 0 });
});

it("uses the library's length for whichever type plays, and the presentation's own before it", () => {
  const lib = { transition: { type: 'fade', secs: 1.2 } };
  assert.deepEqual(t.transitionFor({ transition: { type: 'zoom' } }, lib), { type: 'zoom', ms: 1200 });
  assert.deepEqual(t.transitionFor({ transition: { type: 'zoom', secs: 0.3 } }, lib), { type: 'zoom', ms: 300 });
  assert.deepEqual(t.transitionFor({ transition: { type: 'cut' } }, lib), { type: 'cut', ms: 0 });
});

it("ignores settings it doesn't know, and keeps lengths sensible", () => {
  assert.equal(t.cleanTransition({ type: 'spin' }), null);
  assert.equal(t.cleanTransition('fade'), null);
  assert.deepEqual(t.cleanTransition({ type: 'fade', secs: '' }), { type: 'fade' });
  assert.deepEqual(t.cleanTransition({ type: 'fade', secs: 60 }), { type: 'fade', secs: 5 });
  assert.deepEqual(t.cleanTransition({ type: 'push', secs: -1 }), { type: 'push' });
  assert.deepEqual(t.cleanTransition({ type: 'cut', secs: 2 }), { type: 'cut' });
  assert.deepEqual(t.transitionFor({ transition: { type: 'spin' } }, { transition: { type: 'dip' } }), {
    type: 'dip',
    ms: 800,
  });
});

it('names every transition once', () => {
  const ids = t.TRANSITIONS.map(x => x.id);
  assert.deepEqual(ids, ['cut', 'fade', 'dip', 'push', 'zoom']);
  assert.ok(t.TRANSITIONS.every(x => x.name && x.secs >= 0));
});
