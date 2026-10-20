// The phone remote (remote.html): its taps are handed to one open console, which moves the slides just as if they
// were pressed there, so the remote needs no copy of what going live does.
'use strict';
const { bad, nowMs } = require('../util.js');

const CLEAR = ['all', 'slide', 'bg', 'msg', 'logo'];

/** The command as the console takes it, or a 400. */
function command(body) {
  switch (body.action) {
    case 'next': case 'prev': return { action: body.action };
    case 'go':
      if (typeof body.presId !== 'string' || !body.presId) throw bad('presId is missing');
      if (!Number.isInteger(body.idx) || body.idx < 0) throw bad('idx must be a slide number');
      return { action: 'go', presId: body.presId, idx: body.idx };
    case 'clear':
      if (!CLEAR.includes(body.what)) throw bad(`what must be one of ${CLEAR.join(', ')}`);
      return { action: 'clear', what: body.what };
    default: throw bad('action must be next, prev, go or clear');
  }
}

module.exports = {
  async 'POST remote'() {
    const cmd = command(await this.readBodyJson());
    const target = this.srv.hub.console();
    if (!target) return this.error(409, 'no console is open — open Lumen on the computer running it');
    this.srv.hub.sendTo(target, 'remote', { ...cmd, time: nowMs() });
    this.sendJson({ ok: true });
  },
};
