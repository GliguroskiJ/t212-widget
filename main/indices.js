'use strict';
// Index heatmaps: constituents of each index from its Wikipedia article (refreshed at most once a day so
// joiners / leavers show up), market cap + day change from Yahoo Finance's v7 quote endpoint (batches of
// 100, cached a few minutes). One cache file per index in userData, so a map opens instantly with the
// last data and keeps showing it when a source is down. Plus "My portfolio": the user's own positions,
// sized by position value and grouped by the sector / industry (or fund category) Yahoo reports.
//
// Every article writes its table differently, so the parser is generic: it reads every "wikitable" of
// the article, finds the columns by their header names (per-index keys below), keeps the table with the
// most usable rows and turns each ticker into a Yahoo symbol (exchange suffix per index / listing).

const fs = require('fs');
const path = require('path');
const { candidates } = require('./backfill');

const WIKI_API = page => `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page.replace(/ /g, '_'))}&prop=wikitext&format=json&formatversion=2&redirects=1`;
const WIKI_HTML = page => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(page.replace(/ /g, '_'));
const QUOTE = 'https://query2.finance.yahoo.com/v7/finance/quote';
const FIELDS = 'symbol,shortName,longName,regularMarketPrice,regularMarketChangePercent,marketCap,currency,regularMarketTime,marketState,quoteType';
const LIST_TTL = 24 * 3600e3;
const QUOTE_TTL = 4 * 60e3;
const PROFILE_TTL = 30 * 24 * 3600e3;
const BATCH = 100;
const FETCH_TIMEOUT = 25e3;
const UA = 'T212Widget/1.0 (desktop portfolio app; index heatmaps)';

// ── the indices ──────────────────────────────────────────────────
// pages: Wikipedia articles tried in order · min: fewer usable rows = the page changed shape, keep the
// last list · cols: header keys per column, most specific first · market: how tickers become Yahoo symbols
const INDICES = {
  sp500: { name: 'S&P 500', pages: ['List of S&P 500 companies'], file: 'sp500.json', min: 400, market: 'us', prefer: 'constituents',
    cols: { sym: ['symbol', 'ticker'], name: ['security', 'company'], sector: ['gics sector', 'sector'], industry: ['sub-industry', 'sub industry'] } },
  // Wikipedia dropped the Nasdaq-100 components table (2026) → Nasdaq's own list first, then Slickcharts, then Wikipedia
  ndx: { name: 'Nasdaq-100', nasdaq: 'nasdaq100', html: ['https://www.slickcharts.com/nasdaq100'], pages: ['Nasdaq-100'], min: 90, market: 'us', prefer: 'constituents',
    cols: { sym: ['ticker', 'symbol'], name: ['company', 'security'], sector: ['gics sector', 'icb industry', 'sector', 'industry'], industry: ['sub-industry', 'subsector', 'sub-sector', 'sub industry'] } },
  dji: { name: 'Dow Jones', pages: ['List of Dow Jones Industrial Average companies', 'Dow Jones Industrial Average'], min: 28, market: 'us',
    cols: { sym: ['symbol', 'ticker'], name: ['company'], sector: ['industry', 'sector'] } },
  dax: { name: 'DAX 40', pages: ['DAX'], min: 36, market: 'de',
    cols: { sym: ['ticker', 'symbol'], name: ['company', 'name'], sector: ['prime standard sector', 'sector', 'industry'] } },
  sx5e: { name: 'EURO STOXX 50', pages: ['EURO STOXX 50'], min: 45, market: 'eu',
    cols: { sym: ['ticker', 'symbol'], name: ['name', 'company'], sector: ['industry', 'sector'], listing: ['main listing', 'listing', 'exchange'], country: ['registered office', 'country', 'headquarters'] } },
  ftse: { name: 'FTSE 100', pages: ['FTSE 100 Index'], min: 90, market: 'uk', icb: true,
    cols: { sym: ['ticker', 'epic', 'symbol'], name: ['company'], sector: ['industry classification', 'icb sector', 'sector', 'industry'] } }
};
const HEATMAPS = [...Object.keys(INDICES), 'portfolio'];

// ── Nasdaq-100 without Wikipedia ─────────────────────────────────
const NASDAQ_LIST = id => `https://api.nasdaq.com/api/quote/list-type/${id}`;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
// "Apple Inc. Common Stock" → "Apple Inc."
const cleanCompany = n => String(n || '').replace(/\s+(class [a-z] )?(common stock|ordinary shares|american depositary shares?|ads|capital stock|common shares|depositary shares).*$/i, '').replace(/\s+/g, ' ').trim();
function parseNasdaqList(j) {
  const rows = (j && j.data && ((j.data.data && j.data.data.rows) || j.data.rows)) || [];
  const out = [], seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const sym = String((r && r.symbol) || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push({ sym, y: yahooSymbol(sym), name: cleanCompany(r.companyName) || sym, sector: 'Other', industry: 'Other' });
  }
  return out;
}
// Yahoo assetProfile sectors → GICS names used by the Wikipedia lists
const YAHOO_GICS = { technology: 'Information Technology', healthcare: 'Health Care', 'financial services': 'Financials', 'consumer cyclical': 'Consumer Discretionary',
  'consumer defensive': 'Consumer Staples', 'basic materials': 'Materials', 'communication services': 'Communication Services', industrials: 'Industrials',
  energy: 'Energy', utilities: 'Utilities', 'real estate': 'Real Estate' };
const gicsFromYahoo = s => YAHOO_GICS[String(s || '').toLowerCase()] || s || null;

// ── Wikipedia parsing ────────────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', '#39': "'" };
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});

// wikitext cell → plain text
function cleanWiki(cell) {
  let s = String(cell || '');
  s = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  // cell attributes: style="…" | text
  const a = /^\s*(?:[a-z-]+\s*=\s*("[^"]*"|'[^']*'|[^\s|]+)\s*)+\|(?!\|)([\s\S]*)$/i.exec(s);
  if (a && !/\[\[|\{\{/.test(s.slice(0, s.indexOf('|')))) s = a[2];
  // templates: {{NyseSymbol|BRK.B}} → BRK.B, {{sort|x|Text}} → Text, {{nowrap|Text}} → Text, {{flagicon|GER}} → GER
  for (let i = 0; i < 4 && /\{\{/.test(s); i++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (m, body) => {
      const parts = body.split('|').map(x => x.trim()).filter(x => x && !/^[a-z_]+\s*=/i.test(x));
      return parts.length > 1 ? parts[parts.length - 1] : '';
    });
  }
  s = s.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '');                // logos
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');           // [[Link|Text]] → Text
  s = s.replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');             // [http://x Text] → Text
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  s = s.replace(/'''?/g, '');
  return decode(s).replace(/\s+/g, ' ').trim();
}

// the table's cells, row by row (header row first); handles "|| " inline and one-cell-per-line rows
function wikiRows(table) {
  const rows = [];
  for (const chunk of table.split(/\n\|-[^\n]*/)) {
    const cells = [];
    let hdr = false;
    for (const line of chunk.split('\n')) {
      const l = line.trim();
      if (!l || l.startsWith('{|') || l.startsWith('|}') || l.startsWith('|+')) continue;
      if (l[0] === '!') { hdr = true; cells.push(...l.slice(1).split(/!!|\|\|/)); }
      else if (l[0] === '|') cells.push(...l.slice(1).split('||'));
      else if (cells.length) cells[cells.length - 1] += '\n' + l;   // continuation of the previous cell
    }
    if (cells.length) rows.push({ hdr, cells });
  }
  return rows;
}

// column index per role: keys are tried in order (most specific first), one column per role
function pickColumns(head, cols) {
  const h = head.map(x => x.toLowerCase());
  const used = new Set(), out = {};
  for (const role of ['sym', 'name', 'sector', 'industry', 'listing', 'country']) {
    out[role] = -1;
    for (const k of (cols[role] || [])) {
      const i = h.findIndex((x, j) => !used.has(j) && x.includes(k));
      if (i >= 0) { out[role] = i; used.add(i); break; }
    }
  }
  return out;
}

// ── tickers → Yahoo symbols ──────────────────────────────────────
// Yahoo uses "-" for share classes: BRK.B → BRK-B, BF.B → BF-B
const yahooSymbol = s => String(s || '').trim().toUpperCase().replace(/\./g, '-');
const SUFFIXES = ['DE', 'F', 'PA', 'AS', 'MI', 'MC', 'BR', 'HE', 'IR', 'LS', 'L', 'PR', 'VI', 'SW', 'CO', 'ST', 'OL'];
const hasSuffix = s => { const m = /\.([A-Z]{1,2})$/.exec(s); return !!(m && SUFFIXES.includes(m[1])); };
// main listing / registered office → Yahoo suffix (exchange names first: Airbus is Dutch but listed in Paris)
const EXCHANGE = [[/xetra|fwb|frankfurt|deutsche b/i, '.DE'], [/paris/i, '.PA'], [/amsterdam/i, '.AS'], [/milan|borsa italiana|\bbit\b|euronext milan/i, '.MI'],
  [/madrid|bmad|\bbme\b|bolsa/i, '.MC'], [/brussels/i, '.BR'], [/helsinki/i, '.HE'], [/dublin/i, '.IR'], [/lisbon/i, '.LS']];
const COUNTRY = [[/germany|\bger\b|\bdeu\b/i, '.DE'], [/france|\bfra\b/i, '.PA'], [/netherlands|\bned\b|\bnld\b/i, '.AS'], [/italy|\bita\b/i, '.MI'],
  [/spain|\besp\b/i, '.MC'], [/belgium|\bbel\b/i, '.BR'], [/finland|\bfin\b/i, '.HE'], [/ireland|\birl\b/i, '.IR'], [/portugal|\bpor\b|\bprt\b/i, '.LS']];
const suffixFrom = (text, table) => { for (const [re, s] of table) if (re.test(text || '')) return s; return null; };

// raw ticker cell (+ listing / country cells) → { s: shown ticker, y: Yahoo symbol } or null
function toYahoo(raw, market, extra = {}) {
  let t = String(raw || '').toUpperCase().replace(/\u00a0/g, ' ').trim();
  if (market === 'eu' && !t && extra.listing) t = String(extra.listing).toUpperCase().split(':').pop().trim();
  t = t.replace(/^(?:NYSE|NASDAQ|LSE|FWB|XETRA)\s*:\s*/, '').replace(/\s+/g, ' ');
  if (!t || !/^[A-Z0-9]/.test(t)) return null;
  let s, y;
  if (market === 'us') { s = t.replace(/\s/g, ''); y = yahooSymbol(s); }
  else if (market === 'uk') {
    s = t.replace(/\.L$/, '').replace(/\.+$/, '').replace(/\s/g, '');
    y = s.replace(/\./g, '-') + '.L';                               // BT.A → BT-A.L, RR. → RR.L
  } else if (hasSuffix(t.replace(/\s/g, ''))) {
    t = t.replace(/\s/g, '');
    s = t.replace(/\.[A-Z]{1,2}$/, '');
    y = t.replace(/\.(?=.*\.)/g, '-');                              // NDA.FI.HE → NDA-FI.HE
  } else {
    s = t.replace(/\s/g, '-');
    const suf = market === 'de' ? '.DE' : suffixFrom(extra.listing, EXCHANGE) || suffixFrom(extra.listing, COUNTRY) || suffixFrom(extra.country, COUNTRY);
    if (!suf) return null;
    y = s.replace(/\./g, '-') + suf;                                // NDA FI → NDA-FI.HE
  }
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,15}$/.test(y) || y.length > 18) return null;
  return { s, y };
}

// ICB sectors (what the FTSE 100 article lists) → ICB industries, so the map has ~11 groups, not ~40
const ICB = {
  Technology: ['software and computer services', 'technology hardware and equipment'],
  Telecommunications: ['telecommunications equipment', 'telecommunications service providers', 'fixed line telecommunications', 'mobile telecommunications'],
  'Health Care': ['health care providers', 'medical equipment and services', 'pharmaceuticals and biotechnology', 'health care equipment and services'],
  Financials: ['banks', 'finance and credit services', 'investment banking and brokerage services', 'mortgage real estate investment trusts', 'closed end investments',
    'open end and miscellaneous investment vehicles', 'life insurance', 'non-life insurance', 'nonlife insurance', 'financial services', 'equity investment instruments'],
  'Real Estate': ['real estate investment and services', 'real estate investment trusts'],
  'Consumer Discretionary': ['automobiles and parts', 'consumer services', 'household goods and home construction', 'leisure goods', 'personal goods', 'media', 'retailers',
    'travel and leisure', 'general retailers'],
  'Consumer Staples': ['beverages', 'food producers', 'tobacco', 'personal care, drug and grocery stores', 'food and drug retailers'],
  Industrials: ['construction and materials', 'aerospace and defense', 'electronic and electrical equipment', 'general industrials', 'industrial engineering',
    'industrial support services', 'industrial transportation', 'support services'],
  'Basic Materials': ['industrial materials', 'industrial metals and mining', 'precious metals and mining', 'chemicals', 'mining', 'forestry and paper'],
  Energy: ['non-renewable energy', 'renewable energy', 'oil, gas and coal', 'oil and gas producers', 'alternative energy'],
  Utilities: ['electricity', 'gas, water and multi-utilities', 'gas, water and multiutilities', 'waste and disposal services']
};
const ICB_BY = {};
for (const [ind, list] of Object.entries(ICB)) for (const s of list) ICB_BY[s] = ind;
const icbIndustry = sector => ICB_BY[String(sector || '').toLowerCase().replace(/&/g, 'and').replace(/defence/g, 'defense').replace(/\s+/g, ' ').trim()] || null;

// rows of one table → constituents (+ how many levels the grouping has)
function toRows(rows, clean, cfg) {
  const head = rows.find(r => r.hdr) || rows[0];
  if (!head) return null;
  const col = pickColumns(head.cells.map(clean), cfg.cols);
  if (col.sym < 0 && !(cfg.market === 'eu' && col.listing >= 0)) return null;
  if (col.name < 0) return null;
  const out = [], seen = new Set();
  for (const r of rows) {
    if (r === head || r.hdr) continue;
    const c = r.cells.map(clean);
    const id = toYahoo(col.sym >= 0 ? c[col.sym] : '', cfg.market, { listing: col.listing >= 0 ? c[col.listing] : '', country: col.country >= 0 ? c[col.country] : '' });
    if (!id || seen.has(id.y)) continue;
    seen.add(id.y);
    let sector = (col.sector >= 0 && c[col.sector]) || null;
    let industry = (col.industry >= 0 && c[col.industry]) || null;
    if (cfg.icb && sector && !industry) { const top = icbIndustry(sector); if (top) { industry = sector; sector = top; } }
    out.push({ sym: id.s, y: id.y, name: c[col.name] || id.s, sector: sector || 'Other', industry: industry || sector || 'Other' });
  }
  return { items: out, sector: col.sector >= 0, levels: col.industry >= 0 || (cfg.icb && out.some(x => x.industry !== x.sector)) ? 2 : 1 };
}

// the best table: id="constituents" (when the index config prefers it), then one with a sector column, then the most rows
function best(cands, cfg) {
  let top = null, score = -1;
  for (const { res, id } of cands) {
    if (!res || !res.items.length) continue;
    const sc = res.items.length + (res.sector ? 1e4 : 0) + (cfg.prefer && id ? 1e5 : 0);
    if (sc > score) { top = res; score = sc; }
  }
  return top || { items: [], levels: 1 };
}

const cfgOf = cfg => (typeof cfg === 'string' ? INDICES[cfg] : cfg) || INDICES.sp500;

function parseWikitextFull(text, index) {
  const cfg = cfgOf(index);
  const src = String(text || '');
  const cands = [];
  const re = /\{\|[^\n]*wikitable[^\n]*/gi;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('\n|}', m.index);
    const table = src.slice(m.index, end < 0 ? undefined : end);
    cands.push({ res: toRows(wikiRows(table), cleanWiki, cfg), id: cfg.prefer && new RegExp('id\\s*=\\s*"?' + cfg.prefer, 'i').test(m[0]) });
  }
  return best(cands, cfg);
}
const parseWikitext = (text, index) => parseWikitextFull(text, index).items;

const cleanHtml = s => decode(String(s || '').replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// rendered article (fallback when the API answer can't be read)
function parseHtmlFull(html, index, anyTable) {
  const cfg = cfgOf(index);
  const src = String(html || '');
  const cands = [];
  const re = anyTable ? /<table[^>]*>/gi : /<table[^>]*wikitable[^>]*>/gi;
  let m;
  while ((m = re.exec(src))) {
    const end = src.indexOf('</table>', m.index);
    const table = src.slice(m.index, end < 0 ? undefined : end);
    const rows = [];
    for (const tr of table.split(/<tr[\s>]/i).slice(1)) {
      const cells = [];
      let hdr = false;
      const cre = /<(t[hd])[^>]*>([\s\S]*?)(?=<t[hd][\s>]|<\/tr>|$)/gi;
      let c;
      while ((c = cre.exec(tr))) { if (c[1].toLowerCase() === 'th') hdr = true; cells.push(c[2].replace(/<\/t[hd]>\s*$/i, '')); }
      if (cells.length) rows.push({ hdr: hdr && !rows.some(r => r.hdr), cells });
    }
    cands.push({ res: toRows(rows, cleanHtml, cfg), id: cfg.prefer && new RegExp('id\\s*=\\s*["\']?' + cfg.prefer, 'i').test(m[0]) });
  }
  return best(cands, cfg);
}
const parseHtml = (html, index) => parseHtmlFull(html, index).items;

// v7 quote answer → { SYMBOL: { px, chg, cap, cur, name, t, state, type } }
function parseQuotes(j) {
  const out = {};
  const list = (j && j.quoteResponse && j.quoteResponse.result) || [];
  for (const q of list) {
    if (!q || !q.symbol) continue;
    const n = v => (v == null || !isFinite(Number(v)) ? null : Number(v));
    out[String(q.symbol).toUpperCase()] = { px: n(q.regularMarketPrice), chg: n(q.regularMarketChangePercent), cap: n(q.marketCap), cur: q.currency || 'USD',
      name: q.shortName || q.longName || null, t: n(q.regularMarketTime) ? n(q.regularMarketTime) * 1000 : null, state: q.marketState || null, ...(q.quoteType ? { type: q.quoteType } : {}) };
  }
  return out;
}

// Yahoo symbol → Trading 212 ticker: the instrument list (AAPL_US_EQ, BRK_B_US_EQ / short name BRK.B, SAPd_EQ,
// BARCl_EQ …) plus the symbols the app already resolved for held instruments (most reliable, wins)
function t212Map(index, resolved) {
  const map = {};
  for (const tk of Object.keys(index || {})) {
    const i = index[tk] || {};
    if (i.type && i.type !== 'STOCK') continue;
    const m = /^(.+?)_US_EQ$/.exec(tk);
    if (m) {
      for (const k of [i.shortName && yahooSymbol(i.shortName), yahooSymbol(m[1].replace(/_/g, '-'))]) if (k && !map[k]) map[k] = tk;
      continue;
    }
    let c = candidates(tk)[0];
    if (!c) continue;
    c = c.toUpperCase();
    if (/\.L$/.test(c)) c = c.slice(0, -2).replace(/\./g, '-') + '.L';   // BT.Al_EQ → BT-A.L
    if (!map[c]) map[c] = tk;
  }
  for (const [tk, sym] of Object.entries(resolved || {})) if (sym && /_EQ$/.test(tk)) map[String(sym).toUpperCase()] = tk;
  return map;
}

// Yahoo quotes in batches of 100 with the session cookie + crumb (one shared new session after a 401)
class Quotes {
  constructor({ fetchImpl, crumb }) {
    const f = fetchImpl || fetch;
    // every request gets a deadline: a hung connection must not leave `running` pending forever
    this.fetch = (u, o = {}) => f(u, typeof AbortSignal !== 'undefined' && AbortSignal.timeout && !o.signal ? { ...o, signal: AbortSignal.timeout(FETCH_TIMEOUT) } : o);
    this.crumb = crumb;
    this.partial = null;
  }

  async batch(syms) {
    const go = async force => {
      const c = force ? await (this.freshCrumb || (this.freshCrumb = Promise.resolve().then(() => this.crumb(true)).finally(() => { this.freshCrumb = null; })))
        : await this.crumb(false);
      const headers = { Accept: 'application/json' };
      if (c && c.cookie) headers.Cookie = c.cookie;
      const u = `${QUOTE}?symbols=${syms.map(encodeURIComponent).join(',')}&fields=${FIELDS}&formatted=false&lang=en-US&region=US` + (c && c.crumb ? `&crumb=${encodeURIComponent(c.crumb)}` : '');
      return this.fetch(u, { credentials: 'include', headers });
    };
    let r = await go(false);
    if (r.status === 401 || r.status === 403) r = await go(true);
    if (!r.ok) throw new Error('Yahoo Finance HTTP ' + r.status);
    return parseQuotes(await r.json());
  }

  // → { SYMBOL: quote }; throws only when no batch worked (this.partial = why some are missing)
  async all(syms) {
    const batches = [];
    for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));
    const by = {};
    let ok = 0, lastErr = null, next = 0;
    if (!batches.length) { this.partial = null; return by; }
    // one session first (Library caches it), then three requests at a time
    try { await this.crumb(false); } catch {}
    const worker = async () => {
      while (next < batches.length) {
        const b = batches[next++];
        try { Object.assign(by, await this.batch(b)); ok++; } catch (e) { lastErr = e; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!ok) throw lastErr || new Error('Yahoo Finance returned no quotes');
    this.partial = ok < batches.length ? (lastErr && lastErr.message) || 'some quotes missing' : null;
    return by;
  }
}

function saveJson(dir, file, data) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  } catch {}
}

// ── one index ────────────────────────────────────────────────────
class IndexMap {
  // crumb(force) → { crumb, cookie } (Library.yahooCrumb); onChange() after a background refresh
  constructor({ index = 'sp500', fetchImpl, dir, crumb, now, onChange, summary }) {
    this.fetchImpl = fetchImpl;
    this.summary = summary || null;
    this.id = typeof index === 'string' ? index : 'custom';
    this.cfg = cfgOf(index);
    this.q = new Quotes({ fetchImpl, crumb });
    this.fetch = this.q.fetch;
    this.crumb = crumb;
    this.dir = dir;
    this.now = now || Date.now;
    this.onChange = onChange || (() => {});
    this.file = path.join(dir, this.cfg.file || 'heatmap-' + this.id + '.json');
    this.running = null;
    this.data = this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && d.list && Array.isArray(d.list.items)) return { list: { levels: 2, ...d.list }, quotes: d.quotes || { at: 0, by: {} }, error: null };
    } catch {}
    return { list: { at: 0, items: [], source: null, levels: 1 }, quotes: { at: 0, by: {} }, error: null };
  }

  save() { saveJson(this.dir, this.file, { list: this.data.list, quotes: this.data.quotes }); }

  async constituents(force) {
    const L = this.data.list, cfg = this.cfg;
    if (!force && L.items.length && this.now() - L.at < LIST_TTL) return L.items;
    // don't hammer Wikipedia after a failure: retry after 30 min (unless forced)
    if (!force && L.items.length && this.listFailAt && this.now() - this.listFailAt < 30 * 60e3) return L.items;
    let got = { items: [], levels: 1 }, err = null, page = null;
    const take = (res, p) => { if (res.items.length > got.items.length) { got = res; page = p; } };
    if (cfg.nasdaq) {
      try {
        const r = await this.fetch(NASDAQ_LIST(cfg.nasdaq), { headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } });
        if (!r.ok) throw new Error('Nasdaq HTTP ' + r.status);
        take({ items: parseNasdaqList(await r.json()), levels: 1 }, 'nasdaq.com');
      } catch (e) { err = err || e; }
    }
    for (const u of (got.items.length < cfg.min && cfg.html) || []) {
      try {
        const r = await this.fetch(u, { headers: { Accept: 'text/html', 'User-Agent': BROWSER_UA } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        take(parseHtmlFull(await r.text(), cfg, true), new URL(u).hostname);
      } catch (e) { err = err || e; }
      if (got.items.length >= cfg.min) break;
    }
    for (const p of got.items.length >= cfg.min ? [] : cfg.pages) {
      try {
        const r = await this.fetch(WIKI_API(p), { headers: { Accept: 'application/json', 'Api-User-Agent': UA } });
        if (!r.ok) throw new Error('Wikipedia HTTP ' + r.status);
        const j = await r.json();
        const text = j && j.parse && (typeof j.parse.wikitext === 'string' ? j.parse.wikitext : j.parse.wikitext && j.parse.wikitext['*']);
        take(parseWikitextFull(text, cfg), p);
      } catch (e) { err = err || e; }
      if (got.items.length < cfg.min) {
        try {
          const r = await this.fetch(WIKI_HTML(p), { headers: { Accept: 'text/html' } });
          if (r.ok) take(parseHtmlFull(await r.text(), cfg), p);
          else err = err || new Error('Wikipedia HTTP ' + r.status);
        } catch (e) { err = err || e; }
      }
      if (got.items.length >= cfg.min) break;
    }
    if (got.items.length >= cfg.min) {
      if (got.items.every(x => x.sector === 'Other')) got = { items: await this.addSectors(got.items), levels: 2 };
      this.data.list = { at: this.now(), items: got.items, source: page === 'nasdaq.com' || /\./.test(page || '') ? page : 'wikipedia', page, levels: got.levels };
      this.listFailAt = 0;
      return got.items;
    }
    this.listFailAt = this.now();
    if (L.items.length) return L.items;               // keep the last good list
    throw new Error(err ? `Could not load the ${cfg.name} list: ` + (err.message || err) : `Could not read the ${cfg.name} list from Wikipedia`);
  }

  // a list without sectors (Nasdaq): GICS sector + sub-industry from the S&P 500 list, the rest from Yahoo's profile
  async addSectors(items) {
    const by = {};
    try {
      const sp = new IndexMap({ index: 'sp500', fetchImpl: this.fetchImpl, dir: this.dir, crumb: this.crumb, now: this.now });
      const list = await sp.constituents(false);
      sp.save();
      for (const x of list) by[x.y] = x;
    } catch {}
    const old = Object.fromEntries((this.data.list.items || []).map(x => [x.y, x]));
    const out = items.map(x => (by[x.y] ? { ...x, sector: by[x.y].sector, industry: by[x.y].industry }
      : old[x.y] && old[x.y].sector !== 'Other' ? { ...x, sector: old[x.y].sector, industry: old[x.y].industry } : x));
    if (this.summary) {
      let n = 0;
      for (const x of out) {
        if (x.sector !== 'Other' || n++ >= 40) continue;
        try {
          const ap = ((await this.summary(x.y, 'assetProfile')) || {}).assetProfile || {};
          if (ap.sector) { x.sector = gicsFromYahoo(ap.sector); x.industry = ap.industry || x.sector; }
        } catch (e) { if (/session/.test(String(e && e.message))) break; }
      }
    }
    return out;
  }

  async quotes(items, force) {
    const Q = this.data.quotes;
    if (!force && Q.at && this.now() - Q.at < QUOTE_TTL && items.every(x => Q.by[x.y])) return Q.by;
    const by = await this.q.all(items.map(x => x.y));
    this.partial = this.q.partial;
    this.data.quotes = { at: this.now(), by: { ...Q.by, ...by } };
    return this.data.quotes.by;
  }

  refresh(force) {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const items = await this.constituents(force);
        await this.quotes(items, force);
        this.data.error = this.partial ? { message: this.partial, partial: true } : null;
      } catch (e) {
        this.data.error = { message: e.message || String(e), at: this.now() };
      } finally {
        this.save();
        this.running = null;
      }
    })();
    return this.running;
  }

  stale() {
    const { list, quotes } = this.data;
    return !list.items.length || this.now() - list.at > LIST_TTL || this.now() - quotes.at > QUOTE_TTL;
  }

  // cached data right away (refreshing in the background when old); waits when there's nothing yet or `force`
  async get({ force } = {}) {
    if (force || !this.data.list.items.length || !this.data.quotes.at) await this.refresh(!!force);
    else if (this.stale() && !this.running) this.refresh(false).then(() => this.onChange()).catch(() => {});
    return this.payload();
  }

  // (not called `error`: the app treats an `error` key in an IPC answer as a failed call)
  payload() {
    const { list, quotes, error } = this.data;
    const items = list.items.map(x => {
      const q = quotes.by[x.y] || {};
      return { s: x.sym, y: x.y, n: x.name, sec: x.sector, ind: x.industry, cap: q.cap ?? null, chg: q.chg ?? null, px: q.px ?? null, cur: q.cur || null, t: q.t || null };
    });
    return { index: this.id, name: this.cfg.name, levels: list.levels || 1, items, listAt: list.at || null, at: quotes.at || null, problem: error || null, refreshing: !!this.running,
      marketState: (Object.values(quotes.by).find(q => q && q.state) || {}).state || null };
  }
}

// ── my portfolio ─────────────────────────────────────────────────
// quoteSummary assetProfile / fundProfile / quoteType answer → what grouping needs
function profileOf(r) {
  if (!r) return null;
  const ap = r.assetProfile || {}, fp = r.fundProfile || {}, qt = r.quoteType || {};
  return { type: qt.quoteType || null, sector: ap.sector || null, industry: ap.industry || null, category: fp.categoryName || null, family: fp.family || null };
}

// group of one position: funds under "ETFs" by category, stocks by Yahoo sector → industry
function portfolioGroup(pos, profile, quote) {
  const p = profile || {}, q = quote || {};
  const type = String(p.type || q.type || '').toUpperCase();
  if (type === 'ETF' || type === 'MUTUALFUND' || (!p.sector && pos && pos.type === 'ETF')) return { sec: 'ETFs', ind: p.category || 'ETF' };
  if (p.sector) return { sec: p.sector, ind: p.industry || p.sector };
  return { sec: 'Other', ind: 'Other' };
}

class PortfolioMap {
  // resolve(ticker, isin, price) → Yahoo symbol (Library.resolveSymbol, cached in history.json)
  // summary(sym, modules) → quoteSummary result (Library.quoteSummary)
  constructor({ fetchImpl, dir, crumb, now, onChange, resolve, summary }) {
    this.q = new Quotes({ fetchImpl, crumb });
    this.dir = dir;
    this.now = now || Date.now;
    this.onChange = onChange || (() => {});
    this.resolve = resolve;
    this.summary = summary;
    this.file = path.join(dir, 'heatmap-profiles.json');
    this.prof = (() => { try { const d = JSON.parse(fs.readFileSync(this.file, 'utf8')); return d && d.by ? d : { by: {} }; } catch { return { by: {} }; } })();
    this.syms = {};          // T212 ticker → Yahoo symbol (null = none found)
    this.quotesAt = 0;
    this.quoteBy = {};
    this.error = null;
    this.running = null;
  }

  async symbols(positions) {
    const todo = positions.filter(p => !(p.ticker in this.syms));
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const p = todo[next++];
        try { this.syms[p.ticker] = (await this.resolve(p.ticker, p.isin, p.price)) || null; } catch { /* try again next time */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  async profiles(syms, force) {
    let n = 0, fail = null;
    for (const s of syms) {
      const old = this.prof.by[s];
      if (!force && old && this.now() - old.at < (old.none ? 3 * 86400e3 : PROFILE_TTL)) continue;
      if (n++ >= 40) break;                                 // the rest next time
      try {
        const pr = profileOf(await this.summary(s, 'assetProfile,fundProfile,quoteType'));
        this.prof.by[s] = pr ? { at: this.now(), ...pr } : { at: this.now(), none: true };
      } catch (e) { fail = e; if (/session/.test(String(e && e.message))) break; }
    }
    if (n) saveJson(this.dir, this.file, this.prof);
    return fail;
  }

  refresh(positions, force) {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        await this.symbols(positions);
        const syms = [...new Set(positions.map(p => this.syms[p.ticker]).filter(Boolean))];
        const by = await this.q.all(syms);
        this.quoteBy = { ...this.quoteBy, ...by };
        this.quotesAt = this.now();
        await this.profiles(syms, force);
        this.error = this.q.partial ? { message: this.q.partial, partial: true } : null;
      } catch (e) {
        this.error = { message: e.message || String(e), at: this.now() };
      } finally { this.running = null; }
    })();
    return this.running;
  }

  stale(positions) {
    return this.now() - this.quotesAt > QUOTE_TTL || positions.some(p => !(p.ticker in this.syms));
  }

  // positions: [{ ticker, isin, price, sym, name, value, type }] (value in the account currency)
  async get(positions, { force, currency } = {}) {
    if (force || !this.quotesAt) await this.refresh(positions, !!force);
    else if (this.stale(positions) && !this.running) this.refresh(positions, false).then(() => this.onChange()).catch(() => {});
    return this.payload(positions, currency);
  }

  payload(positions, currency) {
    const items = positions.filter(p => p.value > 0).map(p => {
      const y = this.syms[p.ticker] || null;
      const q = (y && this.quoteBy[y.toUpperCase()]) || {};
      const g = portfolioGroup(p, y && this.prof.by[y], q);
      return { s: p.sym, y: y || p.sym, n: p.name || q.name || p.sym, sec: g.sec, ind: g.ind, cap: p.value, chg: q.chg ?? null, px: q.px ?? p.price ?? null,
        cur: q.cur || p.cur || null, t: q.t || null, tk: p.ticker };
    });
    return { index: 'portfolio', name: 'My portfolio', levels: 2, kind: 'portfolio', currency: currency || null, items, listAt: null,
      at: this.quotesAt || null, problem: this.error, refreshing: !!this.running, marketState: null };
  }
}

module.exports = { parseNasdaqList, cleanCompany, gicsFromYahoo, INDICES, HEATMAPS, IndexMap, PortfolioMap, Quotes, parseWikitext, parseHtml, parseWikitextFull, parseHtmlFull, parseQuotes,
  yahooSymbol, toYahoo, icbIndustry, cleanWiki, t212Map, profileOf, portfolioGroup };
