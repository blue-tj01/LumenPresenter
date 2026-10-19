// Link to the Lumen server (server.js): library storage, media uploads, and live state pushed to every window
// on any device. When the pages are served without the server, windows in the same browser fall back to a
// BroadcastChannel and the library stays in localStorage.
(function () {
  const chan = new BroadcastChannel('lumen-live');
  const client = Math.random().toString(36).slice(2, 10);
  const TOKEN_KEY = 'lumen.token';
  const listeners = { state: [], library: [], hello: [], status: [], error: [] };
  const emit = (type, data) => listeners[type].forEach(fn => fn(data));

  let online = false;    // the page was served by a reachable Lumen server
  let streaming = false; // the event stream is open right now
  let offset = 0;        // server clock minus local clock, so timers agree across devices
  let authDeclined = false;
  let outdated = false;  // server.js was updated on disk but the running server wasn't restarted
  const SERVER_VERSION = 2;

  const syncClock = t => { if (t) offset = t - Date.now(); };
  const status = () => emit('status', { online, streaming });
  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = t => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} };

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const headers = {};
      const token = getToken(); if (token) headers['X-Lumen-Token'] = token;
      let data = body;
      if (body instanceof Blob) {
        headers['Content-Type'] = body.type || 'application/octet-stream';
        if (body.name) headers['X-Filename'] = encodeURIComponent(body.name);
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json'; data = JSON.stringify(body);
      }
      const r = await fetch(path, { method, headers, body: data, cache: 'no-store' });
      if (r.status === 401 && attempt === 0 && !authDeclined) {
        // On the computer running Lumen the server hands over its token, so only other devices are asked.
        const t = await localToken() || prompt('This Lumen server needs its access token before changes can be made:', '');
        if (t && t.trim()) { setToken(t.trim()); continue; }
        authDeclined = true;
      }
      if (!r.ok) {
        const e = new Error((await r.json().catch(() => ({}))).error || r.statusText);
        e.status = r.status; throw e;
      }
      return r.json();
    }
  }

  async function localToken() {
    try {
      const r = await fetch('api/network', { cache: 'no-store' });
      // Another device whose token link is out of date (a new token was made): reload to be asked for it.
      if (r.status === 401) { location.reload(); return new Promise(() => {}); }
      const n = await r.json();
      if (n.token && n.token !== getToken()) return n.token;
    } catch {}
    return '';
  }
  async function network(change) {
    const n = change ? await request('POST', 'api/network', change) : await request('GET', 'api/network');
    if (n.token) setToken(n.token);
    return n;
  }

  // ---------- live state ----------
  // Sends are serialised and coalesced, so the server always ends up with the newest state, in order.
  let pendingLive = null, sendingLive = false;
  const liveBusy = () => sendingLive || !!pendingLive;
  function publish(live) {
    chan.postMessage({ type: 'state', live }); // same-browser windows keep working if the server drops
    if (!online) return;
    pendingLive = live; flushLive();
  }
  async function flushLive() {
    if (sendingLive || !pendingLive) return;
    sendingLive = true;
    const live = pendingLive;
    let retry = false;
    try { await request('POST', 'api/live', { client, live }); if (pendingLive === live) pendingLive = null; }
    catch (e) {
      if (e.status === 401 || e.status === 400) { pendingLive = null; emit('error', `Server refused the change: ${e.message}`); }
      else retry = true;
    } finally { sendingLive = false; }
    if (retry) setTimeout(flushLive, 2000); else if (pendingLive) flushLive();
  }
  function receiveState(d) {
    syncClock(d.time);
    // Our own echo, or we have newer state still on its way to the server.
    if (!d.live || d.origin === client || liveBusy()) return;
    emit('state', d);
  }

  // ---------- library ----------
  let libRev = 0, pendingLib = null, sendingLib = false, libTimer = null;
  const libBusy = () => sendingLib || !!pendingLib;
  async function loadLibrary() {
    const r = await request('GET', 'api/library');
    libRev = r.rev; return r.library;
  }
  function saveLibrary(lib) {
    if (!online) return;
    pendingLib = lib; clearTimeout(libTimer); libTimer = setTimeout(flushLib, 400);
  }
  async function flushLib() {
    if (sendingLib || !pendingLib) return;
    sendingLib = true;
    const lib = pendingLib; pendingLib = null;
    let retry = false;
    try { libRev = (await request('PUT', 'api/library', { client, library: lib })).rev; }
    catch (e) {
      if (!pendingLib) pendingLib = lib;
      if (e.status === 401 || e.status === 400 || e.status === 413) { pendingLib = null; emit('error', `Library not saved: ${e.message}`); }
      else { retry = true; emit('error', 'Server unreachable — library will be saved when it reconnects'); }
    } finally { sendingLib = false; }
    if (retry) setTimeout(flushLib, 3000); else if (pendingLib) flushLib();
  }
  window.addEventListener('beforeunload', e => {
    if (!libBusy()) return;
    clearTimeout(libTimer); flushLib();
    e.preventDefault(); e.returnValue = '';
  });

  // ---------- connection ----------
  function connect() {
    const es = new EventSource('api/events');
    es.onopen = () => { streaming = true; status(); flushLive(); flushLib(); };
    es.onerror = () => { if (streaming) { streaming = false; status(); localToken(); } };
    es.addEventListener('hello', e => {
      const d = JSON.parse(e.data);
      receiveState(d);
      if (d.rev !== libRev && !libBusy()) emit('library', { rev: d.rev }); // changed while we were away
    });
    es.addEventListener('state', e => receiveState(JSON.parse(e.data)));
    es.addEventListener('library', e => {
      const d = JSON.parse(e.data); syncClock(d.time);
      if (d.origin !== client && d.rev !== libRev && !libBusy()) emit('library', d);
    });
    es.addEventListener('ping', e => syncClock(JSON.parse(e.data).time));
  }

  async function init() {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('api/health', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      const h = r.ok ? await r.json() : null;
      online = !!(h && h.ok);
      if (online) syncClock(h.time);
      outdated = online && !(h.version >= SERVER_VERSION);
    } catch { online = false; }
    if (online) connect();
    status();
    return online;
  }

  chan.onmessage = e => {
    const d = e.data;
    if (d?.type === 'hello') emit('hello');
    else if (d?.type === 'state' && !streaming) emit('state', { live: d.live, origin: 'local' });
  };

  window.Lumen = {
    client, init, publish, loadLibrary, saveLibrary,
    on: (type, fn) => listeners[type].push(fn),
    hello: () => chan.postMessage({ type: 'hello' }), // ask same-browser operator windows for the current state
    getLive: () => request('GET', 'api/live'),
    network: () => network(),            // {network, local, and on this computer: locked, token, port, addresses}
    setNetwork: change => network(change), // {network: true|false}, {regenerate: true} or {disconnect: id|'all'}
    signOut: async () => { // this device, when it was signed in with the token
      setToken('');
      await fetch('api/logout', { method: 'POST', cache: 'no-store' }).catch(() => {});
      location.reload();
    },
    get outdated() { return outdated; },
    uploadMedia: file => request('POST', 'api/media', file),
    deleteMedia: src => /^media\/[a-z0-9.]+$/.test(src) ? request('DELETE', 'api/' + src).catch(() => {}) : Promise.resolve(),
    now: () => Date.now() + offset,
    get online() { return online; },
    get streaming() { return streaming; },
  };
})();
