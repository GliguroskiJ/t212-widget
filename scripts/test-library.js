// Library (history sync, pies, orders, exports, metadata) against a local fake Trading 212 server.
const http = require('http'); const os = require('os'); const fs = require('fs'); const path = require('path');
const assert = require('assert');

const AUTH = 'Basic ' + Buffer.from('KEY:SECRET').toString('base64');
const DAY = 86400e3;
const now = Date.now();
let orders = [], dividends = [], txs = [];
let calls = [], mode = {}, posts = [], all = [];
const iso = t => new Date(t).toISOString();

function mkOrder(i, t) {
  return { order: { id: 1000 + i, side: i % 3 ? 'BUY' : 'SELL', type: 'MARKET', status: 'FILLED', createdAt: iso(t), filledQuantity: 2, filledValue: 200,
    instrument: { ticker: i % 2 ? 'AAPL_US_EQ' : 'VWCEd_EQ', name: i % 2 ? 'Apple' : 'Vanguard FTSE All-World', isin: 'X' + i, currency: 'USD' }, ticker: i % 2 ? 'AAPL_US_EQ' : 'VWCEd_EQ' },
    fill: { id: 5000 + i, filledAt: iso(t), price: 100 + i, quantity: 2, type: 'TRADE', walletImpact: { currency: 'CZK', fxRate: 23, netValue: 4600, realisedProfitLoss: i % 3 ? 0 : 50, taxes: [{ name: 'FX', quantity: 1.5, currency: 'CZK' }] } } };
}
for (let i = 0; i < 120; i++) orders.push(mkOrder(i, now - i * DAY));
for (let i = 0; i < 30; i++) dividends.push({ reference: 'D' + i, amount: 10, paidOn: iso(now - i * 20 * DAY), ticker: 'AAPL_US_EQ', instrument: { ticker: 'AAPL_US_EQ', name: 'Apple' }, quantity: 5, grossAmountPerShare: 0.25, type: 'ORDINARY' });
for (let i = 0; i < 7; i++) txs.push({ reference: 'T' + i, amount: i === 3 ? -500 : 1000, type: i === 3 ? 'WITHDRAW' : i === 5 ? 'INTEREST_ON_FREE_CASH' : 'DEPOSIT', currency: 'CZK', dateTime: iso(now - i * 40 * DAY) });

function page(list, url) {
  const u = new URL(url, 'http://x');
  const limit = Number(u.searchParams.get('limit') || 20);
  const cursor = Number(u.searchParams.get('cursor') || 0);
  const items = list.slice(cursor, cursor + limit);
  const next = cursor + limit < list.length ? `${u.pathname}?limit=${limit}&cursor=${cursor + limit}` : null;
  return { items, nextPagePath: next };
}

const srv = http.createServer((req, res) => {
  calls.push(req.method + ' ' + req.url); all.push(req.method + ' ' + req.url.split('?')[0]);
  if (req.headers.authorization !== AUTH) { res.writeHead(401); return res.end('{}'); }
  const p = req.url.split('?')[0];
  if (mode.forbid && p.includes(mode.forbid)) { res.writeHead(403); return res.end('{"code":"Forbidden"}'); }
  if (mode.rate429 && p.includes('/history/orders')) { mode.rate429--; res.writeHead(429, { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000)) }); return res.end(); }
  if (mode.failAt && p.includes('/history/orders') && req.url.includes('cursor=' + mode.failAt)) { mode.failAt = 0; res.writeHead(500); return res.end('boom'); }
  res.setHeader('content-type', 'application/json');
  const j = x => res.end(JSON.stringify(x));
  if (p === '/api/v0/equity/history/orders') return j(page(orders, req.url));
  if (p === '/api/v0/equity/history/dividends') return j(page(dividends, req.url));
  if (p === '/api/v0/equity/history/transactions') return j(page(txs, req.url));
  if (p === '/api/v0/equity/orders') return j([{ id: 9, type: 'LIMIT', side: 'BUY', status: 'NEW', quantity: 3, limitPrice: 99.5, createdAt: iso(now), ticker: 'AAPL_US_EQ', instrument: { ticker: 'AAPL_US_EQ', name: 'Apple' }, timeInForce: 'GOOD_TILL_CANCEL' }]);
  if (p === '/api/v0/equity/pies') return j([{ id: 7, cash: 12, progress: 0.4, status: 'AHEAD', result: { priceAvgInvestedValue: 1000, priceAvgValue: 1100, priceAvgResult: 100, priceAvgResultCoef: 0.1 }, dividendDetails: { gained: 5, inCash: 1, reinvested: 4 } }]);
  if (p === '/api/v0/equity/pies/7') return j({ settings: { id: 7, name: 'Dividendy', icon: 'Coins', goal: 5000, creationDate: iso(now - 100 * DAY) },
    instruments: [{ ticker: 'AAPL_US_EQ', currentShare: 0.6, expectedShare: 0.5, ownedQuantity: 2, result: { priceAvgValue: 660 }, issues: [] }, { ticker: 'VWCEd_EQ', currentShare: 0.4, expectedShare: 0.5, ownedQuantity: 3, result: { priceAvgValue: 440 }, issues: [{ name: 'DELISTED', severity: 'IRREVERSIBLE' }] }] });
  if (p === '/api/v0/equity/metadata/instruments') return j([{ ticker: 'AAPL_US_EQ', name: 'Apple Inc', shortName: 'AAPL', isin: 'US0378331005', currencyCode: 'USD', type: 'STOCK', workingScheduleId: 1 },
    { ticker: 'APLE_US_EQ', name: 'Apple Hospitality', shortName: 'APLE', isin: 'US03784Y2000', currencyCode: 'USD', type: 'STOCK', workingScheduleId: 1 }]);
  if (p === '/api/v0/equity/metadata/exchanges') return j([{ id: 1, name: 'NASDAQ', workingSchedules: [{ id: 1, timeEvents: [{ date: iso(now - 3600e3), type: 'OPEN' }, { date: iso(now + 3600e3), type: 'CLOSE' }] }] }]);
  if (p === '/api/v0/equity/history/exports' && req.method === 'POST') {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => { posts.push(JSON.parse(b)); j({ reportId: 77 }); }); return;
  }
  if (p === '/api/v0/equity/history/exports') return j([{ reportId: 77, status: 'Finished', timeFrom: iso(now - 30 * DAY), timeTo: iso(now), downloadLink: 'https://example.com/r.csv', dataIncluded: { includeOrders: true } },
    { reportId: 76, status: 'Failed', timeFrom: iso(now - 30 * DAY), timeTo: iso(now), downloadLink: 'http://insecure/r.csv' }]);
  res.writeHead(404); res.end();
});

srv.listen(0, async () => {
  process.env.T212_BASE = 'http://127.0.0.1:' + srv.address().port;
  const { Store } = require('../main/store');
  const { Library } = require('../main/library');
  const { Limiter } = require('../main/limiter');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212lib-'));
  const store = new Store(dir, null);
  store.setCreds({ key: 'KEY', secret: 'SECRET' });
  const fast = () => new Limiter({ intervals: Object.fromEntries(['hOrders', 'hDividends', 'hTransactions', 'orders', 'pies', 'pie', 'instruments', 'exchanges', 'exportsList', 'exportsRequest'].map(k => [k, 0])) });
  let lib = new Library({ store, fetchImpl: fetch, limiter: fast() });
  lib.setAccount('live', 42);

  // 1) first full sync, paginated (120 orders = 3 pages of 50)
  const events = [];
  lib.on('change', e => events.push(e.what));
  await lib.sync();
  assert.equal(lib.data.orders.length, 120);
  assert.equal(lib.data.dividends.length, 30);
  assert.equal(lib.data.transactions.length, 7);
  assert.ok(lib.data.complete.orders && lib.data.complete.dividends);
  assert.equal(calls.filter(c => c.includes('/history/orders')).length, 3);
  assert.ok(events.includes('orders') && events.includes('sync-done'));
  const o0 = lib.data.orders[0];
  assert.equal(o0.sym, 'VWCE'); assert.equal(o0.fees, 1.5); assert.equal(o0.value, 4600); assert.equal(o0.side, 'SELL'); assert.equal(o0.realized, 50);
  console.log('full sync ok', lib.statusPayload().orders);

  // 2) incremental: two new orders → only the first page is fetched
  calls = [];
  orders.unshift(mkOrder(200, now + 1000), mkOrder(201, now + 2000));
  orders.sort((a, b) => Date.parse(b.fill.filledAt) - Date.parse(a.fill.filledAt));
  await lib.sync(['orders']);
  assert.equal(lib.data.orders.length, 122);
  assert.equal(calls.length, 1);
  assert.equal(lib.data.orders[0].id, 1201);
  console.log('incremental ok');

  // 3) persisted + reloaded; a different account wipes it
  lib.save();
  let lib2 = new Library({ store, fetchImpl: fetch, limiter: fast() });
  assert.equal(lib2.data.orders.length, 122);
  assert.equal(lib2.setAccount('live', 42), false);
  assert.equal(lib2.setAccount('demo', 42), true);
  assert.equal(lib2.data.orders.length, 0);
  console.log('persist/account ok');

  // 4) interrupted first download resumes from the saved cursor
  calls = [];
  mode.failAt = 100;
  await lib2.sync(['orders']);
  assert.equal(lib2.status.orders.state, 'error');
  assert.equal(lib2.data.orders.length, 100);
  assert.ok(lib2.data.cursor.orders && !lib2.data.complete.orders);
  calls = [];
  await lib2.sync(['orders']);
  assert.equal(lib2.data.orders.length, 122);
  assert.ok(lib2.data.complete.orders);
  assert.equal(lib2.status.orders.state, 'done');
  // head page (all known → stop) + the missing tail page
  assert.equal(calls.length, 2, calls.join('\n'));
  console.log('resume ok');

  // 5) 429 → waits for reset and retries
  mode.rate429 = 1; calls = [];
  orders.unshift(mkOrder(300, now + 5000));
  await lib2.sync(['orders']);
  assert.equal(lib2.data.orders.length, 123);
  assert.equal(calls.length, 2);
  console.log('429 retry ok');

  // 6) 403 for one scope → 'forbidden', others still sync
  mode.forbid = '/history/transactions';
  const lib3 = new Library({ store, fetchImpl: fetch, limiter: fast(), dir: fs.mkdtempSync(path.join(os.tmpdir(), 't212lib3-')) });
  lib3.setAccount('live', 1);
  await lib3.sync();
  assert.equal(lib3.status.transactions.state, 'forbidden');
  assert.equal(lib3.status.dividends.state, 'done');
  mode.forbid = null;
  console.log('403 scope ok');

  // 7) stats + dividends YTD
  const st = lib.stats();
  assert.equal(st.dividends.total, 300);
  assert.equal(st.cash.deposits, 5000); assert.equal(st.cash.withdrawals, 500); assert.equal(st.cash.interest, 1000); assert.equal(st.cash.net, 4500);
  assert.equal(st.orders.count, 122);
  const yStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  assert.equal(lib.dividendsSince(yStart), dividends.filter(d => Date.parse(d.paidOn) >= yStart).length * 10);
  assert.equal(lib.activity({ kind: 'orders', ticker: 'AAPL_US_EQ' }).total, lib.data.orders.filter(o => o.ticker === 'AAPL_US_EQ').length);
  assert.equal(lib.activity({ kind: 'transactions', type: 'DEPOSIT' }).total, 5);
  assert.equal(lib.activity({ kind: 'orders', q: 'apple', limit: 5 }).items.length, 5);
  console.log('stats ok', { ytd: lib.dividendsSince(yStart) });

  // 8) pending, pies, metadata, search, hours, instrument, exports
  const pend = await lib.pending();
  assert.equal(pend[0].limitPrice, 99.5); assert.equal(pend[0].sym, 'AAPL');
  let pies = await lib.pies();
  assert.equal(pies[0].resultPct.toFixed(1), '10.0');
  await new Promise(r => setTimeout(r, 100));
  pies = lib.piesPayload();
  assert.equal(pies[0].name, 'Dividendy'); assert.equal(pies[0].count, 2);
  assert.ok(await lib.loadMetadata());
  const pie = await lib.pieDetail(7);
  assert.equal(pie.instruments[0].name, 'Apple Inc'); assert.equal(pie.instruments[1].issues[0].name, 'DELISTED');
  const found = lib.search('apple', ['APLE_US_EQ']);
  assert.equal(found[0].ticker, 'APLE_US_EQ'); assert.equal(found.length, 2);
  assert.equal(lib.search('AAPL')[0].ticker, 'AAPL_US_EQ');
  const ins = lib.instrument('AAPL_US_EQ');
  assert.equal(ins.hours.exchange, 'NASDAQ'); assert.equal(ins.hours.open, true);
  assert.ok(ins.orders.length > 0 && ins.dividendTotal === 300 && ins.pending.length === 1);
  const ex = await lib.exportsList();
  assert.equal(ex[0].id, 77);
  assert.ok(lib.exportLink(77)); assert.equal(lib.exportLink(76), null);
  const rq = await lib.requestExport({ from: now - 10 * DAY, to: now, interest: false });
  assert.equal(rq.id, 77); assert.equal(posts[0].dataIncluded.includeInterest, false); assert.ok(posts[0].timeFrom.endsWith('Z'));
  await assert.rejects(lib.requestExport({ from: now, to: now - 1 }));
  console.log('pending/pies/meta/exports ok');

  // 9b) logos: fetched once, cached on disk, misses remembered
  let logoCalls = 0;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 1)]);
  const lf = async u => { logoCalls++; return u.includes('AAPL') ? new Response(png, { headers: { 'content-type': 'image/png' } }) : new Response('no', { status: 403 }); };
  const ldir = fs.mkdtempSync(path.join(os.tmpdir(), 't212logo-'));
  const ll = new Library({ store, fetchImpl: lf, limiter: fast(), dir: ldir });
  let lg = await ll.logos(['AAPL_US_EQ', 'NOPE_US_EQ', '../evil']);
  assert.ok(lg.AAPL_US_EQ.startsWith('data:image/png;base64,')); assert.equal(lg.NOPE_US_EQ, null); assert.equal(lg['../evil'], null);
  assert.equal(logoCalls, 2);
  const ll2 = new Library({ store, fetchImpl: lf, limiter: fast(), dir: ldir });
  lg = await ll2.logos(['AAPL_US_EQ', 'NOPE_US_EQ']);
  assert.ok(lg.AAPL_US_EQ); assert.equal(logoCalls, 2);
  console.log('logos ok');

  // 9) limiter spacing really spaces calls per key, keys are independent
  const L = new Limiter({ intervals: { a: 60, b: 0 } });
  const t0 = Date.now(); const times = [];
  await Promise.all([1, 2, 3].map(() => L.run('a', async () => times.push(Date.now() - t0))));
  assert.ok(times[1] >= 55 && times[2] >= 115, times.join(','));
  console.log('limiter ok', times);

  // 10) the read-only promise: no write endpoint was ever called
  const writes = all.filter(c => !c.startsWith('GET '));
  assert.deepEqual([...new Set(writes)], ['POST /api/v0/equity/history/exports']);
  srv.close();
  console.log('LIBRARY TESTS PASSED');
});
