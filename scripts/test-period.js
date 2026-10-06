// Change over the selected chart range (1D / 1W / 1M / 1Y / ALL) and the chart series format.
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
const { Store } = require('../main/store'); const { Poller } = require('../main/t212');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-period-'));
const store = new Store(dir, null);
const p = new Poller({ store, fetchImpl: fetch });
const DAY = 86400e3, now = Date.now();
const sod = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();

// history: [time, value, P/L, estimated?]
// 20 days ago value 100 000 / P/L 5 000; 8 days ago P/L 7 000; 3 days ago a 50 000 deposit (value jumps, P/L doesn't);
// yesterday evening P/L 9 000; now P/L 9 600
store.history.points = [
  [now - 20 * DAY, 100000, 5000, 1],
  [now - 8 * DAY, 102000, 7000],
  [now - 3 * DAY, 153000, 8000],
  [sod - 3600e3, 154000, 9000],
  [now - 60e3, 154600, 9600]
];
store.history.dayBase = { date: 'x', pl: 9000, value: 154000 };
const pl = 9600, value = 154600;

const d1 = p.period('1D', pl, value, 7);
assert.equal(d1.range, '1D'); assert.equal(d1.abs, 600); assert.equal(d1.partial, false);
assert.equal(d1.pct.toFixed(4), (600 / 154000 * 100).toFixed(4));

const w = p.period('1W', pl, value, 7);
assert.equal(w.abs, 2600, 'week change = P/L now − P/L 8 days ago (deposit excluded)');
assert.equal(w.partial, false);
assert.equal(w.pct.toFixed(4), (2600 / (154600 - 2600) * 100).toFixed(4));

const m = p.period('1M', pl, value, 7);
assert.equal(m.abs, 4600, 'month: history starts 20 days ago → measured from the oldest point');
assert.equal(m.partial, true); assert.equal(m.from, now - 20 * DAY);

const all = p.period('ALL', pl, value, 7.25);
assert.equal(all.abs, 9600); assert.equal(all.pct, 7.25); assert.equal(all.basePl, 0);

// payload carries the period of the selected range, converted with fx
store.set({ range: '1W' });
const s = p.series('1W', 1);
assert.ok(s.every(q => q.length === 4), 'series = [t, value, pl, est]');
assert.equal(s[s.length - 1][2], 9600);

// empty history must not crash
store.history.points = [];
const e = p.period('1M', 1, 1, 0);
assert.equal(e.abs, 0); assert.equal(e.partial, true);
console.log('PERIOD TESTS PASSED', { d1: d1.abs, w: w.abs, m: m.abs, mPartial: m.partial, all: all.abs });
