// Full-history rebuild: replaying trades and cash backwards must land exactly on today's numbers
// and give the right value on past days.
const assert = require('assert');
const { rebuild, snap } = require('../main/fullhistory');
const DAY = 86400e3;
const now = Date.UTC(2026, 9, 21, 12);
const t0 = now - 100 * DAY;
// deposit 1000 on day 0; buy 10 × 50 (USD price, fx 20 → 10 000 CZK? keep fx 2: value 1000) on day 1;
// price doubles linearly to 100 by today; sell 2 shares on day 80 at 90 → +360
const deposits = [{ type: 'DEPOSIT', amount: 1000, time: t0 }];
const orders = [
  { ticker: 'X_US_EQ', side: 'BUY', qty: 10, price: 50, value: 1000, time: t0 + DAY, fillType: 'TRADE' },
  { ticker: 'X_US_EQ', side: 'SELL', qty: 2, price: 90, value: 360, time: t0 + 80 * DAY, fillType: 'TRADE' }
];
const px = t => 50 + 50 * Math.min(1, Math.max(0, (t - t0) / (now - t0)));
const pts = []; for (let t = t0 - 5 * DAY; t <= now; t += DAY / 2) pts.push([t, px(t) * 100]);   // Yahoo quotes in "pence" (×100)
const summary = { totalValue: 360 + 8 * 100 * 2, investments: { unrealizedProfitLoss: 8 * (100 - 50) * 2, realizedProfitLoss: 2 * (90 - 50) * 2 } };
const positions = [{ instrument: { ticker: 'X_US_EQ' }, quantity: 8, currentPrice: 100, walletImpact: { currentValue: 1600 } }];
(async () => {
  const out = await rebuild({ orders, transactions: deposits, dividends: [], positions, summary, until: now - DAY, now, prices: async () => pts });
  assert.ok(out.length > 90, 'daily points');
  const at = t => out.reduce((b, p) => (Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b));
  // day 0 (after deposit, before buy): 1000 cash
  assert.ok(Math.abs(at(t0 + 0.4 * DAY)[1] - 1000) < 1, 'start = deposit ' + at(t0 + 0.4 * DAY)[1]);
  // day 50: 10 shares at px, cash 0
  const d50 = at(t0 + 50 * DAY);
  assert.ok(Math.abs(d50[1] - 10 * px(d50[0]) * 2) < 25, 'mid value ' + d50[1] + ' vs ' + 10 * px(d50[0]) * 2);
  // P/L = NAV − deposits (Trading 212's P/L today 960 = 1960 − 1000, so no shift)
  assert.ok(Math.abs(d50[2] - (d50[1] - 1000)) < 1e-6, 'pl');
  assert.equal(snap(98), 100); assert.equal(snap(0.011), 0.01); assert.equal(snap(1.1), 1);
  console.log('FULL HISTORY TESTS PASSED', { points: out.length, first: Math.round(out[0][1]), d50: Math.round(d50[1]) });
})().catch(e => { console.error(e); process.exit(1); });
