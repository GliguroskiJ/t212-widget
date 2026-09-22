'use strict';
// Fills holes in the locally recorded NAV chart (PC off, app closed) from public price history.
// Trading 212's API has no portfolio-value history, so the value is reconstructed from today's
// holdings:  NAV(t) = cash + Σ value_i(now) × price_i(t) / price_i(now)
// Ratios make the price currency/units irrelevant (GBX vs GBP, USD vs CZK); FX moves during the gap
// and trades made while the app was off are not reflected.

const YH = 'https://query1.finance.yahoo.com';
const SUFFIX = { l: '.L', d: '.DE', p: '.PA', a: '.AS', e: '.MC', m: '.MI', s: '.SW', b: '.BR', v: '.VI', i: '.IR', h: '.HK' };
const COUNTRY_SUFFIX = { US: '', CA: '.TO', CZ: '.PR', GB: '.L', DE: '.DE', FR: '.PA', NL: '.AS' };

function candidates(ticker) {
  const t = String(ticker || '');
  let m = /^(.+?)_([A-Z]{2})_EQ$/.exec(t);
  if (m) return [m[1].replace(/\./g, '-') + (COUNTRY_SUFFIX[m[2]] ?? '')];
  m = /^(.+?)([a-z])_EQ$/.exec(t);
  if (m && SUFFIX[m[2]]) return [m[1] + SUFFIX[m[2]]];
  return [];
}

async function getJson(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function searchIsin(fetchImpl, isin) {
  if (!isin) return [];
  try {
    const j = await getJson(fetchImpl, `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=8&newsCount=0`);
    return (j.quotes || []).map(q => q.symbol).filter(Boolean);
  } catch { return []; }
}

async function chart(fetchImpl, symbol, range, interval) {
  const j = await getJson(fetchImpl, `${YH}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) return null;
  const close = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [];
  const pts = [];
  r.timestamp.forEach((ts, i) => { if (close[i] != null && isFinite(close[i])) pts.push([ts * 1000, close[i]]); });
  if (pts.length < 2) return null;
  return { pts, last: (r.meta && r.meta.regularMarketPrice) || pts[pts.length - 1][1] };
}

// price sanity: Yahoo vs Trading 212 price should agree (allowing GBX/GBP ×100)
function plausible(yLast, t212Price) {
  if (!t212Price || !yLast) return true;
  const r = yLast / t212Price;
  return [1, 100, 0.01].some(k => Math.abs(r / k - 1) < 0.2);
}

async function resolveSeries(fetchImpl, pos, range, interval, symbolCache) {
  const tk = pos.instrument && pos.instrument.ticker;
  let tried = [];
  const cached = symbolCache[tk];
  const list = cached ? [cached] : candidates(tk);
  for (const pass of [0, 1]) {
    for (const sym of list) {
      if (tried.includes(sym)) continue;
      tried.push(sym);
      try {
        const c = await chart(fetchImpl, sym, range, interval);
        if (c && plausible(c.last, pos.currentPrice)) { symbolCache[tk] = sym; return c; }
      } catch {}
    }
    if (pass === 0) list.push(...(await searchIsin(fetchImpl, pos.instrument && pos.instrument.isin)));
  }
  symbolCache[tk] = cached || null;
  return null;
}

function pickRange(gapMs) {
  if (gapMs <= 4.5 * 86400e3) return ['5d', '5m'];
  if (gapMs <= 28 * 86400e3) return ['1mo', '30m'];
  return ['1y', '1d'];
}

/**
 * Reconstruct NAV points strictly inside (from, to).
 * @returns {Promise<Array<[number, number, number, 1]>>} [t, value, plEstimate, backfilledFlag]
 */
async function reconstruct({ fetchImpl, summary, positions, from, to, symbolCache }) {
  const [range, interval] = pickRange(Date.now() - from);
  const holdings = positions
    .map(p => ({ p, v: (p.walletImpact && p.walletImpact.currentValue) || 0 }))
    .filter(h => h.v > 0);
  const total = summary.totalValue || 0;
  const cash = total - holdings.reduce((a, h) => a + h.v, 0);
  const inv = summary.investments || {};
  const plNow = (inv.unrealizedProfitLoss || 0) + (inv.realizedProfitLoss || 0);

  const series = [];
  for (const h of holdings) {
    const s = await resolveSeries(fetchImpl, h.p, range, interval, symbolCache);
    series.push(s ? { v: h.v, pts: s.pts, ref: s.pts[s.pts.length - 1][1] } : { v: h.v, pts: null });
    await new Promise(r => setTimeout(r, 150));
  }
  const covered = series.filter(s => s.pts).reduce((a, s) => a + s.v, 0);
  // not worth drawing if we could price less than half of the invested money
  if (!holdings.length || covered < 0.5 * holdings.reduce((a, h) => a + h.v, 0)) return [];

  const times = [...new Set(series.flatMap(s => (s.pts ? s.pts.map(q => q[0]) : [])))]
    .filter(t => t > from + 60e3 && t < to - 60e3)
    .sort((a, b) => a - b);
  const idx = series.map(() => 0);
  const out = [];
  for (const t of times) {
    let nav = cash;
    series.forEach((s, i) => {
      if (!s.pts) { nav += s.v; return; }
      while (idx[i] + 1 < s.pts.length && s.pts[idx[i] + 1][0] <= t) idx[i]++;
      const price = s.pts[idx[i]][0] <= t ? s.pts[idx[i]][1] : s.pts[0][1];
      nav += s.v * price / s.ref;
    });
    out.push([t, nav, plNow - (total - nav), 1]);
  }
  return out;
}

module.exports = { reconstruct, candidates, pickRange, plausible };
