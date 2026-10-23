// @ts-check
// End-to-end checks of the operator console in a real browser (Chromium, through Playwright): what an operator
// does in a service, and what keeps two operators from losing each other's work. Run with: npm run test:e2e
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const { chromium } = require('playwright');
const { LumenServer } = require('../../server.js');

/** @type {import('playwright').Browser} */
let browser;
/** @type {LumenServer} */
let srv;
let data = '', url = '';
/** @type {string[]} */
let errors = [];
/** @type {import('playwright').Page[]} */
let pages = [];

before(async () => {
  browser = await chromium.launch(process.env.LUMEN_CHROMIUM ? { executablePath: process.env.LUMEN_CHROMIUM } : {});
});
after(async () => { await browser.close(); });
beforeEach(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-e2e-'));
  srv = new LumenServer({ host: '127.0.0.1', port: 0, data });
  url = `http://127.0.0.1:${await srv.listen()}/`;
  errors = []; pages = [];
});
afterEach(async () => {
  const seen = [...errors];
  await Promise.all(pages.map(p => p.close()));
  await srv.close();
  fs.rmSync(data, { recursive: true, force: true });
  assert.deepEqual(seen, [], 'no errors in the pages');
});

/** A page of Lumen, with its errors collected. */
async function open(page = '') {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  pages.push(p);
  p.on('pageerror', e => errors.push(`${page || 'console'}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`${page || 'console'}: ${m.text()} ${m.location().url}`); });
  await p.goto(url + page);
  if (!page) await p.waitForSelector('#libList li');
  return p;
}
const songs = p => p.$$eval('#libList li', l => l.map(li => li.textContent.replace('♪', '').trim()));
/** Write a song in the editor and save it. */
async function writeSong(p, name, text) {
  await p.click('#btnNewPres');
  await p.fill('#edName', name);
  await p.fill('#edText', text);
  await p.click('#edSave');
}
async function rename(p, from, to) {
  await p.click(`#libList li:has-text("${from}")`);
  await p.click('#btnEdit');
  await p.fill('#edName', to);
  await p.click('#edSave');
}
/** Wait until a condition on the page holds, or fail after a few seconds. */
async function until(fn, what) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail(`timed out waiting for ${what}`);
}

describe('console', () => {
  it('writes a song, puts it on the audience output, and keeps it after a reload', async () => {
    const c = await open();
    const out = await open('output.html');
    await writeSong(c, 'Test Hymn', '[Verse 1]\nFirst line of the hymn\n\n[Chorus]\nSing the chorus');
    await until(async () => (await songs(c)).includes('Test Hymn'), 'the new song in the library');
    await c.click('#libList li:has-text("Test Hymn")');
    await c.click('#slideGrid .slide >> nth=0');
    await until(async () => (await out.textContent('#screen'))?.includes('First line of the hymn'), 'the slide on the output');
    await c.keyboard.press('ArrowRight');
    await until(async () => (await out.textContent('#screen'))?.includes('Sing the chorus'), 'the next slide on the output');
    await c.keyboard.press('F1');
    await until(async () => !(await out.textContent('#screen'))?.includes('Sing the chorus'), 'the output cleared');
    await c.waitForTimeout(600); // the save is sent a moment after the change
    await c.reload();
    await c.waitForSelector('#libList li');
    assert.ok((await songs(c)).includes('Test Hymn'));
  });

  it('keeps both operators’ changes to different songs, and says when they changed the same one', async () => {
    // The first console saves the demo library to the empty server; the second opens once it is there.
    const a = await open();
    await until(async () => (await (await fetch(url + 'api/library')).json()).library !== null, 'the library saved');
    const b = await open();
    await Promise.all([rename(a, 'Amazing Grace', 'Grace (A)'), rename(b, 'Doxology', 'Doxology (B)')]);
    for (const p of [a, b]) {
      await until(async () => { const s = await songs(p); return s.includes('Grace (A)') && s.includes('Doxology (B)'); }, 'both changes on both screens');
    }
    await Promise.all([rename(a, 'Be Thou My Vision', 'Vision (A)'), rename(b, 'Be Thou My Vision', 'Vision (B)')]);
    await until(async () => {
      const [sa, sb] = [await songs(a), await songs(b)];
      return sa.some(n => n.startsWith('Vision')) && sa.join() === sb.join();
    }, 'both screens to agree on one version');
    const toasts = [await a.textContent('#toast'), await b.textContent('#toast')];
    assert.ok(toasts.some(t => /changed on another screen/.test(t || '')), 'one console says its change was not kept');
  });

  it('starts over only once START OVER is typed, and puts the library back from a backup', async () => {
    const c = await open();
    await writeSong(c, 'Keep Me', '[Verse 1]\nDo not lose this');
    await c.waitForTimeout(600);
    await c.click('#btnLibrary');
    await c.click('#btnReset');
    const yes = c.locator('.ask-card button[type=submit]');
    assert.equal(await yes.isDisabled(), true);
    await c.keyboard.press('Enter'); // nothing happens without the words
    assert.ok((await songs(c)).includes('Keep Me'));
    await c.keyboard.type('start over');
    await yes.click();
    await until(async () => !(await songs(c)).includes('Keep Me'), 'the demo library');
    await c.click('#btnLibrary');
    await c.click('#backupList li button >> nth=0');
    await c.click('.ask-card button[type=submit]');
    await until(async () => (await songs(c)).includes('Keep Me'), 'the restored library');
  });

  it('asks before deleting a song, and undoes and redoes it', async () => {
    const c = await open();
    await c.click('#libList li:has-text("Doxology")');
    await c.click('#btnDelete');
    await c.click('.ask-card button:has-text("Cancel")');
    assert.ok((await songs(c)).includes('Doxology'));
    await c.click('#btnDelete');
    await c.click('.ask-card button[type=submit]');
    await until(async () => !(await songs(c)).includes('Doxology'), 'the song deleted');
    await c.keyboard.press('Control+z');
    await until(async () => (await songs(c)).includes('Doxology'), 'the song back');
    assert.match(await c.textContent('#toast') || '', /Undid “Doxology”/);
    await c.keyboard.press('Control+Shift+z');
    await until(async () => !(await songs(c)).includes('Doxology'), 'the song deleted again');
    await c.click('#btnUndo');
    await until(async () => (await songs(c)).includes('Doxology'), 'the song back again');
    await c.waitForTimeout(700);
    await c.reload();
    await c.waitForSelector('#libList li');
    assert.ok((await songs(c)).includes('Doxology'), 'the undo was saved');
  });

  it('draws a large library a page at a time', async () => {
    const lib = { format: 2, presentations: Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, name: `Song ${i}`,
      groups: [{ id: 'g', name: 'Verse 1', slides: [{ id: 's', text: `Words of song ${i}` }] }] })), playlist: [] };
    const r = await fetch(url + 'api/library', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ library: lib }) });
    assert.equal(r.status, 200);
    const c = await open();
    const count = () => c.$$eval('#libList li[data-id]', l => l.length);
    assert.equal(await count(), 150);
    assert.deepEqual((await songs(c)).slice(0, 3), ['Song 0', 'Song 1', 'Song 2']); // numbers in order, not 0, 1, 10
    await c.$eval('#libList', ul => { ul.scrollTop = ul.scrollHeight; });
    await until(async () => await count() > 150, 'more songs as the list scrolls');
    await c.fill('#libSearch', 'song 2999');
    await until(async () => (await songs(c))[0]?.startsWith('Song 2999'), 'the search result');
  });

  it('keeps the stage display, network and control settings under Setup', async () => {
    const c = await open();
    assert.equal(await c.isVisible('#netOn'), false);
    await c.click('.tabs > button[data-tab="setup"]');
    assert.equal(await c.isVisible('#stageInput'), true);
    await c.click('.subtabs > button[data-tab="net"]');
    assert.equal(await c.isVisible('#netOn'), true);
    assert.equal(await c.isVisible('#stageInput'), false);
    await c.click('.tabs > button[data-tab="bible"]');
    assert.equal(await c.isVisible('#netOn'), false);
  });

  it('opens the theme layout editor and leaves it without changes', async () => {
    const c = await open();
    await c.click('#thLayout');
    await c.waitForSelector('#layoutEditor:not([hidden])');
    await c.click('#leCancel');
    await c.waitForSelector('#layoutEditor', { state: 'hidden' });
  });
});
