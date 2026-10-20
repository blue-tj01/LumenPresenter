// Importing a PowerPoint, Impress or PDF file as one picture per slide.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { HttpError, bad, unquote } = require('../util.js');
const { SLIDE_EXT, convert } = require('../slides.js');

module.exports = {
  /** The file as the body, its name in X-Filename. Answers {name, slides: ['media/<name>.png', ...], via}; the
   * console makes the presentation, as it does a slideshow of uploaded pictures. */
  async 'POST slides'() {
    const name = Array.from(unquote(this.header('x-filename') || 'Slides')).slice(0, 200).join('');
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!SLIDE_EXT.has(ext)) throw bad('choose a PowerPoint (.pptx, .ppt, .ppsx), Impress (.odp) or PDF file');
    const n = Number(this.header('content-length') || 0);
    if (!Number.isInteger(n) || n <= 0) throw bad('empty upload');
    if (n > this.srv.maxUpload) return this.error(413, 'file too large');
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-slides-'));
    try {
      // A fixed name: what the uploader called the file never reaches a command line.
      const src = path.join(work, `slides.${ext}`);
      try { await pipeline(this.req, fs.createWriteStream(src)); } catch { throw bad('upload interrupted'); }
      if (fs.statSync(src).size !== n) throw bad('upload interrupted');
      let result;
      try { result = await convert(src, work); } catch (e) { throw new HttpError(422, e.message); }
      const slides = result.files.map(f => {
        const fname = `${crypto.randomBytes(8).toString('hex')}.png`;
        fs.copyFileSync(f, path.join(this.store.mediaDir, fname)); // the temporary folder may be on another drive
        return `media/${fname}`;
      });
      this.sendJson({ name: path.basename(name, path.extname(name)), slides, via: result.via }, 201);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  },
};
