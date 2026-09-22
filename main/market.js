'use strict';
// Rough exchange-hours model (weekdays only, no holiday calendar).
const MARKETS = [
  { name: 'Xetra', tz: 'Europe/Berlin', open: 9 * 60, close: 17 * 60 + 30 },
  { name: 'NYSE', tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 }
];

const fmts = {};
function parts(tz, d) {
  if (!fmts[tz]) {
    fmts[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
  }
  const o = {};
  for (const p of fmts[tz].formatToParts(d)) o[p.type] = p.value;
  return { wd: o.weekday, min: (+o.hour % 24) * 60 + +o.minute };
}

function isOpen(m, d) {
  const p = parts(m.tz, d);
  if (p.wd === 'Sat' || p.wd === 'Sun') return false;
  return p.min >= m.open && p.min < m.close;
}

function marketStatus(now = new Date()) {
  const open = MARKETS.some(m => isOpen(m, now));
  if (open) return { open: true, names: MARKETS.map(m => m.name).join(', '), opensIn: null };
  // walk forward minute by minute (max 4 days) to the next opening
  const start = Math.ceil(now.getTime() / 60000) * 60000;
  for (let i = 0; i < 4 * 1440; i++) {
    const d = new Date(start + i * 60000);
    if (MARKETS.some(m => isOpen(m, d))) {
      const mins = Math.max(1, Math.round((d - now) / 60000));
      const h = Math.floor(mins / 60), mm = mins % 60;
      const txt = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${mm}m` : `${mm}m`;
      return { open: false, names: MARKETS.map(m => m.name).join(', '), opensIn: txt, opensAt: d.getTime() };
    }
  }
  return { open: false, names: MARKETS.map(m => m.name).join(', '), opensIn: null };
}

module.exports = { marketStatus };
