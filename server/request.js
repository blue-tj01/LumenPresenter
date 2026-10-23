// @ts-check
// One HTTP request: who it is from, what it may do, and the files it asks for.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { COOKIE, HttpError, bad, deviceName, nowMs, safeEqual, unquote, quote, isObject } = require('./util.js');
const { MEDIA_NAME, TYPES, MEDIA_CSP } = require('./media.js');
const API = require('./api/index.js');

const APP_DIR = path.join(__dirname, '..');
// The pages and what they load; every module in console/ is served, so a new one needs no change here.
const STATIC = new Set(['index.html', 'output.html', 'stage.html', 'remote.html', 'app.css', 'render.js', 'render.css', 'sync.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs',
  ...fs.readdirSync(path.join(APP_DIR, 'console')).filter(f => f.endsWith('.js')).map(f => `console/${f}`)]);
const MAX_JSON = 64 * 1024 * 1024;
const FORWARDED = ['x-forwarded-for', 'forwarded', 'x-real-ip'];
// Shown to another device that opens a page without the token (or with an old one).
const TOKEN_PAGE = msg => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Lumen Presenter</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14161b;color:#e6e8ee;
font:15px system-ui,sans-serif}form{display:flex;flex-direction:column;gap:12px;width:min(320px,90vw)}
input,button{font:inherit;padding:9px 11px;border-radius:6px;border:1px solid #333a48;background:#1d2027;color:inherit}
button{background:#4f7cff;border-color:#4f7cff;cursor:pointer}p{margin:0;color:#8b92a3;font-size:13px}</style></head>
<body><form method="get"><strong>Lumen Presenter</strong>
<p>${msg}</p>
<input name="token" placeholder="xxxx-xxxx-xxxx" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus>
<button>Open</button></form></body></html>`;

/** One parsed request, with the checks that decide what it may do. */
class Request {
  constructor(srv, req, res) {
    this.srv = srv; this.store = srv.store; this.req = req; this.res = res;
    this.method = req.method;
    const q = req.url.indexOf('?');
    this.path = q < 0 ? req.url : req.url.slice(0, q);
    this.query = new URLSearchParams(q < 0 ? '' : req.url.slice(q + 1));
    this.address = (req.socket.remoteAddress || '').replace(/^::ffff:(?=\d+\.)/, '');
  }

  header(name) { const v = this.req.headers[name]; return Array.isArray(v) ? v[0] : v || ''; }

  // ---------- helpers ----------
  sendJson(obj, status = 200, headers = {}) {
    const body = Buffer.from(JSON.stringify(obj));
    this.res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length,
      'Cache-Control': 'no-store', ...headers });
    this.res.end(body);
  }

  error(status, msg) {
    // Any unread request body must not be parsed as the next request.
    this.sendJson({ error: msg }, status, { Connection: 'close' });
  }

  fromLoopback() {
    const a = this.address;
    return net.isIPv4(a) ? a.startsWith('127.') : a === '::1';
  }

  /** A request from this computer itself, not relayed by a proxy on it. */
  isLocal() {
    return this.fromLoopback() && !FORWARDED.some(h => this.header(h));
  }

  /** DNS rebinding: a web page whose own name is pointed at 127.0.0.1 would reach Lumen from this computer as a
   * page of the same site, so it could read the token and make changes. Only names nobody else can point here are
   * accepted from this computer: IP addresses, localhost, this computer's name, and --allowed-host. */
  knownHost() {
    const m = /^(?:\[([0-9a-fA-F:.]+)\](?::\d+)?|([^:]*)(?::\d+)?)$/.exec(this.header('host'));
    if (!m) return false;
    const name = (m[1] || m[2] || '').toLowerCase().replace(/\.$/, '');
    if (!name || name === 'localhost' || name.endsWith('.localhost') || this.srv.allowedHosts.has(name)) return true;
    return net.isIP(name) !== 0;
  }

  /** CSRF: browsers say which site a request comes from; changes are only taken from Lumen's own pages. */
  sameOrigin() {
    return ['GET', 'HEAD'].includes(this.method) || ['same-origin', 'none'].includes(this.header('sec-fetch-site') || 'same-origin');
  }

  /** The signed-in device this request comes from (its cookie), if any. */
  session() {
    for (const part of this.header('cookie').split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0 || part.slice(0, eq).trim() !== COOKIE) continue;
      const sid = part.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      return sid && Object.hasOwn(this.store.settings.sessions, sid) ? sid : null;
    }
    return null;
  }

  authorized() {
    const token = this.srv.token;
    if (!token) return true;
    const given = [this.header('x-lumen-token')];
    const auth = this.header('authorization');
    if (auth.startsWith('Bearer ')) given.push(auth.slice(7));
    if (given.some(g => g && safeEqual(g, token))) return true;
    const sid = this.session();
    if (sid) this.srv.seen.set(sid, nowMs());
    return !!sid;
  }

  /** In network mode other devices need the token to see anything, not only to change it. */
  mayRead() {
    return !this.srv.network || this.isLocal() || this.authorized();
  }

  /** A page opened as ?token=... (the links in the console's Network tab, or the token page's form): sign the
   * device in with a cookie and reload without the token, so it doesn't stay in the address bar or history.
   * True if handled. */
  tokenLink() {
    const token = this.query.getAll('token').find(v => v !== '');
    if (this.method !== 'GET' || this.path.startsWith('/api/') || token === undefined) return false;
    if (!safeEqual(token.trim(), this.srv.token || '')) {
      this.sendTokenPage('That token is not right. Check it in the Network tab of the console.');
      return true;
    }
    const sid = this.store.addSession({ device: deviceName(this.header('user-agent')), address: this.address });
    this.res.writeHead(303, { Location: quote(this.path), 'Content-Length': 0, 'Cache-Control': 'no-store',
      'Set-Cookie': `${COOKIE}=${sid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict` });
    this.res.end();
    return true;
  }

  sendTokenPage(msg) {
    const body = Buffer.from(TOKEN_PAGE(msg));
    this.res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length,
      'Cache-Control': 'no-store', Connection: 'close' });
    this.res.end(this.method === 'HEAD' ? undefined : body);
  }

  async readBodyJson() {
    // Another site can send text/plain without asking first, but not application/json (the browser checks with
    // the server, which doesn't agree).
    if (this.header('content-type').split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw bad('Content-Type must be application/json');
    }
    const n = Number(this.header('content-length') || 0);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_JSON) throw bad('body missing or too large');
    const chunks = [];
    for await (const chunk of this.req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isObject(body)) throw bad('body must be a JSON object');
    return body;
  }

  // ---------- routing ----------
  async route() {
    const { srv, path: p, method } = this;
    if (!srv.network && !this.fromLoopback()) {
      // Network mode was just switched off; connections made while it was on are turned away.
      return this.error(403, 'network mode is off');
    }
    if (this.fromLoopback() && !this.knownHost()) {
      return this.error(403, 'unknown host name (behind a proxy, add it with --allowed-host)');
    }
    if (!this.sameOrigin()) return this.error(403, 'request from another site');
    if (srv.network && this.tokenLink()) return;
    if (p !== '/api/health' && !this.mayRead()) {
      if (p.startsWith('/api/') || p.startsWith('/media/') || p.startsWith('/folders/') || !(p === '/' || p.endsWith('.html'))) {
        return this.error(401, 'token required');
      }
      return this.sendTokenPage('Enter the access token shown in the Network tab of the console.');
    }
    if (p.startsWith('/api/')) {
      const name = p.slice(5);
      if (!['GET', 'HEAD'].includes(method) && !this.authorized()) return this.error(401, 'token required');
      const fn = API[`${method} ${name.split('/')[0]}`];
      if (!fn) return this.error(404, 'no such endpoint');
      try {
        return await fn.call(this, name);
      } catch (e) {
        if (e instanceof HttpError) return this.error(e.status, e.message);
        if (e instanceof SyntaxError || e instanceof TypeError) return this.error(400, e.message);
        throw e;
      }
    }
    if (!['GET', 'HEAD'].includes(method)) return this.error(405, 'method not allowed');
    if (p.startsWith('/media/')) return this.serveMedia(unquote(p.slice(7)));
    if (p.startsWith('/folders/')) return this.serveFolder(p.slice(9));
    return this.serveStatic(p);
  }

  // ---------- files ----------
  serveStatic(p) {
    const name = p.replace(/^\/+/, '') || 'index.html';
    if (!STATIC.has(name)) return this.error(404, 'not found');
    let data;
    try { data = fs.readFileSync(path.join(APP_DIR, name)); } catch { return this.error(404, 'not found'); }
    this.sendFile(name, data.length, (start, end) => this.res.end(data.subarray(start, end + 1)), 'no-cache');
  }

  serveMedia(name) {
    if (!MEDIA_NAME.test(name)) return this.error(404, 'not found');
    // Names are random and never reused, so the content can be cached forever.
    this.serveDiskFile(path.join(this.store.mediaDir, name), 'public, max-age=31536000, immutable');
  }

  serveFolder(rest) {
    const slash = rest.indexOf('/');
    const file = slash > 0 && this.srv.folders.resolve(rest.slice(0, slash), rest.slice(slash + 1));
    if (!file) return this.error(404, 'not found');
    // A file in a folder can be replaced under the same name, so check it is unchanged before using a cached copy.
    this.serveDiskFile(file, 'no-cache');
  }

  serveDiskFile(file, cache) {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return this.error(404, 'not found'); }
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) { fs.closeSync(fd); return this.error(404, 'not found'); }
    const tag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
    if (cache === 'no-cache' && this.header('if-none-match') === tag) {
      fs.closeSync(fd);
      this.res.writeHead(304, { ETag: tag, 'Cache-Control': cache });
      return this.res.end();
    }
    const sent = this.sendFile(file, stat.size, (start, end) => {
      fs.createReadStream(null, { fd, start, end }).on('error', () => this.res.destroy()).pipe(this.res);
    }, cache, MEDIA_CSP, { ETag: tag });
    if (!sent) fs.closeSync(fd);
  }

  /** Headers for a whole file or the byte range asked for, then body(start, end) unless this is HEAD. Returns
   * whether body was called. */
  sendFile(name, size, body, cache, csp, extra = {}) {
    let start = 0, end = size - 1, status = 200;
    const headers = { ...extra };
    const m = /^bytes=(\d*)-(\d*)$/.exec(this.header('range').trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      } else {
        start = Math.max(0, size - Number(m[2]));
      }
      if (start > end || start >= size) {
        this.res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
        this.res.end();
        return false;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    let ctype = TYPES[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
    if (ctype.startsWith('text/') || ctype === 'application/javascript') ctype += '; charset=utf-8';
    Object.assign(headers, { 'Content-Type': ctype, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    if (csp) headers['Content-Security-Policy'] = csp;
    this.res.writeHead(status, headers);
    if (this.method === 'HEAD') { this.res.end(); return false; }
    body(start, end);
    return true;
  }
}

module.exports = { Request, APP_DIR };
