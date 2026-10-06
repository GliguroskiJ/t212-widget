// Smoke test of the update flow in real Electron: fake GitHub, dialogs captured instead of shown.
// xvfb-run electron --no-sandbox scripts/smoke-update.js
const electron = require('electron');
const { app, BrowserWindow, dialog } = electron;
const path = require('path'); const fs = require('fs'); const http = require('http'); const assert = require('assert');
const OUT = process.env.SMOKE_OUT || '/tmp/claude-0/smoke';
fs.mkdirSync(OUT, { recursive: true });
const ud = fs.mkdtempSync('/tmp/claude-0/t212-upd-ud-');
app.setPath('userData', ud);

const dialogs = []; let answer = 1;
dialog.showMessageBox = async opts => { dialogs.push(opts); return { response: answer }; };

const srv = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.endsWith('/account/summary')) return res.end(JSON.stringify({ id: 7, currency: 'CZK', totalValue: 100000, cash: { availableToTrade: 1 }, investments: { currentValue: 1, totalCost: 1, realizedProfitLoss: 0, unrealizedProfitLoss: 0 } }));
  if (req.url.endsWith('/equity/positions')) return res.end('[]');
  if (req.url.includes('/history/dividends')) return res.end(JSON.stringify({ items: [], nextPagePath: null }));
  if (req.url === '/repos/GliguroskiJ/t212-widget/releases/latest') return res.end(JSON.stringify({
    tag_name: 'v99.0.0', draft: false, prerelease: false, html_url: 'https://github.com/GliguroskiJ/t212-widget/releases/tag/v99.0.0',
    body: '## What\'s Changed\n* Updater', assets: [] }));
  res.writeHead(404); res.end();
});
srv.listen(0, () => {
  process.env.T212_BASE = process.env.T212_UPDATE_API = 'http://127.0.0.1:' + srv.address().port;
  require('../main/main.js');
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
process.on('uncaughtException', e => errors.push('MAIN ' + e.stack));
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) errors.push(m.message); }));

app.whenReady().then(async () => {
  await wait(2000);
  console.log('app version (dev run = Electron version):', app.getVersion());
  const widget = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('widget.html'));
  await widget.webContents.executeJavaScript("window.api.connect({env:'live',key:'K',secret:'S'})");
  await widget.webContents.executeJavaScript("window.api.openSettings('system')");
  await wait(2500);
  const settings = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('settings.html'));
  await settings.webContents.executeJavaScript("document.querySelector('main').scrollTop = 99999");
  await wait(400);
  fs.writeFileSync(OUT + '/upd-1-before.png', (await settings.webContents.capturePage()).toPNG());

  // 1) manual check from the settings window → "available" + the question dialog
  const st = await settings.webContents.executeJavaScript('window.api.checkUpdate()');
  await wait(600);
  assert.equal(st.status, 'available'); assert.equal(st.latest, '99.0.0');
  assert.equal(dialogs.length, 1, 'one dialog');
  const d = dialogs[0];
  console.log('dialog:', d.message, '|', d.buttons.join(' / '));
  console.log('detail:', d.detail.replace(/\n+/g, ' ⏎ '));
  assert.ok(/99\.0\.0/.test(d.message));
  assert.equal(d.buttons.length, 3);
  assert.ok(/vývojová verze|development build/.test(d.detail), 'dev build cannot self-install');
  await settings.webContents.executeJavaScript("document.querySelector('main').scrollTop = 99999");
  await wait(500);
  fs.writeFileSync(OUT + '/upd-2-available.png', (await settings.webContents.capturePage()).toPNG());

  // 2) "Skip this version" → remembered, shown in settings
  answer = 2;
  await settings.webContents.executeJavaScript('window.api.installUpdate()');
  await wait(800);
  const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  assert.equal(saved.skippedVersion, '99.0.0'); console.log('skipped version stored:', saved.skippedVersion);
  // 3) token save/remove round trip (encrypted file appears / disappears)
  assert.equal(await settings.webContents.executeJavaScript("window.api.setGithubToken('github_pat_SMOKE')"), true);
  assert.ok(fs.existsSync(path.join(ud, 'github-token.bin')));
  assert.equal(await settings.webContents.executeJavaScript('window.api.setGithubToken(null)'), false);
  assert.ok(!fs.existsSync(path.join(ud, 'github-token.bin')));
  console.log('token save/remove ok');
  await settings.webContents.executeJavaScript("document.querySelector('main').scrollTop = 99999");
  await wait(500);
  fs.writeFileSync(OUT + '/upd-3-skipped.png', (await settings.webContents.capturePage()).toPNG());

  console.log('renderer/main errors:', errors.length ? errors : 'none');
  console.log(errors.length ? 'SMOKE UPDATE FAILED' : 'SMOKE UPDATE PASSED');
  srv.close(); app.exit(errors.length ? 1 : 0);
}).catch(e => { console.error('SMOKE UPDATE FAILED', e); app.exit(1); });
