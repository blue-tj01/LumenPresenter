// @ts-check
// Link to the Lumen server (server.js): library storage, media uploads, and live state pushed to every window
// on any device. When the pages are served without the server, windows in the same browser fall back to a
// BroadcastChannel and the library stays in localStorage.
(function () {
  const chan = new BroadcastChannel('lumen-live');
  const client = Math.random().toString(36).slice(2, 10);
  const TOKEN_KEY = 'lumen.token';
  const listeners = {
    state: [],
    library: [],
    changes: [],
    conflict: [],
    hello: [],
    status: [],
    error: [],
    folders: [],
    bibles: [],
    remote: [],
  };
  const emit = (type, data) => listeners[type].forEach(fn => fn(data));

  let online = false; // the page was served by a reachable Lumen server
  let streaming = false; // the event stream is open right now
  let offset = 0; // server clock minus local clock, so timers agree across devices
  let authDeclined = false;
  let outdated = false; // server.js was updated on disk but the running server wasn't restarted
  const SERVER_VERSION = 6;

  const syncClock = t => {
    if (t) offset = t - Date.now();
  };
  const status = () => emit('status', { online, streaming });
  const getToken = () => {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  };
  const setToken = t => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {}
  };

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const headers = {};
      const token = getToken();
      if (token) headers['X-Lumen-Token'] = token;
      let data = body;
      if (body instanceof Blob) {
        headers['Content-Type'] = body.type || 'application/octet-stream';
        const name = /** @type {Blob & {name?: string}} */ (body).name;
        if (name) headers['X-Filename'] = encodeURIComponent(name);
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        data = JSON.stringify(body);
      }
      const r = await fetch(path, { method, headers, body: data, cache: 'no-store' });
      if (r.status === 401 && attempt === 0 && !authDeclined) {
        // On the computer running Lumen the server hands over its token, so only other devices are asked.
        const t =
          (await localToken()) || prompt('This Lumen server needs its access token before changes can be made:', '');
        if (t && t.trim()) {
          setToken(t.trim());
          continue;
        }
        authDeclined = true;
      }
      if (!r.ok) {
        const e = /** @type {Error & {status?: number}} */ (
          new Error((await r.json().catch(() => ({}))).error || r.statusText)
        );
        e.status = r.status;
        throw e;
      }
      return r.json();
    }
  }

  async function localToken() {
    try {
      const r = await fetch('api/network', { cache: 'no-store' });
      // Another device whose token link is out of date (a new token was made): reload to be asked for it.
      if (r.status === 401) {
        location.reload();
        return new Promise(() => {});
      }
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
  let pendingLive = null,
    sendingLive = false;
  const liveBusy = () => sendingLive || !!pendingLive;
  function publish(live) {
    chan.postMessage({ type: 'state', live }); // same-browser windows keep working if the server drops
    if (!online) return;
    pendingLive = live;
    flushLive();
  }
  async function flushLive() {
    if (sendingLive || !pendingLive) return;
    sendingLive = true;
    const live = pendingLive;
    let retry = false;
    try {
      await request('POST', 'api/live', { client, live });
      if (pendingLive === live) pendingLive = null;
    } catch (e) {
      if (e.status === 401 || e.status === 400) {
        pendingLive = null;
        emit('error', `Server refused the change: ${e.message}`);
      } else retry = true;
    } finally {
      sendingLive = false;
    }
    if (retry) setTimeout(flushLive, 2000);
    else if (pendingLive) flushLive();
  }
  function receiveState(d) {
    syncClock(d.time);
    // Our own echo, or we have newer state still on its way to the server.
    if (!d.live || d.origin === client || liveBusy()) return;
    emit('state', d);
  }

  // ---------- library ----------
  // Saves send only what changed since the library was last loaded or saved (PATCH), so a change costs the same
  // in a library of any size; the server keeps changes made elsewhere at the same time and names any presentation
  // or service both changed. A library the server doesn't have yet, or one with items lacking ids, goes whole (PUT).
  const LISTS = ['presentations', 'services']; // the lists the server keeps an item at a time (server/library.js)
  let libRev = 0,
    pendingLib = null,
    sendingLib = false,
    libTimer = null;
  let synced = null; // the library as the server has it at libRev: {lists: {name: {items: Map id → JSON, order}}, fields: Map}
  let stale = false; // the server changed elsewhere while a save was waiting; load it again once saved
  let emptyAtLoad = false; // the server had no library yet: the first save goes only if no other console's did
  const libBusy = () => sendingLib || !!pendingLib;

  /** A library as its saved parts, or null if a list has an item without an id of its own. */
  function snapshot(lib) {
    if (!lib) return null;
    const lists = {},
      fields = new Map();
    for (const [k, v] of Object.entries(lib)) {
      if (!LISTS.includes(k) || !Array.isArray(v)) {
        fields.set(k, JSON.stringify(v ?? null));
        continue;
      }
      const items = new Map();
      for (const x of v) {
        if (!x || typeof x.id !== 'string' || !x.id || x.id.startsWith('#') || items.has(x.id)) return null;
        items.set(x.id, JSON.stringify(x));
      }
      lists[k] = { items, order: v.map(x => x.id) };
    }
    return { lists, fields };
  }
  /** Whether `next` is `prev` with some keys taken out and new ones added at the end, which needs no order sent. */
  function appendOnly(prev, next) {
    const had = new Set(prev),
      has = new Set(next);
    const kept = prev.filter(k => has.has(k)),
      added = next.filter(k => !had.has(k));
    return next.length === kept.length + added.length && [...kept, ...added].every((k, i) => k === next[i]);
  }
  /** How a list field's items are told apart: by id when every one has its own ('id'), by value when they are
   * plain and all different ('value'), or not at all (null: the field is sent whole). */
  function listMode(v) {
    if (!Array.isArray(v)) return null;
    const ids = v.map(x => (x && typeof x === 'object' && typeof x.id === 'string' ? x.id : null));
    if (v.length && !ids.includes(null) && new Set(ids).size === ids.length) return 'id';
    const values = v.map(x => JSON.stringify(x));
    return new Set(values).size === values.length ? 'value' : null;
  }
  /** A list field's change as items put and removed, and its order when that can't be worked out, or null when
   * it has to be sent whole. Two consoles adding a theme or a picture at once then both keep theirs. */
  function fieldChange(before, after) {
    const mode = listMode(after);
    if (!mode || !Array.isArray(before) || (before.length && listMode(before) !== mode)) return null;
    const keyOf = mode === 'id' ? x => x.id : x => JSON.stringify(x);
    const was = new Map(before.map(x => [keyOf(x), JSON.stringify(x)]));
    const keys = after.map(keyOf),
      has = new Set(keys);
    const put = after.filter(x => was.get(keyOf(x)) !== JSON.stringify(x));
    const remove = [...was.keys()].filter(k => !has.has(k));
    return { mode, put, remove, ...(appendOnly([...was.keys()], keys) ? {} : { order: keys }) };
  }
  /** What changed from `from` to `to` as the server's PATCH takes it, or {} if nothing did. A list that appeared
   * or went is every item added or removed. */
  function diff(to, from) {
    const changes = {};
    const none = { items: new Map(), order: [] };
    const names = new Set([...Object.keys(to.lists), ...Object.keys(from.lists)]);
    for (const name of names) {
      const a = from.lists[name] || none,
        b = to.lists[name] || none;
      const put = [...b.items].filter(([id, json]) => a.items.get(id) !== json).map(([, json]) => JSON.parse(json));
      const remove = a.order.filter(id => !b.items.has(id));
      const moved = a.order.length !== b.order.length || b.order.some((id, i) => id !== a.order[i]);
      if (put.length || remove.length || moved)
        changes[name] = { put, remove, ...(appendOnly(a.order, b.order) ? {} : { order: b.order }) };
    }
    const set = {},
      merge = {};
    for (const [k, json] of to.fields) {
      if (from.fields.get(k) === json) continue;
      const v = JSON.parse(json);
      const m = from.fields.has(k) ? fieldChange(JSON.parse(from.fields.get(k)), v) : null;
      if (m) merge[k] = m;
      else set[k] = v;
    }
    const unset = [...from.fields.keys()].filter(k => !to.fields.has(k));
    if (Object.keys(set).length) changes.set = set;
    if (Object.keys(merge).length) changes.merge = merge;
    if (unset.length) changes.unset = unset;
    return changes;
  }
  /** Apply changes the server sent (as PATCH answers them) to a library, in place. */
  function applyChanges(lib, changes) {
    for (const name of LISTS) {
      const c = changes[name];
      if (!c) continue;
      const byId = new Map((lib[name] || []).map(x => [x.id, x]));
      c.put.forEach(x => byId.set(x.id, x));
      c.remove.forEach(id => byId.delete(id));
      const had = (lib[name] || []).map(x => x.id);
      const order = c.order || [
        ...had.filter(id => byId.has(id)),
        ...c.put.map(x => x.id).filter(id => !had.includes(id)),
      ];
      lib[name] = order.map(id => byId.get(id)).filter(Boolean);
    }
    Object.assign(lib, changes.set || {});
    (changes.unset || []).forEach(k => delete lib[k]);
    return lib;
  }

  async function loadLibrary() {
    const r = await request('GET', 'api/library');
    libRev = r.rev;
    synced = snapshot(r.library);
    stale = false;
    emptyAtLoad = r.library === null;
    return r.library;
  }
  function saveLibrary(lib) {
    if (!online) return;
    pendingLib = lib;
    clearTimeout(libTimer);
    libTimer = setTimeout(flushLib, 400);
  }
  async function flushLib() {
    if (sendingLib || !pendingLib) return;
    sendingLib = true;
    const lib = pendingLib;
    pendingLib = null;
    const next = snapshot(lib);
    const changes = synced && next && !outdated ? diff(next, synced) : null;
    let retry = false;
    try {
      if (changes && !Object.keys(changes).length) {
        /* nothing changed */
      } else if (changes) {
        const base = libRev;
        const r = await request('PATCH', 'api/library', { client, base, format: lib.format, changes });
        libRev = r.rev;
        synced = next;
        if (r.prev !== base) stale = true; // changed elsewhere too
        if (r.conflicts.length) {
          stale = true;
          emit('conflict', r.conflicts);
        }
        // Fields the server couldn't merge an item at a time: send them whole.
        if (r.resend?.length) {
          r.resend.forEach(k => synced.fields.delete(k));
          if (!pendingLib) pendingLib = lib;
        }
      } else {
        const ifEmpty = emptyAtLoad; // the server had no library when this page loaded
        libRev = (await request('PUT', 'api/library', { client, library: lib, ...(ifEmpty ? { ifEmpty } : {}) })).rev;
        synced = next;
        emptyAtLoad = false;
      }
    } catch (e) {
      if (!pendingLib) pendingLib = lib;
      if (e.status === 409) {
        pendingLib = null;
        stale = true;
      } // another console saved the first library: load it
      else if (e.status === 401 || e.status === 400 || e.status === 413) {
        pendingLib = null;
        emit('error', `Library not saved: ${e.message}`);
      } else {
        retry = true;
        emit('error', 'Server unreachable — library will be saved when it reconnects');
      }
    } finally {
      sendingLib = false;
    }
    if (retry) setTimeout(flushLib, 3000);
    else if (pendingLib) flushLib();
    else if (stale) {
      stale = false;
      emit('library', { rev: libRev });
    }
  }
  /** Replace the whole library on purpose (an import, or starting over): sent at once, with a backup kept first. */
  async function replaceLibrary(lib) {
    clearTimeout(libTimer);
    pendingLib = null;
    while (sendingLib) await new Promise(r => setTimeout(r, 50));
    libRev = (await request('PUT', 'api/library', { client, library: lib, replace: true })).rev;
    synced = snapshot(lib);
    stale = false;
  }
  /** Put a backup back; every console, this one too, then loads it. Changes waiting to be saved go first. */
  async function restoreBackup(name) {
    if (pendingLib && !sendingLib) {
      clearTimeout(libTimer);
      await flushLib();
    }
    return request('POST', 'api/backups', { restore: name });
  }

  /** Song search on the server; a change still waiting to be saved is sent first, so results include it. */
  async function search(q) {
    if (pendingLib && !sendingLib) {
      clearTimeout(libTimer);
      await flushLib();
    }
    return (await request('GET', 'api/search?q=' + encodeURIComponent(q))).results;
  }
  window.addEventListener('beforeunload', e => {
    if (!libBusy()) return;
    clearTimeout(libTimer);
    flushLib();
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------- connection ----------
  function connect() {
    const es = new EventSource('api/events');
    es.onopen = () => {
      streaming = true;
      status();
      flushLive();
      flushLib();
      emit('folders');
    };
    es.onerror = () => {
      if (streaming) {
        streaming = false;
        status();
        localToken();
      }
    };
    es.addEventListener('hello', e => {
      const d = JSON.parse(e.data);
      receiveState(d);
      if (d.rev !== libRev && !libBusy()) emit('library', { rev: d.rev }); // changed while we were away
    });
    es.addEventListener('state', e => receiveState(JSON.parse(e.data)));
    es.addEventListener('library', e => {
      const d = JSON.parse(e.data);
      syncClock(d.time);
      if (d.origin === client || d.rev === libRev) return;
      if (libBusy()) {
        stale = true;
        return;
      } // loaded again once our own change is saved
      if (d.changes && d.prev === libRev && synced) {
        // Just this change: apply it to what we have, without loading the whole library again.
        const ch = d.changes;
        for (const name of LISTS) {
          const c = ch[name],
            l = synced.lists[name];
          if (!c) continue;
          if (!l) {
            emit('library', d);
            return;
          }
          const had = new Set(l.order);
          c.put.forEach(x => l.items.set(x.id, JSON.stringify(x)));
          c.remove.forEach(id => l.items.delete(id));
          l.order = c.order || [
            ...l.order.filter(id => l.items.has(id)),
            ...c.put.map(x => x.id).filter(id => !had.has(id)),
          ];
        }
        Object.entries(ch.set || {}).forEach(([k, v]) => synced.fields.set(k, JSON.stringify(v)));
        (ch.unset || []).forEach(k => synced.fields.delete(k));
        libRev = d.rev;
        emit('changes', ch);
      } else emit('library', d);
    });
    es.addEventListener('ping', e => syncClock(JSON.parse(e.data).time));
    es.addEventListener('folders', () => emit('folders'));
    es.addEventListener('bibles', () => emit('bibles'));
    es.addEventListener('remote', e => emit('remote', JSON.parse(e.data)));
  }

  async function init() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('api/health', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      const h = r.ok ? await r.json() : null;
      online = !!(h && h.ok);
      if (online) syncClock(h.time);
      outdated = online && !(h.version >= SERVER_VERSION);
    } catch {
      online = false;
    }
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
    client,
    init,
    publish,
    loadLibrary,
    saveLibrary,
    search, // search(q): [{id, name, snippet}], best first
    applyChanges, // applyChanges(lib, changes): a change made elsewhere ('changes' event), applied to a library
    replaceLibrary,
    restoreBackup, // restoreBackup(name), a name from backups()
    backups: async () => (await request('GET', 'api/backups')).backups, // [{name, time, size}], newest first
    on: (type, fn) => listeners[type].push(fn),
    hello: () => chan.postMessage({ type: 'hello' }), // ask same-browser operator windows for the current state
    getLive: () => request('GET', 'api/live'),
    // The phone remote: {action: 'next'|'prev'} or {action: 'go', presId, idx} or {action: 'clear', what}
    remote: cmd => request('POST', 'api/remote', cmd),
    control: () => request('GET', 'api/control'), // {local, network, osc, and on this computer: port, addresses, token}
    setControl: change => request('POST', 'api/control', change), // {osc: {on, port, lan}}
    network: () => network(), // {network, local, and on this computer: locked, token, port, addresses}
    setNetwork: change => network(change), // {network: true|false}, {regenerate: true} or {disconnect: id|'all'}
    signOut: async () => {
      // this device, when it was signed in with the token
      setToken('');
      await fetch('api/logout', { method: 'POST', cache: 'no-store' }).catch(() => {});
      location.reload();
    },
    get outdated() {
      return outdated;
    },
    uploadMedia: file => request('POST', 'api/media', file),
    folders: () => request('GET', 'api/folders'), // {folders: [{id, name, files: [{path, name, type}]}], local}
    setFolders: change => request('POST', 'api/folders', change), // {add: '<path>'} or {remove: id}
    bibles: () => request('GET', 'api/bibles'), // {bibles: [{id, name, abbrev, language, rights, bundled}]}
    importSlides: file => request('POST', 'api/slides', file), // {name, slides: ['media/<file>.png', ...], via}
    importBible: file =>
      request(
        'POST',
        'api/bibles',
        new File([file], file.name, { type: /gzip/.test(file.type) ? 'application/gzip' : 'application/xml' }),
      ),
    deleteBible: id => request('DELETE', 'api/bibles/' + encodeURIComponent(id)),
    // {type: 'passage', reference, verses} for a reference, or {type: 'search', verses} for words
    scripture: (bible, q) =>
      request('GET', `api/scripture?bible=${encodeURIComponent(bible)}&q=${encodeURIComponent(q)}`),
    deleteMedia: src =>
      /^media\/[a-z0-9.]+$/.test(src) ? request('DELETE', 'api/' + src).catch(() => {}) : Promise.resolve(),
    now: () => Date.now() + offset,
    get online() {
      return online;
    },
    get streaming() {
      return streaming;
    },
  };
})();
