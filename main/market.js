'use strict';
// Exchange-hours model (weekdays only, no holiday calendar), driven by the user's holdings.
// Shared by the main process (polling cadence) and the widget (live "Opens in" countdown).
const EXCHANGES = {
  US: { name: 'NYSE', tz: 'America/New_York', open: 570, close: 960 },
  GB: { name: 'LSE', tz: 'Europe/London', open: 480, close: 990 },
  DE: { name: 'Xetra', tz: 'Europe/Berlin', open: 540, close: 1050 },
  FR: { name: 'Euronext', tz: 'Europe/Paris', open: 540, close: 1050 },
  NL: { name: 'Euronext', tz: 'Europe/Amsterdam', open: 540, close: 1050 },
  BE: { name: 'Euronext', tz: 'Europe/Brussels', open: 540, close: 1050 },
  PT: { name: 'Euronext', tz: 'Europe/Lisbon', open: 480, close: 990 },
  IE: { name: 'Euronext', tz: 'Europe/Dublin', open: 480, close: 990 },
  IT: { name: 'Borsa Italiana', tz: 'Europe/Rome', open: 540, close: 1050 },
  ES: { name: 'BME', tz: 'Europe/Madrid', open: 540, close: 1050 },
  CH: { name: 'SIX', tz: 'Europe/Zurich', open: 540, close: 1050 },
  AT: { name: 'Wiener Börse', tz: 'Europe/Vienna', open: 540, close: 1050 },
  CZ: { name: 'PSE', tz: 'Europe/Prague', open: 540, close: 980 },
  CA: { name: 'TSX', tz: 'America/Toronto', open: 570, close: 960 }
};
const DEFAULT_CODES = ['DE', 'US'];

const fmts = {};
function parts(tz, d) {
  if (!fmts[tz]) {
    fmts[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  const o = {};
  for (const p of fmts[tz].formatToParts(d)) o[p.type] = p.value;
  return { wd: o.weekday, min: (+o.hour % 24) * 60 + +o.minute };
}
function isOpen(ex, d) {
  const p = parts(ex.tz, d);
  if (p.wd === 'Sat' || p.wd === 'Sun') return false;
  return p.min >= ex.open && p.min < ex.close;
}

function exchangesFor(codes) {
  const list = [];
  const seen = new Set();
  for (const c of (codes && codes.length ? codes : DEFAULT_CODES)) {
    const ex = EXCHANGES[c];
    if (ex && !seen.has(ex.name + ex.tz)) { seen.add(ex.name + ex.tz); list.push(ex); }
  }
  return list.length ? list : DEFAULT_CODES.map(c => EXCHANGES[c]);
}

// next opening instant: coarse 15-min walk, then refine to the minute
function nextOpen(exs, now) {
  const any = d => exs.some(ex => isOpen(ex, d));
  const t0 = Math.ceil(now / 60000) * 60000;
  for (let t = t0; t < t0 + 5 * 86400e3; t += 15 * 60000) {
    if (any(new Date(t))) {
      for (let u = Math.max(t0, t - 15 * 60000); u <= t; u += 60000) if (any(new Date(u))) return u;
      return t;
    }
  }
  return null;
}

const cache = { key: '', opensAt: 0 };
function fmtIn(ms) {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function marketStatus(now = new Date(), codes) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const exs = exchangesFor(codes);
  const names = [...new Set(exs.map(e => e.name))].join(', ');
  const openList = exs.filter(ex => isOpen(ex, new Date(t)));
  if (openList.length) return { open: true, names, openNames: [...new Set(openList.map(e => e.name))].join(', '), opensIn: null, opensAt: null };
  const key = exs.map(e => e.name + e.tz).join('|');
  if (cache.key !== key || !cache.opensAt || cache.opensAt <= t) {
    cache.key = key;
    cache.opensAt = nextOpen(exs, t);
  }
  return { open: false, names, opensAt: cache.opensAt, opensIn: cache.opensAt ? fmtIn(cache.opensAt - t) : null };
}

module.exports = { marketStatus, fmtIn, EXCHANGES };
