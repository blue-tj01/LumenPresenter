// Network mode: whether other devices can reach Lumen, its token and the devices signed in with it.
'use strict';
const { COOKIE, newToken, nowMs, lanAddresses } = require('../util.js');

/** What the Network tab shows. Only the computer running Lumen is shown the token and may change the setting. */
async function networkInfo(r) {
  const srv = r.srv;
  const info = { network: srv.network, local: r.isLocal(), signedIn: !!r.session() };
  if (info.local) {
    const sessions = r.store.settings.sessions;
    const devices = Object.entries(sessions).map(([id, s]) => ({ id, ...s, seen: srv.seen.get(id) ?? null,
      open: [...new Set(srv.streams.get(id) || [])].sort() }));
    Object.assign(info, { locked: srv.hostLocked, token: srv.explicitToken || r.store.settings.token, port: srv.port,
      addresses: srv.network ? await lanAddresses() : [],
      devices: devices.sort((a, b) => (b.seen || b.created || 0) - (a.seen || a.created || 0)) });
  }
  return info;
}

module.exports = {
  async 'GET network'() {
    this.sendJson(await networkInfo(this));
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
    this.sendJson(await networkInfo(this));
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
};
