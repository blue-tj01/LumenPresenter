// Tests for console/undo.js: undo and redo of library changes. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it } = require('node:test');

globalThis.document = { querySelector: () => ({ classList: { add() {}, remove() {} } }) }; // for the toast
const { canRedo, canUndo, noteChange, resetUndo, undo } = require('../console/undo.js');

const lib = () => ({ presentations: [{ id: 'a', name: 'One' }, { id: 'b', name: 'Two' }], playlist: ['a'], usage: [] });

it('undoes and redoes a change, an add and a delete, keeping only what changed', () => {
  const db = lib();
  resetUndo(db);
  assert.equal(canUndo(), false);
  db.presentations[0].name = 'One renamed'; noteChange(db);
  assert.equal(canUndo(), true);
  db.presentations.splice(1, 1); db.presentations.push({ id: 'c', name: 'Three' }); db.playlist = ['a', 'c']; noteChange(db);
  let saves = 0;
  const saved = () => saves++;
  undo(db, saved);
  assert.deepEqual(db.presentations.map(p => p.id), ['a', 'b']);
  assert.deepEqual(db.playlist, ['a']);
  assert.equal(db.presentations[0].name, 'One renamed');
  undo(db, saved);
  assert.equal(db.presentations[0].name, 'One');
  assert.equal(undo(db, saved), false); // nothing more
  assert.equal(canRedo(), true);
  undo(db, saved, true); undo(db, saved, true);
  assert.deepEqual(db.presentations.map(p => p.name), ['One renamed', 'Three']);
  assert.equal(saves, 4);
});

it('leaves the CCLI usage record alone, and a new change clears what could be redone', () => {
  const db = lib();
  resetUndo(db);
  db.usage.push({ id: 'a' }); noteChange(db);
  assert.equal(canUndo(), false, 'going live is not an edit');
  db.messages = ['Welcome']; noteChange(db);
  undo(db, () => {});
  assert.equal('messages' in db, false);
  assert.deepEqual(db.usage, [{ id: 'a' }]);
  db.playlist = []; noteChange(db);
  assert.equal(canRedo(), false);
});
