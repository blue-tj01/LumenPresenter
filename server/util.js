// @ts-check
// Small helpers shared by the server's modules.
'use strict';
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');

const VERSION = 6; // the pages warn when the server is older than they are (updated but not restarted)
const COOKIE = 'lumen_session'; // a signed-in device's session id
const TOKEN_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i, so it can be read off one screen and typed on another

/** A request the client got wrong: answered with this status and message. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = msg => new HttpError(400, msg);

/** Three groups of four, e.g. k7mq-3xht-p9wd (about 59 bits). */
function newToken() {
  const group = () => Array.from({ length: 4 }, () => TOKEN_CHARS[crypto.randomInt(TOKEN_CHARS.length)]).join('');
  return [group(), group(), group()].join('-');
}

/** 'Chrome on iPhone' from a User-Agent, for the list of signed-in devices. */
function deviceName(agent) {
  const find = pairs => (pairs.find(([k]) => agent.includes(k)) || [null, ''])[1];
  const system = find([
    ['iPhone', 'iPhone'],
    ['iPad', 'iPad'],
    ['Android', 'Android'],
    ['CrOS', 'Chromebook'],
    ['Macintosh', 'Mac'],
    ['Windows', 'Windows'],
    ['Linux', 'Linux'],
  ]);
  const browser = find([
    ['Edg/', 'Edge'],
    ['Firefox/', 'Firefox'],
    ['CriOS/', 'Chrome'],
    ['Chrome/', 'Chrome'],
    ['Safari/', 'Safari'],
  ]);
  return [browser, system].filter(Boolean).join(' on ') || 'Unknown device';
}

/** This computer's addresses on the local network, best guess first. */
async function lanAddresses() {
  const found = [];
  // The address the default route would use; connecting a UDP socket sends nothing.
  found.push(
    await new Promise(resolve => {
      const s = dgram.createSocket('udp4');
      const done = a => {
        try {
          s.close();
        } catch {}
        resolve(a);
      };
      s.on('error', () => done(null));
      try {
        s.connect(9, '192.0.2.1', (/** @type {any[]} */ ...err) => {
          if (err[0]) return done(null);
          try {
            done(s.address().address);
          } catch {
            done(null);
          }
        });
      } catch {
        done(null);
      }
    }),
  );
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || [])
      if (a.family === 'IPv4' || /** @type {unknown} */ (a.family) === 4) found.push(a.address);
  }
  return found.filter((a, i) => a && found.indexOf(a) === i && !a.startsWith('127.'));
}

const nowMs = () => Date.now();

/** Constant-time comparison of two strings of any length. */
function safeEqual(a, b) {
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/** Percent-decoding that never throws: invalid UTF-8 becomes U+FFFD, like Python's unquote. */
function unquote(s) {
  try {
    return decodeURIComponent(s);
  } catch {}
  const bytes = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const ch = String.fromCodePoint(s.codePointAt(i));
      bytes.push(...Buffer.from(ch));
      i += ch.length;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

const quote = p => encodeURIComponent(p).replace(/%2F/g, '/');

function writeAtomic(file, data, mode) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', mode ?? 0o666);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`warning: could not read ${file}: ${e.message}`);
    return null;
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.error(`warning: could not read ${file}: ${e.message}`);
    return null;
  }
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

module.exports = {
  VERSION,
  COOKIE,
  HttpError,
  bad,
  newToken,
  deviceName,
  lanAddresses,
  nowMs,
  safeEqual,
  unquote,
  quote,
  writeAtomic,
  readJson,
  isObject,
};
