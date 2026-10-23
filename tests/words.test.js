// Tests for console/words.js: bold, italic, underlined and coloured words in a slide's text. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let w;
before(async () => { w = await import('../console/words.js'); });

it('reads formatting marks into runs of text', () => {
  assert.deepEqual(w.parseWords('Amazing **grace**, how *sweet*'), [{ text: 'Amazing ' }, { text: 'grace', bold: true },
    { text: ', how ' }, { text: 'sweet', italic: true }]);
  assert.deepEqual(w.parseWords('{gold}Jesus{/} is __Lord__'), [{ text: 'Jesus', color: '#ffd54f' }, { text: ' is ' },
    { text: 'Lord', underline: true }]);
  assert.deepEqual(w.parseWords('**{#ff0000}All{/} of me**\nnext'), [{ text: 'All', bold: true, color: '#ff0000' },
    { text: ' of me', bold: true }, { text: '\nnext' }]);
  assert.deepEqual(w.parseWords('{orange}a {#123}b{/} c{/}'), [{ text: 'a ', color: 'orange' }, { text: 'b', color: '#123' }, { text: ' c', color: 'orange' }]);
});

it('shows marks with no partner, and escaped ones, as typed', () => {
  assert.deepEqual(w.parseWords('5 * 3 = 15'), [{ text: '5 * 3 = 15' }]);
  assert.deepEqual(w.parseWords('{Chorus} x2'), [{ text: '{Chorus} x2' }]);
  assert.deepEqual(w.parseWords('a \\*b\\* c'), [{ text: 'a *b* c' }]);
  assert.deepEqual(w.parseWords('**a** **b'), [{ text: 'a', bold: true }, { text: ' **b' }]);
  assert.deepEqual(w.parseWords(''), []);
});

it('gives the plain words for search and the stage display', () => {
  assert.equal(w.plainWords('Amazing **grace**\n{gold}how{/} sweet'), 'Amazing grace\nhow sweet');
  assert.equal(w.plainWords('Plain words'), 'Plain words');
  assert.equal(w.plainWords(undefined), '');
  assert.equal(w.hasMarks('5 * 3'), false);
  assert.equal(w.hasMarks('a **b**'), true);
});

it('puts formatting on a selection, and takes it off again', () => {
  let r = w.toggleMark('Amazing grace', 8, 13, 'bold');
  assert.deepEqual(r, { text: 'Amazing **grace**', start: 10, end: 15 });
  assert.deepEqual(w.toggleMark(r.text, r.start, r.end, 'bold'), { text: 'Amazing grace', start: 8, end: 13 });
  // Selecting the marks too takes them off.
  assert.equal(w.toggleMark('Amazing **grace**', 8, 17, 'bold').text, 'Amazing grace');
  // Spaces at the ends stay outside the marks, and each line is marked on its own.
  assert.equal(w.toggleMark('Amazing grace ', 7, 14, 'italic').text, 'Amazing *grace* ');
  assert.equal(w.toggleMark('one\ntwo', 0, 7, 'underline').text, '__one__\n__two__');
  // Italic inside bold isn't mistaken for bold's marks.
  assert.equal(w.toggleMark('**grace**', 2, 7, 'italic').text, '***grace***');
  assert.deepEqual(w.parseWords('***grace***'), [{ text: 'grace', bold: true, italic: true }]);
  assert.equal(w.toggleMark('a b', 1, 1, 'bold').text, 'a b');
});

it('colours a selection, changes its colour, and takes it off', () => {
  let r = w.toggleMark('Jesus is Lord', 0, 5, 'color', '#ffcc00');
  assert.deepEqual(r, { text: '{#ffcc00}Jesus{/} is Lord', start: 9, end: 14 });
  r = w.toggleMark(r.text, r.start, r.end, 'color', 'red');
  assert.deepEqual(r, { text: '{red}Jesus{/} is Lord', start: 5, end: 10 });
  assert.equal(w.toggleMark(r.text, r.start, r.end, 'color', 'red').text, 'Jesus is Lord');
  assert.equal(w.toggleMark('{red}Jesus{/} is Lord', 0, 13, 'color', 'red').text, 'Jesus is Lord');
  assert.equal(w.toggleMark('{red}Jesus{/} is Lord', 0, 13, 'color', 'blue').text, '{blue}Jesus{/} is Lord');
});
