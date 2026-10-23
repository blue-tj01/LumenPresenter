// Lumen's data folder: the library, what is on screen, settings, media and backups.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { newToken, nowMs, writeAtomic, readJson, isObject } = require('./util.js');
const { Library } = require('./library.js');
const { Bibles } = require('./bible/bibles.js');

const BACKUP_EVERY = 600; // seconds between library snapshots in data/backups
const BACKUP_KEEP = 50;     // the latest snapshots kept, whenever they were made
const BACKUP_DAYS = 30;     // and the last one of each of this many days before them
const BACKUP_NAME = /^library-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)\.json$/;
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

  /** Replace the library. A library saved in a new format, or one replaced on purpose (an import, starting over,
   * restoring a backup), is backed up as it was first, whenever the last backup was. */
  setLibrary(library, replace = false) {
    this._backup(replace || (library.format || 1) !== (this.lib.library?.format || 1));
    return this.lib.set(library);
  }

  /** The backups, newest first: [{name, time, size}], time in ms. */
  backups() {
    return fs.readdirSync(this.backupDir).filter(f => BACKUP_NAME.test(f)).sort().reverse().map(name => {
      const [, y, mo, d, h, mi, s] = BACKUP_NAME.exec(name).map(Number);
      return { name, time: new Date(y, mo - 1, d, h, mi, s).getTime(), size: fs.statSync(path.join(this.backupDir, name)).size };
    });
  }

  /** Put a backup's library back, keeping the current one as a backup first. Returns the new revision. */
  restoreBackup(name) {
    if (typeof name !== 'string' || !BACKUP_NAME.test(name)) return null;
    const saved = readJson(path.join(this.backupDir, name));
    if (!isObject(saved) || !isObject(saved.library) || !Array.isArray(saved.library.presentations)) return null;
    return this.setLibrary(saved.library, true);
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
    let name = backupName();
    // Two in the same second (a replace straight after a backup): keep both.
    for (let i = 1; fs.existsSync(path.join(this.backupDir, name)); i++) name = backupName(new Date(Date.now() + i * 1000));
    writeAtomic(path.join(this.backupDir, name), this.lib.snapshot());
    // The latest BACKUP_KEEP, and before them the last of each day for BACKUP_DAYS days.
    const all = fs.readdirSync(this.backupDir).filter(f => BACKUP_NAME.test(f)).sort().reverse();
    const keep = new Set(all.slice(0, BACKUP_KEEP));
    const days = new Set();
    for (const f of all.slice(BACKUP_KEEP)) {
      const day = f.slice(8, 16);
      if (days.size < BACKUP_DAYS && !days.has(day)) { days.add(day); keep.add(f); }
    }
    for (const f of all) if (!keep.has(f)) fs.rmSync(path.join(this.backupDir, f), { force: true });
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
