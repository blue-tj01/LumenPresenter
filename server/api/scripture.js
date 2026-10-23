// @ts-check
// Bible translations, and finding passages and verses in them.
'use strict';
const { HttpError, bad, nowMs, unquote } = require('../util.js');

const MAX_BIBLE = 128 * 1024 * 1024;
const BIBLE_TYPES = ['application/xml', 'text/xml', 'application/gzip', 'application/x-gzip', 'application/octet-stream'];

module.exports = {
  'GET bibles'() {
    this.sendJson({ bibles: this.store.bibles.list() });
  },

  /** A Zefania, OSIS or USFX file as the body (gzipped or not), its name in X-Filename. */
  async 'POST bibles'() {
    const ctype = this.header('content-type').split(';')[0].trim().toLowerCase();
    if (!BIBLE_TYPES.includes(ctype)) throw bad('send the Bible file as application/xml');
    const n = Number(this.header('content-length') || 0);
    if (!Number.isInteger(n) || n <= 0) throw bad('empty upload');
    if (n > MAX_BIBLE) return this.error(413, 'file too large');
    const chunks = [];
    for await (const chunk of this.req) chunks.push(chunk);
    let bible;
    try { bible = this.store.bibles.import(Buffer.concat(chunks), unquote(this.header('x-filename'))); }
    catch (e) { throw bad(`could not read that Bible: ${e.message}`); }
    this.sendJson({ bible }, 201);
    this.srv.hub.send('bibles', { time: nowMs() });
  },

  'DELETE bibles'(name) {
    const id = name.split('/')[1] || '';
    let removed;
    try { removed = this.store.bibles.remove(id); } catch (e) { throw bad(e.message); }
    if (!removed) throw new HttpError(404, 'no such translation');
    this.sendJson({ ok: true });
    this.srv.hub.send('bibles', { time: nowMs() });
  },

  /** ?bible=<id>&q=<reference or words>: the passage a reference names, or else verses with those words. */
  'GET scripture'() {
    const id = this.query.get('bible') || '', q = (this.query.get('q') || '').slice(0, 500);
    const bibles = this.store.bibles;
    try {
      const passage = q.trim() ? bibles.passage(id, q) : null;
      if (passage) return this.sendJson({ bible: id, type: 'passage', ...passage });
      const limit = Number(this.query.get('limit') || 100);
      this.sendJson({ bible: id, type: 'search', verses: q.trim() ? bibles.search(id, q, limit) : [] });
    } catch (e) {
      if (e.missing) throw new HttpError(404, e.message);
      throw e;
    }
  },
};
