'use strict';
// Self-update from GitHub Releases — no extra dependencies, same flow on Windows and macOS.
//   check()    → newest published release vs. app version
//   download() → the platform asset (Setup .exe / mac-<arch>.zip), size + sha256 verified
//   install*() → hands over to the installer / swaps the .app; the caller then quits the app
// electron-updater isn't used on purpose: on macOS it needs a Developer ID signed app,
// and these builds are only ad-hoc signed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const { spawn, execFile } = require('child_process');

const REPO = 'GliguroskiJ/t212-widget';
// Test hooks (fake servers) — honoured only in plain Node tests and `electron script.js` dev runs,
// never in the installed app, so nothing can redirect the API key or the updater elsewhere.
const devEnv = name => ((!process.versions.electron || process.defaultApp) ? process.env[name] : undefined);
const apiBase = () => devEnv('T212_UPDATE_API') || 'https://api.github.com';
const sameOrigin = (url, base) => { try { return new URL(url).origin === new URL(base).origin; } catch { return false; } };
const SAFE_VER = /^\d+\.\d+\.\d+$/;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function parseVer(v) {
  const m = String(v || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

function pickAsset(assets, platform, arch) {
  const list = assets || [];
  if (platform === 'win32') return list.find(a => /^T212-Widget-Setup-.*\.exe$/i.test(a.name)) || null;
  if (platform === 'darwin') return list.find(a => a.name.endsWith(`-mac-${arch}.zip`)) || null;
  return null;
}

// GitHub's generated notes are markdown — keep a short plain-text version for the dialog
function plainNotes(md, max = 700) {
  const txt = String(md || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return txt.length > max ? txt.slice(0, max - 1).trimEnd() + '…' : txt;
}

class UpdateError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

class Updater extends EventEmitter {
  constructor({ version, fetchImpl, getToken = () => null, platform = process.platform, arch = process.arch, tmpDir = os.tmpdir(), repo = REPO }) {
    super();
    this.version = version;
    this.fetch = fetchImpl || fetch;
    this.getToken = getToken;
    this.platform = platform;
    this.arch = arch;
    this.tmpDir = tmpDir;
    this.repo = repo;
    this.release = null;
    this.file = null;
    this.state = { status: 'idle', current: version, latest: null, progress: 0, error: null, checkedAt: null, url: null };
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.emit('state', this.state); }

  headers(extra) {
    const h = { 'User-Agent': 'T212-Widget-Updater', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
    const tok = this.getToken();
    if (tok) h.Authorization = 'Bearer ' + tok;
    return h;
  }

  async check() {
    if (this.state.status === 'downloading') return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const r = await this.fetch(`${apiBase()}/repos/${this.repo}/releases/latest`, { headers: this.headers({ Accept: 'application/vnd.github+json' }) });
      if (r.status === 404) {
        throw new UpdateError('notfound', this.getToken()
          ? 'No published release found (or the token cannot see the repository).'
          : 'No release found — the repository is private, so a GitHub token is needed.');
      }
      if (r.status === 401) throw new UpdateError('auth', 'GitHub rejected the token (401).');
      if (r.status === 403 || r.status === 429) {
        const left = r.headers.get('x-ratelimit-remaining');
        throw new UpdateError(left === '0' ? 'rate' : 'auth', left === '0' ? 'GitHub rate limit — try again later.' : `GitHub refused the request (${r.status}).`);
      }
      if (!r.ok) throw new UpdateError('http', `GitHub returned ${r.status}.`);
      const rel = await r.json();
      if (rel.draft || rel.prerelease) { this.set({ status: 'none', checkedAt: Date.now(), latest: this.version }); return this.state; }
      const latest = String(rel.tag_name || '').replace(/^v/i, '');
      if (!SAFE_VER.test(latest)) { this.set({ status: 'none', checkedAt: Date.now(), latest: this.version }); return this.state; }
      const asset = pickAsset(rel.assets, this.platform, this.arch);
      this.release = { latest, asset, url: rel.html_url, notes: plainNotes(rel.body) };
      const newer = cmpVer(latest, this.version) > 0;
      this.set({ status: newer ? 'available' : 'none', latest, url: rel.html_url, checkedAt: Date.now(), hasAsset: !!asset, notes: this.release.notes });
    } catch (e) {
      const err = e instanceof UpdateError ? e : new UpdateError('network', 'Could not reach GitHub — ' + (e && e.message || e));
      this.set({ status: 'error', error: { kind: err.kind, message: err.message }, checkedAt: Date.now() });
    }
    return this.state;
  }

  async download() {
    const rel = this.release;
    if (!rel || !rel.asset) throw new UpdateError('noasset', 'This release has no file for this platform.');
    const a = rel.asset;
    // never install anything we can't verify: GitHub publishes a sha256 for every release asset
    const want = typeof a.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(a.digest) ? a.digest.slice(7).toLowerCase() : null;
    if (!want) throw new UpdateError('verify', 'The release file has no checksum — not installing.');
    if (!SAFE_NAME.test(a.name || '')) throw new UpdateError('verify', 'Unexpected file name in the release — not installing.');
    const dir = path.join(this.tmpDir, `t212-widget-update-${rel.latest}`);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, a.name);
    const part = dest + '.part';
    this.set({ status: 'downloading', progress: 0, error: null });
    try {
      // private repo → API asset URL with the token; public → plain download link
      // the token only ever goes to the GitHub API itself
      const tok = sameOrigin(a.url, apiBase()) ? this.getToken() : null;
      const url = tok ? a.url : a.browser_download_url;
      const r = await this.fetch(url, { headers: tok ? this.headers({ Accept: 'application/octet-stream' }) : { 'User-Agent': 'T212-Widget-Updater' } });
      if (!r.ok || !r.body) throw new UpdateError('http', `Download failed (${r.status}).`);
      const total = Number(r.headers.get('content-length')) || a.size || 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let got = 0, lastEmit = 0;
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        hash.update(buf);
        got += buf.length;
        if (!out.write(buf)) await new Promise(res => out.once('drain', res));
        const now = Date.now();
        if (total && now - lastEmit > 250) { lastEmit = now; this.set({ progress: Math.min(0.999, got / total) }); }
      }
      await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
      if (a.size && got !== a.size) throw new UpdateError('verify', `Downloaded ${got} B, expected ${a.size} B.`);
      if (hash.digest('hex') !== want) throw new UpdateError('verify', 'Checksum does not match the release — not installing.');
      fs.renameSync(part, dest);
      this.file = dest;
      this.set({ status: 'ready', progress: 1 });
      return dest;
    } catch (e) {
      try { fs.unlinkSync(part); } catch {}
      const err = e instanceof UpdateError ? e : new UpdateError('network', 'Download failed — ' + (e && e.message || e));
      this.set({ status: 'error', error: { kind: err.kind, message: err.message } });
      throw err;
    }
  }
}

// ── installing ───────────────────────────────────────────────
// Windows: the NSIS one-click installer, silent; --force-run starts the new version afterwards.
function installWindows(file, spawnImpl = spawn) {
  const p = spawnImpl(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
  p.unref();
  return true;
}

// macOS: where the running app lives, and whether we may replace it in place
function macBundle(exePath) {
  const i = exePath.indexOf('.app/');
  return i < 0 ? null : exePath.slice(0, i + 4);
}
function macCanReplace(bundle) {
  if (!bundle) return { ok: false, reason: 'notbundle' };
  if (bundle.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' };
  try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); fs.accessSync(bundle, fs.constants.W_OK); }
  catch { return { ok: false, reason: 'readonly' }; }
  return { ok: true };
}

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))));

// unzip next to the download, then a detached script waits for us to exit,
// swaps the bundle (keeping the old one until the new one is in place) and reopens it
async function installMac(zip, bundle, pid, { runImpl = run, spawnImpl = spawn } = {}) {
  const dir = path.join(path.dirname(zip), 'unpacked');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await runImpl('/usr/bin/ditto', ['-x', '-k', zip, dir]);
  const name = fs.readdirSync(dir).find(f => f.endsWith('.app'));
  if (!name) throw new UpdateError('verify', 'The downloaded archive does not contain an app.');
  const fresh = path.join(dir, name);
  try { await runImpl('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh]); } catch {}
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const script = path.join(path.dirname(zip), 'swap.sh');
  fs.writeFileSync(script, [
    '#!/bin/sh',
    `while kill -0 ${Number(pid)} 2>/dev/null; do sleep 0.3; done`,
    `OLD=${q(bundle)}; NEW=${q(fresh)}; BAK="$OLD.update-old"`,
    'rm -rf "$BAK"',
    'if mv "$OLD" "$BAK"; then',
    '  if /usr/bin/ditto "$NEW" "$OLD"; then rm -rf "$BAK"; else rm -rf "$OLD"; mv "$BAK" "$OLD"; fi',
    'fi',
    'open "$OLD"',
    ''
  ].join('\n'), { mode: 0o755 });
  const p = spawnImpl('/bin/sh', [script], { detached: true, stdio: 'ignore' });
  p.unref();
  return true;
}

module.exports = { apiBase, Updater, UpdateError, cmpVer, pickAsset, plainNotes, installWindows, installMac, macBundle, macCanReplace, REPO };
