'use strict';
// S&P 500 heatmap data: constituents from Wikipedia ("List of S&P 500 companies", refreshed at most
// once a day so joiners / leavers show up), market cap + day change from Yahoo Finance's v7 quote
// endpoint (batches of 100, cached a few minutes). Everything is cached in userData/sp500.json, so the
// map opens instantly with the last data and keeps showing it when a source is down.

const fs = require('fs');
const path = require('path');

const WIKI_API = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies&prop=wikitext&format=json&formatversion=2';
const WIKI_HTML = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const QUOTE = 'https://query2.finance.yahoo.com/v7/finance/quote';
const FIELDS = 'symbol,shortName,regularMarketPrice,regularMarketChangePercent,marketCap,currency,regularMarketTime,marketState';
const LIST_TTL = 24 * 3600e3;
const QUOTE_TTL = 4 * 60e3;
const BATCH = 100;
const FETCH_TIMEOUT = 25e3;
const MIN_ROWS = 400;               // fewer than this = the page changed shape, keep what we have
const UA = 'T212Widget/1.0 (desktop portfolio app; S&P 500 heatmap)';

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
  // templates: {{NyseSymbol|BRK.B}} → BRK.B, {{sort|x|Text}} → Text, {{nowrap|Text}} → Text
  for (let i = 0; i < 4 && /\{\{/.test(s); i++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (m, body) => {
      const parts = body.split('|').map(x => x.trim()).filter(x => x && !/^[a-z_]+\s*=/i.test(x));
      return parts.length > 1 ? parts[parts.length - 1] : '';
    });
  }
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

function pickColumns(head) {
  const h = head.map(x => x.toLowerCase());
  const find = (...keys) => h.findIndex(x => keys.some(k => x.includes(k)));
  return { sym: find('symbol', 'ticker'), name: find('security', 'company'), sector: find('gics sector', 'sector'), industry: find('sub-industry', 'sub industry', 'industry') };
}

function toRows(rows, clean) {
  const head = rows.find(r => r.hdr) || rows[0];
  if (!head) return [];
  const col = pickColumns(head.cells.map(clean));
  if (col.sym < 0 || col.name < 0 || col.sector < 0) return [];
  if (col.industry === col.sector) col.industry = -1;
  const out = [], seen = new Set();
  for (const r of rows) {
    if (r === head || r.hdr) continue;
    const c = r.cells.map(clean);
    const sym = (c[col.sym] || '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym) || seen.has(sym)) continue;
    seen.add(sym);
    out.push({ sym, y: yahooSymbol(sym), name: c[col.name] || sym, sector: c[col.sector] || 'Other', industry: (col.industry >= 0 && c[col.industry]) || c[col.sector] || 'Other' });
  }
  return out;
}

// the first "wikitable" (id="constituents" when present) of the article's wikitext
function parseWikitext(text) {
  const src = String(text || '');
  let i = src.search(/\{\|[^\n]*id\s*=\s*"?constituents/i);
  if (i < 0) i = src.search(/\{\|[^\n]*wikitable/i);
  if (i < 0) return [];
  const end = src.indexOf('\n|}', i);
  return toRows(wikiRows(src.slice(i, end < 0 ? undefined : end)), cleanWiki);
}

const cleanHtml = s => decode(String(s || '').replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
// rendered article (fallback when the API answer can't be read)
function parseHtml(html) {
  const src = String(html || '');
  let i = src.search(/<table[^>]*id\s*=\s*["']?constituents/i);
  if (i < 0) i = src.search(/<table[^>]*wikitable/i);
  if (i < 0) return [];
  const end = src.indexOf('</table>', i);
  const table = src.slice(i, end < 0 ? undefined : end);
  const rows = [];
  for (const m of table.split(/<tr[\s>]/i).slice(1)) {
    const cells = [];
    let hdr = false;
    const re = /<(t[hd])[^>]*>([\s\S]*?)(?=<t[hd][\s>]|<\/tr>|$)/gi;
    let c;
    while ((c = re.exec(m))) { if (c[1].toLowerCase() === 'th') hdr = true; cells.push(c[2].replace(/<\/t[hd]>\s*$/i, '')); }
    if (cells.length) rows.push({ hdr: hdr && !rows.some(r => r.hdr), cells });
  }
  return toRows(rows, cleanHtml);
}

// Yahoo uses "-" for share classes: BRK.B → BRK-B, BF.B → BF-B
const yahooSymbol = s => String(s || '').trim().toUpperCase().replace(/\./g, '-');

// v7 quote answer → { SYMBOL: { px, chg, cap, cur, name, t } }
function parseQuotes(j) {
  const out = {};
  const list = (j && j.quoteResponse && j.quoteResponse.result) || [];
  for (const q of list) {
    if (!q || !q.symbol) continue;
    const n = v => (v == null || !isFinite(Number(v)) ? null : Number(v));
    out[String(q.symbol).toUpperCase()] = { px: n(q.regularMarketPrice), chg: n(q.regularMarketChangePercent), cap: n(q.marketCap), cur: q.currency || 'USD',
      name: q.shortName || q.longName || null, t: n(q.regularMarketTime) ? n(q.regularMarketTime) * 1000 : null, state: q.marketState || null };
  }
  return out;
}

// Yahoo symbol → Trading 212 ticker for US stocks: the instrument list (AAPL_US_EQ, BRK_B_US_EQ / short
// name BRK.B) plus the symbols the app already resolved for held instruments (most reliable, wins)
function t212Map(index, resolved) {
  const map = {};
  for (const tk of Object.keys(index || {})) {
    const m = /^(.+?)_US_EQ$/.exec(tk);
    if (!m) continue;
    const i = index[tk] || {};
    if (i.type && i.type !== 'STOCK') continue;
    for (const k of [i.shortName && yahooSymbol(i.shortName), yahooSymbol(m[1].replace(/_/g, '-'))]) if (k && !map[k]) map[k] = tk;
  }
  for (const [tk, sym] of Object.entries(resolved || {})) if (sym && /_US_EQ$/.test(tk)) map[String(sym).toUpperCase()] = tk;
  return map;
}

class SP500 {
  // crumb(force) → { crumb, cookie } (Library.yahooCrumb); onChange() after a background refresh
  constructor({ fetchImpl, dir, crumb, now, onChange }) {
    const f = fetchImpl || fetch;
    // every request gets a deadline: a hung connection must not leave `running` pending forever
    this.fetch = (u, o = {}) => f(u, typeof AbortSignal !== 'undefined' && AbortSignal.timeout && !o.signal ? { ...o, signal: AbortSignal.timeout(FETCH_TIMEOUT) } : o);
    this.dir = dir;
    this.crumb = crumb;
    this.now = now || Date.now;
    this.onChange = onChange || (() => {});
    this.file = path.join(dir, 'sp500.json');
    this.running = null;
    this.data = this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && d.list && Array.isArray(d.list.items)) return { list: d.list, quotes: d.quotes || { at: 0, by: {} }, error: null };
    } catch {}
    return { list: { at: 0, items: [], source: null }, quotes: { at: 0, by: {} }, error: null };
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ list: this.data.list, quotes: this.data.quotes }));
      fs.renameSync(tmp, this.file);
    } catch {}
  }

  async constituents(force) {
    const L = this.data.list;
    if (!force && L.items.length && this.now() - L.at < LIST_TTL) return L.items;
    // don't hammer Wikipedia after a failure: retry after 30 min (unless forced)
    if (!force && L.items.length && this.listFailAt && this.now() - this.listFailAt < 30 * 60e3) return L.items;
    let items = [], err = null;
    try {
      const r = await this.fetch(WIKI_API, { headers: { Accept: 'application/json', 'Api-User-Agent': UA } });
      if (!r.ok) throw new Error('Wikipedia HTTP ' + r.status);
      const j = await r.json();
      const text = j && j.parse && (typeof j.parse.wikitext === 'string' ? j.parse.wikitext : j.parse.wikitext && j.parse.wikitext['*']);
      items = parseWikitext(text);
    } catch (e) { err = e; }
    if (items.length < MIN_ROWS) {
      try {
        const r = await this.fetch(WIKI_HTML, { headers: { Accept: 'text/html' } });
        if (r.ok) { const alt = parseHtml(await r.text()); if (alt.length > items.length) items = alt; }
      } catch (e) { err = err || e; }
    }
    if (items.length >= MIN_ROWS) {
      this.data.list = { at: this.now(), items, source: 'wikipedia' };
      this.listFailAt = 0;
      return items;
    }
    this.listFailAt = this.now();
    if (L.items.length) return L.items;               // keep the last good list
    throw new Error(err ? 'Could not load the S&P 500 list: ' + (err.message || err) : 'Could not read the S&P 500 list from Wikipedia');
  }

  async quoteBatch(syms) {
    const go = async force => {
      // after a 401 the parallel batches share one new session instead of each asking for its own
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

  async quotes(items, force) {
    const Q = this.data.quotes;
    if (!force && Q.at && this.now() - Q.at < QUOTE_TTL && items.every(x => Q.by[x.y])) return Q.by;
    const syms = items.map(x => x.y);
    const batches = [];
    for (let i = 0; i < syms.length; i += BATCH) batches.push(syms.slice(i, i + BATCH));
    const by = {};
    let ok = 0, lastErr = null, next = 0;
    // one session first (Library caches it), then three requests at a time
    try { await this.crumb(false); } catch {}
    const worker = async () => {
      while (next < batches.length) {
        const b = batches[next++];
        try { Object.assign(by, await this.quoteBatch(b)); ok++; } catch (e) { lastErr = e; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!ok) throw lastErr || new Error('Yahoo Finance returned no quotes');
    this.data.quotes = { at: this.now(), by: { ...Q.by, ...by } };
    if (ok < batches.length) this.partial = (lastErr && lastErr.message) || 'some quotes missing';
    else this.partial = null;
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
      return { s: x.sym, y: x.y, n: x.name, sec: x.sector, ind: x.industry, cap: q.cap ?? null, chg: q.chg ?? null, px: q.px ?? null, cur: q.cur || 'USD', t: q.t || null };
    });
    return { items, listAt: list.at || null, at: quotes.at || null, problem: error || null, refreshing: !!this.running,
      marketState: (Object.values(quotes.by).find(q => q && q.state) || {}).state || null };
  }
}

module.exports = { SP500, parseWikitext, parseHtml, parseQuotes, yahooSymbol, cleanWiki, t212Map };
