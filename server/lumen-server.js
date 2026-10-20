// The server: listening, network mode, and handing each request to Request.
'use strict';
const http = require('http');
const os = require('os');
const path = require('path');
const { VERSION, nowMs } = require('./util.js');
const { Store } = require('./store.js');
const { Folders } = require('./folders.js');
const { Hub } = require('./hub.js');
const { Request, APP_DIR } = require('./request.js');

const HEARTBEAT = 15;
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1'];

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

  /** Stop listening, close every connection, and close the library's database. */
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
    this.store.close();
  }
}

module.exports = { LumenServer, VERSION };
