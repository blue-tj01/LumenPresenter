// Tests for outside control: the commands (server/control.js), OSC (server/osc.js), the Control tab's settings,
// the Bitfocus Companion module's connection and variables (companion-module/src), and MIDI (console/midi.js).
// Run with: npm test
'use strict';
const assert = require('assert/strict');
const dgram = require('dgram');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { describe, it, before, beforeEach, afterEach } = require('node:test');
const { LumenServer } = require('../server/lumen-server.js');
const { command } = require('../server/control.js');
const { decode, oscCommand } = require('../server/osc.js');
const { LumenClient } = require('../companion-module/src/lumen.js');
const { variables, flags } = require('../companion-module/src/state.js');

const delay = ms => new Promise(r => setTimeout(r, ms));

// ---------- OSC packets, as a sender makes them ----------
const pad = b => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]); // OSC strings always end in at least one 0
const str = s => pad(Buffer.from(s));
function message(address, ...args) {
  const tags = ',' + args.map(a => typeof a === 'string' ? 's' : a === true ? 'T' : a === false ? 'F'
    : Number.isInteger(a) ? 'i' : 'f').join('');
  const data = args.map(a => {
    if (typeof a === 'string') return str(a);
    if (typeof a === 'boolean') return Buffer.alloc(0);
    const b = Buffer.alloc(4);
    if (Number.isInteger(a)) b.writeInt32BE(a); else b.writeFloatBE(a);
    return b;
  });
  return Buffer.concat([str(address), str(tags), ...data]);
}
function bundle(...parts) {
  const head = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8)]);
  return Buffer.concat([head, ...parts.flatMap(p => { const n = Buffer.alloc(4); n.writeInt32BE(p.length); return [n, p]; })]);
}

describe('commands', () => {
  it('takes the commands the console carries out, and nothing else', () => {
    assert.deepEqual(command({ action: 'next', extra: 1 }), { action: 'next' });
    assert.deepEqual(command({ action: 'nextItem' }), { action: 'nextItem' });
    assert.deepEqual(command({ action: 'item', item: 0 }), { action: 'item', item: 0 });
    assert.deepEqual(command({ action: 'slide', idx: 4 }), { action: 'slide', idx: 4 });
    assert.deepEqual(command({ action: 'video', what: 'restart' }), { action: 'video', what: 'restart' });
    assert.deepEqual(command({ action: 'timer', what: 'pause' }), { action: 'timer', what: 'pause' });
    assert.deepEqual(command({ action: 'auto' }), { action: 'auto' });
    for (const bad of [{}, { action: 'jump' }, { action: 'item' }, { action: 'item', item: -1 }, { action: 'slide', idx: 1.5 },
      { action: 'video', what: 'stop' }, { action: 'timer', what: 'set' }, { action: 'clear', what: 'screen' }]) {
      assert.throws(() => command(bad), { status: 400 }, JSON.stringify(bad));
    }
  });
});

describe('OSC', () => {
  it('reads messages and bundles', () => {
    assert.deepEqual(decode(message('/lumen/next')), [{ address: '/lumen/next', args: [] }]);
    assert.deepEqual(decode(message('/lumen/slide', 3, 'x', true)), [{ address: '/lumen/slide', args: [3, 'x', true] }]);
    assert.equal(decode(message('/a', 0.5))[0].args[0], 0.5);
    const b = bundle(message('/lumen/clear/all'), bundle(message('/lumen/logo', 1)));
    assert.deepEqual(decode(b).map(m => m.address), ['/lumen/clear/all', '/lumen/logo']);
    assert.deepEqual(decode(str('/old')), [{ address: '/old', args: [] }]); // no type tags at all
    for (const junk of [Buffer.from('hello'), Buffer.from('/x\0\0,i\0\0'), bundle(Buffer.from('/x'))]) {
      assert.throws(() => decode(junk));
    }
  });

  it('turns addresses into commands, counting from 1', () => {
    const cases = [
      [['/lumen/next'], { action: 'next' }],
      [['/Lumen/Previous'], { action: 'prev' }],
      [['/lumen/prev', 1], { action: 'prev' }],
      [['/lumen/item/next'], { action: 'nextItem' }],
      [['/lumen/item/prev'], { action: 'prevItem' }],
      [['/lumen/item', 3], { action: 'item', item: 2 }],
      [['/lumen/item/3'], { action: 'item', item: 2 }],
      [['/lumen/slide', 1.0], { action: 'slide', idx: 0 }],
      [['/lumen/slide/12', 1], { action: 'slide', idx: 11 }],
      [['/lumen/clear/all'], { action: 'clear', what: 'all' }],
      [['/lumen/clear/background'], { action: 'clear', what: 'bg' }],
      [['/lumen/logo'], { action: 'clear', what: 'logo' }],
      [['/lumen/video/play'], { action: 'video', what: 'toggle' }],
      [['/lumen/video/restart'], { action: 'video', what: 'restart' }],
      [['/lumen/auto'], { action: 'auto' }],
      [['/lumen/timer/reset'], { action: 'timer', what: 'reset' }],
    ];
    for (const [[address, ...args], want] of cases) assert.deepEqual(oscCommand(address, args), want, address);
    // A button let go (0 or false), nothing to do, or numbers that aren't a place.
    for (const [address, ...args] of [['/lumen/next', 0], ['/lumen/next', 0.0], ['/lumen/clear/all', false],
      ['/lumen/item/3', 0], ['/lumen/item'], ['/lumen/item', 0], ['/lumen/item', 'three'], ['/lumen/slide/0'],
      ['/lumen/slide', 2.5], ['/lumen'], ['/next'], ['/lumen/jump'], ['/lumen/clear/screen'], ['/lumen/next/now'],
      ['/lumen/clear/all/now'], ['/lumen/timer/set']]) {
      assert.equal(oscCommand(address, args), null, `${address} ${args}`);
    }
  });
});

/** A server on free ports with its own data folder. */
function harness() {
  const t = {
    srv: null, data: null,
    async start(opts = {}) {
      t.srv = new LumenServer({ host: '127.0.0.1', port: 0, data: t.data, ...opts });
      await t.srv.listen();
      t.port = t.srv.port;
    },
    req(method, p, body, headers = {}) {
      const h = { ...headers };
      if (body !== undefined) { body = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
      return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: t.port, method, path: p, headers: h, agent: false }, res => {
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => {
            let json; try { json = JSON.parse(Buffer.concat(chunks)); } catch {}
            resolve({ status: res.statusCode, json });
          });
        });
        r.on('error', reject);
        r.end(body);
      });
    },
    /** A console's event stream; next(name) resolves to the data of the next event of that name. */
    console() {
      return new Promise((resolve, reject) => {
        const r = http.get({ host: '127.0.0.1', port: t.port, path: '/api/events', agent: false,
          headers: { Referer: `http://127.0.0.1:${t.port}/` } }, res => {
          let buf = '';
          const queue = [], waiting = [];
          const flush = () => {
            for (let i = 0; i < waiting.length; i++) {
              const j = queue.findIndex(([ev]) => ev === waiting[i][0]);
              if (j >= 0) { waiting[i][1](queue.splice(j, 1)[0][1]); waiting.splice(i--, 1); }
            }
          };
          res.setEncoding('utf8');
          res.on('data', d => {
            buf += d;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = /^event: (.*)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
              if (ev) queue.push([ev[1], data ? JSON.parse(data[1]) : null]);
            }
            flush();
          });
          resolve({ close: () => r.destroy(), next: ev => new Promise(ok => { waiting.push([ev, ok]); flush(); }),
            seen: ev => queue.some(([e]) => e === ev) });
        });
        r.on('error', reject);
      });
    },
  };
  beforeEach(async () => { t.data = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-')); await t.start(); });
  afterEach(async () => { await t.srv.close(); fs.rmSync(t.data, { recursive: true, force: true }); });
  return t;
}

const sendUdp = (port, buf) => new Promise((resolve, reject) => {
  const s = dgram.createSocket('udp4');
  s.send(buf, port, '127.0.0.1', e => { s.close(); e ? reject(e) : resolve(); });
});

describe('OSC listening', () => {
  const t = harness();

  it('is off until switched on, then hands each command to the console', async () => {
    assert.equal(t.srv.osc.listening, false);
    const c = (await t.req('GET', '/api/control')).json;
    assert.deepEqual([c.local, c.osc.on, c.osc.port, c.osc.lan, c.port], [true, false, 8643, false, t.port]);

    t.srv.store.saveSettings({ osc: { on: true, port: 0 } }); // any free port, for the test
    await t.srv.applyOsc();
    const { port, host, listening } = t.srv.osc.status();
    assert.deepEqual([host, listening], ['127.0.0.1', true]);

    await sendUdp(port, message('/lumen/next', 1)); // no console open: nothing happens, and nothing breaks
    const con = await t.console();
    await con.next('hello');
    await sendUdp(port, message('/lumen/next', 0)); // let go: ignored
    await sendUdp(port, bundle(message('/lumen/slide/3'), message('/lumen/nonsense')));
    assert.deepEqual({ ...await con.next('remote'), time: 0 }, { action: 'slide', idx: 2, time: 0 });
    await sendUdp(port, Buffer.from('not osc'));
    await sendUdp(port, message('/lumen/clear/msg'));
    assert.deepEqual((await con.next('remote')).what, 'msg');
    con.close();
  });

  it('is switched on, moved and kept from the Control tab', async () => {
    const free = await new Promise(resolve => {
      const s = dgram.createSocket('udp4');
      s.bind(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    });
    for (const bad of [{ osc: 1 }, { osc: { port: 80 } }, { osc: { port: 70000 } }, { osc: { port: '9000' } }, { osc: { port: t.port } }]) {
      assert.equal((await t.req('POST', '/api/control', bad)).status, 400, JSON.stringify(bad));
    }
    let c = (await t.req('POST', '/api/control', { osc: { on: true, port: free } })).json;
    assert.deepEqual([c.osc.on, c.osc.port, c.osc.listening, c.osc.host], [true, free, true, '127.0.0.1']);
    c = (await t.req('POST', '/api/control', { osc: { lan: true } })).json; // not without network mode
    assert.deepEqual([c.osc.lan, c.osc.host], [true, '127.0.0.1']);

    // A port another program has: reported, not fatal.
    const taken = dgram.createSocket('udp4');
    await new Promise(r => taken.bind(0, '127.0.0.1', r));
    c = (await t.req('POST', '/api/control', { osc: { port: taken.address().port } })).json;
    assert.deepEqual([c.osc.listening, /in use/.test(c.osc.error)], [false, true]);
    taken.close();

    await t.req('POST', '/api/control', { osc: { port: free } });
    await t.srv.close();
    await t.start(); // the same data folder
    assert.deepEqual([t.srv.osc.listening, t.srv.osc.status().port], [true, free]);

    // Network mode moves OSC onto the network, as it was asked to be.
    await t.srv.setNetwork(true);
    assert.equal(t.srv.osc.status().host, '0.0.0.0');
    await t.srv.setNetwork(false);
    assert.equal(t.srv.osc.status().host, '127.0.0.1');
    c = (await t.req('POST', '/api/control', { osc: { on: false } })).json;
    assert.deepEqual([c.osc.on, c.osc.listening, t.srv.osc.listening], [false, false, false]);
  });

  it('only lets the computer running Lumen change it', async () => {
    await t.srv.setNetwork(true);
    const token = t.srv.token, other = { 'X-Forwarded-For': '192.168.1.20', 'X-Lumen-Token': token };
    assert.equal((await t.req('POST', '/api/control', { osc: { on: true } }, other)).status, 403);
    const seen = (await t.req('GET', '/api/control', undefined, other)).json;
    assert.deepEqual(seen, { local: false, network: true, osc: { on: false } });
    assert.equal((await t.req('GET', '/api/control', undefined, { 'X-Forwarded-For': '192.168.1.20' })).status, 401);
    assert.equal((await t.req('GET', '/api/control')).json.token, token);
  });
});

describe('Companion module', () => {
  const t = harness();
  const client = (opts = {}) => {
    const c = { lives: [], states: [] };
    c.lumen = new LumenClient({ host: '127.0.0.1', port: t.port, ...opts,
      onLive: live => c.lives.push(live), onStatus: (s, why) => c.states.push([s, why]) });
    c.until = async test => { for (let i = 0; i < 200 && !test(); i++) await delay(10); assert.ok(test()); };
    return c;
  };

  it('follows the live state, and sends commands to the console', async () => {
    const c = client();
    c.lumen.start();
    await c.until(() => c.states.some(([s]) => s === 'ok'));
    assert.deepEqual(c.lives, [null]);
    // Its event stream is not a console, so it can't be handed its own commands.
    await assert.rejects(c.lumen.send({ action: 'next' }), /no console/);

    const con = await t.console();
    await con.next('hello');
    await c.lumen.send({ action: 'item', item: 1 });
    assert.deepEqual((await con.next('remote')).item, 1);
    await assert.rejects(c.lumen.send({ action: 'jump' }), /action must be/);

    const live = { slide: { label: 'Amazing Grace — Verse 2', stageText: 'Was blind' }, idx: 3, next: 'But now' };
    await t.req('POST', '/api/live', { client: 'x', live });
    await c.until(() => c.lives.length === 2);
    assert.deepEqual(c.lives[1], live);
    c.lumen.stop();
    con.close();
  });

  it('says when Lumen is not there or the token is wrong, and keeps trying', async () => {
    await t.srv.setNetwork(true);
    // From this computer the stream needs no token, so ask as another device would, through a proxy.
    const proxied = (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, 'X-Forwarded-For': '192.168.1.20' } });
    const c = client({ token: 'wrong', fetch: proxied });
    c.lumen.start();
    await c.until(() => c.states.some(([s]) => s === 'auth'));
    c.lumen.stop();

    const ok = client({ token: ` ${t.srv.token} `, fetch: proxied });
    ok.lumen.start();
    await ok.until(() => ok.states.some(([s]) => s === 'ok'));
    ok.lumen.stop();

    const port = t.port;
    await t.srv.close();
    await t.start({ port: 0 });
    const gone = client();
    gone.lumen.base = `http://127.0.0.1:${port}`;
    gone.lumen.start();
    await gone.until(() => gone.states.some(([s, why]) => s === 'error' && /not running/.test(why)));
    gone.lumen.stop();
  });

  it('shows what is on screen as variables and feedbacks', () => {
    const now = Date.UTC(2026, 9, 25, 10, 30);
    assert.deepEqual(variables(null, now), { presentation: '', group: '', slide_number: '', slide_text: '', next_text: '',
      message: '', timer: '00:00', clock: variables(null, now).clock });
    const live = { slide: { label: 'Be Thou — My Vision — Chorus', stageText: 'High King', video: true, play: { paused: false } },
      idx: 0, next: 'Riches', msg: 'Welcome', logo: false, bg: { type: 'image' }, timer: { endAt: now + 65_400, remaining: 300 } };
    const v = variables(live, now);
    assert.deepEqual([v.presentation, v.group, v.slide_number, v.slide_text, v.next_text, v.message, v.timer],
      ['Be Thou — My Vision', 'Chorus', '1', 'High King', 'Riches', 'Welcome', '01:05']);
    assert.equal(variables({ slide: { label: 'Quick slide' }, idx: -1 }, now).slide_number, '');
    assert.equal(variables({ timer: { endAt: null, remaining: 90 } }, now).timer, '01:30');
    assert.equal(variables({ timer: { endAt: now - 5000 } }, now).timer, '-00:05');
    assert.deepEqual(flags(live, now), { slide: true, background: true, message: true, logo: false, cleared: false,
      videoPlaying: true, timerRunning: true, timerOver: false });
    assert.equal(flags({}, now).cleared, true);
    assert.equal(flags({ timer: { endAt: now - 1 } }, now).timerOver, true);
  });

  it('has a manifest Companion accepts', () => {
    const m = JSON.parse(fs.readFileSync(path.join(__dirname, '../companion-module/companion/manifest.json'), 'utf8'));
    const pkg = require('../companion-module/package.json');
    assert.equal(m.id, 'lumen-presenter');
    assert.equal(m.runtime.entrypoint, '../src/main.js');
    assert.ok(fs.existsSync(path.join(__dirname, '../companion-module/src/main.js')));
    assert.equal(pkg.main, 'src/main.js');
    for (const k of ['id', 'name', 'shortname', 'description', 'version', 'license', 'repository', 'bugs', 'maintainers',
      'legacyIds', 'runtime', 'manufacturer', 'products', 'keywords']) assert.ok(k in m, k);
  });
});

describe('MIDI', () => {
  let m;
  before(async () => { m = await import('../console/midi.js'); });

  it('knows a key, pad, pedal or button from what it sends', () => {
    assert.equal(m.midiTrigger([0x90, 60, 100]), 'note:1:60');
    assert.equal(m.midiTrigger([0x9f, 36, 1]), 'note:16:36');
    assert.equal(m.midiTrigger([0x90, 60, 0]), null); // note on at no velocity is a key let go
    assert.equal(m.midiTrigger([0x80, 60, 64]), null);
    assert.equal(m.midiTrigger([0xc2, 4]), 'pc:3:4');
    assert.equal(m.midiTrigger([0xf8]), null); // clock
    const held = new Map();
    assert.equal(m.midiTrigger([0xb0, 20, 127], held), 'cc:1:20');
    assert.equal(m.midiTrigger([0xb0, 20, 100], held), null); // a fader still up
    assert.equal(m.midiTrigger([0xb0, 20, 0], held), null);
    assert.equal(m.midiTrigger([0xb0, 20, 64], held, Date.now() + 1000), 'cc:1:20');
  });

  it('moves once for a press that arrives through more than one port', () => {
    const held = new Map();
    assert.equal(m.midiTrigger([0x90, 60, 100], held, 1000), 'note:1:60');
    assert.equal(m.midiTrigger([0x90, 60, 100], held, 1002), null); // the same press, through Midi Through
    assert.equal(m.midiTrigger([0x80, 60, 0], held, 1100), null);
    assert.equal(m.midiTrigger([0x90, 61, 100], held, 1110), 'note:1:61'); // another key straight after is its own
    assert.equal(m.midiTrigger([0x90, 60, 100], held, 1400), 'note:1:60'); // pressed again
    assert.equal(m.midiTrigger([0xc0, 5], held, 2000), 'pc:1:5');
    assert.equal(m.midiTrigger([0xc0, 5], held, 2001), null);
  });

  it('names triggers, and keeps only settings it understands', () => {
    assert.equal(m.triggerLabel('note:1:60'), 'Note C4 (60), channel 1');
    assert.equal(m.triggerLabel('note:2:61'), 'Note C♯4 (61), channel 2');
    assert.equal(m.triggerLabel('cc:1:64'), 'Controller 64, channel 1');
    assert.equal(m.triggerLabel('pc:1:0'), 'Program 1, channel 1');
    assert.equal(m.triggerLabel('sysex'), '');
    assert.deepEqual(m.midiSettings(null), { on: false, device: '', map: {} });
    const s = m.midiSettings({ on: 1, device: 'Pedal', map: { next: 'note:1:60', prev: 'nonsense', jump: 'cc:1:1', logo: 'note:1:60' } });
    assert.deepEqual(s, { on: true, device: 'Pedal', map: { next: 'note:1:60', logo: 'note:1:60' } });
    assert.deepEqual(m.commandsFor(s, 'note:1:60'), [{ action: 'next' }, { action: 'clear', what: 'logo' }]);
    assert.deepEqual(m.commandsFor(s, 'note:1:61'), []);
    for (const [, , cmd] of m.MIDI_ACTIONS) assert.deepEqual(command(cmd), cmd); // every one is a command the server takes
  });
});
