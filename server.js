#!/usr/bin/env node
// Lumen Presenter server.
//
// Serves the app, stores the library, media and live state on disk, and pushes live changes to every connected
// window (on any device) over Server-Sent Events. Node's standard library only. The desktop app (electron/main.js)
// runs it in-process; it also runs on its own:
//
//     node server.js                                 # http://127.0.0.1:8642, data in ./data
//     node server.js --host 0.0.0.0 --token secret   # reachable from the LAN
//
// Network mode can also be switched on and off from the console. Its access token is generated once and kept,
// with the setting, in data/settings.json.
'use strict';
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { parseArgs } = require('util');

const VERSION = 2; // the pages warn when the server is older than they are (updated but not restarted)
const APP_DIR = __dirname;
const STATIC = new Set(['index.html', 'output.html', 'stage.html', 'app.js', 'app.css', 'render.js', 'render.css', 'sync.js']);
const MEDIA_NAME = /^[a-z0-9]{16}\.[a-z0-9]{1,5}$/;
// The stored extension decides the Content-Type the file is served with, so it must be a media type,
// never whatever the uploader's filename says (e.g. .html, which would run as a page on this origin).
const MEDIA_EXT = {
  image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']),
  video: new Set(['mp4', 'webm', 'mov', 'm4v', 'ogv']),
};
const TYPES = {
  html: 'text/html', css: 'text/css', js: 'application/javascript', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', ogv: 'video/ogg',
};
const EXT_FOR_TYPE = Object.fromEntries(Object.entries(TYPES).filter(([e]) => e !== 'jpeg').map(([e, t]) => [t, e]));
// Media is only ever displayed, never run: neutralises scripts in an SVG opened directly.
const MEDIA_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
const MAX_JSON = 64 * 1024 * 1024;
const FOLDER_DEPTH = 6;      // levels of subfolders listed in a media folder
const FOLDER_FILES = 5000;   // files listed per media folder
const FOLDER_SKIP = /^(?:\.|\$|~\$|System Volume Information$|node_modules$)/i; // hidden, system and lock files
const BACKUP_EVERY = 600; // seconds between library snapshots in data/backups
const BACKUP_KEEP = 50;
const HEARTBEAT = 15;
const STALLED = 4 * 1024 * 1024; // bytes queued for an event stream before it counts as stalled
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const TOKEN_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i, so it can be read off one screen and typed on another
const FORWARDED = ['x-forwarded-for', 'forwarded', 'x-real-ip'];
const COOKIE = 'lumen_session';
const MAX_SESSIONS = 100;
const PAGES = { 'output.html': 'Audience output', 'stage.html': 'Stage display' };
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

/** A request the client got wrong: answered with this status and message. */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = msg => new HttpError(400, msg);

/** Three groups of four, e.g. k7mq-3xht-p9wd (about 59 bits). */
function newToken() {
  const group = () => Array.from({ length: 4 }, () => TOKEN_CHARS[crypto.randomInt(TOKEN_CHARS.length)]).join('');
  return [group(), group(), group()].join('-');
}

/** 'Chrome on iPhone' from a User-Agent, for the list of signed-in devices. */
function deviceName(agent) {
  const find = pairs => (pairs.find(([k]) => agent.includes(k)) || [, ''])[1];
  const system = find([['iPhone', 'iPhone'], ['iPad', 'iPad'], ['Android', 'Android'], ['CrOS', 'Chromebook'],
    ['Macintosh', 'Mac'], ['Windows', 'Windows'], ['Linux', 'Linux']]);
  const browser = find([['Edg/', 'Edge'], ['Firefox/', 'Firefox'], ['CriOS/', 'Chrome'], ['Chrome/', 'Chrome'],
    ['Safari/', 'Safari']]);
  return [browser, system].filter(Boolean).join(' on ') || 'Unknown device';
}

/** This computer's addresses on the local network, best guess first. */
async function lanAddresses() {
  const found = [];
  // The address the default route would use; connecting a UDP socket sends nothing.
  found.push(await new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    const done = a => { try { s.close(); } catch {} resolve(a); };
    s.on('error', () => done(null));
    try {
      s.connect(9, '192.0.2.1', err => { if (err) return done(null); try { done(s.address().address); } catch { done(null); } });
    } catch { done(null); }
  }));
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' || a.family === 4) found.push(a.address);
  }
  return found.filter((a, i) => a && found.indexOf(a) === i && !a.startsWith('127.'));
}

const nowMs = () => Date.now();

/** Constant-time comparison of two strings of any length. */
function safeEqual(a, b) {
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/** Percent-decoding that never throws: invalid UTF-8 becomes U+FFFD, like Python's unquote. */
function unquote(s) {
  try { return decodeURIComponent(s); } catch {}
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; }
    else { const ch = String.fromCodePoint(s.codePointAt(i)); bytes.push(...Buffer.from(ch)); i += ch.length; }
  }
  return Buffer.from(bytes).toString('utf8');
}

const quote = p => encodeURIComponent(p).replace(/%2F/g, '/');

function writeAtomic(file, data, mode) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', mode ?? 0o666);
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file); } catch (e) {
    if (e.code !== 'ENOENT') console.error(`warning: could not read ${file}: ${e.message}`);
    return null;
  }
  try { return JSON.parse(raw.toString('utf8')); } catch (e) {
    console.error(`warning: could not read ${file}: ${e.message}`);
    return null;
  }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** library-20261019-211500.json, in local time. */
function backupName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `library-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

/** On-disk state. Node runs one request at a time between awaits, and every change here is synchronous. */
class Store {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir);
    this.mediaDir = path.join(this.dir, 'media');
    this.backupDir = path.join(this.dir, 'backups');
    for (const d of [this.dir, this.mediaDir, this.backupDir]) fs.mkdirSync(d, { recursive: true });
    this.libPath = path.join(this.dir, 'library.json');
    this.livePath = path.join(this.dir, 'live.json');

    const lib = readJson(this.libPath);
    this.library = isObject(lib) ? lib.library ?? null : null;
    this.rev = isObject(lib) ? lib.rev ?? 0 : 0;
    const live = readJson(this.livePath);
    this.live = isObject(live) ? live.live ?? null : null;
    this.liveOrigin = null;
    this.lastBackup = 0;

    this.settingsPath = path.join(this.dir, 'settings.json');
    const settings = readJson(this.settingsPath);
    this.settings = isObject(settings) ? settings : {};
    if (!isObject(this.settings.sessions)) this.settings.sessions = {};
    if (typeof this.settings.token !== 'string' || !this.settings.token) {
      this.settings.token = newToken();
      this.saveSettings();
    }
  }

  /** Network mode, its token and signed-in devices. Kept with the library, so updating the app's files leaves
   * them alone. */
  saveSettings(changes = {}) {
    Object.assign(this.settings, changes);
    this._writeSettings();
  }

  /** Sign a device in; returns the id its cookie carries instead of the token. */
  addSession(info) {
    const sid = crypto.randomBytes(24).toString('base64url');
    const sessions = this.settings.sessions;
    sessions[sid] = { ...info, created: nowMs() };
    const old = Object.keys(sessions).sort((a, b) => (sessions[a].created || 0) - (sessions[b].created || 0));
    for (const k of old.slice(0, Math.max(0, old.length - MAX_SESSIONS))) delete sessions[k];
    this._writeSettings();
    return sid;
  }

  /** Sign out the given devices, or all of them. */
  dropSessions(sids = null) {
    const sessions = this.settings.sessions;
    for (const sid of sids ?? Object.keys(sessions)) delete sessions[sid];
    this._writeSettings();
  }

  _writeSettings() {
    writeAtomic(this.settingsPath, JSON.stringify(this.settings, null, 2), 0o600); // the token is a secret
  }

  setLibrary(library) {
    this._backup();
    this.rev += 1;
    this.library = library;
    writeAtomic(this.libPath, JSON.stringify({ rev: this.rev, saved: nowMs(), library }));
    return this.rev;
  }

  _backup() {
    if (!fs.existsSync(this.libPath) || Date.now() / 1000 - this.lastBackup < BACKUP_EVERY) return;
    this.lastBackup = Date.now() / 1000;
    fs.copyFileSync(this.libPath, path.join(this.backupDir, backupName()));
    const old = fs.readdirSync(this.backupDir).filter(f => f.startsWith('library-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) fs.rmSync(path.join(this.backupDir, f), { force: true });
  }

  setLive(live, origin) {
    this.live = live;
    this.liveOrigin = origin;
    writeAtomic(this.livePath, JSON.stringify({ saved: nowMs(), live }));
  }
}

const mediaKind = name => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return MEDIA_EXT.image.has(ext) ? 'image' : MEDIA_EXT.video.has(ext) ? 'video' : null;
};
/** Whether a path is inside a folder (a drive root such as E:\\ included). */
const inside = (child, dir) => child.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
const folderId = dir => crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 12);

/** Folders on this computer whose pictures and videos Lumen plays where they are, with no upload: a shared
 * worship-loops folder, say. Those given with --media-folder are fixed; the rest are added and removed in the
 * console and kept in settings.json. Each is served under /folders/<id>/. */
class Folders {
  constructor(store, fixed, changed) {
    this.store = store;
    this.fixed = fixed.filter(Boolean).map(d => ({ id: folderId(d), path: path.resolve(d), fixed: true }));
    this.changed = changed;
    this.watchers = new Map(); // folder id -> fs.watch handle
    this.timer = null;
    if (!Array.isArray(store.settings.folders)) store.settings.folders = [];
  }

  list() {
    const seen = new Set();
    return [...this.fixed, ...this.store.settings.folders.map(f => ({ id: f.id, path: f.path, fixed: false }))]
      .filter(f => !seen.has(f.id) && seen.add(f.id));
  }

  get(id) { return this.list().find(f => f.id === id) || null; }

  add(dir) {
    if (typeof dir !== 'string' || !dir.trim()) throw bad('folder path missing');
    const full = path.resolve(dir.trim());
    let stat;
    try { stat = fs.statSync(full); } catch { throw bad(`no folder at ${full}`); }
    if (!stat.isDirectory()) throw bad(`${full} is not a folder`);
    if (full === this.store.dir || inside(full, this.store.dir) || inside(this.store.dir, full)) {
      throw bad('the data folder cannot be a media folder');
    }
    const id = folderId(full);
    if (!this.get(id)) this.store.saveSettings({ folders: [...this.store.settings.folders, { id, path: full }] });
    this.watch();
    return id;
  }

  remove(id) {
    if (this.fixed.some(f => f.id === id)) throw new HttpError(409, 'that folder is set with --media-folder');
    this.store.saveSettings({ folders: this.store.settings.folders.filter(f => f.id !== id) });
    this.watch();
  }

  /** The pictures and videos in a folder and its subfolders, as paths relative to it with / between parts. */
  async files(folder) {
    const out = [];
    const walk = async (dir, rel, depth) => {
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      for (const e of entries) {
        if (out.length >= FOLDER_FILES || FOLDER_SKIP.test(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < FOLDER_DEPTH) await walk(path.join(dir, e.name), r, depth + 1); continue; }
        const type = (e.isFile() || e.isSymbolicLink()) && mediaKind(e.name);
        if (type) out.push({ path: r, name: e.name, type });
      }
    };
    await walk(folder.path, '', 0);
    return out;
  }

  /** The file a /folders/<id>/<path> request names, or null. Only pictures and videos inside the folder are
   * served: no parent directories, links out of it, or Windows alternate streams (name:stream). */
  resolve(id, rel) {
    const folder = this.get(id);
    if (!folder) return null;
    const parts = rel.split('/').map(unquote);
    if (!parts.length || parts.some(x => !x || x === '.' || x === '..' || /[\\/:\0]/.test(x))) return null;
    if (!mediaKind(parts[parts.length - 1])) return null;
    try {
      const root = fs.realpathSync(folder.path);
      const file = fs.realpathSync(path.join(folder.path, ...parts));
      return inside(file, root) && mediaKind(file) ? file : null;
    } catch { return null; }
  }

  /** Tell the consoles when files are added, removed or renamed in any folder. */
  watch() {
    const ids = new Set(this.list().map(f => f.id));
    for (const [id, w] of this.watchers) if (!ids.has(id)) { w.close(); this.watchers.delete(id); }
    for (const f of this.list()) {
      if (this.watchers.has(f.id)) continue;
      try {
        const w = fs.watch(f.path, { recursive: true, persistent: false }, () => this.touched());
        w.on('error', () => { w.close(); this.watchers.delete(f.id); });
        this.watchers.set(f.id, w);
      } catch {} // missing, or watching unsupported here: the list still updates when the console asks
    }
    this.touched();
  }

  touched() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed(), 500);
    this.timer.unref();
  }

  close() {
    clearTimeout(this.timer);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}

/** Fan-out of events to connected SSE clients. Each one has a check that closes it once it may no longer read. */
class Hub {
  constructor() { this.clients = new Set(); }
  add(client) { this.clients.add(client); }
  remove(client) { this.clients.delete(client); }
  send(event, data) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of [...this.clients]) {
      // Network mode switched off, or this device signed out (or a new token made) since it opened.
      if (!c.check()) { this.remove(c); c.res.end(); continue; }
      // A stalled client; drop it, EventSource will reconnect.
      if (c.res.writableLength > STALLED) { this.remove(c); c.res.destroy(); continue; }
      c.res.write(msg);
    }
  }
  get count() { return this.clients.size; }
}

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

  async networkInfo() {
    const srv = this.srv;
    const info = { network: srv.network, local: this.isLocal(), signedIn: !!this.session() };
    if (info.local) { // only the computer running Lumen is shown the token and may change the setting
      const sessions = this.store.settings.sessions;
      const devices = Object.entries(sessions).map(([id, s]) => ({ id, ...s, seen: srv.seen.get(id) ?? null,
        open: [...new Set(srv.streams.get(id) || [])].sort() }));
      Object.assign(info, { locked: srv.hostLocked, token: srv.explicitToken || this.store.settings.token, port: srv.port,
        addresses: srv.network ? await lanAddresses() : [],
        devices: devices.sort((a, b) => (b.seen || b.created || 0) - (a.seen || a.created || 0)) });
    }
    return info;
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

// ---------- API ----------
const API = {
  'GET health'() {
    this.sendJson({ ok: true, version: VERSION, time: nowMs(), auth: !!this.srv.token, clients: this.srv.hub.count });
  },

  async 'GET network'() {
    this.sendJson(await this.networkInfo());
  },

  async 'POST network'() {
    if (!this.isLocal()) return this.error(403, 'network mode can only be changed on the computer running Lumen');
    const body = await this.readBodyJson();
    const srv = this.srv;
    if (body.regenerate) {
      if (srv.explicitToken) return this.error(409, 'the token is set with --token or LUMEN_TOKEN');
      this.store.saveSettings({ token: newToken() });
      this.store.dropSessions();
      srv.hub.send('ping', { time: nowMs() }); // event streams of signed-out devices close
    }
    if ('disconnect' in body) { // a device id, or 'all'
      this.store.dropSessions(body.disconnect === 'all' ? null : [String(body.disconnect)]);
      srv.hub.send('ping', { time: nowMs() });
    }
    if ('network' in body) {
      const on = !!body.network;
      if (srv.hostLocked && on !== srv.network) return this.error(409, 'network mode is set with --host or LUMEN_HOST');
      if (on !== srv.network) await srv.setNetwork(on);
    }
    this.sendJson(await this.networkInfo());
  },

  /** Sign this device out: forget its session and its cookie. */
  'POST logout'() {
    const sid = this.session();
    if (sid) {
      this.store.dropSessions([sid]);
      this.srv.hub.send('ping', { time: nowMs() });
    }
    this.sendJson({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict` });
  },

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

  async 'POST media'() {
    const ctype = this.header('content-type').split(';')[0].trim().toLowerCase();
    if (!ctype.startsWith('image/') && !ctype.startsWith('video/')) throw bad('only image and video uploads are accepted');
    const n = Number(this.header('content-length') || 0);
    if (!Number.isInteger(n) || n <= 0) throw bad('empty upload');
    if (n > this.srv.maxUpload) return this.error(413, 'file too large');
    const name = Array.from(unquote(this.header('x-filename') || 'upload')).slice(0, 200).join('');
    const kind = ctype.startsWith('video/') ? 'video' : 'image';
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

  'GET events'() {
    const srv = this.srv, res = this.res;
    const sid = this.session();
    let page = '';
    try { page = new URL(this.header('referer')).pathname.split('/').pop(); } catch {}
    page = PAGES[page] || 'Console';
    if (sid) srv.streams.set(sid, [...(srv.streams.get(sid) || []), page]);
    const local = this.fromLoopback();
    const client = { res, check: () => (local || srv.network) && this.mayRead() };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no', // don't let nginx buffer the stream
      Connection: 'close' });
    this.req.socket.setTimeout(0);
    this.req.socket.setNoDelay(true);
    const hello = { live: this.store.live, origin: this.store.liveOrigin, rev: this.store.rev, time: nowMs() };
    res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify(hello)}\n\n`);
    srv.hub.add(client);
    res.on('close', () => {
      srv.hub.remove(client);
      if (!sid) return;
      const open = srv.streams.get(sid) || [];
      open.splice(open.indexOf(page), 1);
      if (open.length) srv.streams.set(sid, open); else srv.streams.delete(sid);
    });
  },
};

/** The first line of the stack that is ours, as ' at server.js:123'. */
function where(e) {
  const m = /\(?([^\s()]+):(\d+):\d+\)?$/m.exec(String(e?.stack || '').split('\n').slice(1).join('\n'));
  return m ? ` at ${path.basename(m[1])}:${m[2]}` : '';
}

/** host null binds as the saved network mode says; any other host is fixed (--host) and can't be switched. */
class LumenServer {
  constructor({ host = null, port = 8642, data = path.join(APP_DIR, 'data'), token = '', maxUploadMb = 4096,
    verbose = false, allowedHosts = [], mediaFolders = [] } = {}) {
    const name = os.hostname().toLowerCase();
    this.allowedHosts = new Set(allowedHosts.map(h => h.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
    this.allowedHosts.add(name).add(`${name}.local`);
    this.store = new Store(data);
    this.hostLocked = host !== null && host !== undefined && host !== '';
    this.host = this.hostLocked ? host : this.store.settings.network ? '0.0.0.0' : '127.0.0.1';
    this.port = port;
    this.hub = new Hub();
    this.explicitToken = token || '';
    this.maxUpload = maxUploadMb * 1024 * 1024;
    this.verbose = verbose;
    this.seen = new Map();    // session id -> last request (ms), not saved
    this.streams = new Map(); // session id -> pages it has open now (one per event stream)
    this.servers = new Set(); // the listening server, and earlier ones still finishing their connections
    this.switching = Promise.resolve();
    this.heartbeat = null;
    this.folders = new Folders(this.store, mediaFolders, () => this.hub.send('folders', { time: nowMs() }));
  }

  /** Reachable from other computers. */
  get network() { return !LOCAL_HOSTS.includes(this.host); }

  /** The token changes need: --token if given, otherwise the saved one while in network mode. */
  get token() { return this.explicitToken || (this.network ? this.store.settings.token : ''); }

  /** Start listening; resolves once it is, with the port. */
  async listen() {
    await this._bind(this.host, this.port);
    this.heartbeat = setInterval(() => this.hub.send('ping', { time: nowMs() }), HEARTBEAT * 1000);
    this.heartbeat.unref();
    this.folders.watch();
    return this.port;
  }

  _bind(host, port, tries = 1) {
    const server = http.createServer((req, res) => this._handle(req, res));
    server.requestTimeout = 0; // a large video upload over Wi-Fi can take a while
    server.on('clientError', (err, socket) => this._clientError(err, socket));
    return new Promise((resolve, reject) => {
      const attempt = n => {
        server.once('error', e => {
          // The previous socket on this port may take a moment to be released after a switch.
          if (e.code === 'EADDRINUSE' && n > 1) setTimeout(() => attempt(n - 1), 100);
          else reject(e);
        });
        server.listen(port, host, () => {
          server.removeAllListeners('error');
          server.on('error', e => console.error(`error: ${e.message}`));
          const a = server.address();
          this.host = a.address;
          this.port = a.port;
          this.current = server;
          this.servers.add(server);
          resolve();
        });
      };
      attempt(tries);
    });
  }

  /** Save the setting and move the listening socket. Open connections (output windows) carry on. */
  setNetwork(on) {
    const run = this.switching.then(() => this._switch(on));
    this.switching = run.catch(() => {});
    return run;
  }

  async _switch(on) {
    this.store.saveSettings({ network: on });
    const old = this.host, target = on ? '0.0.0.0' : '127.0.0.1', previous = this.current;
    previous.close(() => this.servers.delete(previous));
    for (const h of [target, old]) {
      try {
        await this._bind(h, this.port, 30);
        break;
      } catch (e) {
        console.error(`warning: could not listen on ${h}:${this.port}: ${e.message}`);
        if (h === old) throw new Error(`could not listen on port ${this.port}`);
      }
    }
    if (this.host !== target) this.store.saveSettings({ network: this.network }); // fell back; keep the saved setting truthful
    console.log(`Network mode ${this.network ? 'on' : 'off'}: listening on ${this.host}:${this.port}`);
    this.hub.send('ping', { time: nowMs() }); // wake event streams so remote ones close if now local
  }

  async _handle(req, res) {
    req.on('error', () => {});
    res.on('error', () => {});
    res.setHeader('Server', `Lumen/${VERSION}`);
    if (this.verbose) {
      res.on('finish', () => console.error(
        `${req.socket.remoteAddress} - - [${new Date().toISOString()}] "${req.method} ${req.url} HTTP/${req.httpVersion}" ${res.statusCode} -`));
    }
    try {
      await new Request(this, req, res).route();
    } catch (e) {
      this.logError(e, req);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ error: 'internal error' }));
      } else {
        res.destroy();
      }
    }
  }

  /** A client going away mid-request (a closed tab, a phone sleeping, a dropped Wi-Fi link) is normal and stays
   * silent; anything else is one line, with the full stack only with --verbose. */
  logError(e, req) {
    if (['ECONNRESET', 'EPIPE', 'ECONNABORTED', 'ETIMEDOUT', 'ERR_STREAM_PREMATURE_CLOSE'].includes(e?.code)) return;
    const addr = (req?.socket?.remoteAddress || '?').replace(/^::ffff:(?=\d+\.)/, '');
    let line = `error: request from ${addr} failed: ${e?.name || 'Error'}: ${e?.message ?? e}${where(e)}`;
    if (this.verbose && e?.stack) line += '\n' + e.stack;
    process.stderr.write(line + '\n'); // one write, so lines from parallel requests don't interleave
  }

  _clientError(err, socket) {
    if (['ECONNRESET', 'EPIPE'].includes(err.code) || !socket.writable) return socket.destroy();
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  }

  /** Stop listening and close every connection. */
  async close() {
    clearInterval(this.heartbeat);
    this.folders.close();
    for (const c of this.hub.clients) c.res.destroy();
    this.hub.clients.clear();
    await Promise.all([...this.servers].map(s => new Promise(resolve => {
      s.close(() => resolve());
      s.closeAllConnections?.();
    })));
    this.servers.clear();
  }
}

function options(argv = process.argv.slice(2), env = process.env) {
  const { values: v } = parseArgs({
    args: argv,
    options: {
      host: { type: 'string' }, port: { type: 'string' }, data: { type: 'string' }, token: { type: 'string' },
      'allowed-host': { type: 'string', multiple: true }, 'max-upload-mb': { type: 'string' },
      'media-folder': { type: 'string', multiple: true },
      verbose: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (v.help) {
    console.log(`usage: node server.js [--host HOST] [--port PORT] [--data DIR] [--token TOKEN]
                      [--allowed-host NAME ...] [--media-folder DIR ...] [--max-upload-mb MB] [-v]

  --host           address to bind, fixing network mode (0.0.0.0 for all interfaces); default: 127.0.0.1,
                   or 0.0.0.0 once network mode is switched on in the console
  --port           default 8642
  --data           directory for the library, media and live state (default ./data)
  --token          require this token for any change, even locally (default: a generated one, kept in the
                   data directory and required in network mode)
  --allowed-host   a host name Lumen is reached by through a reverse proxy, e.g. lumen.example.org
                   (repeatable; IP addresses, localhost and this computer's name are always accepted)
  --media-folder   a folder of pictures and videos to play from where they are, with no upload (repeatable;
                   more can be added in the console)
  --max-upload-mb  default 4096
  -v, --verbose    log every request`);
    process.exit(0);
  }
  const int = (s, name) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
    return n;
  };
  return {
    host: v.host || env.LUMEN_HOST || null,
    port: int(v.port ?? env.LUMEN_PORT ?? 8642, '--port'),
    data: v.data || env.LUMEN_DATA || path.join(APP_DIR, 'data'),
    token: v.token ?? env.LUMEN_TOKEN ?? '',
    allowedHosts: [...(env.LUMEN_ALLOWED_HOSTS || '').split(','), ...(v['allowed-host'] || [])],
    mediaFolders: [...(env.LUMEN_MEDIA_FOLDERS || '').split(path.delimiter), ...(v['media-folder'] || [])].filter(Boolean),
    maxUploadMb: int(v['max-upload-mb'] ?? env.LUMEN_MAX_UPLOAD_MB ?? 4096, '--max-upload-mb'),
    verbose: !!v.verbose,
  };
}

async function main() {
  let opts;
  try { opts = options(); } catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  const srv = new LumenServer(opts);
  try {
    await srv.listen();
  } catch (e) {
    console.error(`error: could not listen on ${srv.host}:${opts.port}: ${e.message}`);
    process.exit(1);
  }
  console.log(`Lumen Presenter on http://localhost:${srv.port}  (data: ${srv.store.dir})`);
  if (srv.network) {
    const hosts = ['0.0.0.0', '::'].includes(srv.host) ? await lanAddresses() : [srv.host];
    console.log(`Network mode on: ${hosts.map(h => `http://${h}:${srv.port}`).join(', ') || srv.host}` +
      `  token: ${opts.token ? '(from --token)' : srv.token}`);
  }
  const stop = () => srv.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { LumenServer, API, VERSION, newToken, deviceName, lanAddresses, options };

if (require.main === module) main();
