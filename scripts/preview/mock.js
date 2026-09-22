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
  ].map(p => ({ ticker: p[0], sym: p[0].replace(/_EQ$/, '').replace(/_[A-Z]{2}$/, '').replace(/[a-z]+$/, ''), name: p[1], value: p[2], plPct: p[3], pl: p[2] * p[3] / (100 + p[3]), weight: p[4], qty: p[5], avg: p[6], avgCur: p[7], spark: series(14, 100, p[3] >= 0 ? 0.02 : 0.024, p[8]) }));
  const data = {
    currency: 'CZK', accountCurrency: 'CZK', accountId: 4812093,
    value: 1284640.5, cash: 42180, invested: 1242460, allTimePL: 184220, allTimePct: 16.72,
    dayAbs: 8412.4, dayPct: 0.66, dividendsYTD: 11640, holdings: 6, markets: 3,
    positions: POS, series: S.map((v, i) => [now - (47 - i) * 9 * 60e3, v])
  };
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
    init: () => Promise.resolve({ settings, state, version: '1.0.0', dataDir: 'C:\\Users\\jovan\\AppData\\Roaming\\T212 Widget' }),
    setSettings: p => { Object.assign(settings, p); window.__emit('settings', { ...settings }); return Promise.resolve(settings); },
    refresh: noop, openSettings: noop, hideWidget: noop, showWidget: noop, quit: noop, closeSettings: noop, minimizeSettings: noop,
    clearHistory: noop, openDataFolder: noop, openExternal: noop, resetPosition: noop,
    connect: () => new Promise(() => {}), disconnect: noop, getAutostart: () => Promise.resolve(true),
    drag: () => {}, setIgnoreMouse: () => {},
    onState: cb => ls.state.push(cb), onSettings: cb => ls.settings.push(cb), onGotoTab: () => {}
  };
})();
