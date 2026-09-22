// Backfill reconstruction against a fake Yahoo endpoint
const assert = require('assert');
const { reconstruct, candidates } = require('../main/backfill');
assert.deepEqual(candidates('AAPL_US_EQ'), ['AAPL']);
assert.deepEqual(candidates('VUAGl_EQ'), ['VUAG.L']);
assert.deepEqual(candidates('BRK.B_US_EQ'), ['BRK-B']);
assert.deepEqual(candidates('VWCEd_EQ'), ['VWCE.DE']);
const now = Date.now(), from = now - 3 * 3600e3;
const mk = (sym, p0, p1, scale) => {
  const ts = [], close = [];
  for (let t = from - 3600e3; t <= now; t += 300e3) { ts.push(Math.floor(t / 1000)); close.push((p0 + (p1 - p0) * (t - from + 3600e3) / (now - from + 3600e3)) * scale); }
  return { chart: { result: [{ meta: { regularMarketPrice: close[close.length - 1], symbol: sym }, timestamp: ts, indicators: { quote: [{ close }] } }], error: null } };
};
const calls = [];
const fakeFetch = async url => {
  calls.push(url);
  const body = url.includes('/chart/AAPL?') ? mk('AAPL', 200, 230, 1)
    : url.includes('/chart/VUAG.L?') ? mk('VUAG.L', 90, 100, 100)     // GBX pence
    : url.includes('/search?') ? { quotes: [] } : null;
  return body ? { ok: true, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
};
(async () => {
  const summary = { totalValue: 100000, investments: { unrealizedProfitLoss: 5000, realizedProfitLoss: 0 } };
  const positions = [
    { instrument: { ticker: 'AAPL_US_EQ', isin: 'US0378331005' }, currentPrice: 230, walletImpact: { currentValue: 60000 } },
    { instrument: { ticker: 'VUAGl_EQ', isin: 'IE00BFMXXD54' }, currentPrice: 100, walletImpact: { currentValue: 30000 } }
  ];
  const cache = {};
  const pts = await reconstruct({ fetchImpl: fakeFetch, summary, positions, from, to: now, symbolCache: cache });
  assert.ok(pts.length > 20, 'points ' + pts.length);
  assert.ok(pts.every(p => p[0] > from && p[0] < now));
  const first = pts[0][1], last = pts[pts.length - 1][1];
  // at "from" AAPL ≈ 207.5/230, VUAG ≈ 92.5/100 → NAV ≈ 10000 + 60000*0.902 + 30000*0.925
  console.log('first', first.toFixed(0), 'last', last.toFixed(0), 'n', pts.length, 'cache', cache);
  assert.ok(first > 90000 && first < 93000, 'first nav');
  assert.ok(last > 99000 && last <= 100000.01, 'last nav');
  assert.equal(cache['VUAGl_EQ'], 'VUAG.L');
  // unknown ticker → falls back to ISIN search and gives up gracefully
  const pts2 = await reconstruct({ fetchImpl: fakeFetch, summary, positions: [{ instrument: { ticker: 'XYZ_US_EQ', isin: 'X' }, currentPrice: 1, walletImpact: { currentValue: 90000 } }], from, to: now, symbolCache: {} });
  assert.equal(pts2.length, 0);
  console.log('BACKFILL TESTS PASSED');
})();
