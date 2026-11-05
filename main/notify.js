'use strict';
// In-app notifications: news about held companies, price alerts the user sets per instrument (day move, price levels, % from the average buy price),
// and today's calendar events (results, ex-dividend, payout). Stored in userData/notifications.json.
// News and day moves come from Yahoo Finance (the Trading 212 API has neither).

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const DAY = 86400e3;
const MAX = 300;
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function atomicWrite(f, s) { const t = f + '.tmp'; fs.writeFileSync(t, s); fs.renameSync(t, f); }
const HYST = 0.005;                                   // re-arm distance for level rules (fraction of the level)
const LEVELS = ['above', 'below', 'gain', 'loss'];
const RULE_OF = { above: 'above', below: 'below', gain: 'gainPct', loss: 'lossPct' };
const RULE_LIMITS = { day: [0.1, 50], above: [1e-6, 1e9], below: [1e-6, 1e9], gainPct: [0.1, 1000], lossPct: [0.1, 99] };
const dayStr = t => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

// validated rule set (null = no rule left); values outside the sane range are clamped, ≤ 0 / non-numbers switch a rule off
function cleanRules(src) {
  const out = {};
  let any = false;
  for (const [k, [lo, hi]] of Object.entries(RULE_LIMITS)) {
    const v = src && src[k] != null && src[k] !== '' ? Number(src[k]) : NaN;
    if (!isFinite(v) || v <= 0) { out[k] = null; continue; }
    const c = Math.min(hi, Math.max(lo, v));
    out[k] = k === 'above' || k === 'below' ? Number(c.toPrecision(8)) : Math.round(c * 10) / 10;
    any = true;
  }
  return any ? out : null;
}
// old { pct } → { rules: { day: pct } }
function normAlert(a) {
  if (!a || typeof a !== 'object') return null;
  if (a.rules && typeof a.rules === 'object') return a.state && typeof a.state === 'object' ? a : { ...a, state: {} };
  const { pct, ...rest } = a;
  const rules = cleanRules({ day: pct });
  return rules ? { ...rest, rules, state: {} } : null;
}
// minor-unit currencies (Yahoo: GBp / ZAc / ILA, Trading 212: GBX) → [major currency, factor to major]
function curUnit(c) {
  const s = String(c || '');
  if (s === 'GBX' || s === 'GBp' || s === 'GBx') return ['GBP', 0.01];
  if (s === 'ZAc' || s === 'ZAC') return ['ZAR', 0.01];
  if (s === 'ILA' || s === 'ILa') return ['ILS', 0.01];
  return [s.toUpperCase(), 1];
}
// the average buy price (Trading 212, instrument currency) expressed in the Yahoo quote's currency / units.
// Same currency → ×100 / ÷100 for pence vs pounds; a different currency → scale by the ratio of the Yahoo price to
// Trading 212's current price (today's FX); an unknown one → the same ratio, snapped to exactly ×1 / ×100 / ÷100 when close.
function avgInQuote(avg, avgCur, quoteCur, t212Price, quoteLast) {
  if (!(avg > 0)) return null;
  const [ca, fa] = curUnit(avgCur), [cq, fq] = curUnit(quoteCur);
  if (ca && cq && ca === cq) return avg * fa / fq;
  if (!(t212Price > 0) || !(quoteLast > 0)) return ca && cq ? null : avg;
  const ratio = quoteLast / t212Price;
  if (!ca || !cq) for (const f of [1, 100, 0.01]) if (Math.abs(ratio / f - 1) < 0.15) return avg * f;
  return avg * ratio;
}

class Notifier extends EventEmitter {
  constructor({ lib, dir, now }) {
    super();
    this.lib = lib;
    this.now = now || Date.now;
    this.file = path.join(dir, 'notifications.json');
    const d = readJson(this.file, null) || {};
    this.d = { items: Array.isArray(d.items) ? d.items : [], alerts: {} };
    for (const [tk, a] of Object.entries(d.alerts || {})) { const x = normAlert(a); if (x) this.d.alerts[tk] = x; }
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

  // ── price alerts ───────────────────────────────────────────
  // alerts[ticker] = { sym, name, isin, cur, since, rules: { day, above, below, gainPct, lossPct }, state: { above|below|gain|loss: { armed, at } } }
  //   day      ±% move today vs the previous close; fires once a day per direction
  //   above    price ≥ level (quote currency)        below    price ≤ level
  //   gainPct  price ≥ avg buy × (1 + x %)            lossPct  price ≤ avg buy × (1 − x %)   (holdings only)
  // Level rules (above / below / gain / loss) fire once when the condition is met and then disarm; they re-arm by
  // themselves only after the price went back across the level by HYST (0.5 % of the level), so a price hovering
  // around the level doesn't fire again and again. A rule that is already met when it is set fires at the next check.
  // Saving a rule with a new value re-arms it. The old format { pct } (day move only) is read transparently.
  setAlert(ticker, rules, meta = {}) {
    if (!ticker) return false;
    const old = this.alert(ticker);
    let r;
    if (rules == null) r = null;
    else if (typeof rules === 'object') r = cleanRules(rules);
    else r = cleanRules({ ...(old ? old.rules : {}), day: rules });          // a number → only the day rule (legacy setAlert(ticker, pct))
    if (!r) delete this.d.alerts[ticker];
    else {
      const state = {};
      if (old) for (const k of LEVELS) if (old.state[k] && r[RULE_OF[k]] === old.rules[RULE_OF[k]]) state[k] = old.state[k];
      this.d.alerts[ticker] = { sym: meta.sym || (old && old.sym) || ticker, name: meta.name || (old && old.name) || '', isin: meta.isin || (old && old.isin) || null,
        cur: meta.cur || (old && old.cur) || null, since: old ? old.since : this.now(), rules: r, state };
    }
    this.changed();
    return this.d.alerts[ticker] || null;
  }
  alert(ticker) { const a = this.d.alerts[ticker]; return a ? (this.d.alerts[ticker] = normAlert(a)) : null; }

  async checkAlerts(positions) {
    const tickers = Object.keys(this.d.alerts);
    if (!tickers.length) return 0;
    let n = 0, dirty = false;
    for (const tk of tickers) {
      const a = this.alert(tk);
      if (!a) continue;
      const r = a.rules;
      const pos = positions.find(p => p.ticker === tk) || {};
      try {
        const sym = await this.lib.resolveSymbol(tk, a.isin || pos.isin, pos.price);
        if (!sym) continue;
        const q = await this.lib.dayQuote(sym);
        if (!q || !q.last) continue;
        if (q.currency && a.cur !== q.currency) { a.cur = q.currency; dirty = true; }   // quote currency, shown next to price levels
        const base = { type: 'alert', ticker: tk, sym: a.sym, name: a.name, price: q.last, currency: q.currency || null };
        if (r.day && q.prevClose) {
          const pct = (q.last / q.prevClose - 1) * 100;
          if (Math.abs(pct) >= r.day) {
            const up = pct > 0;
            if (this.add({ ...base, key: `alert:${tk}:${dayStr(this.now())}:${up ? 'up' : 'down'}`, rule: 'day', pct, threshold: r.day })) n++;
          }
        }
        // level rules: [state key, level in quote currency, +1 = fire at/above, −1 = at/below, extra item fields]
        const lv = [];
        if (r.above) lv.push(['above', r.above, 1, { level: r.above }]);
        if (r.below) lv.push(['below', r.below, -1, { level: r.below }]);
        const avg = (r.gainPct || r.lossPct) && pos.avg > 0 ? avgInQuote(pos.avg, pos.avgCur, q.currency, pos.price, q.last) : null;
        if (avg) {
          const pct = (q.last / avg - 1) * 100;
          if (r.gainPct) lv.push(['gain', avg * (1 + r.gainPct / 100), 1, { threshold: r.gainPct, pct, avg }]);
          if (r.lossPct) lv.push(['loss', avg * (1 - r.lossPct / 100), -1, { threshold: r.lossPct, pct, avg }]);
        }
        for (const [k, level, dir, extra] of lv) {
          const st = a.state[k] || (a.state[k] = { armed: true });
          const hit = dir > 0 ? q.last >= level : q.last <= level;
          if (st.armed && hit) {
            st.armed = false; st.at = this.now(); dirty = true;
            if (this.add({ ...base, ...extra, key: `alert:${tk}:${k}:${this.now()}`, rule: k })) n++;
          } else if (!st.armed && (dir > 0 ? q.last < level * (1 - HYST) : q.last > level * (1 + HYST))) {
            st.armed = true; dirty = true;
          }
        }
      } catch {}
    }
    if (n) this.changed();
    else if (dirty) this.saveSoon();
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

  // drop news notifications whose article is gone or no longer passes the relevance rules
  pruneNews(valid) {
    const before = this.d.items.length;
    this.d.items = this.d.items.filter(x => x.type !== 'news' || !x.newsId || valid(x.newsId));
    const n = before - this.d.items.length;
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

module.exports = { Notifier, cleanRules, normAlert, avgInQuote, HYST };
