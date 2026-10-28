'use strict';
// In-app notifications: news about held companies, price-move alerts the user sets per instrument,
// and today's calendar events (results, ex-dividend, payout). Stored in userData/notifications.json.
// News and day moves come from Yahoo Finance (the Trading 212 API has neither).

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DAY = 86400e3;
const MAX = 300;
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function atomicWrite(f, s) { const t = f + '.tmp'; fs.writeFileSync(t, s); fs.renameSync(t, f); }
const dayStr = t => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

class Notifier extends EventEmitter {
  constructor({ lib, dir, now }) {
    super();
    this.lib = lib;
    this.now = now || Date.now;
    this.file = path.join(dir, 'notifications.json');
    const d = readJson(this.file, null) || {};
    this.d = { items: Array.isArray(d.items) ? d.items : [], alerts: d.alerts || {} };
    this._t = null;
    this._fresh = [];        // new unread items since the last 'change' → system notifications
  }

  save() { try { atomicWrite(this.file, JSON.stringify(this.d)); } catch {} }
  saveSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.save(), 500); }
  changed() {
    this.saveSoon();
    this.emit('change', this.unread());
    if (this._fresh.length) this.emit('fresh', this._fresh.splice(0));
  }
  unread() { return this.d.items.filter(x => !x.read).length; }

  add(item) {
    if (this.d.items.some(x => x.key === item.key)) return false;
    const x = { id: item.key, read: false, time: this.now(), ...item };
    this.d.items.unshift(x);
    if (!x.read) this._fresh.push(x);
    this.d.items.sort((a, b) => b.time - a.time);
    if (this.d.items.length > MAX) this.d.items.length = MAX;
    return true;
  }

  list({ kind } = {}) {
    const items = kind ? this.d.items.filter(x => x.type === kind) : this.d.items;
    return { items: items.slice(0, 200), unread: this.unread(), alerts: this.d.alerts };
  }
  markRead(ids) {
    for (const x of this.d.items) if (ids === 'all' || (Array.isArray(ids) && ids.includes(x.id))) x.read = true;
    this.changed();
    return true;
  }
  remove(id) { this.d.items = this.d.items.filter(x => x.id !== id); this.changed(); return true; }
  clear() { this.d.items = []; this.changed(); return true; }

  // ── price-move alerts ──────────────────────────────────────
  setAlert(ticker, pct, meta = {}) {
    const p = Number(pct);
    if (!ticker) return false;
    if (!isFinite(p) || p <= 0) delete this.d.alerts[ticker];
    else this.d.alerts[ticker] = { pct: Math.min(50, Math.round(p * 10) / 10), sym: meta.sym || ticker, name: meta.name || '', isin: meta.isin || null, since: this.now() };
    this.changed();
    return this.d.alerts[ticker] || null;
  }

  async checkAlerts(positions) {
    const tickers = Object.keys(this.d.alerts);
    if (!tickers.length) return 0;
    let n = 0;
    for (const tk of tickers) {
      const a = this.d.alerts[tk];
      const pos = positions.find(p => p.ticker === tk) || {};
      try {
        const sym = await this.lib.resolveSymbol(tk, a.isin || pos.isin, pos.price);
        if (!sym) continue;
        const q = await this.lib.dayQuote(sym);
        if (!q || !q.prevClose || !q.last) continue;
        const pct = (q.last / q.prevClose - 1) * 100;
        if (Math.abs(pct) < a.pct) continue;
        const up = pct > 0;
        if (this.add({ key: `alert:${tk}:${dayStr(this.now())}:${up ? 'up' : 'down'}`, type: 'alert', ticker: tk, sym: a.sym, name: a.name,
          pct, threshold: a.pct, price: q.last, currency: q.currency || null })) n++;
      } catch {}
    }
    if (n) this.changed();
    return n;
  }

  // ── news about held and watched companies (fetched by news.js) ──
  addNews(items, positions = []) {
    const by = Object.fromEntries(positions.map(p => [p.ticker, p]));
    let n = 0;
    for (const x of items) {
      const p = by[x.tickers[0]] || {};
      if (this.add({ key: 'news:' + x.id, type: 'news', newsId: x.id, ticker: x.tickers[0], sym: p.sym || x.tickers[0], name: p.name || '',
        title: String(x.title).slice(0, 300), publisher: x.publisher || '', time: x.time })) n++;
    }
    if (n) this.changed();
    return n;
  }

  // ── today's / tomorrow's calendar events ───────────────────
  checkEvents(events) {
    const today = dayStr(this.now()), tomorrow = dayStr(this.now() + DAY);
    let n = 0;
    for (const e of events) {
      if (e.type === 'paid') continue;
      const d = dayStr(e.time);
      if (d !== today && d !== tomorrow) continue;
      if (this.add({ key: `event:${e.ticker}:${e.type}:${d}`, type: 'event', event: e.type, when: d === today ? 'today' : 'tomorrow',
        ticker: e.ticker, sym: e.sym, name: e.name, estimate: !!e.estimate, at: e.time })) n++;
    }
    if (n) this.changed();
    return n;
  }
}

module.exports = { Notifier };
