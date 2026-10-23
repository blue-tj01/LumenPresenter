// @ts-check
// The library (presentations, playlist, themes, media list, messages), searching it, and what is on screen now.
'use strict';
const { bad, nowMs, isObject } = require('../util.js');

module.exports = {
  'GET library'() {
    this.sendJson({ rev: this.store.rev, library: this.store.library });
  },

  async 'PUT library'() {
    const body = await this.readBodyJson();
    if (!('library' in body)) throw bad('library is missing');
    const lib = body.library;
    if (!isObject(lib) || !Array.isArray(lib.presentations)) throw bad('library.presentations must be a list');
    // A page from before an update would write the library back in its older format, losing what the newer one added.
    if ((lib.format || 1) < (this.store.library?.format || 1))
      throw bad('this page is older than the library; reload it');
    // A console that found no library brings its own (this browser's copy, or the demo); if another got there
    // first, it loads that one instead.
    if (body.ifEmpty === true && this.store.library !== null) return this.error(409, 'there is a library already');
    const origin = String(body.client ?? '');
    const rev = this.store.setLibrary(lib, body.replace === true);
    this.sendJson({ rev });
    this.srv.hub.send('library', { rev, origin, time: nowMs() });
  },

  /** Only what changed since the console last had the library at revision `base`: {client, base, format, changes},
   * changes as Library.patch takes them. A presentation or service changed elsewhere since then is left as it is
   * and listed in the answer's conflicts, so the console can say so and load the library again. */
  async 'PATCH library'() {
    const body = await this.readBodyJson();
    if (!isObject(body.changes)) throw bad('changes is missing');
    if (!Number.isInteger(body.base) || body.base < 0) throw bad('base must be a revision');
    if (this.store.library === null) throw bad('there is no library yet; save it whole');
    if ((body.format || 1) < (this.store.library.format || 1))
      throw bad('this page is older than the library; reload it');
    const origin = String(body.client ?? '');
    const { rev, prev, conflicts, resend, applied } = this.store.patchLibrary(body.changes, body.base);
    this.sendJson({ rev, prev, conflicts, resend });
    if (applied) this.srv.hub.send('library', { rev, prev, origin, time: nowMs(), changes: applied });
  },

  /** The library's backups, newest first: {backups: [{name, time, size}]}. */
  'GET backups'() {
    this.sendJson({ backups: this.store.backups() });
  },

  /** Put a backup back: {restore: '<name>'}. The library it replaces is backed up first. */
  async 'POST backups'() {
    const body = await this.readBodyJson();
    const rev = this.store.restoreBackup(body.restore);
    if (rev === null) throw bad('no such backup');
    this.sendJson({ rev });
    this.srv.hub.send('library', { rev, origin: '', time: nowMs() });
  },

  /** Song search: /api/search?q=<words>, best match first. */
  'GET search'() {
    this.sendJson({ results: this.store.lib.search(this.query.get('q') || '') });
  },

  'GET live'() {
    this.sendJson({ live: this.store.live, time: nowMs() });
  },

  async 'POST live'() {
    const body = await this.readBodyJson();
    const live = body.live;
    if (!isObject(live)) throw bad('live must be an object');
    const origin = String(body.client ?? '');
    this.store.setLive(live, origin);
    this.sendJson({ ok: true });
    this.srv.hub.send('state', { live, origin, time: nowMs() });
  },
};
