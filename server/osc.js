// @ts-check
// OSC control: lighting desks, QLab, TouchOSC, Companion's generic OSC and the like send /lumen/... messages over
// UDP, and each one becomes a command for the console (control.js). Node's standard library only.
//
// OSC carries no token, so it is off until switched on in the console, and then only takes messages from this
// computer unless it is also told to listen on the network (which also needs network mode).
'use strict';
const dgram = require('dgram');
const { command } = require('./control.js');

const DEFAULT_PORT = 8643;

// ---------- decoding ----------
/** The OSC string at off (null-terminated, padded to 4 bytes), and where the next field starts. */
function readString(buf, off) {
  const end = buf.indexOf(0, off);
  if (end < 0) throw new Error('unterminated string');
  return [buf.toString('utf8', off, end), (end + 4) & ~3];
}

/** One message: {address, args}. Blobs come back as Buffers, timetags as BigInts. */
function decodeMessage(buf) {
  let [address, off] = readString(buf, 0);
  if (!address.startsWith('/')) throw new Error('not an OSC message');
  const args = [];
  if (off >= buf.length) return { address, args }; // very old senders leave out the type tags
  let tags;
  [tags, off] = readString(buf, off);
  if (!tags.startsWith(',')) return { address, args };
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i': args.push(buf.readInt32BE(off)); off += 4; break;
      case 'f': args.push(buf.readFloatBE(off)); off += 4; break;
      case 'd': args.push(buf.readDoubleBE(off)); off += 8; break;
      case 'h': args.push(Number(buf.readBigInt64BE(off))); off += 8; break;
      case 't': args.push(buf.readBigUInt64BE(off)); off += 8; break;
      case 's': case 'S': { let s; [s, off] = readString(buf, off); args.push(s); break; }
      case 'c': args.push(String.fromCodePoint(buf.readUInt32BE(off))); off += 4; break;
      case 'r': case 'm': args.push(buf.readUInt32BE(off)); off += 4; break;
      case 'b': { const n = buf.readInt32BE(off); args.push(buf.subarray(off + 4, off + 4 + n)); off = (off + 4 + n + 3) & ~3; break; }
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 'I': args.push(Infinity); break;
      case '[': case ']': break; // arrays: their items are read as plain arguments
      default: throw new Error(`unknown type tag ${t}`);
    }
  }
  return { address, args };
}

/** Every message in a packet, unpacking bundles (their timetags are ignored: messages act when they arrive). */
function decode(buf, depth = 0) {
  if (buf.subarray(0, 8).toString('latin1') !== '#bundle\0') return [decodeMessage(buf)];
  if (depth > 8) throw new Error('bundles nested too deep');
  const out = [];
  for (let off = 16; off + 4 <= buf.length;) {
    const n = buf.readInt32BE(off);
    if (n < 0 || off + 4 + n > buf.length) throw new Error('bad bundle element');
    out.push(...decode(buf.subarray(off + 4, off + 4 + n), depth + 1));
    off += 4 + n;
  }
  return out;
}

// ---------- addresses ----------
const PREV = ['prev', 'previous'];

/** The command a message asks for, or null. Numbers count from 1 here, as a person would say them, and are given
 * either in the address (/lumen/slide/3) or as its argument (/lumen/slide 3). A button that sends 1 when pressed
 * and 0 when let go (TouchOSC, many desks) moves the slides once: a 0, false or negative first argument is
 * ignored when the address says everything. */
function oscCommand(address, args = []) {
  const parts = address.toLowerCase().split('/').filter(Boolean);
  if (parts.shift() !== 'lumen' || !parts.length) return null;
  const first = args[0];
  const released = first === false || (typeof first === 'number' && first <= 0);
  const number = s => /^\d+$/.test(s ?? '') ? Number(s) : null;
  const [a, b] = parts;
  let body;
  if (a === 'next' && !b) body = { action: 'next' };
  else if (PREV.includes(a) && !b) body = { action: 'prev' };
  else if (a === 'item' && b === 'next') body = { action: 'nextItem' };
  else if (a === 'item' && PREV.includes(b)) body = { action: 'prevItem' };
  else if ((a === 'item' || a === 'slide') && (b === undefined || number(b) !== null)) {
    const n = b === undefined ? first : number(b);
    if (b === undefined && typeof first !== 'number') return null;
    if (b !== undefined && released) return null;
    if (!Number.isInteger(n) || n < 1) return null;
    return a === 'item' ? { action: 'item', item: n - 1 } : { action: 'slide', idx: n - 1 };
  }
  else if (a === 'clear' && b) body = { action: 'clear', what: b === 'background' ? 'bg' : b === 'message' ? 'msg' : b };
  else if (a === 'logo' && !b) body = { action: 'clear', what: 'logo' };
  else if (a === 'video' && b) body = { action: 'video', what: b === 'play' || b === 'pause' ? 'toggle' : b };
  else if (a === 'auto' && !b) body = { action: 'auto' };
  else if (a === 'timer' && b) body = { action: 'timer', what: b };
  else return null;
  if (released || parts.length > 2) return null;
  try { return command(body); } catch { return null; }
}

// ---------- listening ----------
/** The UDP socket, opened and moved as the settings say. onCommand(cmd, from) is called for each command. */
class OscListener {
  /** @param {(cmd: object, from: string, address: string) => void} onCommand @param {(msg: string) => void} [log] */
  constructor(onCommand, log = () => {}) {
    this.onCommand = onCommand;
    this.log = log;
    this.socket = null;
    this.config = { on: false, port: DEFAULT_PORT, host: '127.0.0.1' };
    this.error = '';
    this.queue = Promise.resolve();
  }

  get listening() { return !!this.socket; }

  status() {
    return { on: this.config.on, port: this.config.port, host: this.config.host, listening: this.listening, error: this.error };
  }

  /** Listen as {on, port, host} says; resolves once done. A port that can't be used is reported in status(). */
  apply(config) {
    const run = this.queue.then(() => this._apply(config));
    this.queue = run.catch(() => {});
    return run;
  }

  async _apply({ on, port, host }) {
    const same = this.socket && on && port === this.config.port && host === this.config.host;
    this.config = { on: !!on, port, host };
    if (same) return;
    await this._close();
    this.error = '';
    if (!on) return;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    try {
      await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(port, host, () => { socket.off('error', reject); resolve(); });
      }));
    } catch (e) {
      socket.close();
      this.error = e.code === 'EADDRINUSE' ? `port ${port} is in use by another program` : e.message;
      this.log(`warning: OSC could not listen on ${host}:${port}: ${this.error}`);
      return;
    }
    socket.on('error', e => this.log(`error: OSC: ${e.message}`));
    socket.on('message', (msg, from) => this._message(msg, from));
    this.socket = socket;
    this.config.port = socket.address().port;
  }

  _message(msg, from) {
    // Bound to 127.0.0.1 nothing else arrives, but make sure.
    if (this.config.host === '127.0.0.1' && !from.address.startsWith('127.')) return;
    let messages;
    try { messages = decode(msg); } catch (e) { return this.log(`OSC: ignored a packet from ${from.address}: ${e.message}`); }
    for (const { address, args } of messages) {
      const cmd = oscCommand(address, args);
      if (cmd) this.onCommand(cmd, from.address, address);
      else this.log(`OSC: ignored ${address} from ${from.address}`);
    }
  }

  _close() {
    const s = this.socket;
    this.socket = null;
    return s ? /** @type {Promise<void>} */ (new Promise(resolve => s.close(() => resolve()))) : Promise.resolve();
  }

  close() {
    this.config.on = false;
    const run = this.queue.then(() => this._close());
    this.queue = run.catch(() => {});
    return run;
  }
}

module.exports = { OscListener, decode, oscCommand, DEFAULT_PORT };
