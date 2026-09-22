// Runs the real Poller against a local fake Trading 212 server.
const http = require('http'); const os = require('os'); const fs = require('fs'); const path = require('path');
let mode = 'ok', calls = [];
const srv = http.createServer((req, res) => {
  calls.push(req.url + ' ' + req.headers.authorization);
  if (req.headers.authorization !== 'Basic ' + Buffer.from('KEY:SECRET').toString('base64')) { res.writeHead(401); return res.end('{"code":"Unauthorized"}'); }
  if (mode === '429') { res.writeHead(429, { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3) }); return res.end(); }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/v0/equity/account/summary') return res.end(JSON.stringify({ id: 42, currency: 'CZK', totalValue: 1284640.5, cash: { availableToTrade: 42180, reservedForOrders: 0, inPies: 0 }, investments: { currentValue: 1242460, totalCost: 1100000, realizedProfitLoss: 20000, unrealizedProfitLoss: 142460 } }));
  if (req.url === '/api/v0/equity/positions') return res.end(JSON.stringify([
    { instrument: { ticker: 'AAPL_US_EQ', name: 'Apple', isin: 'US0378331005', currency: 'USD' }, quantity: 10, currentPrice: 230, averagePricePaid: 180, walletImpact: { currency: 'CZK', totalCost: 40000, currentValue: 52000, unrealizedProfitLoss: 12000 } },
    { instrument: { ticker: 'VWCEd_EQ', name: 'Vanguard FTSE All-World', isin: 'IE00BK5BQT80', currency: 'EUR' }, quantity: 100, currentPrice: 130, averagePricePaid: 110, walletImpact: { currency: 'CZK', totalCost: 280000, currentValue: 330000, unrealizedProfitLoss: 50000 } }]));
  if (req.url.startsWith('/api/v0/equity/history/dividends') && mode === 'div403') { res.writeHead(403); return res.end('{"code":"Forbidden"}'); }
  if (req.url.startsWith('/api/v0/equity/history/dividends')) return res.end(JSON.stringify({ items: [
    { amount: 120.5, paidOn: new Date().toISOString(), ticker: 'AAPL_US_EQ' },
    { amount: 99, paidOn: '2020-01-01T00:00:00Z', ticker: 'AAPL_US_EQ' }], nextPagePath: '/api/v0/equity/history/dividends?cursor=1' }));
  res.writeHead(404); res.end();
});
srv.listen(0, async () => {
  process.env.T212_BASE = 'http://127.0.0.1:' + srv.address().port;
  const { Store } = require('../main/store'); const { Poller } = require('../main/t212');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-'));
  const store = new Store(dir, null);
  const p = new Poller({ store, fetchImpl: fetch });
  const assert = require('assert');
  // 1) first-run
  await p.cycle(); assert.equal(p.status, 'first-run'); console.log('first-run ok');
  // 2) wrong key → verify fails with 401
  try { await p.verify('live', { key: 'X', secret: 'Y' }); assert.fail(); } catch (e) { assert.equal(e.status, 401); console.log('verify 401 ok'); }
  // 3) good key
  const info = await p.verify('live', { key: 'KEY', secret: 'SECRET' }); assert.equal(info.currency, 'CZK');
  store.setCreds({ key: 'KEY', secret: 'SECRET' });
  store.set({ pauseWhenClosed: false });
  await p.cycle(); p.stop();
  let st = p.payload();
  assert.equal(st.status, 'live'); assert.equal(st.data.value, 1284640.5); assert.equal(st.data.positions[0].sym, 'VWCE');
  assert.equal(st.data.positions[1].sym, 'AAPL'); assert.equal(st.data.markets, 2); assert.equal(st.data.cash, 42180);
  assert.equal(Math.round(st.data.allTimePL), 162460);
  console.log('live ok', { value: st.data.value, dayAbs: st.data.dayAbs, allTimePct: st.data.allTimePct.toFixed(2), weights: st.data.positions.map(x => x.weight.toFixed(1)) });
  await new Promise(r => setTimeout(r, 300));
  assert.ok(Math.abs(p.raw.dividendsYTD - 120.5) < 1e-9, 'dividends ' + p.raw.dividendsYTD); console.log('dividends YTD ok', p.raw.dividendsYTD);
  // 3b) dividends forbidden → real error kept; recheck after fixing the key clears it
  mode = 'div403'; p.recheckDividends(); await new Promise(r => setTimeout(r, 300));
  st = p.payload(); assert.equal(st.divError.code, 403); assert.equal(st.divForbidden, true); console.log('dividends 403 ok', st.divError.message);
  mode = 'ok'; p.recheckDividends(); await new Promise(r => setTimeout(r, 300));
  st = p.payload(); assert.equal(st.divError, null); assert.equal(st.divForbidden, false); console.log('dividends recheck ok');
  // 4) 429 keeps last-known data + retryAt from header
  mode = '429'; await p.cycle(); p.stop(); st = p.payload();
  assert.equal(st.status, 'error'); assert.equal(st.error.kind, 'rate'); assert.ok(st.data && st.data.value === 1284640.5);
  assert.ok(st.error.retryAt - Date.now() < 5000); console.log('429 ok');
  // 5) revoked key → 401 auth error
  mode = 'ok'; store.setCreds({ key: 'KEY', secret: 'BAD' }); await p.cycle(); p.stop(); st = p.payload();
  assert.equal(st.error.kind, 'auth'); console.log('401 ok', st.error.message);
  // 6) network error
  store.setCreds({ key: 'KEY', secret: 'SECRET' }); process.env.T212_BASE = 'http://127.0.0.1:1'; await p.cycle(); p.stop(); st = p.payload();
  assert.equal(st.error.kind, 'network'); console.log('network ok');
  // 7) history persisted
  store.saveHistory(); const h = JSON.parse(fs.readFileSync(path.join(dir, 'history.json')));
  assert.equal(h.points.length, 1); assert.ok(h.last.summary); console.log('history ok');
  const { marketStatus } = require('../main/market'); console.log('market now:', marketStatus());
  console.log('Sat 12:00 UTC:', marketStatus(new Date('2026-09-26T12:00:00Z')));
  console.log('Tue 16:00 UTC:', marketStatus(new Date('2026-09-22T16:00:00Z')));
  console.log('ALL TESTS PASSED'); srv.close(); process.exit(0);
});
