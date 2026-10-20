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
    if ((lib.format || 1) < (this.store.library?.format || 1)) throw bad('this page is older than the library; reload it');
    const origin = String(body.client ?? '');
    const rev = this.store.setLibrary(lib);
    this.sendJson({ rev });
    this.srv.hub.send('library', { rev, origin, time: nowMs() });
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
