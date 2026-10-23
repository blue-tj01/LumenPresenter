// Tests for console/usage.js: noting which songs go live, and the CCLI usage report. Run with: npm test
'use strict';
const assert = require('assert/strict');
const { it, before } = require('node:test');

let u;
before(async () => {
  u = await import('../console/usage.js');
});

const grace = {
  id: 'g',
  name: 'Amazing Grace',
  meta: { ccli: '22025', author: 'John Newton', copyright: 'Public Domain' },
};
const holy = { id: 'h', name: 'Holy, Holy, Holy', meta: { ccli: '1156', author: 'Reginald Heber' } };

it('counts a song once per service per day, however many of its slides are shown', () => {
  const lib = { serviceId: 'am' };
  assert.equal(u.recordUse(lib, grace, { day: '2026-10-25' }), true);
  assert.equal(u.recordUse(lib, grace, { day: '2026-10-25' }), false);
  assert.equal(u.recordUse(lib, grace, { day: '2026-10-25', service: 'pm' }), true); // the evening service
  assert.equal(u.recordUse(lib, grace, { day: '2026-11-01' }), true);
  assert.equal(lib.usage.length, 3);
  assert.deepEqual(lib.usage[0], {
    day: '2026-10-25',
    service: 'am',
    id: 'g',
    name: 'Amazing Grace',
    ccli: '22025',
    author: 'John Newton',
    copyright: 'Public Domain',
  });
});

it('leaves out anything without a CCLI song number', () => {
  const lib = {};
  assert.equal(u.recordUse(lib, { id: 'n', name: 'Notices' }), false);
  assert.equal(u.recordUse(lib, { id: 'p', name: 'Own song', meta: { author: 'Our worship team', ccli: ' ' } }), false);
  assert.equal(u.recordUse(lib, null), false);
  assert.equal(lib.usage, undefined);
});

it('reports the songs used between two dates, most used first, with their dates', () => {
  const lib = {};
  u.recordUse(lib, holy, { day: '2026-10-11', service: 'a' });
  u.recordUse(lib, grace, { day: '2026-10-18', service: 'b' });
  u.recordUse(lib, grace, { day: '2026-10-25', service: 'c' });
  u.recordUse(lib, grace, { day: '2026-10-25', service: 'd' });
  u.recordUse(lib, holy, { day: '2026-10-25', service: 'c' });
  u.recordUse(lib, holy, { day: '2026-11-01', service: 'e' });
  const r = u.usageReport(lib.usage, '2026-10-12', '2026-10-31');
  assert.deepEqual(
    r.map(s => [s.name, s.count, s.days]),
    [
      ['Amazing Grace', 3, ['2026-10-18', '2026-10-25']],
      ['Holy, Holy, Holy', 1, ['2026-10-25']],
    ],
  );
  assert.equal(u.usageReport(lib.usage).length, 2);
  assert.equal(u.usageReport(lib.usage, '2026-10-11', '2026-10-11')[0].count, 1);
  assert.deepEqual(u.usageReport(undefined, '2026-01-01', '2026-12-31'), []);
});

it('adds up a song by its number, with the details it was last shown with', () => {
  const lib = {};
  u.recordUse(lib, { ...grace, id: 'old', name: 'Amazing Grace (old copy)' }, { day: '2026-10-18', service: 'a' });
  u.recordUse(lib, grace, { day: '2026-10-25', service: 'b' });
  const [s] = u.usageReport(lib.usage);
  assert.equal(s.count, 2);
  assert.equal(s.name, 'Amazing Grace');
});

it('writes the report as CSV and as tab-separated text', () => {
  const rows = [
    {
      name: 'Holy, Holy, "Holy"',
      ccli: '1156',
      author: '=cmd()',
      copyright: '',
      count: 2,
      days: ['2026-10-18', '2026-10-25'],
    },
  ];
  assert.equal(
    u.reportCsv(rows),
    'Title,CCLI Song #,Writers,Copyright,Times used,Dates\r\n' +
      '"Holy, Holy, ""Holy""",1156,\'=cmd(),,2,2026-10-18 2026-10-25\r\n',
  );
  assert.equal(u.reportText(rows).split('\n')[1], 'Holy, Holy, "Holy"\t1156\t=cmd()\t\t2\t2026-10-18 2026-10-25');
});
