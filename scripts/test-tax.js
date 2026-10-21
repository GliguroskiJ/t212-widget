// Czech tax overview: FIFO lots, 3-year time test, 100 000 Kč value test, dividend withholding credit.
const assert = require('assert');
const { compute } = require('../main/tax');
const T = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
const o = (side, qty, value, time, ticker = 'AAPL_US_EQ') => ({ side, qty, value, time, ticker, sym: ticker.split('_')[0], name: ticker, fillType: 'TRADE' });
const orders = [
  o('BUY', 10, 20000, T(2021, 3, 1)),        // lot A (old → time test)
  o('BUY', 10, 30000, T(2024, 6, 1)),        // lot B (young)
  o('SELL', 15, 60000, T(2025, 5, 10)),      // 10 from A (exempt by time) + 5 from B (taxable)
  o('BUY', 4, 80000, T(2023, 12, 1), 'MSFT_US_EQ'),
  o('SELL', 1, 25000, T(2025, 8, 1), 'MSFT_US_EQ')
];
const dividends = [
  { ticker: 'AAPL_US_EQ', isin: 'US0378331005', amount: 850, time: T(2025, 2, 1) },     // net after 15 %
  { ticker: 'CEZ_CZ_EQ', isin: 'CZ0005112300', amount: 1700, time: T(2025, 7, 1) },
  { ticker: 'SAP_DE_EQ', isin: 'DE0007164600', amount: 736.25, time: T(2025, 5, 1) }   // net after 26.375 %
];
const transactions = [{ type: 'INTEREST_ON_FREE_CASH', amount: 12.5, time: T(2025, 1, 2) }, { type: 'DEPOSIT', amount: 5000, time: T(2025, 1, 2) }];
const r = compute({ orders, dividends, transactions, positions: [{ instrument: { ticker: 'AAPL_US_EQ' }, quantity: 5, walletImpact: { currentValue: 22000 } }], year: 2025, now: T(2025, 12, 1) });
// gross 85 000 ≤ 100 000 → everything exempt by the value test
assert.equal(r.sales.gross, 85000); assert.equal(r.sales.valueTest, true); assert.equal(r.sales.taxBase, 0);
assert.ok(r.sales.rows.every(x => x.status === 'value'));
// above the limit: only the young lots are taxable
const r2 = compute({ orders: orders.concat([o('SELL', 1, 30000, T(2025, 9, 1), 'MSFT_US_EQ')]), dividends: [], transactions: [], positions: [], year: 2025, now: T(2025, 12, 1) });
assert.equal(r2.sales.valueTest, false);
const st = r2.sales.rows.map(x => x.sym + ':' + x.status + ':' + x.qty).sort();
assert.deepEqual(st, ['AAPL:taxable:5', 'AAPL:time:10', 'MSFT:taxable:1', 'MSFT:taxable:1']);
// taxable: AAPL 5 × (4000 − 3000) = 5000; MSFT (25000 − 20000) + (30000 − 20000) = 15000
assert.equal(Math.round(r2.sales.profit), 20000);
// dividends: US gross 1000, 150 withheld, credit 150 → 0 to pay; DE gross 1000, credit capped at 150 → 0; CZ out of the return
assert.equal(Math.round(r.dividends.gross), 2000);
assert.equal(Math.round(r.dividends.credit), 300);
assert.equal(Math.round(r.dividends.tax), 0);
assert.equal(r.dividends.domesticNet, 1700);
assert.equal(r.interest, 12.5);
// remaining 5 shares of lot B become exempt on 1 June 2027 → not within 12 months of Dec 2025
assert.equal(r.soon.length, 0);
const r3 = compute({ orders, dividends: [], transactions: [], positions: [{ instrument: { ticker: 'AAPL_US_EQ' }, quantity: 5, walletImpact: { currentValue: 22000 } }], year: 2026, now: T(2026, 9, 1) });
assert.equal(r3.soon.length, 1); assert.equal(r3.soon[0].qty, 5); assert.equal(Math.round(r3.soon[0].gain), 7000);
console.log('TAX TESTS PASSED');
