// Tests for console/services.js: saved, dated services and the playlist of the open one. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let sv;
before(async () => { sv = await import('../console/services.js'); });

const WED = new Date(2026, 9, 21); // Wednesday 21 October 2026
const lib = (extra = {}) => ({ presentations: ['a', 'b', 'c'].map(id => ({ id, name: id })), playlist: ['b', 'a'], ...extra });

it('finds the coming Sunday, and moves dates on', () => {
  assert.equal(sv.nextSunday(WED), '2026-10-25');
  assert.equal(sv.nextSunday(new Date(2026, 9, 25)), '2026-10-25');
  assert.equal(sv.addDays('2026-12-27', 7), '2027-01-03');
  assert.equal(sv.addDays('2026-03-22', 7), '2026-03-29'); // across a clock change
});

it('gives a library from before services one holding its playlist', () => {
  const l = sv.ensureServices(lib(), WED);
  assert.equal(l.services.length, 1);
  assert.deepEqual(l.services[0], { id: l.serviceId, name: 'Service', date: '2026-10-25', items: ['b', 'a'] });
  assert.deepEqual(l.playlist, ['b', 'a']);
});

it('tidies services as they load, and opens the latest one up to the coming Sunday', () => {
  const l = sv.ensureServices(lib({ playlist: [], services: [
    { id: 's1', name: 'Old', date: '2026-10-18', items: ['a', 'gone'] },
    { id: 's2', name: 'Next', date: '2026-10-25', items: ['c'] },
    { id: 's3', name: 'Later', date: '2026-11-01', items: [] },
    { id: 's4', name: 'No date', date: 'soon' }, null,
  ] }), WED);
  assert.equal(l.serviceId, 's2');
  assert.deepEqual(l.services.map(s => [s.id, s.date, s.items]),
    [['s1', '2026-10-18', ['a']], ['s2', '2026-10-25', []], ['s3', '2026-11-01', []], ['s4', '2026-10-25', []]]);
  // The playlist is what the console last edited, so it wins over the open service's saved items.
  assert.deepEqual(l.playlist, []);
});

it('keeps the open service when it still exists', () => {
  const l = sv.ensureServices(lib({ serviceId: 's1', services: [{ id: 's1', name: 'A', date: '2026-01-04', items: [] }, { id: 's2', name: 'B', date: '2026-10-25', items: [] }] }), WED);
  assert.equal(l.serviceId, 's1');
  assert.deepEqual(l.services[0].items, ['b', 'a']);
});

it('switches between services, keeping each one\'s playlist', () => {
  const l = sv.ensureServices(lib(), WED);
  const first = l.serviceId;
  const s = sv.addService(l, { name: 'Evening', date: '2026-10-25' });
  assert.equal(l.serviceId, s.id);
  assert.deepEqual(l.playlist, []);
  l.playlist.push('c');
  sv.switchService(l, first);
  assert.deepEqual(l.playlist, ['b', 'a']);
  sv.switchService(l, s.id);
  assert.deepEqual(l.playlist, ['c']);
  assert.equal(sv.switchService(l, 'nope'), null);
  assert.equal(l.serviceId, s.id);
});

it('duplicates a service a week later, as a separate copy', () => {
  const l = sv.ensureServices(lib(), WED);
  l.playlist.push('c');
  const from = sv.openService(l);
  const copy = sv.duplicateService(l, from.id);
  assert.notEqual(copy.id, from.id);
  assert.deepEqual([copy.name, copy.date, copy.items], ['Service', '2026-11-01', ['b', 'a', 'c']]);
  assert.equal(l.serviceId, copy.id);
  l.playlist.pop(); sv.stashPlaylist(l);
  assert.deepEqual(from.items, ['b', 'a', 'c']);
});

it('renames and redates a service, ignoring a bad date', () => {
  const l = sv.ensureServices(lib(), WED);
  sv.updateService(l, l.serviceId, { name: '  Easter  ', date: '2027-03-28' });
  sv.updateService(l, l.serviceId, { date: 'tomorrow' });
  assert.deepEqual([sv.openService(l).name, sv.openService(l).date], ['Easter', '2027-03-28']);
});

it('deletes a service and opens the one dated nearest it, but never the last one', () => {
  const l = sv.ensureServices(lib(), WED);
  const only = l.serviceId;
  assert.equal(sv.removeService(l, only), false);
  const far = sv.addService(l, { name: 'Far', date: '2027-06-06' });
  const near = sv.addService(l, { name: 'Near', date: '2026-11-01' });
  l.playlist.push('a');
  sv.switchService(l, only);
  assert.equal(sv.removeService(l, only), true);
  assert.equal(l.serviceId, near.id);
  assert.deepEqual(l.playlist, ['a']);
  assert.equal(sv.removeService(l, far.id), true); // not the open one: the playlist stays
  assert.deepEqual([l.serviceId, l.playlist], [near.id, ['a']]);
});

it('lists services newest first and labels them with their date', () => {
  const l = { services: [{ id: '1', name: 'B', date: '2026-10-18' }, { id: '2', name: 'A', date: '2026-10-25' }, { id: '3', name: 'C', date: '2026-10-25' }] };
  assert.deepEqual(sv.sortedServices(l).map(s => s.id), ['2', '3', '1']);
  const label = sv.serviceLabel({ name: 'Morning', date: '2026-10-25' }); // in the computer's language
  assert.ok(/\b25\b/.test(label) && label.includes('2026') && label.endsWith(' · Morning'), label);
});
