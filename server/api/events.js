// Health and the live event stream every page keeps open.
'use strict';
const { nowMs, VERSION } = require('../util.js');

const PAGES = { 'output.html': 'Audience output', 'stage.html': 'Stage display', 'remote.html': 'Phone remote' };

module.exports = {
  'GET health'() {
    this.sendJson({ ok: true, version: VERSION, time: nowMs(), auth: !!this.srv.token, clients: this.srv.hub.count });
  },

  'GET events'() {
    const srv = this.srv, res = this.res;
    const sid = this.session();
    let page = '';
    try { page = new URL(this.header('referer')).pathname.split('/').pop(); } catch {}
    // Bitfocus Companion and other controllers follow along too, but must never be taken for a console.
    page = this.query.get('client') === 'companion' ? 'Companion' : PAGES[page] || 'Console';
    if (sid) srv.streams.set(sid, [...(srv.streams.get(sid) || []), page]);
    const local = this.fromLoopback();
    const client = { res, page, local: this.isLocal(), check: () => (local || srv.network) && this.mayRead() };
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
