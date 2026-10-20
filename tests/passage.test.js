// Tests for console/passage.js: Bible passages as slides. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let p, f;
before(async () => { p = await import('../console/passage.js'); f = await import('../console/format.js'); });

const v = (chapter, verse, text, book = 43, name = 'John') => ({ book, chapter, verse, text, ref: `${name} ${chapter}:${verse}` });

it('leaves short text alone, and splits long text where it reads naturally', () => {
  assert.deepEqual(p.splitText('Jesus wept.', 50), ['Jesus wept.']);
  const long = 'And it came to pass in those days, that there went out a decree from Caesar Augustus. All the world should be taxed; and all went to be taxed, every one into his own city.';
  const parts = p.splitText(long, 100);
  assert.deepEqual(parts, ['And it came to pass in those days, that there went out a decree from Caesar Augustus.',
    'All the world should be taxed; and all went to be taxed, every one into his own city.']);
  for (const max of [30, 45, 60]) {
    const pieces = p.splitText(long, max);
    assert.equal(pieces.join(' '), long, `nothing lost at ${max}`);
    assert.ok(pieces.every(s => s.length <= max), `every part fits in ${max}`);
  }
  assert.deepEqual(p.splitText('x'.repeat(25), 10), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
});

it('puts verses on slides, splitting a long one and naming each group for its verses', () => {
  const verses = [v(3, 16, 'For God so loved the world.'), v(3, 17, 'For God sent not his Son.'),
    v(3, 18, 'He that believeth on him is not condemned: but he that believeth not is condemned already.')];
  const one = p.passageGroups(verses, { abbrev: 'KJV', maxChars: 60 });
  assert.deepEqual(one.map(g => [g.name, g.slides.map(s => s.text)]), [
    ['John 3:16', ['For God so loved the world.']],
    ['John 3:17', ['For God sent not his Son.']],
    ['John 3:18', ['He that believeth on him is not condemned:', 'but he that believeth not is condemned already.']],
  ]);
  assert.deepEqual(one[2].slides.map(s => s.reference), ['John 3:18 KJV', 'John 3:18 KJV']);
  const packed = p.passageGroups(verses, { versesPerSlide: 3, maxChars: 100, numbers: true });
  assert.deepEqual(packed.map(g => [g.name, g.slides.map(s => s.text)]), [
    ['John 3:16–17', ['¹⁶For God so loved the world. ¹⁷For God sent not his Son.']],
    ['John 3:18', ['¹⁸He that believeth on him is not condemned: but he that believeth not is condemned already.']],
  ]);
  const across = p.passageGroups([v(1, 31, 'It was very good.', 1, 'Genesis'), v(2, 1, 'Thus the heavens were finished.', 1, 'Genesis')], { versesPerSlide: 2 });
  assert.equal(across[0].name, 'Genesis 1:31–2:1');
});

it('makes a presentation that shows the words and the reference with the Scripture template', () => {
  const lib = f.migrateLibrary({ presentations: [] });
  const id = p.scriptureTemplate(lib);
  assert.equal(id, 'scripture');
  const t = lib.templates.find(x => x.id === 'scripture');
  assert.equal(t.layout.elements.filter(e => e.bind === 'slide.reference').length, 1);
  p.scriptureTemplate(lib);
  assert.equal(t.layout.elements.filter(e => e.bind === 'slide.reference').length, 1, 'the box is added once');
  const pres = p.passagePresentation({ reference: 'John 3:16', verses: [v(3, 16, 'For God so loved the world.')], bible: 'kjv', abbrev: 'KJV' }, {}, id);
  assert.deepEqual([pres.name, pres.templateId, pres.scripture], ['John 3:16 (KJV)', 'scripture', { bible: 'kjv', reference: 'John 3:16' }]);
  const shown = f.resolveSlide(pres.groups[0].slides[0], { template: t, pres }).map(e => e.content);
  assert.deepEqual(shown, ['For God so loved the world.', 'John 3:16 KJV']);
  // A song using the template shows no reference.
  assert.deepEqual(f.resolveSlide({ id: 's', text: 'Amazing grace' }, { template: t }).map(e => e.content), ['Amazing grace']);
});

it('makes a Scripture template for a library that has none', () => {
  const lib = { templates: [] };
  assert.equal(p.scriptureTemplate(lib), 'scripture');
  assert.equal(lib.templates[0].name, 'Scripture');
  assert.equal(f.mainText(lib.templates[0]).style.font, 'Georgia, serif');
});
