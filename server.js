#!/usr/bin/env node
// @ts-check
// Lumen Presenter server.
//
// Serves the app, stores the library, media and live state on disk, and pushes live changes to every connected
// window (on any device) over Server-Sent Events. Node's standard library only; the parts are in server/. The
// desktop app (electron/main.js) runs it in-process; it also runs on its own:
//
//     node server.js                                 # http://127.0.0.1:8642, data in ./data
//     node server.js --host 0.0.0.0 --token secret   # reachable from the LAN
//
// Network mode can also be switched on and off from the console. Its access token is generated once and kept,
// with the setting, in data/settings.json.
'use strict';
const { LumenServer, VERSION } = require('./server/lumen-server.js');
const API = require('./server/api/index.js');
const { newToken, deviceName, lanAddresses } = require('./server/util.js');
const { options } = require('./server/options.js');

async function main() {
  let opts;
  try {
    opts = options();
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
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
    console.log(
      `Network mode on: ${hosts.map(h => `http://${h}:${srv.port}`).join(', ') || srv.host}` +
        `  token: ${opts.token ? '(from --token)' : srv.token}`,
    );
  }
  const stop = () => srv.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

module.exports = { LumenServer, API, VERSION, newToken, deviceName, lanAddresses, options };

if (require.main === module) main();
