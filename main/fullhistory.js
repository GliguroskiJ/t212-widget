'use strict';
// Rebuilds the portfolio value back to the first activity on the account (chart range "ALL"),
// once the trade and cash history are downloaded. Trading 212 has no value history, so it is
// replayed backwards from today:
//   shares_i(t) = shares now − fills after t          cash(t) = cash now − cash movements after t
//   NAV(t)      = cash(t) + Σ shares_i(t) × price_i(t) × fx_i
// Prices are daily closes (Yahoo Finance); fx_i is the account-currency value of one price unit,
// taken from today's position (or from the fills of positions already sold). FX moves over time
// and stock splits are not modelled, so older points are estimates (they are flagged as such).
// P/L(t) = NAV(t) − net deposits(t), shifted so that today's value matches Trading 212's P/L.

const DAY = 86400e3;
const snap = r => [1, 100, 0.01].reduce((best, k) => (Math.abs(Math.log(r / k)) < Math.abs(Math.log(r / best)) ? k : best), 1);

function priceAt(pts, t, idx) {
  // pts sorted ascending; idx = {i} cursor for increasing t
  while (idx.i + 1 < pts.length && pts[idx.i + 1][0] <= t) idx.i++;
  return pts[idx.i][0] <= t ? pts[idx.i][1] : null;
}

/**
 * @param {object} a
 * @param {Array} a.orders        normalised order rows (library), newest first or any order
 * @param {Array} a.transactions  normalised cash rows
 * @param {Array} a.dividends     normalised dividend rows
 * @param {Array} a.positions     raw positions from /equity/positions
 * @param {object} a.summary      raw account summary
 * @param {Function} a.prices     async (ticker, isin, refPrice, from) → [[t, close]] ascending or null
 * @param {number} a.until        rebuild points strictly before this time
 * @returns {Promise<Array<[number, number, number, 1]>>}
 */
async function rebuild({ orders, transactions, dividends, positions, summary, prices, until, now = Date.now() }) {
  const fills = orders.filter(o => o.fillType === 'TRADE' && o.qty > 0 && o.time && o.price > 0)
    .map(o => ({ t: o.time, tk: o.ticker, isin: o.isin, q: o.side === 'SELL' ? -o.qty : o.qty, val: Math.abs(o.value || 0), px: o.price }));
  const cash = [];
  for (const f of fills) cash.push({ t: f.t, d: f.q > 0 ? -f.val : f.val });
  for (const x of transactions) {
    if (!x.time) continue;
    const a = x.amount || 0;
    if (x.type === 'DEPOSIT') cash.push({ t: x.time, d: Math.abs(a), dep: Math.abs(a) });
    else if (x.type === 'WITHDRAW') cash.push({ t: x.time, d: -Math.abs(a), dep: -Math.abs(a) });
    else if (x.type === 'TRANSFER') cash.push({ t: x.time, d: a, dep: a });
    else if (x.type === 'FEE') cash.push({ t: x.time, d: -Math.abs(a) });
    else cash.push({ t: x.time, d: a });                       // interest
  }
  for (const x of dividends) if (x.time) cash.push({ t: x.time, d: x.amount || 0 });
  if (!fills.length && !cash.length) return [];
  const start = Math.min(...fills.map(f => f.t), ...cash.map(c => c.t));
  const end = Math.min(until, now);
  if (end - start < 2 * DAY) return [];

  // today's state
  const held = {};
  for (const p of positions) {
    const tk = p.instrument && p.instrument.ticker;
    if (!tk) continue;
    const v = (p.walletImpact && p.walletImpact.currentValue) || 0;
    held[tk] = { q: p.quantity || 0, px: p.currentPrice || 0, v, isin: p.instrument.isin };
  }
  const totalValue = summary.totalValue || 0;
  const cashNow = totalValue - Object.values(held).reduce((a, h) => a + h.v, 0);
  const inv = summary.investments || {};
  const plNow = (inv.unrealizedProfitLoss || 0) + (inv.realizedProfitLoss || 0);

  // per instrument: fx (account ccy per price unit) and daily closes in Trading 212's price unit
  const tickers = [...new Set([...fills.map(f => f.tk), ...Object.keys(held)])];
  const inst = {};
  for (const tk of tickers) {
    const fs = fills.filter(f => f.tk === tk).sort((a, b) => a.t - b.t);
    const h = held[tk];
    let fx = null;
    if (h && h.q && h.px) fx = h.v / (h.q * h.px);
    if (!fx) {
      const r = fs.map(f => f.val / (Math.abs(f.q) * f.px)).filter(x => isFinite(x) && x > 0).sort((a, b) => a - b);
      fx = r.length ? r[Math.floor(r.length / 2)] : 0;
    }
    let pts = null;
    try { pts = await prices(tk, (h && h.isin) || (fs[0] && fs[0].isin), h ? h.px : null, start); } catch {}
    if (pts && pts.length > 1) {
      // Yahoo vs Trading 212 price unit (GBX/GBP …): compare with today's price, else with a fill
      let k = 1;
      if (h && h.px) k = snap(pts[pts.length - 1][1] / h.px);
      else if (fs.length) { const idx = { i: 0 }; const y = priceAt(pts, fs[fs.length - 1].t, idx); if (y) k = snap(y / fs[fs.length - 1].px); }
      pts = pts.map(([t, v]) => [t, v / k]);
    } else pts = null;
    // fallback prices: the last fill price (step line) — keeps sold positions roughly right
    const steps = fs.map(f => [f.t, f.px]);
    inst[tk] = { fx, pts, steps, qNow: h ? h.q : 0, fills: fs, idx: { i: 0 }, sidx: { i: 0 } };
  }

  // daily sample times (end of each day), oldest first
  const times = [];
  const d0 = new Date(start); d0.setHours(23, 0, 0, 0);
  for (let t = d0.getTime(); t < end; t += DAY) times.push(t);
  if (!times.length) return [];

  // replay backwards: totals of everything after time t
  const cashSorted = cash.slice().sort((a, b) => a.t - b.t);
  const depTotal = cashSorted.reduce((a, c) => a + (c.dep || 0), 0);
  // prefix sums for speed
  const cumD = [], cumDep = [];
  let s1 = 0, s2 = 0;
  for (const c of cashSorted) { s1 += c.d; s2 += c.dep || 0; cumD.push(s1); cumDep.push(s2); }
  const totD = s1;
  let ci = -1;
  const out = [];
  const navNow = totalValue;
  const shift = plNow - (navNow - depTotal);
  for (const t of times) {
    while (ci + 1 < cashSorted.length && cashSorted[ci + 1].t <= t) ci++;
    const doneD = ci >= 0 ? cumD[ci] : 0;
    const doneDep = ci >= 0 ? cumDep[ci] : 0;
    const cashT = cashNow - (totD - doneD);
    let nav = cashT;
    for (const tk of tickers) {
      const I = inst[tk];
      const after = I.fills.reduce((a, f) => a + (f.t > t ? f.q : 0), 0);
      const q = I.qNow - after;
      if (q <= 1e-9) continue;
      let px = I.pts ? priceAt(I.pts, t, I.idx) : null;
      if (px == null) px = priceAt(I.steps, t, I.sidx) ?? (I.steps[0] && I.steps[0][1]);
      if (px == null) continue;
      nav += q * px * I.fx;
    }
    out.push([t, nav, nav - doneDep + shift, 1]);
  }
  return out;
}

module.exports = { rebuild, snap };
