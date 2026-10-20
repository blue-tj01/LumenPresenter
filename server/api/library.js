// The library (presentations, playlist, themes, media list, messages) and what is on screen now.
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
    const origin = String(body.client ?? '');
    const rev = this.store.setLibrary(lib);
    this.sendJson({ rev });
    this.srv.hub.send('library', { rev, origin, time: nowMs() });
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
