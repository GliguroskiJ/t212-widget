// Smoke test: boots the real main process against a fake API, connects, captures windows.
const { app, BrowserWindow } = require('electron');
const path = require('path'); const fs = require('fs'); const http = require('http');
const OUT = process.env.SMOKE_OUT || '/tmp/claude-0/smoke';
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', fs.mkdtempSync('/tmp/claude-0/t212-ud-'));
let n = 0;
const srv = http.createServer((req, res) => {
  n++;
  res.setHeader('content-type', 'application/json');
  if (req.url.endsWith('/account/summary')) return res.end(JSON.stringify({ id: 7, currency: 'CZK', totalValue: 1284640.5 + n * 900, cash: { availableToTrade: 42180 }, investments: { currentValue: 1242460, totalCost: 1100000, realizedProfitLoss: 0, unrealizedProfitLoss: 142460 + n * 900 } }));
  if (req.url.endsWith('/equity/positions')) return res.end(JSON.stringify([{ instrument: { ticker: 'NVDA_US_EQ', name: 'NVIDIA Corp', currency: 'USD' }, quantity: 112, currentPrice: 180, averagePricePaid: 84.2, walletImpact: { totalCost: 140000, currentValue: 236410, unrealizedProfitLoss: 96410 } }]));
  if (req.url.includes('/history/dividends')) return res.end(JSON.stringify({ items: [{ reference: 'd1', amount: 120, paidOn: new Date().toISOString(), ticker: 'NVDA_US_EQ', instrument: { ticker: 'NVDA_US_EQ', name: 'NVIDIA Corp' } }], nextPagePath: null }));
  if (req.url.includes('/history/orders')) return res.end(JSON.stringify({ items: [{ order: { id: 1, side: 'BUY', type: 'MARKET', createdAt: new Date().toISOString(), instrument: { ticker: 'NVDA_US_EQ', name: 'NVIDIA Corp', currency: 'USD' } }, fill: { id: 2, price: 84.2, quantity: 112, filledAt: new Date().toISOString(), type: 'TRADE', walletImpact: { currency: 'CZK', netValue: 140000 } } }], nextPagePath: null }));
  if (req.url.includes('/history/transactions')) return res.end(JSON.stringify({ items: [{ reference: 't1', type: 'DEPOSIT', amount: 150000, currency: 'CZK', dateTime: new Date().toISOString() }], nextPagePath: null }));
  if (req.url.endsWith('/equity/orders')) return res.end('[]');
  if (req.url.endsWith('/equity/pies')) return res.end('[]');
  if (req.url.includes('/metadata/')) { res.writeHead(403); return res.end('{}'); }
  if (req.url.includes('/history/exports')) return res.end('[]');
  res.writeHead(404); res.end();
});
srv.listen(0, () => { process.env.T212_BASE = 'http://127.0.0.1:' + srv.address().port; require('../main/main.js'); });
const errors = [];
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (...a) => { const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] }; if (m.level === 'error' || m.level === 3) errors.push(m.message); }));
process.on('uncaughtException', e => { errors.push('MAIN ' + e.stack); });
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(2500);
  const wins = () => BrowserWindow.getAllWindows();
  const widget = wins().find(w => w.webContents.getURL().includes('widget.html'));
  fs.writeFileSync(OUT + '/1-firstrun.png', (await widget.webContents.capturePage()).toPNG());
  console.log('widget bounds (first run):', widget.getBounds());
  const r = await widget.webContents.executeJavaScript("window.api.connect({env:'live',key:'KEY',secret:'SECRET'})");
  console.log('connect →', r);
  await wait(3000);
  fs.writeFileSync(OUT + '/2-live.png', (await widget.webContents.capturePage()).toPNG());
  await widget.webContents.executeJavaScript("window.api.setSettings({size:'large', largeView:'positions'})");
  await wait(1500);
  console.log('widget bounds (large):', widget.getBounds());
  fs.writeFileSync(OUT + '/3-large.png', (await widget.webContents.capturePage()).toPNG());
  await widget.webContents.executeJavaScript("window.api.openSettings('appearance')");
  await wait(2500);
  const sw = wins().find(w => w.webContents.getURL().includes('app.html'));
  fs.writeFileSync(OUT + '/4-settings.png', (await sw.webContents.capturePage()).toPNG());
  for (const r of ['overview', 'activity/orders', 'activity/transactions', 'holdings', 'pies', 'orders', 'reports']) {
    sw.webContents.send('app-goto', r); await wait(1200);
    fs.writeFileSync(OUT + '/app-' + r.replace('/', '_') + '.png', (await sw.webContents.capturePage()).toPNG());
  }
  const st = await sw.webContents.executeJavaScript("window.api.lib('status')");
  console.log('lib status:', Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v && v.state ? v.state + (v.count != null ? ':' + v.count : '') : v])));
  console.log('stats:', JSON.stringify((await sw.webContents.executeJavaScript("window.api.lib('stats')")).cash));
  console.log('widget may not call lib:', JSON.stringify(await widget.webContents.executeJavaScript("window.api.lib('stats')")));
  await sw.webContents.executeJavaScript("window.api.setSettings({theme:'indigo', size:'small'})");
  await wait(1500);
  fs.writeFileSync(OUT + '/5-small-indigo.png', (await widget.webContents.capturePage()).toPNG());
  const ud = app.getPath('userData');
  console.log('files:', fs.readdirSync(ud).filter(f => !/^(Cache|Code|GPU|Local|Session|Shared|Dawn|Network|blob|Crash|DawnGraphite|Preferences|Dictionaries|Trust)/.test(f)));
  console.log('settings.json:', JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'))));
  console.log('requests served:', n, '| renderer/main errors:', errors.length ? errors : 'none');
  app.exit(0);
});
