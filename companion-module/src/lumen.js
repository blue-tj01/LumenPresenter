// Talking to Lumen Presenter: commands go to POST /api/remote, and what is on screen comes back over the event
// stream (GET /api/events). Uses only Node's own fetch, so it is tested with Lumen's own tests.
'use strict';

const RETRY_MS = [1000, 2000, 5000, 10000];

class LumenClient {
  /** host, port, token (only needed in network mode). onLive(live, serverOffsetMs) is called with each new live
   * state, onStatus(state, message) with 'ok', 'connecting', 'auth' or 'error'. */
  constructor({ host, port, token = '', onLive = () => {}, onStatus = () => {}, fetch: fetchFn = globalThis.fetch }) {
    this.base = `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
    this.token = token.trim();
    this.onLive = onLive;
    this.onStatus = onStatus;
    this.fetch = fetchFn;
    this.stopped = false;
    this.abort = null;
    this.tries = 0;
    this.timer = null;
  }

  headers(extra = {}) {
    return this.token ? { 'X-Lumen-Token': this.token, ...extra } : extra;
  }

  /** Send a command, as /api/remote takes it. Resolves, or rejects with Lumen's reason. */
  async send(cmd) {
    const r = await this.fetch(`${this.base}/api/remote`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      const why = (await r.json().catch(() => ({}))).error || r.statusText;
      throw new Error(r.status === 401 ? 'the token is missing or wrong' : why);
    }
  }

  /** Follow the live state until stop(), reconnecting when the link drops. */
  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.abort?.abort();
  }

  async _connect() {
    if (this.stopped) return;
    this.onStatus('connecting');
    const abort = this.abort = new AbortController();
    let failed = 'error', why = '';
    try {
      const r = await this.fetch(`${this.base}/api/events?client=companion`, { headers: this.headers(), signal: abort.signal });
      if (r.status === 401) { failed = 'auth'; throw new Error('the token is missing or wrong'); }
      if (!r.ok) throw new Error(`Lumen answered ${r.status}`);
      await this._read(r.body);
      why = 'Lumen closed the connection';
    } catch (e) {
      if (this.stopped) return;
      why = e.cause?.code === 'ECONNREFUSED' ? 'Lumen is not running there' : e.message;
    }
    if (this.stopped) return;
    this.onStatus(failed, why);
    const wait = RETRY_MS[Math.min(this.tries++, RETRY_MS.length - 1)];
    this.timer = setTimeout(() => this._connect(), wait);
  }

  /** Server-Sent Events, one block at a time. */
  async _read(body) {
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of body) {
      buf += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trimStart();
        }
        this._event(event, data);
      }
    }
  }

  _event(event, data) {
    let d;
    try { d = JSON.parse(data); } catch { return; }
    const offset = typeof d?.time === 'number' ? d.time - Date.now() : 0;
    if (event === 'hello') { this.tries = 0; this.onStatus('ok'); }
    if (event === 'hello' || event === 'state') this.onLive(d.live ?? null, offset);
  }
}

module.exports = { LumenClient };
