// Lumen's data folder: the library, what is on screen, settings, media and backups.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { newToken, nowMs, writeAtomic, readJson, isObject } = require('./util.js');
const { Library } = require('./library.js');
const { Bibles } = require('./bible/bibles.js');

const BACKUP_EVERY = 600; // seconds between library snapshots in data/backups
const BACKUP_KEEP = 50;
const MAX_SESSIONS = 100;

/** library-20261019-211500.json, in local time. */
function backupName(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `library-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}

/** On-disk state: the library in the database, and live state and settings as JSON files beside it. Node runs one
 * request at a time between awaits, and every change here is synchronous. */
class Store {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir);
    this.mediaDir = path.join(this.dir, 'media');
    this.backupDir = path.join(this.dir, 'backups');
    for (const d of [this.dir, this.mediaDir, this.backupDir]) fs.mkdirSync(d, { recursive: true });
    this.livePath = path.join(this.dir, 'live.json');

    this.lib = new Library(this.dir, this.backupDir);
    this.bibles = new Bibles(this.dir);
    const live = readJson(this.livePath);
    this.live = isObject(live) ? live.live ?? null : null;
    this.liveOrigin = null;
    this.lastBackup = 0;

    this.settingsPath = path.join(this.dir, 'settings.json');
    const settings = readJson(this.settingsPath);
    this.settings = isObject(settings) ? settings : {};
    if (!isObject(this.settings.sessions)) this.settings.sessions = {};
    if (typeof this.settings.token !== 'string' || !this.settings.token) {
      this.settings.token = newToken();
      this.saveSettings();
    }
  }

  /** Network mode, its token and signed-in devices. Kept with the library, so updating the app's files leaves
   * them alone. */
  saveSettings(changes = {}) {
    Object.assign(this.settings, changes);
    this._writeSettings();
  }

  /** Sign a device in; returns the id its cookie carries instead of the token. */
  addSession(info) {
    const sid = crypto.randomBytes(24).toString('base64url');
    const sessions = this.settings.sessions;
    sessions[sid] = { ...info, created: nowMs() };
    const old = Object.keys(sessions).sort((a, b) => (sessions[a].created || 0) - (sessions[b].created || 0));
    for (const k of old.slice(0, Math.max(0, old.length - MAX_SESSIONS))) delete sessions[k];
    this._writeSettings();
    return sid;
  }

  /** Sign out the given devices, or all of them. */
  dropSessions(sids = null) {
    const sessions = this.settings.sessions;
    for (const sid of sids ?? Object.keys(sessions)) delete sessions[sid];
    this._writeSettings();
  }

  _writeSettings() {
    writeAtomic(this.settingsPath, JSON.stringify(this.settings, null, 2), 0o600); // the token is a secret
  }

  get library() { return this.lib.library; }
  get rev() { return this.lib.rev; }

  setLibrary(library) {
    // A library saved in a new format is backed up as it was first, whenever the last backup was.
    this._backup((library.format || 1) !== (this.lib.library?.format || 1));
    return this.lib.set(library);
  }

  /** Apply a console's changes since revision `base` (Library.patch). */
  patchLibrary(changes, base) {
    this._backup();
    return this.lib.patch(changes, base);
  }

  /** Before a change, at most every BACKUP_EVERY seconds: the library as it was, as a JSON file that Import reads. */
  _backup(now = false) {
    if (this.lib.library === null || (!now && Date.now() / 1000 - this.lastBackup < BACKUP_EVERY)) return;
    this.lastBackup = Date.now() / 1000;
    writeAtomic(path.join(this.backupDir, backupName()), this.lib.snapshot());
    const old = fs.readdirSync(this.backupDir).filter(f => f.startsWith('library-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUP_KEEP))) fs.rmSync(path.join(this.backupDir, f), { force: true });
  }

  setLive(live, origin) {
    this.live = live;
    this.liveOrigin = origin;
    writeAtomic(this.livePath, JSON.stringify({ saved: nowMs(), live }));
  }

  close() {
    this.lib.close();
    this.bibles.close();
  }
}

module.exports = { Store };
