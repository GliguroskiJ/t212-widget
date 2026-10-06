'use strict';
// Persistent settings, encrypted credentials and NAV history.
// Everything lives in %APPDATA%/T212 Widget (Electron userData).
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  env: 'live',                 // 'live' | 'demo'
  size: 'medium',              // 'small' | 'medium' | 'large' | 'rail'
  largeView: 'chart',          // 'chart' | 'positions' | 'alloc'
  range: '1D',                 // '1D' | '1W' | '1M' | '1Y' | 'ALL'
  theme: 'acrylic',            // 'acrylic' | 'slate' | 'indigo' | 'clear' | 'ink'
  accent: '#9184d9',           // accent colour (hex) — drives the whole Nocturne accent ramp
  tint: 0,                     // 0–1: how much the accent colour tints the background type
  motion: 'full',              // 'full' | 'subtle' | 'off'
  opacity: 1,                  // 0.5 – 1
  numberFormat: 'en',          // 'en' (1,234.56) | 'cs' (1 234,56)
  refreshSeconds: 30,
  displayCurrency: 'account',  // 'account' | 'CZK' | 'EUR' | 'USD' | 'GBP'
  pauseWhenClosed: true,
  fillGaps: true,              // rebuild chart gaps from market prices (Yahoo Finance)
  language: 'cs',              // 'cs' | 'en'
  textColor: 'auto',           // 'auto' or a hex colour
  startWithWindows: true,
  alwaysOnTop: false,
  lockPosition: false,
  showWidget: true,
  widgetPos: null,             // {x, y} top-left of the window
  macMode: 'menubar',          // macOS: 'menubar' | 'desktop' | 'both'
  popoverSize: 'medium',       // size of the menu-bar panel
  menuBarText: 'value',        // macOS menu-bar title: 'value' | 'change' | 'none'
  firstLaunchDone: false,
  autoUpdate: true,            // check GitHub Releases on start, after sleep and daily at 12:00 — always asks first
  skippedVersion: null         // "Skip this version" → no automatic prompt for it
};

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    fs.mkdirSync(dir, { recursive: true });
    this.settingsFile = path.join(dir, 'settings.json');
    this.credsFile = path.join(dir, 'credentials.bin');
    this.ghFile = path.join(dir, 'github-token.bin');
    this.historyFile = path.join(dir, 'history.json');
    this.settings = { ...DEFAULTS, ...readJson(this.settingsFile, {}) };
    this.history = readJson(this.historyFile, null) || { points: [], dayBase: null, posHist: {}, last: null };
    if (!Array.isArray(this.history.points)) this.history.points = [];
    if (!this.history.posHist) this.history.posHist = {};
    this._histTimer = null;
  }

  // ── settings ────────────────────────────────────────────────
  get(k) { return this.settings[k]; }
  all() { return { ...this.settings }; }
  set(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in DEFAULTS) this.settings[k] = v;
    }
    atomicWrite(this.settingsFile, JSON.stringify(this.settings, null, 2));
    return this.all();
  }

  // ── credentials (Windows DPAPI via Electron safeStorage) ────
  getCreds() {
    try {
      const buf = fs.readFileSync(this.credsFile);
      const txt = this.safe && this.safe.isEncryptionAvailable()
        ? this.safe.decryptString(buf)
        : buf.toString('utf8');
      const c = JSON.parse(txt);
      return c && c.key && c.secret ? c : null;
    } catch { return null; }
  }
  setCreds(c) {
    const txt = JSON.stringify({ key: c.key, secret: c.secret });
    const buf = this.safe && this.safe.isEncryptionAvailable()
      ? this.safe.encryptString(txt)
      : Buffer.from(txt, 'utf8');
    fs.writeFileSync(this.credsFile, buf);
  }
  clearCreds() { try { fs.unlinkSync(this.credsFile); } catch {} }

  // GitHub token for updates while the repository is private — encrypted the same way
  getGhToken() {
    try {
      const buf = fs.readFileSync(this.ghFile);
      const txt = this.safe && this.safe.isEncryptionAvailable() ? this.safe.decryptString(buf) : buf.toString('utf8');
      return txt.trim() || null;
    } catch { return null; }
  }
  setGhToken(tok) {
    if (!tok) { try { fs.unlinkSync(this.ghFile); } catch {} return; }
    const buf = this.safe && this.safe.isEncryptionAvailable() ? this.safe.encryptString(tok.trim()) : Buffer.from(tok.trim(), 'utf8');
    fs.writeFileSync(this.ghFile, buf);
  }
  encrypted() { return !!(this.safe && this.safe.isEncryptionAvailable()); }

  // ── history ─────────────────────────────────────────────────
  saveHistorySoon() {
    clearTimeout(this._histTimer);
    this._histTimer = setTimeout(() => this.saveHistory(), 1500);
  }
  saveHistory() {
    compact(this.history);
    try { atomicWrite(this.historyFile, JSON.stringify(this.history)); } catch {}
  }
  clearHistory() {
    this.history = { points: [], dayBase: null, posHist: {}, last: this.history.last };
    this.saveHistory();
  }
}

// Keep full resolution for 48 h, one point per 15 min up to 90 days, then daily.
function compact(h) {
  const now = Date.now();
  const H48 = 48 * 3600e3, D90 = 90 * 86400e3;
  const out = [];
  let lastBucket = null;
  for (const p of h.points) {
    const age = now - p[0];
    if (age <= H48) { out.push(p); lastBucket = null; continue; }
    const size = age <= D90 ? 15 * 60e3 : 86400e3;
    const b = Math.floor(p[0] / size) + ':' + size;
    if (b === lastBucket) out[out.length - 1] = p; // keep the latest point of each bucket
    else { out.push(p); lastBucket = b; }
  }
  h.points = out;
}

module.exports = { Store, DEFAULTS };
