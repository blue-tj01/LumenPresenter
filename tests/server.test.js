// Tests for server.js. Run with: npm test (or node --test tests/)
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const server = require('../server.js');

const LIB = { presentations: [{ id: 'a', name: 'Song', groups: [], bg: null }], playlist: ['a'], media: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));

/** A server on a free port with its own data directory; restart() keeps the directory. */
function harness(opts = {}) {
  const t = {
    data: null, srv: null, port: 0, token: opts.token || '',
    async start(extra = {}) {
      t.srv = new server.LumenServer({ host: '127.0.0.1', port: 0, data: t.data, token: t.token, ...opts, ...extra });
      t.port = await t.srv.listen();
    },
    async stop() { await t.srv.close(); },
    async restart() { await t.stop(); await t.start(); },
    /** One request; returns {status, headers, body (Buffer), json}. */
    req(method, p, body, headers = {}) {
      const h = { ...headers };
      if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') {
        body = JSON.stringify(body);
        h['Content-Type'] ??= 'application/json';
      }
      if (t.token && !('X-Lumen-Token' in h)) h['X-Lumen-Token'] = t.token;
      return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: t.port, method, path: p, headers: h, agent: false }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            let json;
            try { json = JSON.parse(buf.toString()); } catch {}
            resolve({ status: res.statusCode, headers: res.headers, body: buf, json });
          });
        });
        r.on('error', reject);
        r.end(body);
      });
    },
    /** Open the event stream; next() resolves to the next [event, data]. */
    events(headers = {}) {
      return new Promise((resolve, reject) => {
        const r = http.get({ host: '127.0.0.1', port: t.port, path: '/api/events', headers, agent: false }, res => {
          assert.equal(res.headers['content-type'], 'text/event-stream');
          let buf = '';
          const queue = [], waiting = [];
          let ended = false;
          const flush = () => { while (queue.length && waiting.length) waiting.shift()(queue.shift()); if (ended) while (waiting.length) waiting.shift()(null); };
          res.setEncoding('utf8');
          res.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
              if (ev) queue.push([ev[1], data ? JSON.parse(data[1]) : null]);
            }
            flush();
          });
          res.on('end', () => { ended = true; flush(); });
          res.on('error', () => { ended = true; flush(); });
          resolve({ res, close: () => r.destroy(), next: () => new Promise(ok => { waiting.push(ok); flush(); }) });
        });
        r.on('error', reject);
      });
    },
  };
  beforeEach(async () => {
    t.data = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-'));
    await t.start();
  });
  afterEach(async () => {
    await t.stop();
    fs.rmSync(t.data, { recursive: true, force: true });
  });
  return t;
}

describe('server', () => {
  const t = harness();

  it('serves only the app files', async () => {
    const r = await t.req('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.body.toString(), /Lumen Presenter/);
    assert.equal((await t.req('GET', '/sync.js')).status, 200);
    const mod = await t.req('GET', '/console/main.js');
    assert.equal(mod.status, 200);
    assert.match(mod.headers['content-type'], /^application\/javascript/); // browsers load modules only as JavaScript
    for (const p of ['/server.js', '/server.py', '/.git/config', '/data/library.json', '/data/lumen.db', '/../etc/passwd',
      '/tests/server.test.js', '/package.json', '/electron/main.js', '/server/util.js', '/console/package.json', '/app.js']) {
      assert.equal((await t.req('GET', p)).status, 404, p);
    }
  });

  it('turns away a rebound host name', async () => {
    // A page on another site whose name now points at 127.0.0.1 must not reach the token or the library.
    for (const host of ['attacker.example:8642', 'attacker.example', 'evil.localhost.example']) {
      const r = await t.req('GET', '/api/network', undefined, { Host: host });
      assert.equal(r.status, 403, host);
      assert.doesNotMatch(r.body.toString(), /token/);
      assert.equal((await t.req('PUT', '/api/library', { library: LIB }, { Host: host })).status, 403, host);
    }
    for (const host of ['localhost:8642', '127.0.0.1', '[::1]:8642', 'app.localhost', '192.168.1.20:8642',
      os.hostname(), `${os.hostname()}.local`]) {
      assert.equal((await t.req('GET', '/api/network', undefined, { Host: host })).status, 200, host);
    }
  });

  it('accepts an allowed host for a reverse proxy', async () => {
    await t.stop();
    await t.start({ allowedHosts: ['Lumen.Example.org'] });
    assert.equal((await t.req('GET', '/api/library', undefined, { Host: 'lumen.example.org' })).status, 200);
    assert.equal((await t.req('GET', '/api/library', undefined, { Host: 'other.example.org' })).status, 403);
  });

  it('refuses changes from another site', async () => {
    const live = { live: { slide: { text: 'hijacked' } } };
    // A plain cross-site form or fetch can only send text/plain without the browser asking first.
    assert.equal((await t.req('POST', '/api/live', JSON.stringify(live), { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await t.req('POST', '/api/network', '{"network": true}', { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal(t.srv.network, false);
    for (const site of ['cross-site', 'same-site']) {
      assert.equal((await t.req('POST', '/api/live', live, { 'Sec-Fetch-Site': site })).status, 403, site);
      assert.equal((await t.req('POST', '/api/logout', undefined, { 'Sec-Fetch-Site': site })).status, 403, site);
    }
    assert.equal((await t.req('GET', '/api/live')).json.live, null);
    assert.equal((await t.req('POST', '/api/live', live, { 'Sec-Fetch-Site': 'same-origin' })).status, 200);
    assert.equal((await t.req('GET', '/api/live', undefined, { 'Sec-Fetch-Site': 'cross-site' })).status, 200);
  });

  it('keeps the library across a restart', async () => {
    assert.deepEqual((await t.req('GET', '/api/library')).json, { rev: 0, library: null });
    assert.equal((await t.req('PUT', '/api/library', { client: 'x', library: LIB })).json.rev, 1);
    await t.restart();
    assert.deepEqual((await t.req('GET', '/api/library')).json, { rev: 1, library: LIB });
  });

  it('searches the library', async () => {
    assert.deepEqual((await t.req('GET', '/api/search?q=song')).json, { results: [] });
    await t.req('PUT', '/api/library', { client: 'x', library: { presentations: [
      { id: 'a', name: 'Amazing Grace', meta: { ccli: '22025' }, groups: [] }, { id: 'b', name: 'Notices', groups: [] }] } });
    assert.deepEqual((await t.req('GET', '/api/search?q=22025')).json, { results: [{ id: 'a', name: 'Amazing Grace', snippet: '' }] });
    assert.deepEqual((await t.req('GET', '/api/search?q=amaz%20gr')).json.results.map(r => r.id), ['a']);
    assert.deepEqual((await t.req('GET', '/api/search')).json, { results: [] });
  });

  it('reads a library saved by the Python server', async () => {
    await t.stop();
    // server.py wrote ASCII-escaped JSON with ", " separators.
    fs.writeFileSync(path.join(t.data, 'library.json'),
      '{"rev": 7, "saved": 1, "library": {"presentations": [{"id": "a", "name": "Caf\\u00e9"}], "playlist": []}}');
    fs.writeFileSync(path.join(t.data, 'live.json'), '{"saved": 1, "live": {"idx": 2}}');
    await t.start();
    assert.deepEqual((await t.req('GET', '/api/library')).json,
      { rev: 7, library: { presentations: [{ id: 'a', name: 'Café' }], playlist: [] } });
    assert.deepEqual((await t.req('GET', '/api/live')).json.live, { idx: 2 });
  });

  it('validates the library', async () => {
    assert.equal((await t.req('PUT', '/api/library', { library: { nope: 1 } })).status, 400);
    assert.equal((await t.req('PUT', '/api/library', 'not json', { 'Content-Type': 'application/json' })).status, 400);
    assert.equal((await t.req('PUT', '/api/library', [1], { 'Content-Type': 'application/json' })).status, 400);
    assert.equal((await t.req('PUT', '/api/library', {})).status, 400);
  });

  it('pushes and keeps the live state', async () => {
    let s = await t.events();
    let [ev, hello] = await s.next();
    assert.equal(ev, 'hello');
    assert.equal(hello.live, null);
    const live = { slide: { text: 'Amazing grace' }, idx: 0 };
    assert.equal((await t.req('POST', '/api/live', { client: 'op1', live })).status, 200);
    let d;
    [ev, d] = await s.next();
    assert.deepEqual([ev, d.live, d.origin], ['state', live, 'op1']);
    await t.req('PUT', '/api/library', { client: 'op1', library: LIB });
    [ev, d] = await s.next();
    assert.deepEqual([ev, d.rev], ['library', 1]);
    s.close();
    await t.restart();
    assert.deepEqual((await t.req('GET', '/api/live')).json.live, live);
    s = await t.events();
    assert.deepEqual((await s.next())[1].live, live); // reconnecting windows get it straight away
    s.close();
  });

  it('uploads media, serves byte ranges and deletes it', async () => {
    const blob = Buffer.alloc(256 * 40, 0).map((_, i) => i % 256);
    let r = await t.req('POST', '/api/media', blob, { 'Content-Type': 'video/mp4', 'X-Filename': 'My%20Clip.mp4' });
    assert.equal(r.status, 201);
    const m = r.json;
    assert.deepEqual([m.name, m.type], ['My Clip.mp4', 'video']);
    assert.match(m.src, /^media\/[a-z0-9]{16}\.mp4$/);
    r = await t.req('GET', '/' + m.src);
    assert.deepEqual([r.status, r.headers['content-type']], [200, 'video/mp4']);
    assert.ok(r.body.equals(blob));
    r = await t.req('GET', '/' + m.src, undefined, { Range: 'bytes=100-199' });
    assert.deepEqual([r.status, r.headers['content-range']], [206, `bytes 100-199/${blob.length}`]);
    assert.ok(r.body.equals(blob.subarray(100, 200)));
    r = await t.req('GET', '/' + m.src, undefined, { Range: 'bytes=-10' });
    assert.ok(r.body.equals(blob.subarray(-10)));
    assert.equal((await t.req('GET', '/' + m.src, undefined, { Range: 'bytes=999999-' })).status, 416);
    r = await t.req('HEAD', '/' + m.src);
    assert.deepEqual([r.status, r.headers['content-length'], r.body.length], [200, String(blob.length), 0]);
    assert.equal((await t.req('DELETE', '/api/' + m.src)).status, 200);
    assert.equal((await t.req('GET', '/' + m.src)).status, 404);
    assert.deepEqual(fs.readdirSync(path.join(t.data, 'media')), []);
  });

  it('takes the media extension from media types only', async () => {
    const page = Buffer.from('<script>alert(1)</script>');
    let r = await t.req('POST', '/api/media', page, { 'Content-Type': 'image/png', 'X-Filename': 'evil.html' });
    assert.equal(r.status, 201);
    const src = r.json.src;
    assert.ok(src.endsWith('.png'), src);
    r = await t.req('GET', '/' + src);
    assert.equal(r.headers['content-type'], 'image/png');
    assert.match(r.headers['content-security-policy'], /sandbox/);
    r = await t.req('POST', '/api/media', page, { 'Content-Type': 'image/x-unknown', 'X-Filename': 'a.js' });
    assert.equal(r.status, 400);
  });

  it('rejects other types and bad media names', async () => {
    assert.equal((await t.req('POST', '/api/media', Buffer.from('x'), { 'Content-Type': 'text/html' })).status, 400);
    assert.equal((await t.req('DELETE', '/api/media/..%2Flibrary.json')).status, 400);
    assert.equal((await t.req('GET', '/media/..%2Flibrary.json')).status, 404);
  });

  it('plays pictures and videos from a media folder, without upload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-folder-'));
    const clip = Buffer.alloc(5000, 7);
    fs.mkdirSync(path.join(dir, 'Loops', 'Easter'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Loops', 'Easter', 'Sunrise 2.mp4'), clip);
    fs.writeFileSync(path.join(dir, 'Loops', 'Sunrise 10.mp4'), clip);
    fs.writeFileSync(path.join(dir, 'cross.JPG'), 'jpg');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not media');
    fs.writeFileSync(path.join(dir, '.hidden.png'), 'x');
    fs.writeFileSync(path.join(t.data, 'secret.mp4'), 'outside the folder');
    try {
      let r = await t.req('POST', '/api/folders', { add: dir });
      assert.equal(r.status, 200);
      const id = r.json.id;
      r = await t.req('GET', '/api/folders');
      const [f] = r.json.folders;
      assert.deepEqual([f.id, f.name, f.path, f.fixed, f.missing], [id, path.basename(dir), dir, false, false]);
      assert.deepEqual(f.files.map(x => [x.path, x.type]),
        [['cross.JPG', 'image'], ['Loops/Easter/Sunrise 2.mp4', 'video'], ['Loops/Sunrise 10.mp4', 'video']]);

      r = await t.req('GET', `/folders/${id}/Loops/Easter/Sunrise%202.mp4`, undefined, { Range: 'bytes=0-99' });
      assert.deepEqual([r.status, r.headers['content-type'], r.body.length], [206, 'video/mp4', 100]);
      assert.match(r.headers['content-security-policy'], /sandbox/);
      r = await t.req('GET', `/folders/${id}/cross.JPG`, undefined, { 'If-None-Match': r.headers.etag });
      assert.equal(r.status, 200); // a different file's tag
      assert.equal((await t.req('GET', `/folders/${id}/cross.JPG`, undefined, { 'If-None-Match': r.headers.etag })).status, 304);

      try { fs.symlinkSync(path.join(t.data, 'secret.mp4'), path.join(dir, 'link.mp4')); } catch {} // Windows may not allow links
      for (const bad of [`/folders/${id}/notes.txt`, `/folders/${id}/../secret.mp4`, `/folders/${id}/%2e%2e/secret.mp4`,
        `/folders/${id}/..%2Fsecret.mp4`, `/folders/${id}/Loops%5C..%5C..%5Csecret.mp4`, `/folders/${id}/link.mp4`,
        `/folders/${id}/cross.JPG:x.mp4`, `/folders/${id}/`, '/folders/nope/cross.JPG', `/folders/${id}`]) {
        assert.equal((await t.req('GET', bad)).status, 404, bad);
      }

      assert.equal((await t.req('POST', '/api/folders', { add: path.join(dir, 'notes.txt') })).status, 400);
      assert.equal((await t.req('POST', '/api/folders', { add: t.data })).status, 400);
      assert.equal((await t.req('POST', '/api/folders', { add: dir }, { 'X-Forwarded-For': '192.168.1.20' })).status, 403);
      const remote = (await t.req('GET', '/api/folders', undefined, { 'X-Forwarded-For': '192.168.1.20' })).json;
      assert.equal('path' in remote.folders[0], false); // other devices aren't told where it is on this computer

      await t.restart(); // kept in settings.json
      assert.equal((await t.req('GET', '/api/folders')).json.folders[0].id, id);
      assert.equal((await t.req('POST', '/api/folders', { remove: id })).status, 200);
      assert.deepEqual((await t.req('GET', '/api/folders')).json.folders, []);
      assert.equal((await t.req('GET', `/folders/${id}/cross.JPG`)).status, 404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tells the consoles when a media folder changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-folder-'));
    try {
      await t.req('POST', '/api/folders', { add: dir });
      const s = await t.events();
      await s.next(); // hello
      let ev;
      while ((ev = await s.next())[0] !== 'folders'); // the add itself
      fs.writeFileSync(path.join(dir, 'new.png'), 'x');
      while ((ev = await s.next())[0] !== 'folders');
      assert.equal(ev[0], 'folders');
      s.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps folders given on the command line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-folder-'));
    try {
      await t.stop();
      await t.start({ mediaFolders: [dir] });
      const [f] = (await t.req('GET', '/api/folders')).json.folders;
      assert.equal(f.fixed, true);
      assert.equal((await t.req('POST', '/api/folders', { remove: f.id })).status, 409);
      fs.rmSync(dir, { recursive: true });
      assert.equal((await t.req('GET', '/api/folders')).json.folders[0].missing, true); // a drive unplugged
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps library backups', async () => {
    await t.req('PUT', '/api/library', { library: LIB });
    await t.req('PUT', '/api/library', { library: LIB });
    const backups = fs.readdirSync(path.join(t.data, 'backups'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^library-\d{8}-\d{6}\.json$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.data, 'backups', backups[0]))).rev, 1);
  });

  it('backs the library up before it is saved in a new format, and refuses the old format after', async () => {
    await t.req('PUT', '/api/library', { library: LIB });
    await t.req('PUT', '/api/library', { library: LIB });
    await t.req('PUT', '/api/library', { library: { ...LIB, format: 2 } });
    const backups = fs.readdirSync(path.join(t.data, 'backups')).sort();
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.data, 'backups', backups.at(-1)))).rev, 2); // the format 1 library
    const r = await t.req('PUT', '/api/library', { library: LIB });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /older than the library/);
    assert.equal((await t.req('GET', '/api/library')).json.library.format, 2);
  });

  it('keeps a client dropping the connection out of the log', async () => {
    const out = await captureStderr(async () => {
      const s = net.connect(t.port, '127.0.0.1');
      await new Promise(r => s.on('connect', r));
      s.write('GET /api/health HTTP/1.1\r\nHost: x'); // half a request, then a reset
      await delay(100);
      s.resetAndDestroy();
      await delay(300);
    });
    assert.equal(out, '');
  });

  it('logs a real error in one line', async () => {
    const orig = server.API['GET health'];
    server.API['GET health'] = () => { throw new RangeError('boom'); };
    try {
      let r;
      const out = await captureStderr(async () => { r = await t.req('GET', '/api/health'); await delay(50); });
      assert.equal(r.status, 500);
      assert.match(out, /^error: request from 127\.0\.0\.1 failed: RangeError: boom at \S+:\d+\n$/);
    } finally {
      server.API['GET health'] = orig;
    }
  });
});

async function captureStderr(fn) {
  const write = process.stderr.write;
  let out = '';
  process.stderr.write = s => { out += s; return true; };
  try { await fn(); } finally { process.stderr.write = write; }
  return out;
}

describe('token', () => {
  const t = harness({ token: 's3cret' });

  it('needs the token for changes', async () => {
    assert.equal((await t.req('POST', '/api/live', { live: {} }, { 'X-Lumen-Token': '' })).status, 401);
    assert.equal((await t.req('POST', '/api/live', { live: {} }, { 'X-Lumen-Token': '', Authorization: 'Bearer s3cret' })).status, 200);
    assert.equal((await t.req('GET', '/api/health')).json.auth, true);
  });
});

describe('network mode', () => {
  // Network mode switched from the console: a saved token, rebinding, and who may see or change it.
  const t = harness({ host: null });

  it('is local only by default, with a saved token', async () => {
    assert.equal(t.srv.host, '127.0.0.1');
    const r = await t.req('GET', '/api/network');
    assert.equal(r.status, 200);
    assert.equal(r.json.network, false);
    assert.equal(r.json.locked, false);
    assert.match(r.json.token, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.equal((await t.req('POST', '/api/live', { live: {} })).status, 200); // no token needed locally
    const file = path.join(t.data, 'settings.json');
    assert.equal(JSON.parse(fs.readFileSync(file)).token, r.json.token);
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it('switching on rebinds, requires the token and persists', async () => {
    const token = (await t.req('GET', '/api/network')).json.token;
    const r = await t.req('POST', '/api/network', { network: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.network, true);
    const port = t.port;
    assert.deepEqual([t.srv.host, t.srv.port], ['0.0.0.0', port]);
    assert.equal((await t.req('POST', '/api/live', { live: {} })).status, 401);
    assert.equal((await t.req('POST', '/api/live', { live: {} }, { 'X-Lumen-Token': token })).status, 200);
    assert.equal((await t.req('POST', '/api/network', { network: false })).status, 401);

    await t.restart(); // a restart (or an updated server) keeps both the mode and the token
    assert.equal(t.srv.host, '0.0.0.0');
    assert.equal((await t.req('GET', '/api/network')).json.token, token);

    const off = await t.req('POST', '/api/network', { network: false }, { 'X-Lumen-Token': token });
    assert.equal(off.status, 200);
    assert.equal(t.srv.host, '127.0.0.1');
    assert.equal((await t.req('POST', '/api/live', { live: {} })).status, 200);
  });

  it('makes a new token', async () => {
    const old = (await t.req('GET', '/api/network')).json.token;
    const fresh = (await t.req('POST', '/api/network', { regenerate: true })).json.token;
    assert.notEqual(old, fresh);
    assert.equal((await t.req('GET', '/api/network')).json.token, fresh);
  });

  it('gives proxied requests no token and no switch', async () => {
    const fwd = { 'X-Forwarded-For': '203.0.113.9' };
    const r = await t.req('GET', '/api/network', undefined, fwd);
    assert.equal(r.status, 200);
    assert.equal('token' in r.json, false);
    assert.equal((await t.req('POST', '/api/network', { network: true }, fwd)).status, 403);
    assert.equal(t.srv.host, '127.0.0.1');
  });

  it('makes other devices use the token to see anything', async () => {
    const token = (await t.req('POST', '/api/network', { network: true })).json.token;
    const remote = { 'X-Forwarded-For': '192.168.1.20' }; // counts as another device
    const get = (p, h = {}) => t.req('GET', p, undefined, { ...remote, ...h });

    let r = await get('/output.html');
    assert.equal(r.status, 401);
    assert.match(r.body.toString(), /access token/);
    assert.equal((await get('/api/library')).status, 401);
    assert.equal((await get('/render.js')).status, 401);
    assert.equal((await get('/api/health')).status, 200);
    assert.equal((await get('/stage.html?token=nope')).status, 401);

    r = await get(`/stage.html?token=${token}`); // a link from the Network tab
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, '/stage.html');
    const setCookie = r.headers['set-cookie'][0];
    const cookie = setCookie.split(';')[0];
    assert.match(setCookie, /HttpOnly/);
    for (const p of ['/stage.html', '/render.js', '/api/library', '/api/live']) {
      assert.equal((await get(p, { Cookie: cookie })).status, 200, p);
    }
    assert.equal((await t.req('POST', '/api/live', { live: {} }, { ...remote, Cookie: cookie })).status, 200);
    assert.ok(!cookie.includes(token)); // the cookie holds a sign-in for this device, not the token itself

    await t.req('POST', '/api/network', { regenerate: true }, { 'X-Lumen-Token': token });
    assert.equal((await get('/stage.html', { Cookie: cookie })).status, 401); // signed out by a new token
    assert.equal((await t.req('GET', '/api/library')).status, 200); // this computer never needs it to read
  });

  async function signIn(token, page = '/output.html', agent = 'Mozilla/5.0 (iPhone) Safari/604.1') {
    const r = await t.req('GET', `${page}?token=${token}`, undefined, { 'X-Forwarded-For': '192.168.1.20', 'User-Agent': agent });
    assert.equal(r.status, 303);
    return { 'X-Forwarded-For': '192.168.1.20', Cookie: r.headers['set-cookie'][0].split(';')[0] };
  }

  it('lists devices and can disconnect them', async () => {
    const token = (await t.req('POST', '/api/network', { network: true })).json.token;
    const phone = await signIn(token);
    const laptop = await signIn(token, '/stage.html', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36');

    const stream = await t.events({ ...phone, Referer: `http://192.168.1.5:${t.port}/output.html` }); // the phone shows the output
    assert.equal(stream.res.statusCode, 200);
    await stream.next();

    let devices = (await t.req('GET', '/api/network', undefined, { 'X-Lumen-Token': token })).json.devices;
    assert.deepEqual(devices.map(d => d.device).sort(), ['Chrome on Windows', 'Safari on iPhone']);
    const iphone = devices.find(d => d.device === 'Safari on iPhone');
    assert.deepEqual(iphone.open, ['Audience output']);
    const seenByPhone = (await t.req('GET', '/api/network', undefined, phone)).json;
    assert.equal('token' in seenByPhone, false);
    assert.equal(seenByPhone.signedIn, true);

    const r = await t.req('POST', '/api/network', { disconnect: iphone.id }, { 'X-Lumen-Token': token });
    assert.deepEqual(r.json.devices.map(d => d.device), ['Chrome on Windows']);
    assert.equal((await t.req('GET', '/api/library', undefined, phone)).status, 401);
    assert.equal((await t.req('GET', '/api/library', undefined, laptop)).status, 200);
    let ev;
    while ((ev = await stream.next())); // the phone's open stream is closed too
    stream.close();

    await t.req('POST', '/api/network', { disconnect: 'all' }, { 'X-Lumen-Token': token });
    assert.equal((await t.req('GET', '/api/library', undefined, laptop)).status, 401);
    devices = (await t.req('GET', '/api/network', undefined, { 'X-Lumen-Token': token })).json.devices;
    assert.deepEqual(devices, []);
  });

  it('lets a device sign itself out', async () => {
    const token = (await t.req('POST', '/api/network', { network: true })).json.token;
    const phone = await signIn(token, '/');
    const r = await t.req('POST', '/api/logout', undefined, phone);
    assert.equal(r.status, 200);
    assert.match(r.headers['set-cookie'][0], /Max-Age=0/);
    assert.equal((await t.req('GET', '/api/library', undefined, phone)).status, 401);
    assert.deepEqual((await t.req('GET', '/api/network', undefined, { 'X-Lumen-Token': token })).json.devices, []);
  });

  it('keeps sign-ins across a restart', async () => {
    const token = (await t.req('POST', '/api/network', { network: true })).json.token;
    const phone = await signIn(token);
    await t.restart();
    assert.equal((await t.req('GET', '/api/library', undefined, phone)).status, 200);
  });

  it('locks the switch when the host is given on the command line', async () => {
    await t.stop();
    await t.start({ host: '127.0.0.1' });
    assert.equal((await t.req('GET', '/api/network')).json.locked, true);
    assert.equal((await t.req('POST', '/api/network', { network: true })).status, 409);
  });
});

describe('options', () => {
  it('reads the command line and environment', () => {
    const o = server.options(['--port', '9000', '--allowed-host', 'a.example', '-v'],
      { LUMEN_HOST: '0.0.0.0', LUMEN_TOKEN: 't', LUMEN_ALLOWED_HOSTS: 'b.example,c.example', LUMEN_DATA: '/srv/lumen' });
    assert.deepEqual(o, { host: '0.0.0.0', port: 9000, data: '/srv/lumen', token: 't', maxUploadMb: 4096, verbose: true, mediaFolders: [],
      allowedHosts: ['b.example', 'c.example', 'a.example'] });
    assert.equal(server.options([], {}).host, null);
  });

  it('names devices from their browser', () => {
    assert.equal(server.deviceName('Mozilla/5.0 (iPhone) CriOS/120 Safari/604.1'), 'Chrome on iPhone');
    assert.equal(server.deviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120'), 'Edge on Windows');
    assert.equal(server.deviceName('curl/8'), 'Unknown device');
  });
});
