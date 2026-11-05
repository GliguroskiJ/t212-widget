// S&P 500 heatmap data: Wikipedia constituents parser (wikitext + HTML), Yahoo quote parsing,
// batching, crumb retry, caching and graceful failure — against fixtures (no network).
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
const { SP500, parseWikitext, parseHtml, parseQuotes, yahooSymbol, cleanWiki, t212Map } = require('../main/sp500');

// ── cleanWiki / symbols ──
assert.strictEqual(cleanWiki(' {{NyseSymbol|MMM}} '), 'MMM');
assert.strictEqual(cleanWiki('[[Alphabet Inc.|Alphabet Inc. (Class A)]]'), 'Alphabet Inc. (Class A)');
assert.strictEqual(cleanWiki('[[3M]]<ref name="x">{{cite web|url=http://x}}</ref>'), '3M');
assert.strictEqual(cleanWiki('style="text-align:left" | Health Care'), 'Health Care');
assert.strictEqual(cleanWiki('AT&amp;T'), 'AT&T');
assert.strictEqual(cleanWiki("'''[[Apple Inc.]]'''"), 'Apple Inc.');
assert.strictEqual(yahooSymbol('BRK.B'), 'BRK-B');
assert.strictEqual(yahooSymbol('bf.b'), 'BF-B');

// ── wikitext fixture (shape of the real article: inline "||" rows, one-cell-per-line rows, refs, attributes) ──
const SECT = ['Information Technology', 'Health Care', 'Financials', 'Industrials', 'Energy'];
let wt = 'Intro text {{Short description|x}}\n\n== S&P 500 component stocks ==\n' +
  '{| class="wikitable sortable sticky-header" id="constituents"\n' +
  '! Symbol !! Security !! GICS Sector !! GICS Sub-Industry !! Headquarters Location !! Date added !! CIK !! Founded\n';
wt += '|-\n| {{NyseSymbol|MMM}} || [[3M]] || Industrials || Industrial Conglomerates || [[Saint Paul, Minnesota]] || 1957-03-04 || 0000066740 || 1902\n';
wt += '|-\n| {{NyseSymbol|BRK.B}} || [[Berkshire Hathaway]]<ref>class B</ref> || Financials || Multi-Sector Holdings || [[Omaha, Nebraska]] || 2010-02-16 || 0001067983 || 1839\n';
wt += '|-\n|{{NyseSymbol|BF.B}}\n|[[Brown–Forman]]\n|Consumer Staples\n|Distillers & Vintners\n|[[Louisville, Kentucky]]\n|1982-10-31\n|0000014693\n|1870\n';
wt += '|-\n| {{NasdaqSymbol|GOOGL}} || [[Alphabet Inc.|Alphabet Inc. (Class A)]] || Communication Services || Interactive Media &amp; Services || [[Mountain View, California]] || 2014-04-03 || 0001652044 || 1998\n';
wt += '|-\n| {{NasdaqSymbol|GOOGL}} || duplicate row || Communication Services || x || y || z || 1 || 2\n';
for (let i = 0; i < 440; i++) wt += `|-\n| {{NyseSymbol|T${i}}} || [[Company ${i} Inc.]] || ${SECT[i % 5]} || Sub ${i % 17} || [[City]] || 2000-01-01 || 000${i} || 1950\n`;
wt += '|}\n\n== Selected changes ==\n{| class="wikitable"\n! Date !! Added\n|-\n| 2024 || {{NyseSymbol|ZZZZ}}\n|}\n';
const rows = parseWikitext(wt);
assert.strictEqual(rows.length, 444, 'one row per company, duplicates and the changes table left out');
const by = Object.fromEntries(rows.map(r => [r.sym, r]));
assert.deepStrictEqual(by['MMM'], { sym: 'MMM', y: 'MMM', name: '3M', sector: 'Industrials', industry: 'Industrial Conglomerates' });
assert.strictEqual(by['BRK.B'].y, 'BRK-B');
assert.strictEqual(by['BRK.B'].name, 'Berkshire Hathaway');
assert.strictEqual(by['BF.B'].y, 'BF-B');
assert.strictEqual(by['BF.B'].sector, 'Consumer Staples');
assert.strictEqual(by['BF.B'].industry, 'Distillers & Vintners');
assert.strictEqual(by['GOOGL'].name, 'Alphabet Inc. (Class A)');
assert.strictEqual(by['GOOGL'].industry, 'Interactive Media & Services');
assert.ok(!by['ZZZZ']);

// ── the live article (checked 2026-11: header + first rows as rendered on en.wikipedia.org; markup as the
// article writes it: linked header cells, {{NyseSymbol}} / {{NasdaqSymbol}}, "||" rows, piped place links) ──
{
  let live = '{{Short description|None}}\n{{Use mdy dates|date=May 2020}}\nThe S&P 500 ...<ref>{{cite web |url=https://example.org |title=x}}</ref>\n\n' +
    '== S&P 500 component stocks ==\n{| class="wikitable sortable sticky-header" id="constituents"\n' +
    '! [[Ticker symbol|Symbol]] !! Security !! [[Global Industry Classification Standard|GICS]] Sector !! GICS Sub-Industry !! Headquarters Location !! Date added !! [[Central Index Key|CIK]] !! Founded\n' +
    '|-\n| {{NyseSymbol|MMM}} || [[3M]] || Industrials || Industrial Conglomerates || [[Saint Paul, Minnesota]] || 1957-03-04 || 0000066740 || 1902\n' +
    '|-\n| {{NyseSymbol|AOS}} || [[A. O. Smith]] || Industrials || Building Products || [[Milwaukee|Milwaukee, Wisconsin]] || 2017-07-26 || 0000091142 || 1916\n' +
    '|-\n| {{NyseSymbol|ABT}} || [[Abbott Laboratories]] || Health Care || Health Care Equipment || [[North Chicago, Illinois]] || 1957-03-04 || 0000001800 || 1888\n' +
    '|-\n|{{NyseSymbol|ABBV}}||[[AbbVie]]||Health Care||Biotechnology||[[North Chicago, Illinois]]||2012-12-31||0001551152||2013 (1888)\n';
  for (let i = 0; i < 420; i++) live += `|-\n| {{NasdaqSymbol|L${i}}} || [[L${i} Inc.]] || Energy || Oil || [[X]] || 2000-01-01 || 1 || 1900\n`;
  live += '|}\n';
  const lr = parseWikitext(live);
  assert.strictEqual(lr.length, 424);
  assert.deepStrictEqual(lr.slice(0, 4).map(r => [r.sym, r.name, r.sector, r.industry]), [
    ['MMM', '3M', 'Industrials', 'Industrial Conglomerates'], ['AOS', 'A. O. Smith', 'Industrials', 'Building Products'],
    ['ABT', 'Abbott Laboratories', 'Health Care', 'Health Care Equipment'], ['ABBV', 'AbbVie', 'Health Care', 'Biotechnology']]);
}

// ── rendered HTML fixture ──
let html = '<html><body><table class="wikitable sortable" id="constituents"><tbody><tr><th>Symbol</th><th>Security</th><th>GICS Sector</th><th>GICS Sub-Industry</th><th>Headquarters</th></tr>\n';
html += '<tr><td><a rel="nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:BRK.B">BRK.B</a></td><td><a href="/wiki/Berkshire_Hathaway">Berkshire Hathaway</a><sup class="reference">[5]</sup></td><td>Financials</td><td>Multi-Sector Holdings</td><td>Omaha</td></tr>\n';
for (let i = 0; i < 420; i++) html += `<tr>\n<td><a href="x">H${i}</a>\n</td>\n<td><a href="/wiki/C${i}">C&amp;${i}</a></td>\n<td>${SECT[i % 5]}</td>\n<td>Sub ${i % 9}</td>\n<td>X</td>\n</tr>\n`;
html += '</tbody></table><table class="wikitable"><tr><th>Date</th></tr><tr><td>QQQ</td></tr></table></body></html>';
const hr = parseHtml(html);
assert.strictEqual(hr.length, 421);
assert.strictEqual(hr[0].sym, 'BRK.B'); assert.strictEqual(hr[0].y, 'BRK-B'); assert.strictEqual(hr[0].name, 'Berkshire Hathaway');
assert.strictEqual(hr[1].name, 'C&0'); assert.strictEqual(hr[1].industry, 'Sub 0');
assert.deepStrictEqual(parseWikitext('no table here'), []);
assert.deepStrictEqual(parseHtml('<p>nothing</p>'), []);

// ── quotes ──
const qj = { quoteResponse: { result: [{ symbol: 'brk-b', regularMarketPrice: 480.1, regularMarketChangePercent: -1.25, marketCap: 1.03e12, currency: 'USD', shortName: 'Berkshire', regularMarketTime: 1700000000 }, { symbol: 'X' }, null], error: null } };
const pq = parseQuotes(qj);
assert.deepStrictEqual(pq['BRK-B'], { px: 480.1, chg: -1.25, cap: 1.03e12, cur: 'USD', name: 'Berkshire', t: 1700000000000, state: null });
assert.strictEqual(pq.X.cap, null);
assert.deepStrictEqual(parseQuotes(null), {});

// ── T212 ticker map ──
const tm = t212Map({ AAPL_US_EQ: { type: 'STOCK' }, BRK_B_US_EQ: { type: 'STOCK', shortName: 'BRK.B' }, SPY_US_EQ: { type: 'ETF' }, VWCEd_EQ: { type: 'ETF' } }, { GOOGL_US_EQ: 'GOOGL', CEZ_CZ_EQ: 'CEZ.PR' });
assert.strictEqual(tm.AAPL, 'AAPL_US_EQ'); assert.strictEqual(tm['BRK-B'], 'BRK_B_US_EQ'); assert.strictEqual(tm.GOOGL, 'GOOGL_US_EQ');
assert.ok(!tm.SPY, 'ETFs are left out');
assert.strictEqual(tm['CEZ.PR'], 'CEZ_CZ_EQ', 'non-US holdings map too (index heatmaps outside the US)');

// ── service: batching, crumb retry, cache, failure keeps last data ──
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212-sp500-'));
  let now = 1e12, calls = [], mode = { wiki: 'ok', yahoo: 'ok', unauthOnce: true }, crumbs = [];
  const res = (status, body, text) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text || JSON.stringify(body) });
  const fetchImpl = async (u, o) => {
    calls.push(u);
    if (u.includes('wikipedia.org/w/api.php')) return mode.wiki === 'ok' ? res(200, { parse: { title: 'List', wikitext: wt } }) : res(503, {});
    if (u.includes('wikipedia.org/wiki/')) return mode.wiki === 'ok' ? res(200, null, html) : res(503, {});
    if (u.includes('/v7/finance/quote')) {
      if (mode.yahoo === 'down') return res(500, {});
      if (mode.unauthOnce) { mode.unauthOnce = false; return res(401, {}); }
      assert.ok(/crumb=CR/.test(u), 'crumb is sent'); assert.strictEqual(o.headers.Cookie, 'A3=c');
      const syms = decodeURIComponent(/symbols=([^&]*)/.exec(u)[1]).split(',');
      assert.ok(syms.length <= 100, 'batches of at most 100');
      return res(200, { quoteResponse: { result: syms.map((s, i) => ({ symbol: s, regularMarketPrice: 100 + i, regularMarketChangePercent: (i % 7) - 3, marketCap: 1e9 * (i + 1), currency: 'USD' })) } });
    }
    throw new Error('unexpected ' + u);
  };
  let changed = 0;
  const svc = new SP500({ fetchImpl, dir, now: () => now, crumb: async f => { crumbs.push(!!f); return { crumb: 'CR' + crumbs.length, cookie: 'A3=c' }; }, onChange: () => changed++ });
  const p1 = await svc.get({});
  assert.strictEqual(p1.items.length, 444);
  assert.strictEqual(p1.problem, null);
  const brk = p1.items.find(x => x.s === 'BRK.B');
  assert.ok(brk.cap > 0 && brk.chg != null && brk.px > 0, 'quote merged by Yahoo symbol');
  assert.strictEqual(calls.filter(u => u.includes('/v7/')).length, 6, '5 batches + one 401 retry');
  assert.strictEqual(crumbs[0], false); assert.ok(crumbs.includes(true), 'crumb refreshed after a 401');
  assert.ok(fs.existsSync(path.join(dir, 'sp500.json')));

  // fresh → no requests
  calls = [];
  await svc.get({});
  assert.strictEqual(calls.length, 0);

  // quotes old → cached data right away, background refresh, onChange afterwards
  now += 5 * 60e3;
  const p2 = await svc.get({});
  assert.strictEqual(p2.refreshing, true);
  await svc.running; await new Promise(r => setTimeout(r, 0));
  assert.strictEqual(changed, 1);
  assert.ok(!calls.some(u => u.includes('wikipedia')), 'list is refreshed only daily');

  // Yahoo down on a forced refresh → last quotes stay, error text is shown
  mode.yahoo = 'down';
  const p3 = await svc.get({ force: true });
  assert.ok(p3.problem && /HTTP 500/.test(p3.problem.message));
  assert.ok(p3.items.find(x => x.s === 'MMM').cap > 0, 'last data kept');

  // next day, Wikipedia down → the cached list is kept
  mode.yahoo = 'ok'; mode.wiki = 'down'; now += 25 * 3600e3;
  const p4 = await svc.get({ force: true });
  assert.strictEqual(p4.items.length, 444); assert.strictEqual(p4.problem, null);

  // a new instance reads the cache from disk
  const svc2 = new SP500({ fetchImpl: async () => { throw new Error('offline'); }, dir, now: () => now, crumb: async () => ({ crumb: 'x' }) });
  const p5 = svc2.payload();
  assert.strictEqual(p5.items.length, 444); assert.ok(p5.at);

  // nothing cached + everything offline → a clear error, no crash
  const svc3 = new SP500({ fetchImpl: async () => { throw new Error('offline'); }, dir: fs.mkdtempSync(path.join(os.tmpdir(), 't212-sp500b-')), crumb: async () => ({ crumb: 'x' }) });
  const p6 = await svc3.get({});
  assert.strictEqual(p6.items.length, 0); assert.ok(p6.problem && /S&P 500 list/.test(p6.problem.message));
  console.log('sp500 ok');
})().catch(e => { console.error(e); process.exit(1); });
