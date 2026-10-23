// @ts-check
// The Control tab: OSC, and what Bitfocus Companion needs to connect.
'use strict';
const { bad, lanAddresses } = require('../util.js');

/** What the Control tab shows. Other devices see whether OSC is on, not how to reach it. */
async function controlInfo(r) {
  const srv = r.srv,
    local = r.isLocal();
  const info = { local, network: srv.network, osc: { on: srv.oscSettings.on } };
  if (local) {
    Object.assign(info.osc, srv.osc.status(), { on: srv.oscSettings.on, lan: srv.oscSettings.lan });
    Object.assign(info, {
      port: srv.port,
      addresses: srv.network ? await lanAddresses() : [],
      token: srv.token ? srv.explicitToken || r.store.settings.token : '',
    });
  }
  return info;
}

module.exports = {
  async 'GET control'() {
    this.sendJson(await controlInfo(this));
  },

  /** {osc: {on, port, lan}}, any of them. */
  async 'POST control'() {
    if (!this.isLocal()) return this.error(403, 'control settings can only be changed on the computer running Lumen');
    const body = await this.readBodyJson();
    if ('osc' in body) {
      const o = body.osc,
        now = this.srv.oscSettings;
      if (o === null || typeof o !== 'object') throw bad('osc must be an object');
      if ('port' in o && !(Number.isInteger(o.port) && o.port >= 1024 && o.port <= 65535))
        throw bad('port must be from 1024 to 65535');
      if (o.port === this.srv.port) throw bad(`port ${o.port} is Lumen's own`);
      const osc = { on: 'on' in o ? !!o.on : now.on, port: o.port ?? now.port, lan: 'lan' in o ? !!o.lan : now.lan };
      this.store.saveSettings({ osc });
      await this.srv.applyOsc();
    }
    this.sendJson(await controlInfo(this));
  },
};
