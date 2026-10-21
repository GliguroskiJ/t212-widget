'use strict';
// Everything the full app shows beyond the live widget data: trade / dividend / cash history,
// pending orders, pies, instrument metadata, CSV reports and price charts.
// Read-only: no order or pie is ever created, changed or cancelled.
//
// History is synced incrementally into userData/activity.json (newest pages first until a known
// item shows up, then the rest of the first full download continues from a saved cursor), so after
// the first run only a page or two is fetched. All of it stays on this computer.

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { apiRequest, shortTicker, marketOf } = require('./t212');
const { Limiter } = require('./limiter');
const { candidates, searchIsin, chart, plausible } = require('./backfill');

const KINDS = {
  orders: { path: '/equity/history/orders', limit: 'hOrders', scope: 'History – orders' },
  dividends: { path: '/equity/history/dividends', limit: 'hDividends', scope: 'History – dividends' },
  transactions: { path: '/equity/history/transactions', limit: 'hTransactions', scope: 'History – transactions' }
};
const PRICE_RANGES = { '1D': ['1d', '5m'], '1W': ['5d', '30m'], '1M': ['1mo', '1d'], '3M': ['3mo', '1d'], '1Y': ['1y', '1d'], '5Y': ['5y', '1wk'], 'MAX': ['max', '1mo'] };
const PRICE_TTL = { '1D': 120e3, '1W': 600e3 };
const DAY = 86400e3;
const YF_TYPES = ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'CRYPTOCURRENCY', 'CURRENCY', 'FUTURE'];
const YF_SYMBOL = /^[A-Za-z0-9.^=\-]{1,24}$/;
const LOGO_BASE = 'https://trading212equities.s3.eu-central-1.amazonaws.com/';

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
const num = v => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
const ts = v => { const t = Date.parse(v); return isFinite(t) ? t : null; };

// ── normalisers: API item → compact row for the renderer ─────────
function instr(i, ticker) {
  const tk = (i && i.ticker) || ticker || '';
  return { ticker: tk, sym: shortTicker(tk), name: (i && i.name) || tk, isin: (i && i.isin) || null, instrCur: (i && i.currency) || null };
}

function normOrder(it) {
  const o = it.order || it;
  const f = it.fill || null;
  const w = (f && f.walletImpact) || {};
  const taxes = Array.isArray(w.taxes) ? w.taxes : [];
  const qty = num(f && f.quantity) ?? num(o.filledQuantity) ?? num(o.quantity);
  const side = o.side || (qty != null && qty < 0 ? 'SELL' : 'BUY');
  return {
    key: `${o.id}:${(f && f.id) || ''}`,
    id: o.id,
    ...instr(o.instrument, o.ticker),
    side,
    type: o.type || null,
    status: o.status || null,
    fillType: (f && f.type) || null,
    qty: qty == null ? null : Math.abs(qty),
    reqQty: num(o.quantity) == null ? null : Math.abs(num(o.quantity)),
    price: num(f && f.price) ?? num(o.limitPrice) ?? num(o.stopPrice),
    value: num(w.netValue) ?? num(o.filledValue) ?? num(o.value),
    currency: w.currency || o.currency || null,
    fxRate: num(w.fxRate),
    realized: num(w.realisedProfitLoss),
    fees: taxes.reduce((a, x) => a + Math.abs(num(x.quantity) || 0), 0),
    taxes: taxes.map(x => ({ name: x.name, amount: num(x.quantity), currency: x.currency })),
    time: ts(f && f.filledAt) ?? ts(o.createdAt),
    created: ts(o.createdAt),
    from: o.initiatedFrom || null,
    tif: o.timeInForce || null,
    extended: !!o.extendedHours
  };
}

function normDividend(it) {
  const t = ts(it.paidOn);
  return {
    key: it.reference || `${it.ticker}:${it.paidOn}:${it.amount}`,
    ...instr(it.instrument, it.ticker),
    amount: num(it.amount),
    amountEur: num(it.amountInEuro),
    perShare: num(it.grossAmountPerShare),
    qty: num(it.quantity),
    tickerCurrency: it.tickerCurrency || null,
    type: it.type || null,
    time: t
  };
}

function normTransaction(it) {
  return {
    key: it.reference || `${it.type}:${it.dateTime}:${it.amount}`,
    type: it.type || 'OTHER',
    amount: num(it.amount),
    currency: it.currency || null,
    time: ts(it.dateTime)
  };
}

function normPending(o) {
  return {
    id: o.id,
    ...instr(o.instrument, o.ticker),
    side: o.side || (num(o.quantity) < 0 ? 'SELL' : 'BUY'),
    type: o.type, status: o.status,
    qty: num(o.quantity) == null ? null : Math.abs(num(o.quantity)),
    filledQty: num(o.filledQuantity),
    value: num(o.value),
    limitPrice: num(o.limitPrice), stopPrice: num(o.stopPrice),
    currency: o.currency || null,
    tif: o.timeInForce || null,
    extended: !!o.extendedHours,
    strategy: o.strategy || null,
    from: o.initiatedFrom || null,
    created: ts(o.createdAt)
  };
}

const NORM = { orders: normOrder, dividends: normDividend, transactions: normTransaction };

// money movement direction of a cash transaction: 'IN' (deposit / transfer in), 'OUT' (withdrawal,
// card payment, transfer out) or null (interest, fees)
function txDir(x) {
  if (x.type === 'DEPOSIT') return 'IN';
  if (x.type === 'WITHDRAW') return 'OUT';
  if (x.type === 'TRANSFER') return (x.amount || 0) >= 0 ? 'IN' : 'OUT';
  return null;
}

// an order that actually traded (cancelled / rejected / expired orders come back with no fill)
function isFilled(x) {
  return x.fillType != null || ((x.qty || 0) > 0 && (x.status === 'FILLED' || x.status === 'PARTIALLY_FILLED'));
}

function monthKey(t) { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

class Library extends EventEmitter {
  constructor({ store, fetchImpl, dir, limiter, now }) {
    super();
    this.store = store;
    this.fetch = fetchImpl || fetch;
    this.now = now || Date.now;
    this.limiter = limiter || new Limiter();
    this.dir = dir || store.dir;
    this.file = path.join(this.dir, 'activity.json');
    this.dayCache = {};         // symbol → today's quote (previous close, day range)
    this.logoMiss = null;       // ticker → time Trading 212 had no logo for it
    this.metaFile = path.join(dir || store.dir, 'metadata.json');
    this.data = this.load();
    this.meta = readJson(this.metaFile, null) || { instruments: null, exchanges: null };
    this.status = {};           // kind → { state, error, code, at, progress }
    for (const k of [...Object.keys(KINDS), 'pending', 'pies', 'instruments', 'exports']) this.status[k] = { state: 'idle' };
    this.syncing = null;
    this.mem = { pending: null, pies: null, exports: null, prices: {}, quotes: null };
    this.pieDetailRunning = false;
    this._saveT = null;
  }

  empty(account) {
    return { v: 1, account: account || null, orders: [], dividends: [], transactions: [],
      cursor: {}, complete: {}, syncedAt: {}, pies: {} };
  }
  load() {
    const d = readJson(this.file, null);
    if (!d || d.v !== 1) return this.empty();
    for (const k of Object.keys(KINDS)) if (!Array.isArray(d[k])) d[k] = [];
    d.cursor = d.cursor || {}; d.complete = d.complete || {}; d.syncedAt = d.syncedAt || {}; d.pies = d.pies || {};
    return d;
  }
  save() { try { atomicWrite(this.file, JSON.stringify(this.data)); } catch {} }
  saveSoon() { clearTimeout(this._saveT); this._saveT = setTimeout(() => this.save(), 1000); }
  saveMeta() { try { atomicWrite(this.metaFile, JSON.stringify(this.meta)); } catch {} }

  creds() { return this.store.getCreds(); }
  env() { return this.store.get('env'); }
  call(limitKey, method, p, body) {
    const creds = this.creds();
    if (!creds) return Promise.reject(Object.assign(new Error('Not connected'), { status: 401 }));
    const env = this.env();
    return this.limiter.run(limitKey, () => apiRequest(this.fetch, env, creds, method, p, body));
  }

  // The cache belongs to one account: a different key/env/account starts from scratch.
  setAccount(env, id) {
    const acc = `${env}:${id}`;
    if (this.data.account === acc) return false;
    const fresh = !this.data.account;
    this.data = this.empty(acc);
    this.mem = { pending: null, pies: null, exports: null, prices: this.mem.prices, quotes: null };
    for (const k of Object.keys(this.status)) this.status[k] = { state: 'idle' };
    this.save();
    if (!fresh) this.emitChange('account');
    return true;
  }
  reset() {
    this.data = this.empty(null);
    this.mem = { pending: null, pies: null, exports: null, prices: {}, quotes: null };
    for (const k of Object.keys(this.status)) this.status[k] = { state: 'idle' };
    try { fs.unlinkSync(this.file); } catch {}
    this.emitChange('account');
  }

  emitChange(what) { this.emit('change', { what, status: this.statusPayload() }); }

  fail(kind, e) {
    const code = (e && e.status) || 0;
    this.status[kind] = {
      state: code === 401 || code === 403 ? 'forbidden' : 'error',
      code, error: (e && e.message) || String(e), at: this.now()
    };
  }

  // ── history sync ─────────────────────────────────────────────
  sync(kinds = Object.keys(KINDS)) {
    if (this.syncing) { this.syncing.want = [...new Set([...this.syncing.want, ...kinds])]; return this.syncing.p; }
    const job = { want: kinds.slice() };
    job.p = (async () => {
      while (job.want.length) {
        const k = job.want.shift();
        if (KINDS[k]) await this.syncKind(k);
      }
    })().finally(() => { this.syncing = null; this.emitChange('sync-done'); });
    this.syncing = job;
    return job.p;
  }

  async syncKind(kind) {
    const def = KINDS[kind];
    const list = this.data[kind];
    const known = new Set(list.map(x => x.key));
    const st = this.status[kind] = { state: 'syncing', progress: list.length, at: this.now() };
    this.emitChange(kind);
    const add = items => {
      let fresh = 0, hitKnown = false;
      for (const it of items) {
        const row = NORM[kind](it);
        if (known.has(row.key)) { hitKnown = true; continue; }
        known.add(row.key);
        list.push(row);
        fresh++;
      }
      return { fresh, hitKnown };
    };
    try {
      // 1) newest pages until we reach something we already have
      let next = `${def.path}?limit=50`;
      let pages = 0;
      const firstEver = !this.data.complete[kind] && !this.data.cursor[kind] && !list.length;
      while (next) {
        const res = await this.call(def.limit, 'GET', next);
        const items = (res && res.items) || [];
        const { hitKnown } = add(items);
        pages++;
        next = res && res.nextPagePath ? res.nextPagePath : null;
        if (firstEver) this.data.cursor[kind] = next; // first download: remember where we stopped
        st.progress = list.length;
        this.sortKind(kind);
        this.saveSoon();
        this.emitChange(kind);
        if (!next) { if (firstEver) this.data.complete[kind] = true; break; }
        if (hitKnown && !firstEver) break;
      }
      // 2) the rest of an interrupted first download
      while (!this.data.complete[kind] && this.data.cursor[kind]) {
        const res = await this.call(def.limit, 'GET', this.data.cursor[kind]);
        add((res && res.items) || []);
        this.data.cursor[kind] = (res && res.nextPagePath) || null;
        if (!this.data.cursor[kind]) this.data.complete[kind] = true;
        st.progress = list.length;
        this.sortKind(kind);
        this.saveSoon();
        this.emitChange(kind);
      }
      if (!this.data.cursor[kind]) this.data.complete[kind] = true;
      this.data.syncedAt[kind] = this.now();
      this.status[kind] = { state: 'done', at: this.now(), count: list.length, pages };
      this.save();
    } catch (e) {
      this.fail(kind, e);
      this.save();
    }
    this.emitChange(kind);
  }

  sortKind(kind) { this.data[kind].sort((a, b) => (b.time || 0) - (a.time || 0)); }

  // has the dividend list reached back to `since` (so a sum from it is complete)?
  covers(kind, since) {
    if (this.data.complete[kind]) return true;
    const l = this.data[kind];
    return l.length > 0 && (l[l.length - 1].time || Infinity) < since;
  }

  dividendsSince(since) {
    if (!this.covers('dividends', since)) return null;
    return this.data.dividends.reduce((a, d) => a + (d.time >= since ? d.amount || 0 : 0), 0);
  }

  // ── queries for the renderer ─────────────────────────────────
  statusPayload() {
    const out = {};
    for (const [k, v] of Object.entries(this.status)) out[k] = { ...v };
    for (const k of Object.keys(KINDS)) {
      out[k].count = this.data[k].length;
      out[k].complete = !!this.data.complete[k];
      out[k].syncedAt = this.data.syncedAt[k] || null;
    }
    out.syncing = !!this.syncing;
    out.pendingCount = this.mem.pending ? this.mem.pending.list.length : 0;
    return out;
  }

  // cumulative net deposits over time (deposits − withdrawals, transfers by sign) for the chart line
  netDeposits() {
    const ev = this.data.transactions.filter(x => x.time && txDir(x)).map(x => [x.time, txDir(x) === 'IN' ? Math.abs(x.amount || 0) : -Math.abs(x.amount || 0)]).sort((a, b) => a[0] - b[0]);
    let c = 0;
    return { complete: !!this.data.complete.transactions, pts: ev.map(([t, a]) => [t, (c += a)]) };
  }

  // newest items of all three histories, merged (overview "Recent activity")
  recent(limit = 8) {
    const n = Math.max(1, Math.min(50, Number(limit) || 8));
    const all = [];
    for (const k of Object.keys(KINDS)) for (const x of this.data[k].slice(0, n)) all.push({ ...x, kind: k });
    return all.filter(x => !(x.kind === 'orders' && (!isFilled(x) || (x.fillType && x.fillType !== 'TRADE')))).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, n);
  }

  // forget the downloaded history (Settings → Data); the next sync starts from scratch
  wipe() {
    const acc = this.data.account;
    this.data = this.empty(acc);
    for (const k of Object.keys(KINDS)) this.status[k] = { state: 'idle' };
    this.save();
    this.emitChange('account');
  }

  activity({ kind, ticker, q, type, from, to, offset = 0, limit = 100 } = {}) {
    if (!KINDS[kind]) return { items: [], total: 0 };
    let l = this.data[kind];
    if (ticker) l = l.filter(x => x.ticker === ticker);
    // trades: unfilled orders only under their own filter, never mixed into the list or the sums
    if (kind === 'orders') l = type === 'UNFILLED' ? l.filter(x => !isFilled(x)) : l.filter(isFilled);
    if (type && type !== 'UNFILLED') l = l.filter(x => (kind === 'orders' ? x.side === type : type === 'IN' || type === 'OUT' ? txDir(x) === type : x.type === type));
    if (from) l = l.filter(x => (x.time || 0) >= from);
    if (to) l = l.filter(x => (x.time || 0) < to);
    if (q) {
      const s = String(q).toLowerCase();
      l = l.filter(x => (x.sym && x.sym.toLowerCase().includes(s)) || (x.name && x.name.toLowerCase().includes(s)) ||
        (x.isin && x.isin.toLowerCase() === s) || (x.type && x.type.toLowerCase().includes(s)));
    }
    return { items: l.slice(offset, offset + Math.min(500, limit)), total: l.length };
  }

  // totals and monthly buckets for the overview / activity charts
  stats() {
    const now = new Date(this.now());
    const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
    const d = { total: 0, ytd: 0, last12: 0, byMonth: {}, byTicker: {}, count: this.data.dividends.length };
    const since12 = this.now() - 365 * DAY;
    for (const x of this.data.dividends) {
      const a = x.amount || 0;
      d.total += a;
      if (x.time >= yearStart) d.ytd += a;
      if (x.time >= since12) d.last12 += a;
      if (x.time) d.byMonth[monthKey(x.time)] = (d.byMonth[monthKey(x.time)] || 0) + a;
      const t = d.byTicker[x.ticker] || (d.byTicker[x.ticker] = { ticker: x.ticker, sym: x.sym, name: x.name, amount: 0, count: 0 });
      t.amount += a; t.count++;
    }
    // Deposits = everything that came in (bank deposits and transfers from your other Trading 212
    // accounts, e.g. CFD); withdrawals = everything that went out (bank withdrawals, card payments,
    // transfers to other accounts). A transfer's sign says which one it is.
    const c = { deposits: 0, withdrawals: 0, interest: 0, fees: 0, byMonth: {} };
    for (const x of this.data.transactions) {
      const a = x.amount || 0;
      const dir = txDir(x);
      if (dir) {
        const m = x.time ? (c.byMonth[monthKey(x.time)] || (c.byMonth[monthKey(x.time)] = { in: 0, out: 0 })) : { in: 0, out: 0 };
        if (dir === 'IN') { c.deposits += Math.abs(a); m.in += Math.abs(a); } else { c.withdrawals += Math.abs(a); m.out += Math.abs(a); }
      } else if (x.type === 'INTEREST_ON_FREE_CASH' || x.type === 'LENDING_INTEREST') c.interest += a;
      else if (x.type === 'FEE') c.fees += Math.abs(a);
    }
    c.net = c.deposits - c.withdrawals;
    const o = { count: 0, unfilled: 0, buys: 0, sells: 0, realized: 0, fees: 0, bought: 0, sold: 0, byMonth: {} };
    for (const x of this.data.orders) {
      if (!isFilled(x)) { o.unfilled++; continue; }
      if (x.fillType && x.fillType !== 'TRADE') continue;
      o.count++;
      if (x.side === 'SELL') { o.sells++; o.sold += Math.abs(x.value || 0); } else { o.buys++; o.bought += Math.abs(x.value || 0); }
      o.realized += x.realized || 0;
      o.fees += Math.abs(x.fees || 0);
      if (x.time) o.byMonth[monthKey(x.time)] = (o.byMonth[monthKey(x.time)] || 0) + 1;
    }
    d.byTicker = Object.values(d.byTicker).sort((a, b) => b.amount - a.amount);
    return {
      dividends: { ...d, complete: !!this.data.complete.dividends },
      cash: { ...c, complete: !!this.data.complete.transactions },
      orders: { ...o, complete: !!this.data.complete.orders },
      firstActivity: Math.min(...['orders', 'dividends', 'transactions'].map(k => {
        const l = this.data[k]; return l.length ? l[l.length - 1].time || Infinity : Infinity;
      }))
    };
  }

  // ── pending orders (1 / 5 s) ─────────────────────────────────
  async pending(force) {
    const m = this.mem.pending;
    if (m && !force && this.now() - m.at < 15e3) return m.list;
    try {
      const res = await this.call('orders', 'GET', '/equity/orders');
      const list = (Array.isArray(res) ? res : (res && res.items) || []).map(normPending).sort((a, b) => (b.created || 0) - (a.created || 0));
      this.mem.pending = { at: this.now(), list };
      this.status.pending = { state: 'done', at: this.now() };
      return list;
    } catch (e) {
      this.fail('pending', e);
      if (m) return m.list;
      throw e;
    }
  }

  // ── pies (list 1 / 30 s, detail 1 / 5 s) ─────────────────────
  // The list has no names, so details are fetched one by one in the background and cached.
  async pies(force) {
    const m = this.mem.pies;
    if (!m || force || this.now() - m.at > 60e3) {
      try {
        const res = await this.call('pies', 'GET', '/equity/pies');
        this.mem.pies = { at: this.now(), list: Array.isArray(res) ? res : [] };
        this.status.pies = { state: 'done', at: this.now() };
        this.loadPieDetails();
      } catch (e) {
        this.fail('pies', e);
        if (!m) throw e;
      }
    }
    return this.piesPayload();
  }

  piesPayload() {
    const list = (this.mem.pies && this.mem.pies.list) || [];
    return list.map(p => {
      const det = this.data.pies[p.id];
      const s = (det && det.settings) || {};
      const r = p.result || {};
      return {
        id: p.id,
        name: s.name || null,
        icon: s.icon || null,
        goal: num(s.goal),
        endDate: ts(s.endDate),
        created: ts(s.creationDate),
        dividendAction: s.dividendCashAction || null,
        cash: num(p.cash),
        progress: num(p.progress),
        status: p.status || null,
        invested: num(r.priceAvgInvestedValue),
        value: num(r.priceAvgValue),
        result: num(r.priceAvgResult),
        resultPct: num(r.priceAvgResultCoef) == null ? null : num(r.priceAvgResultCoef) * 100,
        dividends: p.dividendDetails ? { gained: num(p.dividendDetails.gained), inCash: num(p.dividendDetails.inCash), reinvested: num(p.dividendDetails.reinvested) } : null,
        count: det && Array.isArray(det.instruments) ? det.instruments.length : null,
        detailAt: det ? det.at : null
      };
    });
  }

  async loadPieDetails() {
    if (this.pieDetailRunning) return;
    this.pieDetailRunning = true;
    try {
      const list = (this.mem.pies && this.mem.pies.list) || [];
      for (const p of list) {
        const det = this.data.pies[p.id];
        if (det && this.now() - det.at < 30 * 60e3) continue;
        try { await this.pieDetail(p.id, true); } catch (e) { if (e.status === 401 || e.status === 403) break; }
      }
      // forget pies that no longer exist
      for (const id of Object.keys(this.data.pies)) if (!list.some(p => String(p.id) === id)) delete this.data.pies[id];
      this.saveSoon();
    } finally {
      this.pieDetailRunning = false;
      this.emitChange('pies');
    }
  }

  async pieDetail(id, force) {
    id = Number(id);
    if (!Number.isFinite(id)) throw new Error('Bad pie id');
    const det = this.data.pies[id];
    if (!det || force || this.now() - det.at > 5 * 60e3) {
      const res = await this.call('pie', 'GET', `/equity/pies/${id}`);
      this.data.pies[id] = { at: this.now(), settings: res.settings || {}, instruments: res.instruments || [] };
      this.saveSoon();
      this.emitChange('pies');
    }
    const d = this.data.pies[id];
    const base = this.piesPayload().find(p => p.id === id) || { id, name: d.settings.name || null };
    const names = this.instrumentIndex();
    return {
      ...base,
      instruments: d.instruments.map(i => {
        const r = i.result || {};
        const meta = names[i.ticker];
        return {
          ticker: i.ticker, sym: shortTicker(i.ticker), name: (meta && meta.name) || shortTicker(i.ticker),
          current: num(i.currentShare) == null ? null : num(i.currentShare) * 100,
          expected: num(i.expectedShare) == null ? null : num(i.expectedShare) * 100,
          qty: num(i.ownedQuantity),
          invested: num(r.priceAvgInvestedValue), value: num(r.priceAvgValue), result: num(r.priceAvgResult),
          resultPct: num(r.priceAvgResultCoef) == null ? null : num(r.priceAvgResultCoef) * 100,
          issues: (i.issues || []).map(x => ({ name: x.name, severity: x.severity }))
        };
      }).sort((a, b) => (b.value || 0) - (a.value || 0)),
      publicUrl: d.settings.publicUrl || null,
      initialInvestment: num(d.settings.initialInvestment)
    };
  }

  // ── instrument metadata (instruments 1 / 50 s, exchanges 1 / 30 s) — refreshed daily ──
  async loadMetadata(force) {
    const fresh = x => x && this.now() - x.at < DAY;
    if (!force && fresh(this.meta.instruments) && fresh(this.meta.exchanges)) return true;
    if (this.metaRunning) return this.metaRunning;
    this.status.instruments = { state: 'syncing', at: this.now() };
    this.metaRunning = (async () => {
      try {
        if (force || !fresh(this.meta.instruments)) {
          const list = await this.call('instruments', 'GET', '/equity/metadata/instruments');
          this.meta.instruments = { at: this.now(), list: (Array.isArray(list) ? list : []).map(i => ({
            ticker: i.ticker, name: i.name, shortName: i.shortName, isin: i.isin, currency: i.currencyCode,
            type: i.type, schedule: i.workingScheduleId, ext: !!i.extendedHours, added: ts(i.addedOn), maxQty: num(i.maxOpenQuantity)
          })) };
          this._index = null;
        }
        if (force || !fresh(this.meta.exchanges)) {
          const ex = await this.call('exchanges', 'GET', '/equity/metadata/exchanges');
          this.meta.exchanges = { at: this.now(), list: Array.isArray(ex) ? ex : [] };
        }
        this.saveMeta();
        this.status.instruments = { state: 'done', at: this.now(), count: this.meta.instruments.list.length };
        return true;
      } catch (e) {
        this.fail('instruments', e);
        return false;
      } finally {
        this.metaRunning = null;
        this.emitChange('instruments');
      }
    })();
    return this.metaRunning;
  }

  instrumentIndex() {
    if (this._index) return this._index;
    const idx = {};
    for (const i of (this.meta.instruments && this.meta.instruments.list) || []) idx[i.ticker] = i;
    this._index = idx;
    return idx;
  }

  // any stock / ETF / index on Yahoo Finance — for watching instruments Trading 212 doesn't offer
  // (or that the key can't list). Such instruments get the ticker "yf:<Yahoo symbol>".
  async yahooSearch(q) {
    const key = String(q || '').trim().toLowerCase();
    if (key.length < 1) return [];
    this.ySearch = this.ySearch || {};
    const c = this.ySearch[key];
    if (c && this.now() - c.at < 10 * 60e3) return c.list;
    let list = [];
    try {
      const r = await this.fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(key)}&quotesCount=12&newsCount=0&listsCount=0`, { headers: { Accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        list = (j.quotes || [])
          .filter(x => x.symbol && YF_TYPES.includes(x.quoteType) && YF_SYMBOL.test(x.symbol))
          .map(x => ({ ticker: 'yf:' + x.symbol, sym: x.symbol, name: x.longname || x.shortname || x.symbol, type: x.quoteType === 'EQUITY' ? 'STOCK' : x.quoteType,
            exchange: x.exchDisp || x.exchange || null, currency: null, external: true }));
      }
    } catch {}
    this.ySearch[key] = { at: this.now(), list };
    this.extNames = this.extNames || {};
    for (const x of list) this.extNames[x.ticker] = { name: x.name, type: x.type, exchange: x.exchange };
    return list;
  }

  // Trading 212 matches first, then everything else Yahoo knows (without the ones already listed)
  async searchAll(q, held = []) {
    const own = this.search(q, held);
    const ext = await this.yahooSearch(q);
    const have = new Set(own.map(r => (candidates(r.ticker)[0] || '').toUpperCase()).concat(own.map(r => this.store.history.symbols && this.store.history.symbols[r.ticker]).filter(Boolean).map(x => x.toUpperCase())));
    return own.concat(ext.filter(x => !have.has(x.sym.toUpperCase()))).slice(0, 24);
  }

  search(q, held = []) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return [];
    const heldSet = new Set(held);
    const list = (this.meta.instruments && this.meta.instruments.list) || [];
    const scored = [];
    for (const i of list) {
      const sh = (i.shortName || '').toLowerCase(), nm = (i.name || '').toLowerCase();
      let score = 0;
      if (sh === s) score = 100;
      else if ((i.isin || '').toLowerCase() === s) score = 95;
      else if (sh.startsWith(s)) score = 80;
      else if (nm.startsWith(s)) score = 60;
      else if (nm.includes(s)) score = 40;
      else if (sh.includes(s)) score = 30;
      if (!score) continue;
      if (heldSet.has(i.ticker)) score += 50;
      if (i.type === 'STOCK' || i.type === 'ETF') score += 5;
      scored.push([score, i]);
    }
    // nothing downloaded yet (no Metadata permission) → at least search what we hold / traded
    if (!list.length) {
      const seen = new Set();
      for (const r of [...this.data.orders, ...this.data.dividends]) {
        if (seen.has(r.ticker)) continue;
        if ((r.sym || '').toLowerCase().includes(s) || (r.name || '').toLowerCase().includes(s)) {
          seen.add(r.ticker);
          scored.push([heldSet.has(r.ticker) ? 90 : 40, { ticker: r.ticker, shortName: r.sym, name: r.name, isin: r.isin, currency: r.instrCur }]);
        }
      }
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, 20).map(([, i]) => ({
      ticker: i.ticker, sym: i.shortName || shortTicker(i.ticker), name: i.name, isin: i.isin, currency: i.currency, type: i.type || null, held: heldSet.has(i.ticker)
    }));
  }

  // trading hours of an instrument: next open / close from the exchange schedule
  hours(scheduleId) {
    for (const ex of (this.meta.exchanges && this.meta.exchanges.list) || []) {
      for (const ws of ex.workingSchedules || []) {
        if (ws.id !== scheduleId) continue;
        const now = this.now();
        const evs = (ws.timeEvents || []).map(e => ({ t: ts(e.date), type: e.type })).filter(e => e.t).sort((a, b) => a.t - b.t);
        const past = evs.filter(e => e.t <= now);
        const last = past[past.length - 1];
        const open = !!last && (last.type === 'OPEN' || last.type === 'BREAK_END');
        const nextChange = evs.find(e => e.t > now && (open ? (e.type === 'CLOSE' || e.type === 'BREAK_START') : (e.type === 'OPEN' || e.type === 'BREAK_END')));
        return { exchange: ex.name, open, next: nextChange ? nextChange.t : null };
      }
    }
    return null;
  }

  instrument(ticker) {
    if (String(ticker).startsWith('yf:')) {
      const e = (this.extNames && this.extNames[ticker]) || {};
      const sym = ticker.slice(3);
      return { ticker, sym, name: e.name || sym, isin: null, currency: null, type: e.type || null, external: true, exchange: e.exchange || null,
        market: null, hours: null, orders: [], dividends: [], pending: [], dividendTotal: 0, realized: 0, fees: 0 };
    }
    const meta = this.instrumentIndex()[ticker] || null;
    const orders = this.data.orders.filter(x => x.ticker === ticker && isFilled(x));
    const dividends = this.data.dividends.filter(x => x.ticker === ticker);
    const pend = ((this.mem.pending && this.mem.pending.list) || []).filter(x => x.ticker === ticker);
    const sample = orders[0] || dividends[0] || null;
    return {
      ticker,
      sym: (meta && meta.shortName) || shortTicker(ticker),
      name: (meta && meta.name) || (sample && sample.name) || shortTicker(ticker),
      isin: (meta && meta.isin) || (sample && sample.isin) || null,
      currency: (meta && meta.currency) || (sample && sample.instrCur) || null,
      type: (meta && meta.type) || null,
      extended: meta ? meta.ext : null,
      added: meta ? meta.added : null,
      market: marketOf(ticker),
      hours: meta ? this.hours(meta.schedule) : null,
      orders: orders.slice(0, 200),
      dividends: dividends.slice(0, 200),
      pending: pend,
      dividendTotal: dividends.reduce((a, d) => a + (d.amount || 0), 0),
      realized: orders.reduce((a, o) => a + (o.realized || 0), 0),
      fees: orders.reduce((a, o) => a + Math.abs(o.fees || 0), 0)
    };
  }

  // ── price history from Yahoo Finance (the API has no candles) ──
  async resolveSymbol(ticker, isin, refPrice) {
    const h = this.store.history;
    h.symbols = h.symbols || {};
    const cache = h.symbols;
    if (String(ticker).startsWith('yf:')) { const y = ticker.slice(3); return YF_SYMBOL.test(y) ? y : null; }
    if (cache[ticker]) return cache[ticker];
    const list = candidates(ticker);
    const tried = new Set();
    for (const pass of [0, 1]) {
      for (const sym of list) {
        if (tried.has(sym)) continue;
        tried.add(sym);
        try {
          const c = await chart(this.fetch, sym, '5d', '1d');
          if (c && plausible(c.last, refPrice)) { cache[ticker] = sym; this.store.saveHistorySoon && this.store.saveHistorySoon(); return sym; }
        } catch {}
      }
      if (pass === 0) list.push(...(await searchIsin(this.fetch, isin)));
    }
    return null;
  }

  async prices({ ticker, isin, range = '1M', refPrice } = {}) {
    if (!PRICE_RANGES[range]) range = '1M';
    const meta = this.instrumentIndex()[ticker];
    const sym = await this.resolveSymbol(ticker, isin || (meta && meta.isin), refPrice);
    if (!sym) return { ticker, range, symbol: null, pts: [] };
    const key = sym + ':' + range;
    const c = this.mem.prices[key];
    if (c && this.now() - c.at < (PRICE_TTL[range] || 30 * 60e3)) return c.data;
    const [r, iv] = PRICE_RANGES[range];
    let res = null;
    try { res = await chart(this.fetch, sym, r, iv); } catch {}
    // the chart's own "previous close" is the close before the whole range (a year ago on 1Y) →
    // take the real last session close (and today's range) from the 1-day chart
    const dq = await this.dayQuote(sym);
    const qmeta = res ? { ...res.meta, prevClose: dq ? dq.prevClose : null, dayHigh: dq ? dq.dayHigh : res.meta.dayHigh, dayLow: dq ? dq.dayLow : res.meta.dayLow, open: dq ? dq.open : null } : null;
    const data = res ? { ticker, range, symbol: sym, pts: res.pts, last: dq && dq.last ? dq.last : res.last, meta: qmeta } : { ticker, range, symbol: sym, pts: [] };
    if (res) this.mem.prices[key] = { at: this.now(), data };
    // keep the cache small
    const keys = Object.keys(this.mem.prices);
    if (keys.length > 120) for (const k of keys.slice(0, keys.length - 120)) delete this.mem.prices[k];
    return data;
  }

  // ── company calendar (earnings, ex-dividend, dividend pay dates) ──
  // Trading 212's API has no corporate calendar, so this uses Yahoo Finance's quote summary, which
  // needs a session cookie + "crumb". Collected for held instruments, cached in calendar.json.
  async yahooCrumb(force) {
    if (!force && this.crumb && this.now() - this.crumb.at < 6 * 3600e3) return this.crumb;
    let cookie = '';
    try {
      const r = await this.fetch('https://fc.yahoo.com/', { credentials: 'include', redirect: 'manual' });
      const sc = (r.headers && r.headers.get && r.headers.get('set-cookie')) || '';
      const m = /(?:^|[;,]\s*)(A3=[^;]+)/.exec(sc);
      if (m) cookie = m[1];
    } catch {}
    const headers = { Accept: 'text/plain' };
    if (cookie) headers.Cookie = cookie;
    const r2 = await this.fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { credentials: 'include', headers });
    const crumb = r2.ok ? (await r2.text()).trim() : '';
    if (!crumb || crumb.length > 40 || /[<\s{]/.test(crumb)) throw new Error('Yahoo Finance did not hand out a session (HTTP ' + r2.status + ')');
    this.crumb = { at: this.now(), crumb, cookie };
    return this.crumb;
  }

  async quoteSummary(sym) {
    const go = async force => {
      const c = await this.yahooCrumb(force);
      const headers = { Accept: 'application/json' };
      if (c.cookie) headers.Cookie = c.cookie;
      return this.fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=calendarEvents,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(c.crumb)}`, { credentials: 'include', headers });
    };
    let r = await go(false);
    if (r.status === 401 || r.status === 403) r = await go(true);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
  }

  calFile() { return path.join(this.dir, 'calendar.json'); }
  calData() {
    if (!this.cal) this.cal = readJson(this.calFile(), null) || { by: {}, at: 0 };
    return this.cal;
  }

  // refresh calendar data of the given positions (each at most every 12 h)
  async refreshCalendar(positions, force) {
    if (this.calRunning) return this.calRunning;
    const cal = this.calData();
    this.calRunning = (async () => {
      let ok = 0, fail = null;
      for (const p of positions.slice(0, 80)) {
        const old = cal.by[p.ticker];
        if (!force && old && this.now() - old.at < 12 * 3600e3) continue;
        try {
          const sym = await this.resolveSymbol(p.ticker, p.isin, p.price);
          if (!sym) { cal.by[p.ticker] = { at: this.now(), none: true }; continue; }
          const q = await this.quoteSummary(sym);
          const ce = (q && q.calendarEvents) || {}, sd = (q && q.summaryDetail) || {}, ks = (q && q.defaultKeyStatistics) || {};
          const raw = v => (v && typeof v === 'object' ? (v.raw ?? null) : v ?? null);
          const er = ce.earnings || {};
          cal.by[p.ticker] = {
            at: this.now(), sym,
            earnings: (er.earningsDate || []).map(x => raw(x) * 1000).filter(Boolean),
            estimate: !!er.isEarningsDateEstimate,
            epsAvg: raw(er.earningsAverage), revAvg: raw(er.revenueAverage),
            exDiv: raw(ce.exDividendDate) ? raw(ce.exDividendDate) * 1000 : null,
            divDate: raw(ce.dividendDate) ? raw(ce.dividendDate) * 1000 : null,
            stats: { marketCap: raw(sd.marketCap), pe: raw(sd.trailingPE), fwdPe: raw(sd.forwardPE), divYield: raw(sd.dividendYield),
              beta: raw(sd.beta), eps: raw(ks.trailingEps), avgVolume: raw(sd.averageVolume), currency: sd.currency || null }
          };
          ok++;
        } catch (e) { fail = e; if (/session/.test(String(e && e.message))) break; }
        await new Promise(r => setTimeout(r, 250));
      }
      cal.at = this.now();
      cal.error = ok || !fail ? null : String(fail.message || fail);
      try { atomicWrite(this.calFile(), JSON.stringify(cal)); } catch {}
      this.emitChange('calendar');
      return true;
    })().finally(() => { this.calRunning = null; });
    return this.calRunning;
  }

  // events for the calendar page: upcoming corporate events of holdings + dividends received
  calendar(positions) {
    const cal = this.calData();
    const names = Object.fromEntries(positions.map(p => [p.ticker, p]));
    const ev = [];
    for (const [tk, c] of Object.entries(cal.by)) {
      if (!names[tk] || c.none) continue;
      const base = { ticker: tk, sym: names[tk].sym, name: names[tk].name };
      (c.earnings || []).slice(0, 2).forEach((t, i) => ev.push({ ...base, type: 'earnings', time: t, estimate: c.estimate || i > 0, eps: c.epsAvg, rev: c.revAvg }));
      if (c.exDiv) ev.push({ ...base, type: 'exdiv', time: c.exDiv });
      if (c.divDate) ev.push({ ...base, type: 'divpay', time: c.divDate });
    }
    for (const d of this.data.dividends) ev.push({ ticker: d.ticker, sym: d.sym, name: d.name, type: 'paid', time: d.time, amount: d.amount });
    ev.sort((a, b) => a.time - b.time);
    return { events: ev, at: cal.at || null, error: cal.error || null, running: !!this.calRunning };
  }

  stats4(ticker) { const c = this.calData().by[ticker]; return c && c.stats ? c.stats : null; }

  // returns over standard periods + all-time high/low (instrument page), from 5 years of daily closes
  async performance({ ticker, isin, refPrice } = {}) {
    const sym = await this.resolveSymbol(ticker, isin, refPrice);
    if (!sym) return null;
    this.perfCache = this.perfCache || {};
    const c = this.perfCache[sym];
    if (c && this.now() - c.at < 30 * 60e3) return c.data;
    let r = null;
    try { r = await chart(this.fetch, sym, '5y', '1d'); } catch {}
    if (!r || r.pts.length < 2) return null;
    const pts = r.pts, last = r.last || pts[pts.length - 1][1], now = pts[pts.length - 1][0];
    const at = t => { let v = null; for (const p of pts) { if (p[0] <= t) v = p[1]; else break; } return v ?? pts[0][1]; };
    const ret = t => (t < pts[0][0] - 5 * DAY ? null : (last / at(t) - 1) * 100);
    const y0 = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    const vals = pts.map(p => p[1]);
    const data = {
      w1: ret(now - 7 * DAY), m1: ret(now - 30 * DAY), m3: ret(now - 91 * DAY), m6: ret(now - 182 * DAY), ytd: ret(y0),
      y1: ret(now - 365 * DAY), y3: ret(now - 3 * 365 * DAY), y5: ret(now - 5 * 365 * DAY + 10 * DAY),
      high5: Math.max(...vals), low5: Math.min(...vals), since: pts[0][0]
    };
    this.perfCache[sym] = { at: this.now(), data };
    return data;
  }

  // daily closes from `from` until today (full-history rebuild)
  async dailyCloses(ticker, isin, refPrice, from) {
    const sym = await this.resolveSymbol(ticker, isin, refPrice);
    if (!sym) return null;
    const age = this.now() - from;
    const range = age < 360 * DAY ? '1y' : age < 720 * DAY ? '2y' : age < 1800 * DAY ? '5y' : '10y';
    try { const c = await chart(this.fetch, sym, range, '1d'); return c ? c.pts : null; } catch { return null; }
  }

  async dayQuote(sym) {
    const c = this.dayCache[sym];
    if (c && this.now() - c.at < 120e3) return c.q;
    let q = null;
    try {
      const r = await chart(this.fetch, sym, '1d', '5m');
      if (r && r.meta && r.meta.prevClose) q = { last: r.last, prevClose: r.meta.prevClose, dayHigh: r.meta.dayHigh, dayLow: r.meta.dayLow, currency: r.meta.currency, open: r.pts.length ? r.pts[0][1] : null };
    } catch {}
    this.dayCache[sym] = { at: this.now(), q };
    return q;
  }

  // company logos from Trading 212's public icon store, cached on disk (misses retried after a week)
  async logos(tickers) {
    const dir = path.join(this.dir, 'logos');
    const missFile = path.join(dir, '_missing.json');
    if (!this.logoMiss) this.logoMiss = readJson(missFile, {}) || {};
    const out = {};
    let missChanged = false;
    for (const tk of [...new Set(tickers)].slice(0, 300)) {
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(tk)) { out[tk] = null; continue; }
      const f = path.join(dir, tk + '.png');
      try { out[tk] = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'); continue; } catch {}
      if (this.logoMiss[tk] && this.now() - this.logoMiss[tk] < 7 * DAY) { out[tk] = null; continue; }
      out[tk] = null;
      try {
        const r = await this.fetch(LOGO_BASE + encodeURIComponent(tk) + '.png');
        const type = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
        if (r.ok && /^image\//.test(type)) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 64 && buf.length < 400e3) {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(f, buf);
            out[tk] = 'data:' + type.split(';')[0] + ';base64,' + buf.toString('base64');
            continue;
          }
        }
        this.logoMiss[tk] = this.now(); missChanged = true;
      } catch { /* offline: try again next time */ }
    }
    if (missChanged) { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(missFile, JSON.stringify(this.logoMiss)); } catch {} }
    return out;
  }

  // today's move of each held position (previous close from Yahoo) — for "movers"
  async quotes(positions) {
    const m = this.mem.quotes;
    if (m && this.now() - m.at < 5 * 60e3 && positions.every(p => p.ticker in m.map)) return m.map;
    const map = {};
    for (const p of positions) {
      try {
        const sym = await this.resolveSymbol(p.ticker, p.isin, p.price);
        if (!sym) { map[p.ticker] = null; continue; }
        const q = await this.dayQuote(sym);
        map[p.ticker] = q ? { last: q.last, prevClose: q.prevClose, pct: (q.last / q.prevClose - 1) * 100, symbol: sym, currency: q.currency } : null;
      } catch { map[p.ticker] = null; }
      await new Promise(r => setTimeout(r, 120));
    }
    this.mem.quotes = { at: this.now(), map };
    return map;
  }

  // ── CSV reports (list 1 / min, request 1 / 30 s) ──────────────
  async exportsList(force) {
    const m = this.mem.exports;
    if (m && !force && this.now() - m.at < 61e3) return m.list;
    try {
      const res = await this.call('exportsList', 'GET', '/equity/history/exports');
      const list = (Array.isArray(res) ? res : []).map(r => ({
        id: r.reportId, status: r.status, from: ts(r.timeFrom), to: ts(r.timeTo),
        link: r.downloadLink || null, include: r.dataIncluded || {}
      })).sort((a, b) => (b.id || 0) - (a.id || 0));
      this.mem.exports = { at: this.now(), list };
      this.status.exports = { state: 'done', at: this.now() };
      return list;
    } catch (e) {
      this.fail('exports', e);
      if (m) return m.list;
      throw e;
    }
  }

  async requestExport({ from, to, dividends = true, interest = true, orders = true, transactions = true } = {}) {
    const f = Number(from), t = Number(to);
    if (!isFinite(f) || !isFinite(t) || t <= f) throw new Error('Bad date range');
    const body = {
      dataIncluded: { includeDividends: !!dividends, includeInterest: !!interest, includeOrders: !!orders, includeTransactions: !!transactions },
      timeFrom: new Date(f).toISOString(), timeTo: new Date(t).toISOString()
    };
    const res = await this.call('exportsRequest', 'POST', '/equity/history/exports', body);
    this.mem.exports = null;
    return { id: res && res.reportId };
  }

  exportLink(id) {
    const r = ((this.mem.exports && this.mem.exports.list) || []).find(x => x.id === id);
    if (!r || !r.link) return null;
    try { const u = new URL(r.link); return u.protocol === 'https:' ? { url: r.link, row: r } : null; } catch { return null; }
  }
}

module.exports = { Library, normOrder, normDividend, normTransaction, normPending, KINDS, PRICE_RANGES };
