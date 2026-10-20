// Tests for importing PowerPoint, Impress and PDF files as pictures (server/slides.js, POST /api/slides). The
// conversion itself runs where LibreOffice or pdftoppm is installed. Run with: npm test
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const { LumenServer } = require('../server.js');
const { findSoffice, findPython } = require('../server/slides.js');

/** A PDF of `pages` blank pages, 16:9. */
function pdf(pages) {
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] >>')];
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => { const at = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const onPath = name => (process.env.PATH || '').split(path.delimiter).some(d => fs.existsSync(path.join(d, name)));
const canConvertPdf = !!findSoffice() || onPath(process.platform === 'win32' ? 'pdftoppm.exe' : 'pdftoppm');

describe('slides import', () => {
  let srv, data, port;
  before(async () => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
    srv = new LumenServer({ host: '127.0.0.1', port: 0, data });
    port = await srv.listen();
  });
  after(async () => { await srv.close(); fs.rmSync(data, { recursive: true, force: true }); });

  const post = (body, name) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/slides', agent: false,
      headers: { 'Content-Type': 'application/octet-stream', ...name ? { 'X-Filename': encodeURIComponent(name) } : {} } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
    });
    r.on('error', reject);
    r.end(body);
  });

  it('takes only presentation and PDF files', async () => {
    assert.equal((await post(Buffer.from('x'), 'notes.docx')).status, 400);
    assert.equal((await post(Buffer.from('x'))).status, 400);
    assert.equal((await post(Buffer.alloc(0), 'a.pptx')).status, 400);
  });

  it('makes one picture per page, in order, in the media folder', { skip: !canConvertPdf && 'no LibreOffice or pdftoppm here' }, async () => {
    const r = await post(pdf(3), 'Sunday Sermon.pdf');
    assert.equal(r.status, 201, r.json.error);
    assert.equal(r.json.name, 'Sunday Sermon');
    assert.equal(r.json.slides.length, 3);
    for (const src of r.json.slides) {
      assert.match(src, /^media\/[a-z0-9]{16}\.png$/);
      const png = fs.readFileSync(path.join(data, src));
      assert.equal(png.readUInt32BE(16), 1920); // the width, from the PNG header
    }
    assert.ok(!fs.readdirSync(os.tmpdir()).some(f => f.startsWith('lumen-slides-')), 'the work folder is removed');
  });

  it('says what went wrong with a file it cannot read', { skip: !findSoffice() && 'no LibreOffice here' }, async () => {
    const r = await post(Buffer.from('not a presentation'), 'broken.pptx');
    assert.equal(r.status, 422);
    assert.match(r.json.error, /could not convert/);
  });
});

describe('finding LibreOffice', () => {
  it('uses LUMEN_SOFFICE when it is set, and only if it is there', () => {
    assert.equal(findSoffice({ LUMEN_SOFFICE: __filename }), __filename);
    assert.equal(findSoffice({ LUMEN_SOFFICE: path.join(__dirname, 'no-such-soffice') }), null);
  });

  it('prefers the Python LibreOffice comes with', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-lo-'));
    try {
      fs.writeFileSync(path.join(dir, 'soffice'), '');
      fs.writeFileSync(path.join(dir, 'python'), '');
      assert.equal(findPython(path.join(dir, 'soffice'), { PATH: '' }, 'linux'), path.join(dir, 'python'));
      fs.rmSync(path.join(dir, 'python'));
      assert.equal(findPython(path.join(dir, 'soffice'), { PATH: '' }, 'linux'), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
