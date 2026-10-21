'use strict';
// Czech personal income tax overview for one calendar year (podklad pro daňové přiznání, ne daňové poradenství).
//
// Securities sales (§10 ZDP):
//   • value test  – income is exempt when the year's total gross proceeds from securities ≤ 100 000 Kč
//   • time test   – a lot held more than 3 years is exempt (from 2025 up to 40 mil. Kč proceeds a year;
//                   the cap was removed again from 2026)
//   • lots are matched FIFO; profit = proceeds − acquisition cost; losses only offset gains of the same year
// Foreign dividends (§8, separate tax base §16a, 15 %): foreign withholding is credited up to 15 %.
//   Trading 212's API gives the net amount, so withholding is estimated from the issuer's country.
//   Czech companies' dividends are taxed at source in CZ (final) and don't go into the return.
// Interest on cash (§8) is listed as received.
// Amounts are Trading 212's account-currency values; the law wants ČNB rates (daily or the annual
// "jednotný kurz"), so a CZK account gives close but not identical figures.

const DAY = 86400e3;
const VALUE_LIMIT = 100000;
const TIME_CAP = { 2025: 40e6 };      // time-test exemption cap per year (removed from 2026)
const CZ_RATE = 0.15;
// usual withholding on dividends paid to a Czech resident (treaty / domestic rates, typical case)
const WHT = { US: 0.15, GB: 0, IE: 0, DE: 0.26375, FR: 0.128, NL: 0.15, ES: 0.19, IT: 0.26, CH: 0.35, CA: 0.25, AT: 0.275, BE: 0.30,
  DK: 0.27, SE: 0.30, NO: 0.25, FI: 0.35, PT: 0.25, PL: 0.19, JP: 0.15, AU: 0.15, HK: 0, LU: 0.15, CZ: 0.15 };

const addYears = (t, n) => { const d = new Date(t); d.setFullYear(d.getFullYear() + n); return d.getTime(); };
const yearOf = t => new Date(t).getFullYear();
const countryOf = (isin, ticker) => {
  if (isin && /^[A-Z]{2}/.test(isin)) return isin.slice(0, 2);
  const m = /_([A-Z]{2})_EQ$/.exec(ticker || '');
  return m ? m[1] : '??';
};

function lotsAndSales(orders) {
  const fills = orders.filter(o => o.fillType === 'TRADE' && o.qty > 0 && o.time).sort((a, b) => a.time - b.time);
  const lots = {};          // ticker → [{ t, qty, costPer }]
  const sales = [];
  for (const f of fills) {
    const q = lots[f.ticker] || (lots[f.ticker] = []);
    const val = Math.abs(f.value || 0);
    if (f.side !== 'SELL') { q.push({ t: f.time, qty: f.qty, costPer: val / f.qty }); continue; }
    let left = f.qty;
    const matches = [];
    while (left > 1e-9 && q.length) {
      const lot = q[0];
      const take = Math.min(left, lot.qty);
      matches.push({ buyTime: lot.t, qty: take, cost: take * lot.costPer, proceeds: (val / f.qty) * take });
      lot.qty -= take; left -= take;
      if (lot.qty <= 1e-9) q.shift();
    }
    // sold more than the history shows (bought before the API history starts): cost unknown
    if (left > 1e-9) matches.push({ buyTime: null, qty: left, cost: null, proceeds: (val / f.qty) * left });
    sales.push({ time: f.time, ticker: f.ticker, sym: f.sym, name: f.name, isin: f.isin, qty: f.qty, proceeds: val, fees: f.fees || 0,
      matches: matches.map(m => ({ ...m, timeTest: m.buyTime != null && f.time > addYears(m.buyTime, 3), days: m.buyTime ? Math.floor((f.time - m.buyTime) / DAY) : null })) });
  }
  return { lots, sales };
}

function compute({ orders, dividends, transactions, positions, year, now = Date.now(), currency = 'CZK' }) {
  const { lots, sales } = lotsAndSales(orders);
  const ys = sales.filter(s => yearOf(s.time) === year);
  const gross = ys.reduce((a, s) => a + s.proceeds, 0);
  const valueTest = gross <= VALUE_LIMIT;
  const cap = TIME_CAP[year] || Infinity;
  let timeExemptProceeds = 0;
  let taxProceeds = 0, taxCost = 0, unknownCost = false;
  const rows = [];
  for (const s of ys) {
    for (const m of s.matches) {
      let status;
      if (valueTest) status = 'value';
      else if (m.timeTest && timeExemptProceeds + m.proceeds <= cap) { status = 'time'; timeExemptProceeds += m.proceeds; }
      else status = 'taxable';
      if (status === 'taxable') { taxProceeds += m.proceeds; if (m.cost == null) unknownCost = true; else taxCost += m.cost; }
      rows.push({ time: s.time, ticker: s.ticker, sym: s.sym, name: s.name, qty: m.qty, buyTime: m.buyTime, days: m.days,
        proceeds: m.proceeds, cost: m.cost, pl: m.cost == null ? null : m.proceeds - m.cost, status });
    }
  }
  const profit = taxProceeds - taxCost;

  // dividends of the year, by issuer country
  const byC = {};
  for (const d of dividends.filter(x => x.time && yearOf(x.time) === year)) {
    const c = countryOf(d.isin, d.ticker);
    const w = WHT[c] ?? 0.15;
    const net = d.amount || 0;
    const g = w < 1 ? net / (1 - w) : net;
    const r = byC[c] || (byC[c] = { country: c, rate: w, net: 0, gross: 0, withheld: 0, count: 0 });
    r.net += net; r.gross += g; r.withheld += g - net; r.count++;
  }
  const divRows = Object.values(byC).map(r => {
    const domestic = r.country === 'CZ';
    const credit = Math.min(r.withheld, r.gross * CZ_RATE);
    return { ...r, domestic, credit, czTax: domestic ? 0 : Math.max(0, r.gross * CZ_RATE - credit) };
  }).sort((a, b) => b.gross - a.gross);
  const foreign = divRows.filter(r => !r.domestic);
  const div = {
    rows: divRows,
    gross: foreign.reduce((a, r) => a + r.gross, 0),
    withheld: foreign.reduce((a, r) => a + r.withheld, 0),
    credit: foreign.reduce((a, r) => a + r.credit, 0),
    tax: foreign.reduce((a, r) => a + r.czTax, 0),
    domesticNet: divRows.filter(r => r.domestic).reduce((a, r) => a + r.net, 0)
  };
  const interest = transactions.filter(x => x.time && yearOf(x.time) === year && (x.type === 'INTEREST_ON_FREE_CASH' || x.type === 'LENDING_INTEREST'))
    .reduce((a, x) => a + (x.amount || 0), 0);

  // open lots of current holdings that pass the 3-year test soon (next 12 months)
  const valuePer = {};
  for (const p of positions || []) { const tk = p.instrument && p.instrument.ticker; const v = p.walletImpact && p.walletImpact.currentValue; if (tk && p.quantity) valuePer[tk] = (v || 0) / p.quantity; }
  const soon = [];
  for (const [tk, q] of Object.entries(lots)) {
    if (!(tk in valuePer)) continue;
    const meta = orders.find(o => o.ticker === tk) || {};
    for (const l of q) {
      if (l.qty <= 1e-9) continue;
      const free = addYears(l.t, 3);
      if (free <= now || free > now + 365 * DAY) continue;
      soon.push({ ticker: tk, sym: meta.sym, name: meta.name, qty: l.qty, buyTime: l.t, freeFrom: free, cost: l.qty * l.costPer, value: l.qty * valuePer[tk], gain: l.qty * (valuePer[tk] - l.costPer) });
    }
  }
  soon.sort((a, b) => a.freeFrom - b.freeFrom);

  const years = [...new Set([...orders.map(o => o.time), ...dividends.map(d => d.time), ...transactions.map(t => t.time)].filter(Boolean).map(yearOf))].sort((a, b) => b - a);
  return {
    year, currency, years,
    sales: { gross, valueTest, valueLimit: VALUE_LIMIT, timeCap: TIME_CAP[year] || null, timeExemptProceeds, taxProceeds, taxCost, profit, taxBase: Math.max(0, profit), unknownCost, rows: rows.sort((a, b) => b.time - a.time) },
    dividends: div, interest, soon
  };
}

module.exports = { compute, lotsAndSales, countryOf, WHT, VALUE_LIMIT };
