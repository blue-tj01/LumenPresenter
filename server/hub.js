// Live updates: Server-Sent Events to every open window.
'use strict';

const STALLED = 4 * 1024 * 1024; // bytes queued for an event stream before it counts as stalled

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

  /** The console that takes the phone remote's taps: one on this computer if any (the desktop app's), otherwise
   * the one opened last. Only one moves the slides, so a tap never moves two places. */
  console() {
    const open = [...this.clients].filter(c => c.page === 'Console' && c.check());
    return open.findLast(c => c.local) || open.at(-1) || null;
  }
  sendTo(client, event, data) {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

module.exports = { Hub };
