// Index heatmaps (main/indices.js): the generic Wikipedia table parser against fixtures shaped like each
// article (checked 2026-11 on en.wikipedia.org), ticker → Yahoo symbol conversion, ICB grouping, the
// per-index service (page fallbacks, cache file) and the "My portfolio" grouping — no network.
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
const I = require('../main/indices');
const { toYahoo, parseWikitextFull, parseHtmlFull, icbIndustry, portfolioGroup, profileOf, IndexMap, PortfolioMap, INDICES, HEATMAPS, t212Map } = I;

// ── symbols ──
const Y = (raw, market, extra) => (toYahoo(raw, market, extra) || {}).y;
assert.strictEqual(Y('BRK.B', 'us'), 'BRK-B');
assert.strictEqual(Y('ADS.DE', 'de'), 'ADS.DE');
assert.strictEqual(Y('AIR.PA', 'de'), 'AIR.PA', 'Airbus is in the DAX but listed in Paris');
assert.strictEqual(Y('MUV2', 'de'), 'MUV2.DE');
assert.strictEqual(toYahoo('ADS.DE', 'de').s, 'ADS');
assert.strictEqual(Y('BT.A', 'uk'), 'BT-A.L');
assert.strictEqual(toYahoo('BT.A', 'uk').s, 'BT.A');
assert.strictEqual(Y('RR.', 'uk'), 'RR.L');
assert.strictEqual(Y('III', 'uk'), 'III.L');
assert.strictEqual(Y('ASML', 'eu', { listing: 'Netherlands Euronext Amsterdam: ASML' }), 'ASML.AS');
assert.strictEqual(Y('AIR', 'eu', { listing: 'France Euronext Paris: AIR', country: 'Netherlands' }), 'AIR.PA', 'the listing wins over the registered office');
assert.strictEqual(Y('SAP', 'eu', { listing: 'Xetra: SAP' }), 'SAP.DE');
assert.strictEqual(Y('ENEL', 'eu', { listing: 'Italy BIT: ENEL' }), 'ENEL.MI');
assert.strictEqual(Y('ITX', 'eu', { listing: 'Spain BMAD: ITX' }), 'ITX.MC');
assert.strictEqual(Y('ABI', 'eu', { listing: 'Belgium Euronext Brussels: ABI' }), 'ABI.BR');
assert.strictEqual(Y('', 'eu', { listing: 'Finland Nasdaq Helsinki: NDA FI' }), 'NDA-FI.HE', 'ticker from the listing cell');
assert.strictEqual(Y('KRZ', 'eu', { listing: 'Euronext Dublin: KRZ' }), 'KRZ.IR');
assert.strictEqual(Y('EDP', 'eu', { listing: 'Euronext Lisbon: EDP' }), 'EDP.LS');
assert.strictEqual(Y('BBVA', 'eu', { listing: 'BBVA', country: 'Spain' }), 'BBVA.MC', 'registered office as the last resort');
assert.strictEqual(Y('X', 'eu', { listing: 'Somewhere: X' }), undefined, 'no exchange → left out');
assert.strictEqual(Y('NYSE: KO', 'us'), 'KO');
assert.strictEqual(icbIndustry('Banks'), 'Financials');
assert.strictEqual(icbIndustry('Aerospace and Defence'), 'Industrials');
assert.strictEqual(icbIndustry('Personal Care, Drug & Grocery Stores'), 'Consumer Staples');
assert.strictEqual(icbIndustry('Something new'), null);
assert.deepStrictEqual(HEATMAPS, ['sp500', 'ndx', 'dji', 'dax', 'sx5e', 'ftse', 'portfolio']);

const fill = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');

// ── Nasdaq-100: "Current components", Ticker | Company | ICB Industry | ICB Subsector (older revisions: GICS Sector | GICS Sub-Industry) ──
{
  let wt = '{{Short description|Stock market index}}\n{{Infobox ...}}\n== Current components ==\n' +
    '{| class="wikitable sortable" id="constituents" style="font-size:90%"\n|+ Nasdaq-100 components\n' +
    '! Ticker !! Company !! ICB Industry<ref name="icb"/> !! ICB Subsector<ref name="icb"/>\n' +
    '|-\n| ADBE || [[Adobe Inc.]] || Technology || Computer Software\n' +
    '|-\n| AMD || [[Advanced Micro Devices]] || Technology || Semiconductors\n' +
    '|-\n| ABNB || [[Airbnb]] || Consumer Discretionary || Diversified Commercial Services\n' +
    '|-\n| GOOGL || [[Alphabet Inc.]] (Class A) || Technology || Computer Software\n' +
    fill(97, i => `|-\n| N${i} || [[N${i} Corp]] || ${['Technology', 'Health Care', 'Industrials'][i % 3]} || Sub ${i % 7}\n`) + '|}\n' +
    '== Annual returns ==\n{| class="wikitable"\n! Year !! Closing level !! Change\n|-\n| 2024 || 21,012 || 24.9\n|}\n';
  const r = parseWikitextFull(wt, 'ndx');
  assert.strictEqual(r.items.length, 101); assert.strictEqual(r.levels, 2);
  assert.deepStrictEqual(r.items[3], { sym: 'GOOGL', y: 'GOOGL', name: 'Alphabet Inc. (Class A)', sector: 'Technology', industry: 'Computer Software' });
  // GICS-headed revision
  const g = parseWikitextFull(wt.replace('ICB Industry<ref name="icb"/>', '[[Global Industry Classification Standard|GICS]] Sector').replace('ICB Subsector<ref name="icb"/>', 'GICS Sub-Industry'), 'ndx');
  assert.strictEqual(g.items[1].sector, 'Technology'); assert.strictEqual(g.items[1].industry, 'Semiconductors');
}

// ── Dow Jones (List of Dow Jones Industrial Average companies): Company | Exchange | Symbol | Sector | Date added | Notes ──
{
  let html = '<p>The following are the components of the index:</p><table class="wikitable sortable" id="constituents"><tbody>' +
    '<tr><th>Company</th><th>Exchange</th><th>Symbol</th><th>Sector</th><th>Date added</th><th>Notes</th></tr>' +
    '<tr><td><a href="/wiki/3M">3M</a></td><td><a href="/wiki/NYSE">NYSE</a></td><td><a rel="nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:MMM">MMM</a></td><td>Industrials</td><td>1976-08-09</td><td>As Minnesota Mining and Manufacturing</td></tr>' +
    '<tr><td><a href="/wiki/Alphabet_Inc.">Alphabet</a> (Class A)</td><td>NASDAQ</td><td>GOOGL</td><td>Communication Services</td><td>2026-06-29</td><td></td></tr>' +
    fill(28, i => `<tr>\n<td><a href="/wiki/D${i}">Dow ${i} Inc.</a>\n</td>\n<td>NYSE</td>\n<td>D${i}</td>\n<td>${['Financials', 'Health Care'][i % 2]}</td>\n<td>2000-01-01</td>\n<td></td>\n</tr>\n`) +
    '</tbody></table><table class="wikitable"><tr><th>Year</th><th>Closing value</th></tr><tr><td>2025</td><td>48,000</td></tr></table>';
  const r = parseHtmlFull(html, 'dji');
  assert.strictEqual(r.items.length, 30); assert.strictEqual(r.levels, 1, 'one level: the sector');
  assert.deepStrictEqual(r.items[0], { sym: 'MMM', y: 'MMM', name: '3M', sector: 'Industrials', industry: 'Industrials' });
  assert.strictEqual(r.items[1].name, 'Alphabet (Class A)');
}

// ── DAX: Ticker | Logo | Company | Prime Standard Sector | Index weighting (%) | Employees | Founded ──
const daxWt = '{{Infobox ...}}\nBelow is the list of companies which are a component of the DAX 40, as of 22 September 2025.\n' +
  '{| class="wikitable sortable" style="text-align:center"\n! Ticker !! Logo !! Company !! [[Prime Standard]] Sector !! Index weighting (%)<sup>1</sup> !! Employees !! Founded\n' +
  '|-\n| ADS.DE || [[File:Adidas Logo.svg|80px]] || [[Adidas]] || Apparel || 2.5 || {{0}}62,035 (2024) || 1924\n' +
  '|-\n| AIR.PA || [[File:Airbus logo 2017.svg|80px]] || [[Airbus]] || Aerospace & Defence || 6.1 || 126,495 (2021) || 1970\n' +
  '|-\n| {{FWB|ALV}} || || [[Allianz]] || Financial Services || 8.4 || 156,626 (2024) || 1890\n' +
  fill(37, i => `|-\n| X${i}.DE || [[File:X${i}.png|80px]] || [[X${i} AG]] || ${['Chemicals', 'Software', 'Automobile'][i % 3]} || 1.0 || 1,000 || 1900\n`) + '|}\n' +
  '== Former components ==\n{| class="wikitable"\n! Ticker !! Company !! Removed\n|-\n| OLD.DE || Old AG || 2021\n|}\n';
{
  const r = parseWikitextFull(daxWt, 'dax');
  assert.strictEqual(r.items.length, 40, 'the components table, not the former ones');
  assert.deepStrictEqual(r.items[0], { sym: 'ADS', y: 'ADS.DE', name: 'Adidas', sector: 'Apparel', industry: 'Apparel' });
  assert.strictEqual(r.items[1].y, 'AIR.PA'); assert.strictEqual(r.items[1].sector, 'Aerospace & Defence');
  assert.strictEqual(r.items[2].y, 'ALV.DE', 'template ticker without a suffix → Xetra');
  // rendered page: the logo cell has an <img>, weights a footnote
  const html = '<table class="wikitable sortable"><tbody><tr><th>Ticker</th><th>Logo</th><th>Company</th><th><a href="/wiki/Prime_Standard">Prime Standard</a> Sector</th><th>Index weighting (%)<sup id="cite_ref-1">1</sup></th><th>Employees</th><th>Founded</th></tr>' +
    fill(40, i => `<tr><td>D${i}.DE</td><td><span typeof="mw:File"><img src="x.png" alt="logo"></span></td><td><a href="/wiki/D${i}">D${i} SE</a></td><td>Chemicals</td><td>1.2</td><td>1</td><td>1900</td></tr>`) + '</tbody></table>';
  const h = parseHtmlFull(html, 'dax');
  assert.strictEqual(h.items.length, 40); assert.strictEqual(h.items[5].y, 'D5.DE'); assert.strictEqual(h.items[5].name, 'D5 SE');
}

// ── EURO STOXX 50: Ticker | Main listing | Name | Corporate form | Registered office | Sector | Founded ──
{
  let wt = 'As of 22 September 2025, Euro Stoxx 50 consists of the following companies:\n{| class="wikitable sortable"\n' +
    '! Ticker !! Main listing !! Name !! Corporate form !! Registered office !! Sector !! Founded\n' +
    '|-\n| ADS.DE || {{flagicon|GER}} [[Frankfurt Stock Exchange|FWB]]: {{FWB|ADS}} || [[Adidas]] || {{flagicon|GER}} [[Aktiengesellschaft]] || {{flagicon|GER}} Germany || Consumer Discretionary || 1924\n' +
    '|-\n| AIR.PA || {{flagicon|FRA}} [[Euronext Paris]]: {{Euronext|AIR}} || [[Airbus]] || {{flagicon|EU}} [[Societas Europaea]] || {{flagicon|FRA}} France || Industrials || 1970\n' +
    '|-\n| SAN.PA || {{flagicon|FRA}} [[Euronext Paris]]: SAN || [[Sanofi]] || x || France || Health Care || 1973\n' +
    '|-\n| SAN.MC || {{flagicon|ESP}} [[Bolsa de Madrid|BMAD]]: {{BMAD|SAN}} || [[Banco Santander]] || x || Spain || Financials || 1857\n' +
    '|-\n| || {{flagicon|FIN}} [[Nasdaq Helsinki]]: NDA FI || [[Nordea]] || x || Finland || Financials || 2000\n' +
    '|-\n| ENEL || {{flagicon|ITA}} [[Borsa Italiana|BIT]]: {{BIT|ENEL}} || [[Enel]] || x || Italy || Utilities || 1962\n' +
    fill(44, i => `|-\n| E${i}.AS || {{flagicon|NED}} [[Euronext Amsterdam]]: E${i} || [[E${i} N.V.]] || x || Netherlands || ${['Financials', 'Technology'][i % 2]} || 1900\n`) + '|}\n';
  const r = parseWikitextFull(wt, 'sx5e');
  assert.strictEqual(r.items.length, 50);
  const by = Object.fromEntries(r.items.map(x => [x.y, x]));
  assert.ok(by['SAN.PA'] && by['SAN.MC'], 'same ticker on two exchanges = two companies');
  assert.strictEqual(by['SAN.MC'].name, 'Banco Santander');
  assert.strictEqual(by['NDA-FI.HE'].name, 'Nordea');
  assert.strictEqual(by['ENEL.MI'].sector, 'Utilities');
  assert.strictEqual(by['ADS.DE'].s, undefined); assert.strictEqual(by['ADS.DE'].sym, 'ADS');
}

// ── FTSE 100: Company | Ticker | ISIN | FTSE industry classification benchmark sector (ICB sector → industry groups) ──
{
  const SECS = ['Banks', 'Pharmaceuticals and Biotechnology', 'Oil, Gas and Coal', 'Industrial Metals and Mining', 'Software and Computer Services'];
  let html = '<p>The following table lists the FTSE 100 companies after the changes on 1 October 2026.</p><table class="wikitable sortable" id="constituents"><tbody>' +
    '<tr><th>Company</th><th>Ticker</th><th>ISIN</th><th><a href="/wiki/Industry_Classification_Benchmark">FTSE industry classification benchmark</a> sector<sup class="reference">[18]</sup></th></tr>' +
    '<tr><td><a href="/wiki/3i">3i</a></td><td>III</td><td>GB00B1YW4409</td><td>Investment Banking and Brokerage Services</td></tr>' +
    '<tr><td><a href="/wiki/BT_Group">BT Group</a></td><td>BT.A</td><td>GB0030913577</td><td>Telecommunications Service Providers</td></tr>' +
    '<tr><td>Rolls-Royce Holdings</td><td>RR.</td><td>GB00B63H8491</td><td>Aerospace and Defense</td></tr>' +
    '<tr><td>Brand New plc</td><td>BNP</td><td>GB0000000001</td><td>Space Tourism</td></tr>' +
    fill(96, i => `<tr><td>F${i} plc</td><td>F${i}</td><td>GB${i}</td><td>${SECS[i % 5]}</td></tr>`) + '</tbody></table>';
  const r = parseHtmlFull(html, 'ftse');
  assert.strictEqual(r.items.length, 100); assert.strictEqual(r.levels, 2);
  assert.deepStrictEqual(r.items[0], { sym: 'III', y: 'III.L', name: '3i', sector: 'Financials', industry: 'Investment Banking and Brokerage Services' });
  assert.deepStrictEqual([r.items[1].y, r.items[1].sym, r.items[1].sector], ['BT-A.L', 'BT.A', 'Telecommunications']);
  assert.deepStrictEqual([r.items[2].y, r.items[2].sector], ['RR.L', 'Industrials']);
  assert.deepStrictEqual([r.items[3].sector, r.items[3].industry], ['Space Tourism', 'Space Tourism'], 'unknown ICB sector stays its own group');
  assert.ok(new Set(r.items.map(x => x.sector)).size <= 8);
}

// ── S&P 500 still prefers id="constituents" over a longer table ──
{
  const wt = '{| class="wikitable"\n! Symbol !! Security !! Sector\n' + fill(600, i => `|-\n| Z${i} || Z || S\n`) + '|}\n' +
    '{| class="wikitable sortable" id="constituents"\n! Symbol !! Security !! GICS Sector !! GICS Sub-Industry\n' + fill(450, i => `|-\n| C${i} || C || IT || Soft\n`) + '|}\n';
  assert.strictEqual(parseWikitextFull(wt, 'sp500').items[0].sym, 'C0');
}

// ── T212 map: European instruments by exchange suffix ──
{
  const tm = t212Map({ SAPd_EQ: { type: 'STOCK' }, BARCl_EQ: { type: 'STOCK' }, 'BT.Al_EQ': { type: 'STOCK' }, ASMLa_EQ: { type: 'STOCK' }, AIRp_EQ: { type: 'STOCK' }, VWCEd_EQ: { type: 'ETF' } }, {});
  assert.strictEqual(tm['SAP.DE'], 'SAPd_EQ'); assert.strictEqual(tm['BARC.L'], 'BARCl_EQ'); assert.strictEqual(tm['BT-A.L'], 'BT.Al_EQ');
  assert.strictEqual(tm['ASML.AS'], 'ASMLa_EQ'); assert.strictEqual(tm['AIR.PA'], 'AIRp_EQ'); assert.ok(!tm['VWCE.DE']);
}

// ── portfolio grouping ──
assert.deepStrictEqual(profileOf({ assetProfile: { sector: 'Technology', industry: 'Semiconductors' }, quoteType: { quoteType: 'EQUITY' } }),
  { type: 'EQUITY', sector: 'Technology', industry: 'Semiconductors', category: null, family: null });
assert.deepStrictEqual(portfolioGroup({}, { type: 'EQUITY', sector: 'Technology', industry: 'Semiconductors' }), { sec: 'Technology', ind: 'Semiconductors' });
assert.deepStrictEqual(portfolioGroup({}, { type: 'ETF', category: 'Global Large-Cap Blend Equity' }), { sec: 'ETFs', ind: 'Global Large-Cap Blend Equity' });
assert.deepStrictEqual(portfolioGroup({ type: 'ETF' }, null), { sec: 'ETFs', ind: 'ETF' }, 'T212 type when Yahoo has no profile');
assert.deepStrictEqual(portfolioGroup({}, null, { type: 'ETF' }), { sec: 'ETFs', ind: 'ETF' }, 'quote type');
assert.deepStrictEqual(portfolioGroup({}, { type: 'EQUITY' }), { sec: 'Other', ind: 'Other' });
assert.deepStrictEqual(portfolioGroup({}, { type: 'EQUITY', sector: 'Utilities' }), { sec: 'Utilities', ind: 'Utilities' });

(async () => {
  const res = (status, body, text) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text || JSON.stringify(body) });
  const quoteAnswer = u => {
    const syms = decodeURIComponent(/symbols=([^&]*)/.exec(u)[1]).split(',');
    return res(200, { quoteResponse: { result: syms.map((s, i) => ({ symbol: s, regularMarketPrice: 50 + i, regularMarketChangePercent: i % 2 ? 1.5 : -0.7, marketCap: 2e9 * (i + 1), currency: 'EUR',
      quoteType: /VWCE/.test(s) ? 'ETF' : 'EQUITY', marketState: 'REGULAR' })) } });
  };

  // ── DAX service: the API is down → rendered page; own cache file; list error names the index ──
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-idx-'));
    const calls = [];
    const fetchImpl = async u => {
      calls.push(u);
      if (u.includes('/w/api.php')) return res(503, {});
      if (u.includes('/wiki/DAX')) return res(200, null, '<table class="wikitable"><tr><th>Ticker</th><th>Company</th><th>Prime Standard Sector</th></tr>' + fill(40, i => `<tr><td>D${i}.DE</td><td>D${i} AG</td><td>${i % 2 ? 'Software' : 'Chemicals'}</td></tr>`) + '</table>');
      if (u.includes('/v7/finance/quote')) return quoteAnswer(u);
      throw new Error('unexpected ' + u);
    };
    const svc = new IndexMap({ index: 'dax', fetchImpl, dir, crumb: async () => ({ crumb: 'C', cookie: 'A3=x' }) });
    const p = await svc.get({});
    assert.strictEqual(p.index, 'dax'); assert.strictEqual(p.name, 'DAX 40'); assert.strictEqual(p.levels, 1);
    assert.strictEqual(p.items.length, 40); assert.strictEqual(p.problem, null);
    assert.ok(p.items.every(x => x.cap > 0 && x.cur === 'EUR'));
    assert.ok(calls.some(u => u.includes('page=DAX&')), 'wikitext API asked first');
    assert.ok(fs.existsSync(path.join(dir, 'heatmap-dax.json')));
    assert.strictEqual(p.marketState, 'REGULAR');
    const off = new IndexMap({ index: 'dax', fetchImpl: async () => { throw new Error('offline'); }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 't212-idx0-')), crumb: async () => ({ crumb: 'C' }) });
    const e = await off.get({});
    assert.ok(e.problem && /DAX 40 list: offline/.test(e.problem.message));
  }

  // ── Dow: the list article is missing → the index article is tried next ──
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-idx-'));
    const pages = [];
    const fetchImpl = async u => {
      if (u.includes('/v7/finance/quote')) return quoteAnswer(u);
      pages.push(u);
      if (/List_of_Dow/.test(u)) return res(404, {});
      if (u.includes('/w/api.php')) return res(200, { parse: { wikitext: '{| class="wikitable sortable"\n! Company !! Exchange !! Symbol !! Industry\n' + fill(30, i => `|-\n| [[C${i}]] || [[NYSE]] || {{NyseSymbol|C${i}}} || Tech\n`) + '|}' } });
      throw new Error('unexpected ' + u);
    };
    const p = await new IndexMap({ index: 'dji', fetchImpl, dir, crumb: async () => ({ crumb: 'C' }) }).get({});
    assert.strictEqual(p.items.length, 30); assert.strictEqual(p.items[0].sec, 'Tech');
    assert.ok(pages.some(u => /page=Dow_Jones_Industrial_Average&/.test(u)));
  }

  // ── My portfolio: symbols resolved once, quotes + profiles, ETF group, value as size ──
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-pf-'));
    let resolves = 0, summaries = [], now = 1e12, changed = 0;
    const SYM = { NVDA_US_EQ: 'NVDA', VWCEd_EQ: 'VWCE.DE', CEZ_CZ_EQ: 'CEZ.PR', ODD_US_EQ: null };
    const PROF = { NVDA: { assetProfile: { sector: 'Technology', industry: 'Semiconductors' }, quoteType: { quoteType: 'EQUITY' } },
      'VWCE.DE': { fundProfile: { categoryName: 'Global Large-Cap Blend Equity' }, quoteType: { quoteType: 'ETF' } },
      'CEZ.PR': { assetProfile: { sector: 'Utilities', industry: 'Utilities—Diversified' }, quoteType: { quoteType: 'EQUITY' } } };
    const pf = new PortfolioMap({ dir, now: () => now, onChange: () => changed++, crumb: async () => ({ crumb: 'C' }),
      fetchImpl: async u => { assert.ok(u.includes('/v7/finance/quote')); return quoteAnswer(u); },
      resolve: async tk => { resolves++; return SYM[tk]; },
      summary: async (s, mods) => { summaries.push(s); assert.strictEqual(mods, 'assetProfile,fundProfile,quoteType'); return PROF[s]; } });
    const pos = [{ ticker: 'NVDA_US_EQ', sym: 'NVDA', name: 'NVIDIA', value: 2000, price: 140 }, { ticker: 'VWCEd_EQ', sym: 'VWCE', name: 'Vanguard FTSE All-World', value: 5000, type: 'ETF' },
      { ticker: 'CEZ_CZ_EQ', sym: 'CEZ', name: 'ČEZ', value: 900 }, { ticker: 'ODD_US_EQ', sym: 'ODD', name: 'Odd', value: 10 }, { ticker: 'ZERO_US_EQ', sym: 'ZERO', value: 0 }];
    const p = await pf.get(pos, { currency: 'CZK' });
    assert.strictEqual(p.index, 'portfolio'); assert.strictEqual(p.currency, 'CZK');
    assert.strictEqual(p.items.length, 4, 'empty positions left out');
    const by = Object.fromEntries(p.items.map(x => [x.tk, x]));
    assert.deepStrictEqual([by.NVDA_US_EQ.sec, by.NVDA_US_EQ.ind, by.NVDA_US_EQ.cap], ['Technology', 'Semiconductors', 2000]);
    assert.deepStrictEqual([by.VWCEd_EQ.sec, by.VWCEd_EQ.ind], ['ETFs', 'Global Large-Cap Blend Equity']);
    assert.strictEqual(by.CEZ_CZ_EQ.sec, 'Utilities'); assert.ok(by.CEZ_CZ_EQ.chg != null);
    assert.deepStrictEqual([by.ODD_US_EQ.sec, by.ODD_US_EQ.chg], ['Other', null], 'no Yahoo symbol → no change, own group');
    assert.ok(fs.existsSync(path.join(dir, 'heatmap-profiles.json')));
    const r1 = resolves, s1 = summaries.length;
    now += 5 * 60e3;
    const p2 = await pf.get(pos, {});
    assert.strictEqual(p2.refreshing, true);
    await pf.running; await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(changed, 1);
    assert.strictEqual(resolves, r1, 'symbols resolved once'); assert.strictEqual(summaries.length, s1, 'profiles cached for a month');
    // profiles survive a restart
    const pf2 = new PortfolioMap({ dir, now: () => now, crumb: async () => ({ crumb: 'C' }), fetchImpl: async u => quoteAnswer(u), resolve: async tk => SYM[tk], summary: async () => { throw new Error('no'); } });
    const p3 = await pf2.get(pos, {});
    assert.strictEqual(p3.items.find(x => x.tk === 'NVDA_US_EQ').ind, 'Semiconductors');
  }
  // ── Nasdaq-100: Wikipedia has no table any more → Nasdaq's list, sectors from the S&P 500 list + Yahoo profile ──
  {
    assert.strictEqual(I.cleanCompany('Apple Inc. Common Stock'), 'Apple Inc.');
    assert.strictEqual(I.cleanCompany('Alphabet Inc. Class A Common Stock'), 'Alphabet Inc.');
    assert.strictEqual(I.cleanCompany('ASML Holding N.V. New York Registry Shares'), 'ASML Holding N.V. New York Registry Shares');
    assert.strictEqual(I.gicsFromYahoo('Technology'), 'Information Technology');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-ndx-'));
    const rows = [{ symbol: 'AAPL', companyName: 'Apple Inc. Common Stock' }, { symbol: 'ASML', companyName: 'ASML Holding N.V. New York Registry Shares' }, { symbol: 'BRK.B', companyName: 'x' }]
      .concat(Array.from({ length: 98 }, (_, i) => ({ symbol: 'N' + i, companyName: 'Co ' + i + ' Common Stock' })));
    const sp = fill(450, i => `|-\n| {{NasdaqSymbol|N${i}}} || [[Co ${i}]] || Industrials || Machinery\n`);
    const calls = [], summ = [];
    const fetchImpl = async (u, o) => {
      calls.push(u);
      if (u.includes('api.nasdaq.com')) { assert.ok(/Mozilla/.test(o.headers['User-Agent'])); return res(200, { data: { data: { rows } }, status: { rCode: 200 } }); }
      if (u.includes('/w/api.php') && u.includes('S%26P')) return res(200, { parse: { wikitext: '{| class="wikitable sortable" id="constituents"\n! Symbol !! Security !! GICS Sector !! GICS Sub-Industry\n|-\n| {{NasdaqSymbol|AAPL}} || [[Apple Inc.]] || Information Technology || Technology Hardware\n' + sp + '|}' } });
      if (u.includes('/v7/finance/quote')) return quoteAnswer(u);
      throw new Error('unexpected ' + u);
    };
    const svc = new IndexMap({ index: 'ndx', fetchImpl, dir, crumb: async () => ({ crumb: 'C' }),
      summary: async (sym, mods) => { summ.push(sym); assert.strictEqual(mods, 'assetProfile'); return sym === 'ASML' ? { assetProfile: { sector: 'Technology', industry: 'Semiconductor Equipment & Materials' } } : null; } });
    const p = await svc.get({});
    assert.strictEqual(p.problem, null); assert.strictEqual(p.items.length, 101); assert.strictEqual(p.levels, 2);
    const by = Object.fromEntries(p.items.map(x => [x.s, x]));
    assert.strictEqual(by.AAPL.sec, 'Information Technology'); assert.strictEqual(by.AAPL.n, 'Apple Inc.');
    assert.strictEqual(by.N5.sec, 'Industrials', 'sector taken from the S&P 500 list');
    assert.strictEqual(by.ASML.sec, 'Information Technology', 'Yahoo sector mapped to GICS');
    assert.strictEqual(by['BRK.B'].y, 'BRK-B');
    assert.ok(!calls.some(u => u.includes('page=Nasdaq-100')), 'Wikipedia not needed');
    assert.ok(!summ.includes('AAPL') && summ.includes('ASML'), 'Yahoo profile only for the ones the S&P list lacks');
    assert.ok(fs.existsSync(path.join(dir, 'sp500.json')), 'S&P 500 list cached for later');
    // Nasdaq refuses → Slickcharts table
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 't212-ndx2-'));
    const html = '<table class="table table-hover"><thead><tr><th>#</th><th>Company</th><th>Symbol</th><th>Weight</th></tr></thead><tbody>' +
      Array.from({ length: 100 }, (_, i) => `<tr><td>${i + 1}</td><td><a href="/symbol/S${i}">Slick ${i}</a></td><td><a href="/symbol/S${i}">S${i}</a></td><td>1%</td></tr>`).join('') + '</tbody></table>';
    const f2 = async u => {
      if (u.includes('api.nasdaq.com')) return res(403, {});
      if (u.includes('slickcharts')) return res(200, null, html);
      if (u.includes('/w/api.php')) return res(500, {});
      if (u.includes('/v7/finance/quote')) return quoteAnswer(u);
      throw new Error('unexpected ' + u);
    };
    const p2 = await new IndexMap({ index: 'ndx', fetchImpl: f2, dir: dir2, crumb: async () => ({ crumb: 'C' }) }).get({});
    assert.strictEqual(p2.items.length, 100); assert.strictEqual(p2.items[3].s, 'S3'); assert.strictEqual(p2.items[3].n, 'Slick 3');
  }

  assert.deepStrictEqual(Object.keys(INDICES), HEATMAPS.slice(0, -1));
  console.log('indices ok');
})().catch(e => { console.error(e); process.exit(1); });
