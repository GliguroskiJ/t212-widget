// Updater against a fake GitHub API: check, errors, asset pick, verified download, macOS swap script.
const assert = require('assert'); const http = require('http'); const crypto = require('crypto');
const fs = require('fs'); const os = require('os'); const path = require('path'); const { execFileSync } = require('child_process');
const { Updater, cmpVer, pickAsset, plainNotes, installMac, installWindows, macBundle, macCanReplace } = require('../main/updater');

const EXE = Buffer.alloc(300 * 1024, 7), ZIP = Buffer.alloc(120 * 1024, 3);
const sha = b => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
let mode = 'ok', lastAuth = {}, srv;
const rel = () => ({
  tag_name: mode === 'same' ? 'v1.5.1' : 'v1.6.0', draft: false, prerelease: false,
  html_url: 'https://github.com/x/y/releases/tag/v1.6.0',
  body: '## What\'s Changed\n* Chart hover by @me in [#3](https://x)\n\n**Full Changelog**: v1.5.1...v1.6.0',
  assets: [
    { name: 'T212-Widget-Setup-1.6.0.exe', size: EXE.length, digest: mode === 'baddigest' ? sha(Buffer.from('x')) : sha(EXE),
      url: `${base()}/api/assets/1`, browser_download_url: `${base()}/dl/T212-Widget-Setup-1.6.0.exe` },
    { name: 'T212-Widget-1.6.0-mac-arm64.zip', size: ZIP.length, digest: sha(ZIP), url: `${base()}/api/assets/2`, browser_download_url: `${base()}/dl/arm.zip` },
    { name: 'T212-Widget-1.6.0-mac-x64.zip', size: ZIP.length, url: `${base()}/api/assets/3`, browser_download_url: `${base()}/dl/x64.zip` },
    { name: 'T212-Widget-1.6.0-mac-arm64.dmg', size: 1, url: '', browser_download_url: '' }
  ]
});
const base = () => 'http://127.0.0.1:' + srv.address().port;

srv = http.createServer((req, res) => {
  lastAuth = { url: req.url, auth: req.headers.authorization, accept: req.headers.accept };
  if (req.url === '/repos/GliguroskiJ/t212-widget/releases/latest') {
    if (mode === 'private' && !req.headers.authorization) { res.writeHead(404); return res.end('{}'); }
    if (mode === 'badtoken') { res.writeHead(401); return res.end('{}'); }
    if (mode === 'rate') { res.writeHead(403, { 'x-ratelimit-remaining': '0' }); return res.end('{}'); }
    res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(rel()));
  }
  if (req.url.startsWith('/dl/') || req.url.startsWith('/api/assets/')) {
    const body = /exe|assets\/1/.test(req.url) ? EXE : ZIP;
    if (req.url.startsWith('/api/assets/') && req.headers.accept !== 'application/octet-stream') { res.writeHead(415); return res.end(); }
    res.writeHead(200, { 'content-length': body.length });
    // send in chunks so progress events fire
    let i = 0; const step = () => { if (i >= body.length) return res.end(); res.write(body.subarray(i, i += 64 * 1024)); setTimeout(step, 5); }; return step();
  }
  res.writeHead(404); res.end();
});

srv.listen(0, async () => {
  process.env.T212_UPDATE_API = base();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't212-upd-'));
  let token = null;
  const mk = (platform, arch) => new Updater({ version: '1.5.1', platform, arch, tmpDir: tmp, getToken: () => token });

  // pure helpers
  assert.equal(cmpVer('v1.6.0', '1.5.1'), 1); assert.equal(cmpVer('1.5.1', 'v1.5.1'), 0); assert.equal(cmpVer('1.9.0', '1.10.0'), -1);
  assert.equal(pickAsset(rel().assets, 'darwin', 'x64').name, 'T212-Widget-1.6.0-mac-x64.zip');
  assert.equal(pickAsset(rel().assets, 'linux', 'x64'), null);
  assert.ok(!plainNotes(rel().body).includes('**') && plainNotes(rel().body).includes('• Chart hover'));
  assert.equal(macBundle('/Applications/T212 Widget.app/Contents/MacOS/T212 Widget'), '/Applications/T212 Widget.app');
  assert.equal(macCanReplace('/private/var/folders/x/AppTranslocation/ABC/d/T212 Widget.app').reason, 'translocated');
  console.log('helpers ok');

  // newer release → available, Windows asset picked
  let u = mk('win32', 'x64'); let s = await u.check();
  assert.equal(s.status, 'available'); assert.equal(s.latest, '1.6.0'); assert.equal(s.hasAsset, true); assert.equal(lastAuth.auth, undefined);
  console.log('available ok', s.latest);
  // same version → none
  mode = 'same'; s = await mk('win32', 'x64').check(); assert.equal(s.status, 'none'); console.log('up-to-date ok');
  // private repo: 404 without token, works with it
  mode = 'private'; s = await mk('win32', 'x64').check(); assert.equal(s.status, 'error'); assert.equal(s.error.kind, 'notfound');
  token = 'github_pat_TEST'; u = mk('win32', 'x64'); s = await u.check(); assert.equal(s.status, 'available'); assert.equal(lastAuth.auth, 'Bearer github_pat_TEST');
  console.log('private repo ok');
  mode = 'badtoken'; s = await mk('win32', 'x64').check(); assert.equal(s.error.kind, 'auth');
  mode = 'rate'; s = await mk('win32', 'x64').check(); assert.equal(s.error.kind, 'rate');
  console.log('errors ok');
  // network down
  process.env.T212_UPDATE_API = 'http://127.0.0.1:1'; s = await mk('win32', 'x64').check(); assert.equal(s.error.kind, 'network');
  process.env.T212_UPDATE_API = base();
  console.log('network ok');

  // download with token → API asset URL + octet-stream, progress, sha256 verified
  mode = 'ok'; const prog = []; u.on('state', st => st.status === 'downloading' && prog.push(st.progress));
  const file = await u.download();
  assert.equal(lastAuth.url, '/api/assets/1'); assert.equal(lastAuth.accept, 'application/octet-stream');
  assert.ok(fs.readFileSync(file).equals(EXE)); assert.equal(u.state.status, 'ready'); assert.ok(prog.length >= 2, 'progress events ' + prog.length);
  console.log('download (token) ok', path.basename(file), prog.length, 'progress events');
  // public → browser_download_url
  token = null; u = mk('darwin', 'arm64'); await u.check(); const zip = await u.download();
  assert.equal(lastAuth.url, '/dl/arm.zip'); assert.ok(fs.readFileSync(zip).equals(ZIP));
  console.log('download (public) ok');
  // tampered file → refused, nothing left behind
  mode = 'baddigest'; u = mk('win32', 'x64'); await u.check();
  await assert.rejects(() => u.download(), e => e.kind === 'verify');
  assert.ok(!fs.existsSync(path.join(tmp, 't212-widget-update-1.6.0', 'T212-Widget-Setup-1.6.0.exe.part')));
  console.log('checksum mismatch refused ok');

  // Windows hand-over: silent installer, relaunch afterwards
  let spawned; installWindows('C:\\t\\setup.exe', (f, a, o) => { spawned = { f, a, o }; return { unref() {} }; });
  assert.deepEqual(spawned.a, ['/S', '--updated', '--force-run']); assert.equal(spawned.o.detached, true);
  console.log('windows hand-over ok');

  // macOS swap: real script on fake bundles (ditto/open stubbed)
  const apps = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-'));
  const bundle = path.join(apps, 'T212 Widget.app');
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true }); fs.writeFileSync(path.join(bundle, 'Contents', 'v'), 'old');
  const fakeRun = async (cmd, args) => {
    if (cmd.endsWith('ditto')) { const d = path.join(args[3], 'T212 Widget.app', 'Contents'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'v'), 'new'); }
  };
  let script; await installMac(zip, bundle, 999999, { runImpl: fakeRun, spawnImpl: (c, a) => { script = a[0]; return { unref() {} }; } });
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  fs.writeFileSync(path.join(bin, 'open'), '#!/bin/sh\necho "$1" > "' + path.join(bin, 'opened') + '"\n', { mode: 0o755 });
  const sh = fs.readFileSync(script, 'utf8').replace(/\/usr\/bin\/ditto/g, 'cp -R');
  fs.writeFileSync(script, sh);
  execFileSync('/bin/sh', [script], { env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  assert.equal(fs.readFileSync(path.join(bundle, 'Contents', 'v'), 'utf8'), 'new');
  assert.ok(!fs.existsSync(bundle + '.update-old'));
  assert.equal(fs.readFileSync(path.join(bin, 'opened'), 'utf8').trim(), bundle);
  console.log('mac swap ok (old replaced, backup removed, reopened)');
  // copy of the new version fails → the old app is put back and still opens
  let script2; await installMac(zip, bundle, 999999, { runImpl: fakeRun, spawnImpl: (c, a) => { script2 = a[0]; return { unref() {} }; } });
  fs.writeFileSync(script2, fs.readFileSync(script2, 'utf8').replace(/\/usr\/bin\/ditto "\$NEW" "\$OLD"/, 'false'));
  fs.writeFileSync(path.join(bundle, 'Contents', 'v'), 'current');
  execFileSync('/bin/sh', [script2], { env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  assert.equal(fs.readFileSync(path.join(bundle, 'Contents', 'v'), 'utf8'), 'current');
  assert.ok(!fs.existsSync(bundle + '.update-old'));
  console.log('mac swap rollback ok');

  console.log('UPDATER TESTS PASSED'); srv.close(); process.exit(0);
});
