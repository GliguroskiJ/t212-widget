'use strict';
// Trading 212 public API client + polling loop.
// Docs: https://docs.trading212.com/api  (Basic auth with API key + secret)
const { EventEmitter } = require('events');
const { marketStatus } = require('./market');
const { reconstruct } = require('./backfill');

const BASES = {
  live: 'https://live.trading212.com',
  demo: 'https://demo.trading212.com'
};

class ApiError extends Error {
  constructor(status, message, retryAt) {
    super(message);
    this.status = status;
    this.retryAt = retryAt || null;
  }
}

function baseFor(env) {
  return process.env.T212_BASE || BASES[env] || BASES.live;
}

async function apiGet(fetchImpl, env, creds, pathAndQuery) {
  const url = baseFor(env) + (pathAndQuery.startsWith('/api/') ? pathAndQuery : '/api/v0' + pathAndQuery);
  const auth = 'Basic ' + Buffer.from(`${creds.key}:${creds.secret}`).toString('base64');
  let res;
  try {
    res = await fetchImpl(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  } catch (e) {
    throw new ApiError(0, 'Network error — ' + (e && e.message ? e.message : 'no connection'));
  }
  if (res.status === 429) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const retryAt = reset > 1e9 ? reset * 1000 + 500 : Date.now() + 30e3;
    throw new ApiError(429, 'Too Many Requests', retryAt);
  }
  if (!res.ok) {
    let text = '';
    try { text = (await res.text()).slice(0, 200); } catch {}
    const label = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found' }[res.status] || 'HTTP error';
    throw new ApiError(res.status, `${res.status} ${label}${text ? ' — ' + text : ''}`);
  }
  return res.json();
}

// "AAPL_US_EQ" → "AAPL", "VWCEd_EQ" → "VWCE"
function shortTicker(t) {
  return String(t || '').replace(/_EQ$/, '').replace(/_[A-Z]{2}$/, '').replace(/[a-z]+$/, '') || String(t || '');
}
const EXCH_LETTER = { d: 'DE', l: 'GB', p: 'FR', a: 'NL', e: 'ES', m: 'IT', s: 'CH', b: 'BE', i: 'IE', v: 'AT', h: 'HK' };
function marketOf(t) {
  let m = /_([A-Z]{2})_EQ$/.exec(t || '');
  if (m) return m[1];
  m = /([a-z])_EQ$/.exec(t || '');
  if (m) return EXCH_LETTER[m[1]] || m[1];
  return 'OTHER';
}

function localDate(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
const RANGE_MS = { '1W': 7 * 86400e3, '1M': 30 * 86400e3, '1Y': 365 * 86400e3 };
function rangeStart(range, now = Date.now()) {
  if (range === 'ALL') return 0;
  return RANGE_MS[range] ? now - RANGE_MS[range] : startOfToday();
}

function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const out = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

class Poller extends EventEmitter {
  constructor({ store, fetchImpl }) {
    super();
    this.store = store;
    this.fetch = fetchImpl || fetch;
    this.timer = null;
    this.busy = false;
    this.status = 'loading';
    this.error = null;
    this.lastSync = store.history.last ? store.history.last.t : null;
    this.raw = store.history.last || null;       // {summary, positions, dividendsYTD, t}
    this.divFetchedAt = 0;
    this.divRunning = false;
    this.fx = { pair: null, rate: 1, at: 0 };
    this.nextRetryAt = null;
    this.lastCycleAt = 0;
    this.market = marketStatus(new Date(), this.marketCodes());
  }

  marketCodes() {
    const pos = (this.raw && this.raw.positions) || [];
    return [...new Set(pos.map(p => marketOf(p.instrument && p.instrument.ticker)).filter(c => c !== 'OTHER'))];
  }

  // called every minute by main: keeps "opens in" fresh and wakes the loop when a market opens
  tick() {
    const was = this.market && this.market.open;
    this.market = marketStatus(new Date(), this.marketCodes());
    if (!was && this.market.open && this.status === 'closed') this.refreshNow();
    else this.emitState();
  }

  creds() { return this.store.getCreds(); }
  env() { return this.store.get('env'); }

  start() { this.cycle(); }
  stop() { clearTimeout(this.timer); this.timer = null; }

  refreshNow() {
    // summary is limited to 1 req / 5 s — never hammer it
    const wait = Math.max(0, 5200 - (Date.now() - this.lastCycleAt));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.cycle(), wait);
  }

  resetForNewAccount() {
    this.stop();
    this.raw = null;
    this.lastSync = null;
    this.divFetchedAt = 0;
    this.divError = null;
    this.store.history = { points: [], dayBase: null, posHist: {}, last: null };
    this.store.saveHistory();
    this.status = 'loading';
    this.error = null;
    this.emitState();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.cycle(), Math.max(1000, ms));
  }

  async verify(env, creds) {
    const summary = await apiGet(this.fetch, env, creds, '/equity/account/summary');
    return { currency: summary.currency, id: summary.id, totalValue: summary.totalValue };
  }

  async cycle() {
    clearTimeout(this.timer);
    this.market = marketStatus(new Date(), this.marketCodes());
    const creds = this.creds();
    if (!creds) {
      this.status = 'first-run';
      this.error = null;
      this.emitState();
      return;
    }
    if (this.busy) return;
    this.busy = true;
    this.lastCycleAt = Date.now();
    const settings = this.store.all();
    try {
      const summary = await apiGet(this.fetch, settings.env, creds, '/equity/account/summary').catch(e => { e.scope = 'Account data'; throw e; });
      const positions = await apiGet(this.fetch, settings.env, creds, '/equity/positions').catch(e => { e.scope = 'Portfolio'; throw e; });
      const t = Date.now();
      this.raw = { summary, positions: Array.isArray(positions) ? positions : [], dividendsYTD: this.raw ? this.raw.dividendsYTD : null, t };
      this.lastSync = t;
      const pts0 = this.store.history.points;
      const prevT = pts0.length ? pts0[pts0.length - 1][0] : null;
      this.record();
      if (settings.fillGaps !== false) this.maybeBackfill(prevT);
      this.market = marketStatus(new Date(), this.marketCodes());
      await this.updateFx(summary.currency, settings.displayCurrency);
      this.error = null;
      this.nextRetryAt = null;
      this.status = (this.market.open || !settings.pauseWhenClosed) ? 'live' : 'closed';
      if (Date.now() - this.divFetchedAt > 30 * 60e3) this.fetchDividends(settings.env, creds);
      const openish = this.market.open || !settings.pauseWhenClosed;
      this.schedule(openish ? Math.max(10, settings.refreshSeconds) * 1000 : 10 * 60e3);
    } catch (e) {
      const status = e.status || 0;
      let kind = 'network';
      if (status === 401) kind = 'auth';
      else if (status === 403) kind = 'forbidden';
      else if (status === 429) kind = 'rate';
      else if (status >= 500) kind = 'server';
      const retryAt = e.retryAt || Date.now() + 60e3;
      this.error = { kind, code: status, message: e.message || String(e), retryAt, scope: e.scope || null };
      this.nextRetryAt = retryAt;
      this.status = 'error';
      this.schedule(retryAt - Date.now());
    } finally {
      this.busy = false;
    }
    this.emitState();
  }

  record() {
    const { summary, positions, t } = this.raw;
    const inv = summary.investments || {};
    const pl = (inv.unrealizedProfitLoss || 0) + (inv.realizedProfitLoss || 0);
    const h = this.store.history;
    const today = localDate(t);
    if (!h.dayBase || h.dayBase.date !== today) {
      const sod = startOfToday();
      let prev = null;
      for (let i = h.points.length - 1; i >= 0; i--) { if (h.points[i][0] < sod) { prev = h.points[i]; break; } }
      h.dayBase = { date: today, pl: prev ? prev[2] : pl, value: prev ? prev[1] : summary.totalValue };
    }
    h.points.push([t, summary.totalValue, pl]);
    for (const p of positions) {
      const k = p.instrument && p.instrument.ticker;
      if (!k) continue;
      const arr = h.posHist[k] || (h.posHist[k] = []);
      arr.push(p.currentPrice);
      if (arr.length > 48) arr.splice(0, arr.length - 48);
    }
    for (const k of Object.keys(h.posHist)) {
      if (!positions.some(p => p.instrument && p.instrument.ticker === k)) delete h.posHist[k];
    }
    h.last = this.raw;
    this.store.saveHistorySoon();
  }

  // PC was off / app closed → rebuild the missing part of the chart from market prices
  async maybeBackfill(prevT) {
    if (this.bfRunning || !this.raw) return;
    const now = Date.now();
    const from = prevT || now - 4.5 * 86400e3;          // first run: seed the last few trading days
    if (now - from < 15 * 60e3) return;
    this.bfRunning = true;
    try {
      const h = this.store.history;
      h.symbols = h.symbols || {};
      const pts = await reconstruct({
        fetchImpl: this.fetch, summary: this.raw.summary, positions: this.raw.positions,
        from, to: this.raw.t, symbolCache: h.symbols
      });
      if (pts.length) {
        h.points = h.points.concat(pts).sort((a, b) => a[0] - b[0]);
        // yesterday's close may now be known → fix today's P/L baseline
        const sod = startOfToday();
        let prev = null;
        for (let i = h.points.length - 1; i >= 0; i--) { if (h.points[i][0] < sod) { prev = h.points[i]; break; } }
        if (prev && h.dayBase && h.dayBase.date === localDate(now)) h.dayBase = { date: h.dayBase.date, pl: prev[2], value: prev[1] };
        this.store.saveHistorySoon();
        this.emitState();
      }
      this.lastBackfill = { at: Date.now(), points: pts.length };
    } catch (e) {
      this.lastBackfill = { at: Date.now(), points: 0, error: String(e && e.message || e) };
    } finally {
      this.bfRunning = false;
    }
  }

  async fetchDividends(env, creds) {
    if (this.divRunning) return;
    this.divRunning = true;
    try {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
      let total = 0;
      let next = '/equity/history/dividends?limit=50';
      for (let page = 0; next && page < 12; page++) {
        if (page) await new Promise(r => setTimeout(r, 10500)); // 6 req / 60 s
        let res;
        try { res = await apiGet(this.fetch, env, creds, next); }
        catch (e) {
          if (e.status !== 429) throw e;                         // rate limited: wait once, then retry
          await new Promise(r => setTimeout(r, Math.max(2000, (e.retryAt || Date.now() + 12e3) - Date.now())));
          res = await apiGet(this.fetch, env, creds, next);
        }
        const items = (res && res.items) || [];
        let older = false;
        for (const it of items) {
          const ts = Date.parse(it.paidOn);
          if (ts >= yearStart) total += Number(it.amount) || 0;
          else older = true;
        }
        next = older ? null : res.nextPagePath || null;
      }
      if (this.raw) { this.raw.dividendsYTD = total; this.store.history.last = this.raw; this.store.saveHistorySoon(); }
      this.divFetchedAt = Date.now();
      this.divError = null;
    } catch (e) {
      // keep the real answer from Trading 212 so the UI can show it instead of guessing
      this.divError = { code: e.status || 0, message: e.message || String(e), at: Date.now() };
      this.divFetchedAt = Date.now() - 27 * 60e3; // try again in ~3 min
    } finally {
      this.divRunning = false;
      this.emitState();
    }
  }

  // new key / manual recheck: forget the old dividend result and ask again now
  recheckDividends() {
    this.divError = null;
    this.divFetchedAt = 0;
    const creds = this.creds();
    if (creds) this.fetchDividends(this.store.get('env'), creds);
    else this.emitState();
  }

  async updateFx(from, display) {
    const to = display && display !== 'account' ? display : from;
    if (!from || to === from) { this.fx = { pair: null, rate: 1, at: Date.now(), cur: from }; return; }
    const pair = from + to;
    if (this.fx.pair === pair && Date.now() - this.fx.at < 3600e3) return;
    const urls = [
      `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`
    ];
    for (const u of urls) {
      try {
        const r = await this.fetch(u);
        if (!r.ok) continue;
        const j = await r.json();
        const rate = j && j.rates && j.rates[to];
        if (rate) { this.fx = { pair, rate, at: Date.now(), cur: to }; return; }
      } catch {}
    }
    if (this.fx.pair !== pair) this.fx = { pair: null, rate: 1, at: 0, cur: from }; // fall back to account currency
  }

  // ── payload for the renderer ─────────────────────────────────
  // [time, value, P/L, estimated?] — P/L lets the chart tooltip show the change at any point
  series(range, fx) {
    const pts = this.store.history.points;
    const now = Date.now();
    const from = rangeStart(range, now);
    let sel = pts.filter(p => p[0] >= from);
    if (range === '1D' && sel.length < 2) sel = pts.filter(p => p[0] >= now - 86400e3);
    if (sel.length < 2 && pts.length) sel = pts.slice(-2);
    sel = downsample(sel, 160);
    return sel.map(p => [p[0], p[1] * fx, Number.isFinite(p[2]) ? p[2] * fx : null, p[3] ? 1 : 0]);
  }

  // Change over the selected chart range. Like the day change it is measured on P/L,
  // so deposits and withdrawals don't count as gains. 'ALL' = all-time P/L.
  period(range, pl, value, allTimePct) {
    const h = this.store.history;
    const pts = h.points;
    if (range === 'ALL') {
      return { range, abs: pl, pct: allTimePct, basePl: 0, from: pts.length ? pts[0][0] : null, partial: false };
    }
    if (!RANGE_MS[range]) {
      const db = h.dayBase || { pl };
      const abs = pl - db.pl;
      return { range: '1D', abs, pct: value - abs ? (abs / (value - abs)) * 100 : 0, basePl: db.pl, from: startOfToday(), partial: false };
    }
    const from = Date.now() - RANGE_MS[range];
    let base = null;
    for (let i = pts.length - 1; i >= 0; i--) {
      if (pts[i][0] <= from && Number.isFinite(pts[i][2])) { base = pts[i]; break; }
    }
    let partial = false;
    if (!base) { // history doesn't reach that far back yet → measure from the oldest point we have
      base = pts.find(p => p[0] > from && Number.isFinite(p[2])) || null;
      partial = !!base;
    }
    if (!base) return { range, abs: 0, pct: 0, basePl: pl, from, partial: true };
    const abs = pl - base[2];
    return { range, abs, pct: value - abs ? (abs / (value - abs)) * 100 : 0, basePl: base[2], from: base[0], partial };
  }

  payload() {
    const s = this.store.all();
    const base = {
      status: this.status,
      error: this.error,
      lastSync: this.lastSync,
      market: this.market,
      marketCodes: this.marketCodes(),
      env: s.env,
      encrypted: this.store.encrypted(),
      platform: process.platform,
      connected: !!this.creds(),
      divError: this.divError || null,
      divForbidden: !!(this.divError && (this.divError.code === 401 || this.divError.code === 403))
    };
    if (!this.raw || !this.raw.summary) return { ...base, data: null };
    const { summary, positions, dividendsYTD } = this.raw;
    const accCur = summary.currency || 'EUR';
    const fx = this.fx.pair && this.fx.pair.startsWith(accCur) ? this.fx.rate : 1;
    const currency = fx !== 1 ? this.fx.cur : accCur;
    const inv = summary.investments || {};
    const cash = summary.cash || {};
    const pl = (inv.unrealizedProfitLoss || 0) + (inv.realizedProfitLoss || 0);
    const dayBase = this.store.history.dayBase || { pl };
    const dayAbs = pl - dayBase.pl;
    const value = summary.totalValue || 0;
    const prevVal = value - dayAbs;
    const posHist = this.store.history.posHist;
    const sumVal = positions.reduce((a, p) => a + ((p.walletImpact && p.walletImpact.currentValue) || 0), 0) || 1;
    const pos = positions.map(p => {
      const w = p.walletImpact || {};
      const ins = p.instrument || {};
      const cost = w.totalCost || 0;
      return {
        ticker: ins.ticker,
        sym: shortTicker(ins.ticker),
        name: ins.name || ins.ticker,
        value: (w.currentValue || 0) * fx,
        pl: (w.unrealizedProfitLoss || 0) * fx,
        plPct: cost ? ((w.unrealizedProfitLoss || 0) / cost) * 100 : 0,
        qty: p.quantity,
        avg: p.averagePricePaid,
        avgCur: ins.currency || '',
        weight: ((w.currentValue || 0) / sumVal) * 100,
        spark: posHist[ins.ticker] || []
      };
    }).sort((a, b) => b.value - a.value);
    const markets = new Set(positions.map(p => marketOf(p.instrument && p.instrument.ticker)));
    return {
      ...base,
      data: {
        currency,
        accountCurrency: accCur,
        accountId: summary.id,
        value: value * fx,
        cash: (cash.availableToTrade || 0) * fx,
        invested: (inv.currentValue || 0) * fx,
        allTimePL: pl * fx,
        allTimePct: inv.totalCost ? (pl / inv.totalCost) * 100 : 0,
        dayAbs: dayAbs * fx,
        dayPct: prevVal ? (dayAbs / prevVal) * 100 : 0,
        dividendsYTD: dividendsYTD == null ? null : dividendsYTD * fx,
        holdings: positions.length,
        markets: markets.size,
        positions: pos,
        series: this.series(s.range, fx),
        period: (() => {
          const p = this.period(s.range, pl, value, inv.totalCost ? (pl / inv.totalCost) * 100 : 0);
          return { ...p, abs: p.abs * fx, basePl: p.basePl * fx };
        })()
      }
    };
  }

  emitState() { this.emit('state', this.payload()); }
}

module.exports = { Poller, apiGet, ApiError, shortTicker, marketOf };
