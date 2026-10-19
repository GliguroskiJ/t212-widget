'use strict';
// Trading 212 rate limits are per account and per endpoint (docs, Oct 2026). Every call made by
// the app goes through one queue per endpoint, spaced by its limit; a 429 waits until the reset
// time Trading 212 sends back and tries again (max 3×).

const INTERVALS = {
  summary: 5200,          // 1 / 5 s
  positions: 1100,        // 1 / 1 s
  orders: 5200,           // pending orders, 1 / 5 s
  order: 1100,            // single order, 1 / 1 s
  hOrders: 3100,          // history: 20 / min each
  hDividends: 3100,
  hTransactions: 3100,
  exportsList: 61000,     // 1 / min
  exportsRequest: 31000,  // 1 / 30 s
  pies: 31000,            // 1 / 30 s
  pie: 5200,              // 1 / 5 s
  instruments: 51000,     // 1 / 50 s
  exchanges: 31000        // 1 / 30 s
};

class Limiter {
  constructor({ intervals, sleep, now } = {}) {
    this.intervals = { ...INTERVALS, ...(intervals || {}) };
    this.sleep = sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this.now = now || Date.now;
    this.last = {};     // key → time of last call start
    this.chain = {};    // key → promise tail
  }

  // earliest time the next call for `key` may start (used to tell the UI how long to wait)
  readyAt(key) { return (this.last[key] || 0) + (this.intervals[key] || 0); }

  run(key, fn) {
    const prev = this.chain[key] || Promise.resolve();
    const task = prev.catch(() => {}).then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.readyAt(key) - this.now();
        if (wait > 0) await this.sleep(wait);
        this.last[key] = this.now();
        try { return await fn(); }
        catch (e) {
          if (e && e.status === 429 && attempt < 3) {
            const until = e.retryAt || this.now() + 30e3;
            await this.sleep(Math.max(1000, Math.min(120e3, until - this.now())));
            continue;
          }
          throw e;
        }
      }
    });
    this.chain[key] = task;
    return task;
  }
}

module.exports = { Limiter, INTERVALS };
