// Uploaded media, and media folders on this computer.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { bad, unquote } = require('../util.js');
const { MEDIA_NAME, MEDIA_EXT, EXT_FOR_TYPE } = require('../media.js');

module.exports = {
  async 'POST media'() {
    const ctype = this.header('content-type').split(';')[0].trim().toLowerCase();
    const kind = ['image', 'video', 'font'].find(k => ctype.startsWith(k + '/'));
    if (!kind) throw bad('only image, video and font uploads are accepted');
    const n = Number(this.header('content-length') || 0);
    if (!Number.isInteger(n) || n <= 0) throw bad('empty upload');
    if (n > this.srv.maxUpload) return this.error(413, 'file too large');
    const name = Array.from(unquote(this.header('x-filename') || 'upload')).slice(0, 200).join('');
    let ext = path.extname(name).slice(1).toLowerCase();
    if (!MEDIA_EXT[kind].has(ext)) ext = EXT_FOR_TYPE[ctype] || '';
    if (!MEDIA_EXT[kind].has(ext)) throw bad(`unsupported ${kind} type`);
    const fname = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const final = path.join(this.store.mediaDir, fname);
    const tmp = final + '.part';
    try {
      try { await pipeline(this.req, fs.createWriteStream(tmp)); } catch { throw bad('upload interrupted'); }
      if (fs.statSync(tmp).size !== n) throw bad('upload interrupted');
      fs.renameSync(tmp, final);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    this.sendJson({ name, type: kind, src: `media/${fname}` }, 201);
  },

  async 'GET folders'() {
    const local = this.isLocal();
    const folders = await Promise.all(this.srv.folders.list().map(async f => ({
      id: f.id, name: path.basename(f.path) || f.path, fixed: f.fixed, missing: !fs.existsSync(f.path),
      ...local ? { path: f.path } : {}, // where things are on this computer is only shown on it
      files: await this.srv.folders.files(f),
    })));
    this.sendJson({ folders, local });
  },

  /** {add: '<path>'} or {remove: '<id>'}; only on the computer running Lumen, as it names its own folders. */
  async 'POST folders'() {
    if (!this.isLocal()) return this.error(403, 'media folders can only be changed on the computer running Lumen');
    const body = await this.readBodyJson();
    let id;
    if ('add' in body) id = this.srv.folders.add(body.add);
    if ('remove' in body) this.srv.folders.remove(String(body.remove));
    this.sendJson({ ok: true, id });
  },

  'DELETE media'(name) {
    const fname = name.includes('/') ? name.slice(name.indexOf('/') + 1) : '';
    if (!MEDIA_NAME.test(fname)) throw bad('bad media name');
    fs.rmSync(path.join(this.store.mediaDir, fname), { force: true });
    this.sendJson({ ok: true });
  },
};
