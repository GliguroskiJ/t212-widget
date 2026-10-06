// Smoke test of the update flow in real Electron: fake GitHub, the themed update window answers via IPC.
// xvfb-run electron --no-sandbox scripts/smoke-update.js
const electron = require('electron');
const { app, BrowserWindow } = electron;
const path = require('path'); const fs = require('fs'); const http = require('http'); const assert = require('assert');
const OUT = process.env.SMOKE_OUT || '/tmp/claude-0/smoke';
fs.mkdirSync(OUT, { recursive: true });
const ud = fs.mkdtempSync('/tmp/claude-0/t212-upd-ud-');
app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'github-token.bin'), 'leftover from 1.6.x');

const srv = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.endsWith('/account/summary')) return res.end(JSON.stringify({ id: 7, currency: 'CZK', totalValue: 100000, cash: { availableToTrade: 1 }, investments: { currentValue: 1, totalCost: 1, realizedProfitLoss: 0, unrealizedProfitLoss: 0 } }));
  if (req.url.endsWith('/equity/positions')) return res.end('[]');
  if (req.url.includes('/history/dividends')) return res.end(JSON.stringify({ items: [], nextPagePath: null }));
  if (req.url === '/repos/GliguroskiJ/t212-widget/releases/latest') return res.end(JSON.stringify({
    tag_name: 'v99.0.0', draft: false, prerelease: false, html_url: 'https://github.com/GliguroskiJ/t212-widget/releases/tag/v99.0.0',
    body: '## What\'s Changed\n* Themed update window\n* Autostart fix', assets: [] }));
  res.writeHead(404); res.end();
});
srv.listen(0, () => {
  process.env.T212_BASE = process.env.T212_UPDATE_API = 'http://127.0.0.1:' + srv.address().port;
  require('../main/main.js');
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(100); } };
const errors = [];
process.on('uncaughtException', e => errors.push('MAIN ' + e.stack));
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) errors.push(m.message); }));
const findWin = part => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes(part));

app.whenReady().then(async () => {
  await wait(2000);
  assert.ok(!fs.existsSync(path.join(ud, 'github-token.bin')), 'old token file removed');
  console.log('old GitHub token file removed ok');
  const widget = findWin('widget.html');
  await widget.webContents.executeJavaScript("window.api.connect({env:'live',key:'K',secret:'S'})");
  await widget.webContents.executeJavaScript("window.api.openSettings('system')");
  const settings = await until(() => findWin('settings.html'));
  await wait(1500);

  // 1) manual check from settings → themed update window, "available"
  const st = await settings.webContents.executeJavaScript('window.api.checkUpdate()');
  assert.equal(st.status, 'available');
  const upd = await until(() => findWin('update.html'));
  assert.ok(upd, 'update window opened');
  await wait(1500);
  const text = await upd.webContents.executeJavaScript('document.body.innerText');
  console.log('update window:', text.replace(/\s+/g, ' ').slice(0, 160));
  assert.ok(/99\.0\.0/.test(text) && /Themed update window/.test(text));
  fs.writeFileSync(OUT + '/upd-window-available.png', (await upd.webContents.capturePage()).toPNG());

  // 2) "Skip this version" button → remembered, window closes
  await upd.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b => /Přeskočit|Skip/.test(b.textContent)).click()");
  await until(() => upd.isDestroyed());
  assert.ok(upd.isDestroyed(), 'window closed after answer');
  const saved = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  assert.equal(saved.skippedVersion, '99.0.0'); console.log('skip → stored + window closed ok');

  // 3) a foreign window can't answer for the update window
  const st2 = await settings.webContents.executeJavaScript('window.api.installUpdate()');
  const upd2 = await until(() => findWin('update.html'));
  await wait(800);
  settings.webContents.executeJavaScript("window.api.updateAnswer('install')");
  await wait(600);
  assert.ok(!upd2.isDestroyed(), 'answer from another window ignored');
  await upd2.webContents.executeJavaScript("window.api.updateAnswer('later')");
  await until(() => upd2.isDestroyed());
  console.log('only the update window may answer ok');

  // 4) hardening still in place
  const before = settings.webContents.getURL();
  await settings.webContents.executeJavaScript("location.href = 'https://example.com/'; 1");
  await wait(600);
  assert.equal(settings.webContents.getURL(), before, 'navigation blocked');
  console.log('navigation blocked ok');

  console.log('renderer/main errors:', errors.length ? errors : 'none');
  console.log(errors.length ? 'SMOKE UPDATE FAILED' : 'SMOKE UPDATE PASSED');
  srv.close(); app.exit(errors.length ? 1 : 0);
}).catch(e => { console.error('SMOKE UPDATE FAILED', e); app.exit(1); });
