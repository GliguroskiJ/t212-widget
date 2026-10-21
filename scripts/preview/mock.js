// Mock window.api for design previews (injected before the page loads)
(function () {
  const cfg = window.__MOCK || {};
  function series(n, base, vol, seed) { let v = base, s = seed, out = []; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; v = v * (1 + (s / 2147483648 - 0.48) * vol); out.push(v); } return out; }
  const now = Date.now();
  const S = series(48, 1276228.1, 0.0055, 991);
  S[S.length - 1] = 1284640.5;
  const POS = [
    ['VWCEd_EQ', 'Vanguard FTSE All-World', 354560, 12.1, 27.6, 2164, 128.40, 'EUR', 7],
    ['NVDA_US_EQ', 'NVIDIA Corp', 236410, 68.9, 18.4, 112, 84.20, 'USD', 13],
    ['MSFT_US_EQ', 'Microsoft Corp', 181120, 13.4, 14.1, 48, 312.10, 'USD', 21],
    ['AAPL_US_EQ', 'Apple Inc', 145240, 9.8, 11.3, 64, 186.70, 'USD', 29],
    ['CEZ_CZ_EQ', 'ČEZ a.s.', 118190, 7.7, 9.2, 124, 892.00, 'CZK', 37],
    ['TSLA_US_EQ', 'Tesla Inc', 87350, -6.6, 6.8, 38, 241.30, 'USD', 43]
  ].map(p => ({ ticker: p[0], sym: p[0].replace(/_EQ$/, '').replace(/_[A-Z]{2}$/, '').replace(/[a-z]+$/, ''), name: p[1], value: p[2], plPct: p[3], pl: p[2] * p[3] / (100 + p[3]), weight: p[4], qty: p[5], avg: p[6], avgCur: p[7], price: p[6] * (1 + p[3] / 100), isin: 'X' + p[8], spark: series(14, 100, p[3] >= 0 ? 0.02 : 0.024, p[8]) }));
  const data = {
    currency: 'CZK', accountCurrency: 'CZK', accountId: 4812093,
    value: 1284640.5, cash: 42180, invested: 1242460, allTimePL: 184220, allTimePct: 16.72,
    dayAbs: 8412.4, dayPct: 0.66, dividendsYTD: 11640, holdings: 6, markets: 3, fx: 1,
    reserved: 1800, inPies: 820, totalCost: 1058240, realizedPL: 21400, unrealizedPL: 162820,
    positions: POS, series: S.map((v, i) => [now - (47 - i) * 9 * 60e3, v])
  };
  // range-aware series with P/L per point + the period change, like main/t212.js sends it
  const SPAN = { '1D': 9 * 60e3, '1W': 3.5 * 3600e3, '1M': 15 * 3600e3, '1Y': 7.6 * 86400e3, 'ALL': 7.6 * 86400e3 };
  const rng = (cfg.settings && cfg.settings.range) || '1D';
  const PL0 = data.allTimePL - (data.value - S[0]);
  data.series = S.map((v, i) => [now - (47 - i) * SPAN[rng], v, PL0 + (v - S[0]), i < 6 && rng !== '1D' ? 1 : 0]);
  const basePl = rng === 'ALL' ? 0 : PL0;
  const abs = data.allTimePL - basePl;
  data.period = Object.assign({ range: rng, abs, pct: rng === 'ALL' ? data.allTimePct : abs / (data.value - abs) * 100,
    basePl, from: data.series[0][0], partial: false }, cfg.period || {});
  const state = Object.assign({
    status: 'live', error: null, lastSync: now - 4000,
    market: { open: true, names: 'Xetra, NYSE', opensIn: '14h 22m' }, env: 'live', encrypted: true, connected: true, data
  }, cfg.state || {});
  if (cfg.noData) state.data = null;
  if (state.status === 'error' && !state.error) state.error = { kind: 'auth', code: 401, message: '401 Unauthorized', retryAt: now + 60000 };
  if (state.status === 'error') state.lastSync = new Date().setHours(9, 42, 0, 0);
  const settings = Object.assign({ env: 'live', size: 'medium', largeView: 'chart', range: '1D', theme: 'acrylic', motion: 'full', opacity: 1, numberFormat: 'en', refreshSeconds: 30, displayCurrency: 'account', pauseWhenClosed: true, startWithWindows: true, alwaysOnTop: false, lockPosition: false, showWidget: true }, cfg.settings || {});
  const ls = { state: [], settings: [] };
  window.__emit = (k, v) => ls[k].forEach(f => f(v));
  const noop = () => Promise.resolve(true);
  window.api = {
    init: () => Promise.resolve({ settings, state, update: cfg.update || { status: 'none', current: '1.6.3', checkedAt: Date.now() - 120e3 }, version: '1.6.3', platform: cfg.platform || 'win32', route: cfg.route || '', lib: lstat, dataDir: 'C:\\Users\\user\\AppData\\Roaming\\T212 Widget' }),
    setSettings: p => { Object.assign(settings, p); window.__emit('settings', { ...settings }); return Promise.resolve(settings); },
    refresh: noop, openSettings: noop, hideWidget: noop, showWidget: noop, quit: noop, closeSettings: noop, minimizeSettings: noop,
    clearHistory: noop, openDataFolder: noop, openExternal: noop, resetPosition: noop,
    connect: () => new Promise(() => {}), disconnect: noop, getAutostart: () => Promise.resolve(true),
    drag: () => {}, setIgnoreMouse: () => {},
    checkUpdate: noop, installUpdate: noop, updateAnswer: () => {}, closeUpdate: () => {},
    getUpdateDialog: () => Promise.resolve(cfg.dialog || null),
    onUpdate: () => {}, onUpdateDialog: () => {},
    onState: cb => ls.state.push(cb), onSettings: cb => ls.settings.push(cb), onGotoTab: () => {},
    openApp: noop, appWindow: noop, onLib: () => {}, onAppGoto: () => {},
    lib: (m, a) => Promise.resolve(LIB[m] ? LIB[m](a || {}) : null)
  };
  // ── app window library mock ──
  const DAY = 86400e3;
  const rnd = (() => { let s = 42; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();
  const orders = [], dividends = [], txs = [];
  for (let i = 0; i < 90; i++) {
    const p = POS[i % POS.length], sell = i % 7 === 3, qty = Math.round(rnd() * 12 + 1);
    orders.push({ key: 'o' + i, id: i, ticker: p.ticker, sym: p.sym, name: p.name, instrCur: p.avgCur, side: sell ? 'SELL' : 'BUY', type: i % 5 ? 'MARKET' : 'LIMIT', fillType: 'TRADE',
      qty, price: p.avg * (0.8 + rnd() * 0.4), value: qty * p.avg * 23, realized: sell ? (rnd() - 0.3) * 4000 : null, fees: rnd() * 30, time: now - i * 4.3 * DAY - 3600e3 * 5 });
  }
  for (let i = 0; i < 40; i++) { const p = POS[[0, 3, 4, 2][i % 4]]; dividends.push({ key: 'd' + i, ticker: p.ticker, sym: p.sym, name: p.name, amount: 120 + rnd() * 900, qty: p.qty, perShare: 0.2 + rnd(), tickerCurrency: p.avgCur, time: now - i * 17 * DAY }); }
  for (let i = 0; i < 30; i++) txs.push({ key: 't' + i, type: i % 9 === 4 ? 'WITHDRAW' : i % 5 === 2 ? 'INTEREST_ON_FREE_CASH' : 'DEPOSIT', amount: i % 5 === 2 ? 40 + rnd() * 60 : 15000 + Math.round(rnd() * 20) * 1000, currency: 'CZK', time: now - i * 24 * DAY });
  const L = { orders, dividends, transactions: txs };
  const mk = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const stats = () => {
    const ys = new Date(new Date().getFullYear(), 0, 1).getTime();
    const d = { total: 0, ytd: 0, last12: 0, byMonth: {}, byTicker: {}, count: dividends.length, complete: true };
    for (const x of dividends) { d.total += x.amount; if (x.time >= ys) d.ytd += x.amount; if (x.time > now - 365 * DAY) d.last12 += x.amount; d.byMonth[mk(x.time)] = (d.byMonth[mk(x.time)] || 0) + x.amount; const b = d.byTicker[x.ticker] || (d.byTicker[x.ticker] = { ticker: x.ticker, sym: x.sym, name: x.name, amount: 0, count: 0 }); b.amount += x.amount; b.count++; }
    d.byTicker = Object.values(d.byTicker).sort((a, b) => b.amount - a.amount);
    const c = { deposits: 0, withdrawals: 0, interest: 0, fees: 0, byMonth: {}, complete: true };
    for (const x of txs) { if (x.type === 'DEPOSIT') c.deposits += x.amount; else if (x.type === 'WITHDRAW') c.withdrawals += x.amount; else c.interest += x.amount;
      if (x.type !== 'INTEREST_ON_FREE_CASH') { const b = c.byMonth[mk(x.time)] || (c.byMonth[mk(x.time)] = { in: 0, out: 0 }); if (x.type === 'DEPOSIT') b.in += x.amount; else b.out += x.amount; } }
    c.net = c.deposits - c.withdrawals;
    const o = { count: orders.length, buys: orders.filter(x => x.side === 'BUY').length, sells: orders.filter(x => x.side === 'SELL').length, realized: orders.reduce((a, x) => a + (x.realized || 0), 0), fees: orders.reduce((a, x) => a + x.fees, 0),
      bought: orders.filter(x => x.side === 'BUY').reduce((a, x) => a + x.value, 0), sold: orders.filter(x => x.side === 'SELL').reduce((a, x) => a + x.value, 0), complete: true };
    return { dividends: d, cash: c, orders: o };
  };
  const pricePts = (n, base, vol, seed, span) => series(n, base, vol, seed).map((v, i) => [now - (n - 1 - i) * span, v]);
  const lstat = { orders: { state: 'done', count: orders.length, complete: true, syncedAt: now - 60e3 }, dividends: { state: 'done', count: dividends.length, complete: true, syncedAt: now - 60e3 },
    transactions: { state: 'done', count: txs.length, complete: true, syncedAt: now - 60e3 }, pending: { state: 'done' }, pies: { state: 'done' }, instruments: { state: 'done' }, exports: { state: 'done' }, syncing: false, pendingCount: 2, notifUnread: 3 };
  Object.assign(lstat, cfg.lib || {});
  const PIES = [
    { id: 1, name: 'Dividendový koláč', status: 'AHEAD', goal: 500000, progress: 0.62, value: 310400, invested: 268000, result: 42400, resultPct: 15.8, cash: 820, dividends: { gained: 9120 }, count: 4, endDate: now + 900 * DAY },
    { id: 2, name: 'Tech růst', status: 'BEHIND', goal: 0, progress: 0, value: 128900, invested: 141000, result: -12100, resultPct: -8.6, cash: 120, dividends: { gained: 210 }, count: 5 },
    { id: 3, name: null, status: 'ON_TRACK', goal: 100000, progress: 0.31, value: 31000, invested: 29500, result: 1500, resultPct: 5.1, cash: 0, dividends: null, count: 3 }
  ];
  const LIB = {
    status: () => lstat,
    series: a => ({ range: a.range, series: data.series, period: data.period }),
    stats, recent: a => [...orders.slice(0, 4).map(x => ({ ...x, kind: 'orders' })), ...dividends.slice(0, 2).map(x => ({ ...x, kind: 'dividends' })), ...txs.slice(0, 2).map(x => ({ ...x, kind: 'transactions' }))].sort((a, b) => b.time - a.time).slice(0, a.limit || 8),
    activity: a => { let l = L[a.kind] || []; if (a.type) l = l.filter(x => (a.kind === 'orders' ? x.side : x.type) === a.type); if (a.q) l = l.filter(x => (x.sym + x.name).toLowerCase().includes(a.q.toLowerCase())); return { items: l.slice(0, a.limit || 100), total: l.length }; },
    pending: () => [
      { id: 1, ticker: 'NVDA_US_EQ', sym: 'NVDA', name: 'NVIDIA Corp', side: 'BUY', type: 'LIMIT', status: 'NEW', qty: 5, limitPrice: 118.5, instrCur: 'USD', tif: 'GOOD_TILL_CANCEL', created: now - 2 * DAY },
      { id: 2, ticker: 'TSLA_US_EQ', sym: 'TSLA', name: 'Tesla Inc', side: 'SELL', type: 'STOP', status: 'CONFIRMED', qty: 10, stopPrice: 210, instrCur: 'USD', tif: 'DAY', created: now - 3 * 3600e3 }],
    pies: () => PIES,
    pie: a => ({ ...PIES.find(p => p.id === a.id), created: now - 400 * DAY, dividendAction: 'REINVEST', instruments: POS.slice(0, 4).map((p, i) => ({ ticker: p.ticker, sym: p.sym, name: p.name, current: [32, 27, 22, 19][i], expected: 25, value: [99300, 83800, 68300, 59000][i], result: [5000, 2000, -800, 1200][i], resultPct: [5.3, 2.4, -1.2, 2.1][i], issues: i === 3 ? [{ name: 'DELISTED', severity: 'IRREVERSIBLE' }] : [] })) }),
    search: a => POS.filter(p => (p.sym + p.name).toLowerCase().includes(a.q.toLowerCase())).map(p => ({ ticker: p.ticker, sym: p.sym, name: p.name, type: 'STOCK', currency: p.avgCur, held: true }))
      .concat([{ ticker: 'yf:ASML.AS', sym: 'ASML.AS', name: 'ASML Holding N.V.', type: 'STOCK', exchange: 'Amsterdam', external: true }, { ticker: 'yf:^GSPC', sym: '^GSPC', name: 'S&P 500', type: 'INDEX', exchange: 'SNP', external: true }]),
    instrument: a => a.ticker.startsWith('yf:') ? { ticker: a.ticker, sym: a.ticker.slice(3), name: 'ASML Holding N.V.', external: true, exchange: 'Amsterdam', type: 'STOCK', orders: [], dividends: [], pending: [], dividendTotal: 0, realized: 0, fees: 0 } : ({ ticker: a.ticker, isin: 'US67066G1040', type: 'STOCK', currency: 'USD', hours: { exchange: 'NASDAQ', open: true, next: now + 4 * 3600e3 },
      orders: orders.filter(x => x.ticker === a.ticker).slice(0, 12), dividends: dividends.filter(x => x.ticker === a.ticker), pending: [], dividendTotal: 1820, realized: 3400, fees: 42 }),
    prices: a => { const pos = POS.find(p => p.ticker === a.ticker) || POS[1]; const span = { '1D': 5 * 60e3, '1W': 1800e3, '1M': DAY, '3M': DAY, '1Y': DAY, '5Y': 7 * DAY, 'MAX': 30 * DAY }[a.range] || DAY;
      const n = a.range === '1D' ? 78 : a.range === '1W' ? 65 : a.range === '1M' ? 22 : a.range === '3M' ? 64 : a.range === '1Y' ? 252 : 260;
      const pts = pricePts(n, pos.avg * 1.05, 0.018, 7, span); const last = pts[pts.length - 1][1];
      return { ticker: a.ticker, range: a.range, symbol: pos.sym, pts, last, meta: { currency: pos.avgCur, prevClose: pts[0][1], dayLow: last * 0.98, dayHigh: last * 1.01, low52: last * 0.7, high52: last * 1.2, volume: 18234000, exchange: 'NasdaqGS', open: last * 0.99 } }; },
    quotes: () => Object.fromEntries(POS.map((p, i) => [p.ticker, { last: p.avg * 1.1, prevClose: p.avg, pct: [0.42, 2.81, -0.66, 1.12, -1.4, -3.2][i], currency: p.avgCur }])),
    exports: () => [{ id: 9, status: 'Finished', from: now - 280 * DAY, to: now, link: 'https://x', include: { includeOrders: true, includeDividends: true, includeTransactions: true } },
      { id: 8, status: 'Processing', from: now - 30 * DAY, to: now, include: { includeDividends: true } },
      { id: 7, status: 'Failed', from: now - 700 * DAY, to: now - 365 * DAY, include: { includeOrders: true } }],
    logos: a => Object.fromEntries(a.tickers.map((tk, i) => [tk, i % 3 === 2 ? null : 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="' + ['#76b900', '#0a66c2', '#111', '#e31937', '#d62d20'][i % 5] + '"/><text x="32" y="40" font-family="Arial" font-weight="700" font-size="20" fill="#fff" text-anchor="middle">' + tk.slice(0, 2) + '</text></svg>')])),
    performance: () => ({ w1: 1.8, m1: -3.2, m3: 6.4, m6: 12.1, ytd: 18.9, y1: 24.3, y3: 61.2, y5: null, high5: 140, low5: 38 }),
    netDeposits: () => ({ complete: true, pts: data.series.map((p, i) => [p[0] - 1, 1080000 + Math.floor(i / 12) * 15000]) }),
    keyStats: () => ({ marketCap: 3.2e12, pe: 41.3, divYield: 0.0004, eps: 2.94, currency: 'USD' }),
    calendar: () => { const D = 86400e3, ev = []; const y = new Date(); y.setHours(12, 0, 0, 0);
      [['NVDA_US_EQ', 'NVDA', 'NVIDIA', 'earnings', 6], ['MSFT_US_EQ', 'MSFT', 'Microsoft', 'earnings', 9], ['AAPL_US_EQ', 'AAPL', 'Apple', 'earnings', 10], ['AAPL_US_EQ', 'AAPL', 'Apple', 'exdiv', 18], ['AAPL_US_EQ', 'AAPL', 'Apple', 'divpay', 22], ['CEZ_CZ_EQ', 'CEZ', 'ČEZ', 'paid', -8], ['VWCEd_EQ', 'VWCE', 'Vanguard', 'paid', -2], ['MSFT_US_EQ', 'MSFT', 'Microsoft', 'exdiv', 6]]
        .forEach(([ticker, sym, name, type, dd]) => ev.push({ ticker, sym, name, type, time: y.getTime() + dd * D, estimate: dd === 10, eps: type === 'earnings' ? 1.23 : null, amount: 412 }));
      return { events: ev.sort((a, b) => a.time - b.time), at: Date.now() - 3600e3, error: null, running: false }; },
    notifications: () => { const n = Date.now(); return { unread: 3, alerts: { NVDA_US_EQ: { pct: 3, sym: 'NVDA', name: 'NVIDIA Corp' } }, items: [
      { id: 'n1', type: 'alert', ticker: 'NVDA_US_EQ', sym: 'NVDA', name: 'NVIDIA Corp', pct: 3.4, threshold: 3, price: 145.2, currency: 'USD', time: n - 20 * 60e3, read: false },
      { id: 'n2', type: 'news', ticker: 'MSFT_US_EQ', sym: 'MSFT', title: 'Microsoft beats estimates as Azure growth accelerates', publisher: 'Reuters', url: 'https://x', time: n - 2 * 3600e3, read: false },
      { id: 'n3', type: 'event', event: 'earnings', when: 'today', ticker: 'AAPL_US_EQ', sym: 'AAPL', name: 'Apple Inc', time: n - 5 * 3600e3, read: false },
      { id: 'n4', type: 'news', ticker: 'CEZ_CZ_EQ', sym: 'CEZ', title: 'ČEZ raises dividend outlook for next year', publisher: 'Patria', url: 'https://x', time: n - 30 * 3600e3, read: true }] }; },
    setAlert: () => ({ pct: 3 }), notifRead: () => true, checkNow: () => ({}), openNews: () => true,
    tax: a => ({ year: a.year, currency: 'CZK', years: [2026, 2025, 2024, 2023],
      sales: { gross: 184500, valueTest: false, valueLimit: 100000, timeCap: a.year === 2025 ? 40e6 : null, timeExemptProceeds: 96000, taxProceeds: 88500, taxCost: 71200, profit: 17300, taxBase: 17300, unknownCost: false,
        rows: [{ time: now - 40 * DAY, ticker: 'AAPL_US_EQ', sym: 'AAPL', qty: 10, days: 1210, proceeds: 96000, pl: 41000, status: 'time' },
          { time: now - 40 * DAY, ticker: 'AAPL_US_EQ', sym: 'AAPL', qty: 5, days: 420, proceeds: 48000, pl: 9800, status: 'taxable' },
          { time: now - 120 * DAY, ticker: 'TSLA_US_EQ', sym: 'TSLA', qty: 8, days: 210, proceeds: 40500, pl: 7500, status: 'taxable' }] },
      dividends: { gross: 14200, withheld: 2130, credit: 2130, tax: 0, domesticNet: 3100, rows: [
        { country: 'US', rate: .15, net: 9520, gross: 11200, withheld: 1680, credit: 1680, czTax: 0, count: 14 },
        { country: 'DE', rate: .26375, net: 2210, gross: 3000, withheld: 790, credit: 450, czTax: 0, count: 2 },
        { country: 'CZ', rate: .15, net: 3100, gross: 3647, withheld: 547, credit: 547, czTax: 0, count: 1, domestic: true }] },
      interest: 412.6, soon: [{ ticker: 'MSFT_US_EQ', sym: 'MSFT', qty: 12, buyTime: now - 1000 * DAY, freeFrom: now + 95 * DAY, gain: 18400 }, { ticker: 'VWCEd_EQ', sym: 'VWCE', qty: 300, buyTime: now - 900 * DAY, freeFrom: now + 195 * DAY, gain: 9100 }] }),
    requestExport: () => ({ id: 10 }), download: () => ({ saved: true }), sync: () => true, retry: () => true, wipe: () => true
  };
})();
