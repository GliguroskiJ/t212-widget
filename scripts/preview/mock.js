// Mock window.api for design previews (injected before the page loads)
(function () {
  const cfg = window.__MOCK || {};
  function series(n, base, vol, seed) { let v = base, s = seed, out = []; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; v = v * (1 + (s / 2147483648 - 0.48) * vol); out.push(v); } return out; }
  const now = Date.now();
  // price alerts in the notify.js format (rules + per-rule state of the level rules)
  const ALERTS = {
    NVDA_US_EQ: { sym: 'NVDA', name: 'NVIDIA Corp', cur: 'USD', rules: { day: 3, above: 160, below: null, gainPct: null, lossPct: 15 }, state: {} },
    TSLA_US_EQ: { sym: 'TSLA', name: 'Tesla Inc', cur: 'USD', rules: { day: null, above: null, below: 200, gainPct: null, lossPct: 10 }, state: { loss: { armed: false, at: now - 3 * 3600e3 } } },
    MSFT_US_EQ: { sym: 'MSFT', name: 'Microsoft Corp', cur: 'USD', rules: { day: 4, above: null, below: null, gainPct: null, lossPct: null }, state: {} }
  };
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
  const SPAN = { '6M': 4 * 86400e3, YTD: 7 * 86400e3,  '1D': 9 * 60e3, '1W': 3.5 * 3600e3, '1M': 15 * 3600e3, '1Y': 7.6 * 86400e3, 'ALL': 7.6 * 86400e3 };
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

  // S&P 500 heatmap: ~500 fake constituents across the 11 GICS sectors, caps roughly like the real index
  const SP = (() => {
    let sd = 2024; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const SEC = {
      'Information Technology': [['Semiconductors', 'NVDA:4300 AVGO:1500 AMD:270 QCOM:180 TXN:170 MU:130 INTC:110 ADI:110', 14], ['Systems Software', 'MSFT:3700 ORCL:700 PANW:120 CRWD:110', 6], ['Technology Hardware, Storage & Peripherals', 'AAPL:3500 DELL:90', 5], ['Application Software', 'CRM:250 ADBE:160 INTU:180 NOW:200', 9], ['IT Consulting & Other Services', 'ACN:160 IBM:250', 5], ['Semiconductor Materials & Equipment', 'AMAT:150 LRCX:130 KLAC:110', 4], ['Communications Equipment', 'CSCO:270 ANET:170', 4], ['Electronic Components', 'APH:130 GLW:60', 4]],
      'Communication Services': [['Interactive Media & Services', 'GOOGL:2400 GOOG:2100 META:1800', 2], ['Movies & Entertainment', 'NFLX:500 DIS:200', 4], ['Integrated Telecommunication Services', 'VZ:180 T:190', 2], ['Wireless Telecommunication Services', 'TMUS:260', 1], ['Cable & Satellite', 'CMCSA:130 CHTR:50', 2], ['Advertising', 'OMC:15', 2]],
      'Consumer Discretionary': [['Broadline Retail', 'AMZN:2300 EBAY:40', 2], ['Automobile Manufacturers', 'TSLA:1400 GM:55 F:45', 1], ['Restaurants', 'MCD:220 SBUX:100 CMG:60', 6], ['Home Improvement Retail', 'HD:390 LOW:140', 1], ['Hotels, Resorts & Cruise Lines', 'BKNG:170 MAR:75', 6], ['Apparel Retail', 'TJX:150 ROST:50', 2], ['Footwear', 'NKE:100', 1], ['Homebuilding', 'DHI:50 LEN:35', 3]],
      'Financials': [['Diversified Banks', 'JPM:830 BAC:380 WFC:270 C:180', 3], ['Transaction & Payment Processing Services', 'V:670 MA:530 PYPL:70', 4], ['Multi-Sector Holdings', 'BRK-B:1050', 0], ['Investment Banking & Brokerage', 'GS:230 MS:230 SCHW:170', 3], ['Asset Management & Custody Banks', 'BLK:170 BX:190 KKR:120', 5], ['Property & Casualty Insurance', 'PGR:150 CB:115', 6], ['Financial Exchanges & Data', 'SPGI:160 CME:100 ICE:95', 4], ['Regional Banks', 'PNC:75', 8], ['Life & Health Insurance', 'MET:55', 5]],
      'Health Care': [['Pharmaceuticals', 'LLY:700 JNJ:400 MRK:220 PFE:140 BMY:95', 4], ['Managed Health Care', 'UNH:300 CI:85 ELV:75', 3], ['Health Care Equipment', 'ABT:220 ISRG:190 SYK:140 BSX:150 MDT:110', 8], ['Biotechnology', 'ABBV:380 AMGN:160 GILD:140 VRTX:110', 6], ['Life Sciences Tools & Services', 'TMO:180 DHR:140', 6], ['Health Care Distributors', 'MCK:90 COR:50', 2]],
      'Industrials': [['Aerospace & Defense', 'GE:300 RTX:210 BA:160 LMT:110 GD:85', 7], ['Rail Transportation', 'UNP:140 CSX:65', 1], ['Industrial Machinery & Supplies & Components', 'ETN:140 PH:85 ITW:75', 8], ['Construction Machinery & Heavy Transportation Equipment', 'CAT:200 DE:130 PCAR:55', 3], ['Electrical Components & Equipment', 'GEV:160 EMR:75', 4], ['Air Freight & Logistics', 'UPS:80 FDX:60', 2], ['Building Products', 'TT:90 JCI:75', 5], ['Human Resource & Employment Services', 'ADP:120 PAYX:50', 3], ['Passenger Airlines', 'DAL:40 UAL:30', 2]],
      'Consumer Staples': [['Consumer Staples Merchandise Retail', 'WMT:800 COST:420 TGT:45', 1], ['Household Products', 'PG:370 CL:70 KMB:45', 2], ['Soft Drinks & Non-alcoholic Beverages', 'KO:300 PEP:200 MNST:55', 2], ['Tobacco', 'PM:270 MO:100', 0], ['Packaged Foods & Meats', 'MDLZ:85 GIS:30 HSY:35', 8], ['Distillers & Vintners', 'BF-B:15 STZ:30', 0]],
      'Energy': [['Integrated Oil & Gas', 'XOM:480 CVX:270', 1], ['Oil & Gas Exploration & Production', 'COP:120 EOG:65', 6], ['Oil & Gas Storage & Transportation', 'WMB:70 KMI:60 OKE:55', 2], ['Oil & Gas Refining & Marketing', 'MPC:50 PSX:50', 1], ['Oil & Gas Equipment & Services', 'SLB:50 BKR:40', 1]],
      'Utilities': [['Electric Utilities', 'NEE:150 SO:100 DUK:90 CEG:100', 12], ['Multi-Utilities', 'SRE:55 D:50', 8], ['Independent Power Producers & Energy Traders', 'VST:60', 1]],
      'Real Estate': [['Telecom Tower REITs', 'AMT:95 CCI:45', 0], ['Industrial REITs', 'PLD:105', 0], ['Data Center REITs', 'EQIX:80 DLR:55', 0], ['Retail REITs', 'SPG:60 O:50', 3], ['Health Care REITs', 'WELL:100 VTR:30', 1], ['Multi-Family Residential REITs', 'AVB:30', 4], ['Self-Storage REITs', 'PSA:50', 1]],
      'Materials': [['Specialty Chemicals', 'LIN:220 SHW:90 ECL:75', 5], ['Copper', 'FCX:60', 0], ['Construction Materials', 'VMC:35 MLM:35', 0], ['Commodity Chemicals', 'DOW:20', 2], ['Fertilizers & Agricultural Chemicals', 'CTVA:45', 2], ['Steel', 'NUE:35', 1], ['Paper & Plastic Packaging Products & Materials', 'IP:25', 5], ['Gold', 'NEM:70', 0]]
    };
    const sectorBias = { 'Information Technology': 1.1, 'Energy': -1.2, 'Utilities': -0.4, 'Health Care': 0.3, 'Financials': 0.5, 'Communication Services': 0.8, 'Real Estate': -0.6, 'Consumer Staples': -0.2, 'Industrials': 0.2, 'Materials': -0.8, 'Consumer Discretionary': 0.4 };
    const used = new Set(), items = [];
    const L = 'ABCDEFGHIJKLMNOPRSTUVWXYZ';
    const fake = () => { let s; do { s = ''; const n = 2 + Math.floor(r() * 3); for (let i = 0; i < n; i++) s += L[Math.floor(r() * L.length)]; } while (used.has(s)); return s; };
    const norm = () => (r() + r() + r() - 1.5) * 1.6;
    for (const [sec, inds] of Object.entries(SEC)) for (const [ind, named, extra] of inds) {
      const ib = norm() * 0.5;
      const list = named.split(' ').map(x => x.split(':')).map(([s, c]) => [s, Number(c) * 1e9]);
      for (let k = 0; k < extra + 1; k++) list.push([fake(), (8 + Math.pow(r(), 2.2) * 90) * 1e9]);
      for (const [s, cap] of list) {
        used.add(s);
        const chg = sectorBias[sec] + ib + norm() * 1.1;
        items.push({ s: s.replace('-', '.'), y: s, n: s.length <= 4 && named.includes(s + ':') ? ({ NVDA: 'NVIDIA Corporation', MSFT: 'Microsoft Corporation', AAPL: 'Apple Inc.', TSLA: 'Tesla, Inc.', AMZN: 'Amazon.com, Inc.', GOOGL: 'Alphabet Inc. (Class A)', META: 'Meta Platforms, Inc.', JPM: 'JPMorgan Chase & Co.' }[s] || s + ' Corp.') : s + ' Holdings Inc.',
          sec, ind, cap, chg: Math.round(chg * 100) / 100, px: Math.round((20 + r() * 480) * 100) / 100, cur: 'USD', tk: ['NVDA', 'MSFT', 'AAPL', 'TSLA'].includes(s) ? s + '_US_EQ' : null });
      }
    }
    return items;
  })();
  if (cfg.sp500 === 'few') SP.splice(20);
  // the other index maps: name:cap(bn, local currency):group lists, changes made up (seeded)
  const HM = (() => {
    let sd = 77; const r = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    const mk = (spec, cur, suf, levels, bias) => {
      const out = [];
      for (const [sec, inds] of Object.entries(spec)) for (const [ind, list] of Object.entries(inds)) for (const e of list.split(' ')) {
        const [s, cap, n] = e.split(':');
        const base = s.replace(/\.$/, '').replace(/\.[A-Z]{2}$/, '');
        out.push({ s: base.replace(/_/g, '.'), y: /\.[A-Z]{2}$/.test(s) ? s : base.replace(/_/g, '-') + suf, n: (n || s).replace(/_/g, ' '), sec, ind: levels === 1 ? sec : ind, cap: Number(cap) * 1e9,
          chg: Math.round(((bias[sec] || 0) + (r() + r() + r() - 1.5) * 2.2) * 100) / 100, px: Math.round((10 + r() * 300) * 100) / 100, cur, tk: null });
      }
      return out;
    };
    const dax = mk({
      'Software': { x: 'SAP:290:SAP' }, 'Industrial': { x: 'SIE:150:Siemens ENR:70:Siemens_Energy MTX:15:MTU_Aero_Engines' }, 'Aerospace & Defence': { x: 'AIR.PA:130:Airbus RHM:70:Rheinmetall' },
      'Financial Services': { x: 'ALV:130:Allianz MUV2:75:Munich_Re DBK:55:Deutsche_Bank CBK:35:Commerzbank DB1:45:Deutsche_Börse HNR1:30:Hannover_Rück' },
      'Telecommunication': { x: 'DTE:150:Deutsche_Telekom' }, 'Automobile': { x: 'MBG:60:Mercedes-Benz BMW:55:BMW VOW3:50:Volkswagen P911:45:Porsche DTG:30:Daimler_Truck CON:13:Continental PAH3:12:Porsche_SE' },
      'Chemicals': { x: 'BAS:42:BASF SY1:12:Symrise' }, 'Pharma & Healthcare': { x: 'MRK:60:Merck_KGaA BAYN:28:Bayer SHL:55:Siemens_Healthineers FRE:22:Fresenius QIA:9:Qiagen' },
      'Technology': { x: 'IFX:48:Infineon' }, 'Transportation & Logistics': { x: 'DHL:48:DHL_Group' }, 'Utilities': { x: 'EOAN:35:E.ON RWE:25:RWE' },
      'Apparel': { x: 'ADS:38:Adidas' }, 'Retail': { x: 'ZAL:8:Zalando' }, 'Construction': { x: 'HEI:20:Heidelberg_Materials' }, 'Consumer': { x: 'BEI:25:Beiersdorf HEN3:30:Henkel' },
      'Real Estate': { x: 'VNA:24:Vonovia' }, 'Basic Resources': { x: 'BNR:12:Brenntag' }
    }, 'EUR', '.DE', 1, { 'Software': -1.4, 'Automobile': 0.9, 'Financial Services': 0.6, 'Aerospace & Defence': 1.6 });
    const sx5e = mk({
      'Technology': { x: 'ASML.AS:270:ASML SAP.DE:290:SAP IFX.DE:48:Infineon PRX.AS:80:Prosus' }, 'Consumer Discretionary': { x: 'MC.PA:280:LVMH RMS.PA:240:Hermès ITX.MC:160:Inditex RACE.MI:75:Ferrari OR.PA:200:L’Oréal MBG.DE:60:Mercedes-Benz BMW.DE:55:BMW VOW.DE:50:Volkswagen' },
      'Financials': { x: 'SAN.MC:130:Banco_Santander BBVA.MC:85:BBVA BNP.PA:80:BNP_Paribas ALV.DE:130:Allianz MUV2.DE:75:Munich_Re UCG.MI:90:UniCredit ISP.MI:85:Intesa_Sanpaolo INGA.AS:65:ING CS.PA:75:AXA DB1.DE:45:Deutsche_Börse NDA-FI.HE:42:Nordea ADYEN.AS:45:Adyen' },
      'Industrials': { x: 'SIE.DE:150:Siemens AIR.PA:130:Airbus SAF.PA:110:Safran SU.PA:130:Schneider_Electric DG.PA:65:Vinci RHM.DE:70:Rheinmetall' }, 'Health Care': { x: 'SAN.PA:120:Sanofi EL.PA:110:EssilorLuxottica ARGX.AS:40:argenx BAYN.DE:28:Bayer' },
      'Energy': { x: 'TTE.PA:130:TotalEnergies ENI.MI:45:Eni' }, 'Utilities': { x: 'IBE.MC:100:Iberdrola ENEL.MI:75:Enel ENR.DE:70:Siemens_Energy' }, 'Consumer Staples': { x: 'ABI.BR:110:AB_InBev AD.AS:32:Ahold_Delhaize BN.PA:45:Danone' },
      'Telecommunications': { x: 'DTE.DE:150:Deutsche_Telekom' }, 'Materials': { x: 'AI.PA:100:Air_Liquide BAS.DE:42:BASF SGO.PA:45:Saint-Gobain' }
    }, 'EUR', '', 1, { 'Technology': -1.1, 'Financials': 0.7 });
    const ftse = mk({
      'Financials': { 'Banks': 'HSBA:170:HSBC BARC:45:Barclays LLOY:45:Lloyds NWG:40:NatWest STAN:30:Standard_Chartered', 'Life Insurance': 'LGEN:14:Legal_&_General AV.:15:Aviva', 'Investment Banking and Brokerage Services': 'LSEG:55:LSEG III:35:3i' },
      'Health Care': { 'Pharmaceuticals and Biotechnology': 'AZN:180:AstraZeneca GSK:65:GSK HIK:5:Hikma', 'Medical Equipment and Services': 'SN.:11:Smith_&_Nephew' },
      'Energy': { 'Non-Renewable Energy': 'SHEL:170:Shell BP.:65:BP' }, 'Basic Materials': { 'Industrial Metals and Mining': 'RIO:80:Rio_Tinto GLEN:45:Glencore AAL:30:Anglo_American', 'Precious Metals and Mining': 'FRES:8:Fresnillo' },
      'Consumer Staples': { 'Personal Care, Drug and Grocery Stores': 'ULVR:120:Unilever TSCO:28:Tesco', 'Beverages': 'DGE:50:Diageo', 'Tobacco': 'BATS:75:British_American_Tobacco IMB:22:Imperial_Brands' },
      'Industrials': { 'Aerospace and Defense': 'RR.:70:Rolls-Royce BA.:40:BAE_Systems', 'Industrial Support Services': 'EXPN:35:Experian RELX:70:RELX', 'General Industrials': 'SMIN:7:Smiths' },
      'Consumer Discretionary': { 'Travel and Leisure': 'CPG:35:Compass IHG:15:IHG', 'Retailers': 'NXT:13:Next', 'Media': 'PSON:8:Pearson' },
      'Utilities': { 'Electricity': 'SSE:20:SSE', 'Gas, Water and Multi-utilities': 'NG.:50:National_Grid SVT:8:Severn_Trent' }, 'Telecommunications': { 'Telecommunications Service Providers': 'VOD:20:Vodafone BT_A:15:BT_Group' }
    }, 'GBp', '.L', 2, { 'Energy': -1.3, 'Basic Materials': 1.2 });
    const pick = (secs, n) => SP.filter(x => !secs || secs.includes(x.sec)).slice(0, n);
    const ndx = pick(['Information Technology', 'Communication Services', 'Consumer Discretionary', 'Health Care', 'Consumer Staples', 'Industrials', 'Utilities'], 101);
    const DOW = 'AAPL MSFT NVDA AMZN GOOGL JPM V WMT UNH HD PG JNJ KO CVX MRK CSCO IBM MCD DIS AXP GS CAT AMGN HON CRM BA MMM SHW TRV VZ'.split(' ');
    const dji = SP.filter(x => DOW.includes(x.y)).map(x => ({ ...x, ind: x.sec }));
    const SEC = { VWCEd_EQ: ['ETFs', 'Global Large-Cap Blend Equity'], NVDA_US_EQ: ['Technology', 'Semiconductors'], MSFT_US_EQ: ['Technology', 'Software - Infrastructure'], AAPL_US_EQ: ['Technology', 'Consumer Electronics'],
      CEZ_CZ_EQ: ['Utilities', 'Utilities - Diversified'], TSLA_US_EQ: ['Consumer Cyclical', 'Auto Manufacturers'] };
    const qs = [0.42, 2.81, -0.66, 1.12, -1.4, -3.2];
    const extra = [['EQQQd_EQ', 'EQQQ', 'Invesco EQQQ Nasdaq-100', 61200, 'ETFs', 'Technology Sector Equity', 1.31, 'EUR'], ['SAPd_EQ', 'SAP', 'SAP SE', 52400, 'Technology', 'Software - Application', -2.1, 'EUR'],
      ['KOMB_CZ_EQ', 'KOMB', 'Komerční banka', 40900, 'Financial Services', 'Banks - Regional', 0.35, 'CZK'], ['JPM_US_EQ', 'JPM', 'JPMorgan Chase & Co.', 33100, 'Financial Services', 'Banks - Diversified', 0.84, 'USD'],
      ['O_US_EQ', 'O', 'Realty Income', 18200, 'Real Estate', 'REIT - Retail', -0.55, 'USD'], ['ULVRl_EQ', 'ULVR', 'Unilever', 14100, 'Consumer Defensive', 'Household & Personal Products', 0.12, 'GBX']];
    const pf = POS.map((p, i) => ({ s: p.sym, y: p.sym, n: p.name, sec: SEC[p.ticker][0], ind: SEC[p.ticker][1], cap: p.value, chg: qs[i], px: p.price, cur: p.avgCur, tk: p.ticker }))
      .concat(extra.map(e => ({ s: e[1], y: e[1], n: e[2], sec: e[4], ind: e[5], cap: e[3], chg: e[6], px: 100, cur: e[7], tk: e[0] })));
    return { ndx: [ndx, 2, 'Nasdaq-100'], dji: [dji, 1, 'Dow Jones'], dax: [dax, 1, 'DAX 40'], sx5e: [sx5e, 1, 'EURO STOXX 50'], ftse: [ftse, 2, 'FTSE 100'], portfolio: [pf, 2, 'My portfolio'] };
  })();
  const LIB = {
    sp500: () => cfg.sp500 === 'error' ? { items: [], at: null, listAt: null, problem: { message: 'Could not load the S&P 500 list: getaddrinfo ENOTFOUND en.wikipedia.org' } }
      : { index: 'sp500', name: 'S&P 500', levels: 2, items: SP, at: now - 70e3, listAt: now - 5 * 3600e3, problem: cfg.sp500 === 'stale' ? { message: 'Yahoo Finance HTTP 429' } : null, refreshing: false, marketState: cfg.sp500 === 'closed' ? 'CLOSED' : 'REGULAR' },
    sp500Refresh: () => LIB.sp500(),
    heatmap: a => {
      const id = a.index || 'sp500';
      if (id === 'sp500') return { ...LIB.sp500(), index: 'sp500' };
      const [items, levels, name] = HM[id] || HM.dax;
      return { index: id, name, levels, items, kind: id === 'portfolio' ? 'portfolio' : undefined, currency: id === 'portfolio' ? 'CZK' : undefined,
        at: now - 70e3, listAt: id === 'portfolio' ? null : now - 5 * 3600e3, problem: null, refreshing: false, marketState: id === 'portfolio' ? null : 'REGULAR' };
    },
    heatmapRefresh: a => LIB.heatmap(a),
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
    quotes: () => Object.fromEntries(POS.map((p, i) => [p.ticker, { last: p.avg * 1.1, prevClose: p.avg, pct: [0.42, 2.81, -0.66, 1.12, -1.4, -3.2][i], currency: p.avgCur, open: p.avg, day: Array.from({ length: 78 }, (_, k) => p.avg * (1 + Math.sin(k / 6 + i) * 0.006 + k * [1, 3, -1, 2, -2, -4][i] * 0.0004 + Math.sin(k * 1.7 + i * 3) * 0.002)) }])),
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
    news: a => { const n = Date.now(); const T = [['Microsoft beats estimates as Azure growth accelerates', 'Reuters', 'reuters', 'MSFT_US_EQ'], ['Nvidia: is the AI trade getting crowded?', 'Simply Wall St', 'simplywallst', 'NVDA_US_EQ'],
      ['Apple announces quarterly dividend', 'GlobeNewswire', 'globenewswire', 'AAPL_US_EQ'], ['3 reasons to hold Microsoft stock now', 'Zacks', 'zacks', 'MSFT_US_EQ'], ['Nvidia supplier warns on demand in Asia', 'Bloomberg', 'bloomberg', 'NVDA_US_EQ'],
      ['ČEZ zvyšuje výhled zisku na letošní rok', 'Patria.cz', 'patria', 'CEZ_CZ_EQ'], ['GuruFocus: insider buying at Apple', 'GuruFocus', 'gurufocus', 'AAPL_US_EQ'], ['Stocks close higher as tech rallies', 'Associated Press', 'ap', 'NVDA_US_EQ']];
      const items = T.map(([title, publisher, pub, tk], i) => ({ id: 'nw' + i, src: i === 4 || i === 5 ? 'google' : 'yahoo', tickers: [tk], title, publisher, pub, time: n - (i * 2.3 + 0.4) * 3600e3, summary: i % 3 === 1 ? null : 'Revenue rose 12 % year over year while margins improved, beating analyst expectations; the company also raised its outlook for the rest of the year.', hasMeta: i % 3 !== 1, hasImg: i % 2 === 0 }))
        .filter(x => !a.ticker || x.tickers.includes(a.ticker)).filter(x => !a.source || x.pub === a.source);
      return { total: items.length, items, lastRun: n - 600e3, running: false }; },
    newsMeta: a => new Promise(r => setTimeout(() => r({ id: a.id, summary: 'Analysts see further upside as the company keeps gaining share in data centres, though valuation remains stretched.', image: Number(a.id.slice(2)) % 2 === 0 ? 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="340"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a4d7a"/><stop offset="1" stop-color="#7a2a5d"/></linearGradient></defs><rect width="640" height="340" fill="url(#g)"/><circle cx="480" cy="90" r="70" fill="#fff" opacity=".12"/></svg>') : null }), 400)),
    newsSources: () => ({ feeds: { yahoo: true, google: true, googleCz: true }, sources: [['reuters', 'Reuters', 'news', 12], ['ap', 'Associated Press', 'news', 4], ['bloomberg', 'Bloomberg', 'news', 3], ['cnbc', 'CNBC', 'news', 0], ['ft', 'Financial Times', 'news', 0],
      ['zacks', 'Zacks', 'analysis', 9], ['simplywallst', 'Simply Wall St', 'analysis', 7], ['gurufocus', 'GuruFocus', 'analysis', 5], ['motleyfool', 'The Motley Fool', 'analysis', 2], ['globenewswire', 'GlobeNewswire', 'press', 3], ['businesswire', 'Business Wire', 'press', 1],
      ['patria', 'Patria.cz', 'cz', 2], ['kurzy', 'Kurzy.cz', 'cz', 1], ['insidermonkey', 'Insider Monkey', 'analysis', 0], ['fool-uk', 'Fool UK', 'other', 1]].map(([key, name, group, count]) => ({ key, name, group, count, on: key !== 'insidermonkey' })) }),
    notifications: () => { const n = Date.now(); return { unread: 3, alerts: ALERTS, items: [
      { id: 'n1', type: 'alert', rule: 'day', ticker: 'NVDA_US_EQ', sym: 'NVDA', name: 'NVIDIA Corp', pct: 3.4, threshold: 3, price: 145.2, currency: 'USD', time: n - 20 * 60e3, read: false },
      { id: 'n5', type: 'alert', rule: 'above', ticker: 'NVDA_US_EQ', sym: 'NVDA', name: 'NVIDIA Corp', level: 140, price: 141.3, currency: 'USD', time: n - 50 * 60e3, read: false },
      { id: 'n6', type: 'alert', rule: 'loss', ticker: 'TSLA_US_EQ', sym: 'TSLA', name: 'Tesla Inc', pct: -10.4, threshold: 10, avg: 241.3, price: 216.2, currency: 'USD', time: n - 3 * 3600e3, read: true },
      { id: 'n2', type: 'news', ticker: 'MSFT_US_EQ', sym: 'MSFT', title: 'Microsoft beats estimates as Azure growth accelerates', publisher: 'Reuters', url: 'https://x', time: n - 2 * 3600e3, read: false },
      { id: 'n3', type: 'event', event: 'earnings', when: 'today', ticker: 'AAPL_US_EQ', sym: 'AAPL', name: 'Apple Inc', time: n - 5 * 3600e3, read: false },
      { id: 'n4', type: 'news', ticker: 'CEZ_CZ_EQ', sym: 'CEZ', title: 'ČEZ raises dividend outlook for next year', publisher: 'Patria', url: 'https://x', time: n - 30 * 3600e3, read: true }] }; },
    setAlert: a => { if (a.clear) delete ALERTS[a.ticker]; else ALERTS[a.ticker] = { ...(ALERTS[a.ticker] || {}), sym: a.sym, name: a.name, cur: a.cur || 'USD', rules: a.rules || { ...((ALERTS[a.ticker] || {}).rules || {}), day: a.pct }, state: {} }; return ALERTS[a.ticker] || null; }, notifRead: () => true, checkNow: () => ({}), openNews: () => true,
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
