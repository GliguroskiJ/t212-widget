'use strict';
// News about held and watched instruments, from several feeds:
//   • Yahoo Finance search  – aggregates Reuters, AP, Zacks, Simply Wall St, GuruFocus, GlobeNewswire, …
//   • Google News (world)   – Bloomberg, CNBC, FT, WSJ, MarketWatch, … (stocks only; ETF names are too vague)
//   • Google News (Czech)   – Patria, Kurzy.cz, E15, Seznam Zprávy, …
// Articles are kept in userData/news.json (30 days). Each article belongs to a publisher ("source"),
// which the user can switch off. Teaser text and pictures are read lazily from the article page
// (og:description / og:image) and pictures are passed to the window as data URLs (strict CSP).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DAY = 86400e3;
const KEEP = 30 * DAY;
const MAX = 900;
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function atomicWrite(f, s) { const t = f + '.tmp'; fs.writeFileSync(t, s); fs.renameSync(t, f); }
const httpsOk = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
const titleKey = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 90);

// well-known publishers: key → [display name, group]
const KNOWN = {
  reuters: ['Reuters', 'news'], ap: ['Associated Press', 'news'], bloomberg: ['Bloomberg', 'news'], cnbc: ['CNBC', 'news'],
  ft: ['Financial Times', 'news'], wsj: ['The Wall Street Journal', 'news'], marketwatch: ['MarketWatch', 'news'],
  barrons: ['Barron’s', 'news'], yahoo: ['Yahoo Finance', 'news'], businessinsider: ['Business Insider', 'news'],
  forbes: ['Forbes', 'news'], fortune: ['Fortune', 'news'], economist: ['The Economist', 'news'], investing: ['Investing.com', 'news'],
  zacks: ['Zacks', 'analysis'], simplywallst: ['Simply Wall St', 'analysis'], gurufocus: ['GuruFocus', 'analysis'],
  motleyfool: ['The Motley Fool', 'analysis'], seekingalpha: ['Seeking Alpha', 'analysis'], morningstar: ['Morningstar', 'analysis'],
  ibd: ['Investor’s Business Daily', 'analysis'], benzinga: ['Benzinga', 'analysis'], tipranks: ['TipRanks', 'analysis'],
  insidermonkey: ['Insider Monkey', 'analysis'], investopedia: ['Investopedia', 'analysis'], kiplinger: ['Kiplinger', 'analysis'],
  globenewswire: ['GlobeNewswire', 'press'], businesswire: ['Business Wire', 'press'], prnewswire: ['PR Newswire', 'press'],
  accesswire: ['ACCESSWIRE', 'press'],
  patria: ['Patria.cz', 'cz'], kurzy: ['Kurzy.cz', 'cz'], e15: ['E15', 'cz'], hn: ['Hospodářské noviny', 'cz'],
  seznamzpravy: ['Seznam Zprávy', 'cz'], idnes: ['iDNES.cz', 'cz'], forbescz: ['Forbes Česko', 'cz'], ct24: ['ČT24', 'cz'],
  investicniweb: ['Investiční web', 'cz'], penize: ['Peníze.cz', 'cz']
};
const ALIAS = [
  [/^reuters/, 'reuters'], [/^(the )?associated press|^ap( |$)/, 'ap'], [/^bloomberg/, 'bloomberg'], [/^cnbc/, 'cnbc'],
  [/^financial times|^ft\.com/, 'ft'], [/wall street journal|^wsj/, 'wsj'], [/^marketwatch/, 'marketwatch'], [/^barron/, 'barrons'],
  [/^yahoo/, 'yahoo'], [/^business insider|^insider$|^markets insider/, 'businessinsider'], [/^forbes (česko|cesko|cz)/, 'forbescz'],
  [/^forbes/, 'forbes'], [/^fortune/, 'fortune'], [/economist/, 'economist'], [/^investing\.com/, 'investing'],
  [/^zacks/, 'zacks'], [/^simply wall/, 'simplywallst'], [/^gurufocus/, 'gurufocus'], [/motley fool/, 'motleyfool'],
  [/^seeking alpha/, 'seekingalpha'], [/^morningstar/, 'morningstar'], [/investor'?s business daily|^ibd/, 'ibd'],
  [/^benzinga/, 'benzinga'], [/^tipranks/, 'tipranks'], [/^insider monkey/, 'insidermonkey'], [/^investopedia/, 'investopedia'],
  [/^kiplinger/, 'kiplinger'], [/^globe ?newswire/, 'globenewswire'], [/^business ?wire/, 'businesswire'], [/^pr ?newswire/, 'prnewswire'],
  [/^accesswire/, 'accesswire'], [/^patria/, 'patria'], [/^kurzy/, 'kurzy'], [/^e15/, 'e15'], [/hospodářské noviny|hospodarske noviny|^ihned|^hn\.cz/, 'hn'],
  [/^seznam ?zprávy|^seznam ?zpravy/, 'seznamzpravy'], [/^idnes/, 'idnes'], [/^čt24|^ct24|česká televize/, 'ct24'],
  [/^investiční web|^investicniweb/, 'investicniweb'], [/^peníze\.cz|^penize\.cz/, 'penize']
];
function pubKey(name) {
  const n = String(name || '').trim().toLowerCase().replace(/[’']/g, "'");
  if (!n) return 'unknown';
  for (const [re, k] of ALIAS) if (re.test(n)) return k;
  return n.normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 40) || 'unknown';
}
const pubName = (key, raw) => (KNOWN[key] ? KNOWN[key][0] : String(raw || key).slice(0, 60));

// ETFs and funds: their names make poor search queries for general news
const FUNDISH = /\b(etf|ucits|acc|dist|index|fund|trust|vanguard|ishares|spdr|xtrackers|amundi|invesco|avantis|lyxor|wisdomtree|vaneck)\b/i;
function cleanName(name) {
  return String(name || '').replace(/\(.*?\)/g, ' ')
    .replace(/[,.]?\s+(inc|corp|corporation|co|company|plc|ag|se|sa|s\.a|nv|n\.v|ltd|limited)\.?$/i, '')
    .replace(/\s+/g, ' ').trim();
}
// ── relevance rules ─────────────────────────────────────────
// Yahoo: an article counts only when Yahoo tagged it with exactly this listing (relatedTickers).
// Google News has no tags: the headline must name the company (whole word, as written) or quote the ticker.
const RULES = 2;   // stored items from older rule sets are dropped on load
const normSym = s => String(s || '').trim().toUpperCase().replace(/[-/]/g, '.');
function tagged(tags, sym) {
  if (!Array.isArray(tags) || !tags.length || !sym) return false;
  const s = normSym(sym);
  return tags.some(t => normSym(t) === s);
}
// single words that are ordinary English (a headline "Target hits…" or "grab a share of" is not about the company)
const COMMON = new Set(['grab', 'block', 'target', 'visa', 'snap', 'gap', 'shell', 'match', 'square', 'box', 'zoom', 'unity', 'sea',
  'coin', 'progressive', 'general', 'united', 'national', 'american', 'global', 'first', 'energy', 'digital', 'rocket', 'compass',
  'ball', 'crown', 'eagle', 'dollar', 'fair', 'apex', 'arch', 'core', 'key', 'south', 'north', 'hub', 'nova']);
const LEGAL = String.raw`(?:SE|SA|S\.A\.|AG|N\.?V\.?|Inc\.?|Corp\.?|Corporation|Group|Holdings?|plc|PLC|Ltd\.?|Limited|Co\.)`;
// Yahoo listing suffix → exchange prefixes used in headlines ("EPA:ATO", "(NASDAQ: GRAB)")
const EXCH = { '': ['NASDAQ', 'NYSE', 'NYSEARCA', 'NYSEAMERICAN', 'AMEX', 'OTC', 'OTCMKTS', 'CBOE'], PA: ['EPA', 'EURONEXT'], AS: ['AMS', 'EURONEXT'],
  BR: ['EBR', 'EURONEXT'], LS: ['ELI', 'EURONEXT'], L: ['LON', 'LSE'], DE: ['ETR', 'XETRA', 'FRA'], F: ['FRA'], MI: ['BIT'], MC: ['BME'],
  SW: ['SWX', 'SIX'], PR: ['PSE', 'BCPP'], TO: ['TSX', 'TSE'], V: ['TSXV', 'CVE'], HK: ['HKEX', 'HKG'], ST: ['STO'], CO: ['CPH'], HE: ['HEL'], OL: ['OSL'], VI: ['VIE'], WA: ['WSE'] };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const W0 = '(?<![\\p{L}\\p{N}])', W1 = '(?![\\p{L}\\p{N}])';
// everything needed to judge one company's headlines
function matcher({ name, sym, ticker }) {
  const legal = String(name || '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  const base = cleanName(name);
  const ysym = String(sym || '');
  const dot = ysym.lastIndexOf('.');
  const suf = dot > 0 ? ysym.slice(dot + 1).toUpperCase() : '';
  let tk = (dot > 0 ? ysym.slice(0, dot) : ysym) || String(ticker || '').split('_')[0].replace(/[a-z]+$/, '');
  tk = tk.toUpperCase();
  // US listing: Yahoo symbol without suffix, or (unresolved) a Trading 212 *_US_EQ ticker. Anything else gets no
  // US exchange prefixes / cashtags, so an unresolved "ATOp_EQ" (Atos) can't match "NYSE: ATO" (Atmos Energy)
  const us = ysym ? !suf : /_US_EQ$/.test(String(ticker || ''));
  const exch = suf ? (EXCH[suf] || []) : us ? EXCH[''] : [];
  const one = !/\s/.test(base);
  const ambiguous = one && (base.length <= 4 || COMMON.has(base.toLowerCase()));
  // names written in capitals ("NVIDIA") also appear as "Nvidia" in headlines
  const cap = base.length >= 4 && base === base.toUpperCase() && /\p{L}/u.test(base) ? base[0] + base.slice(1).toLowerCase() : null;
  return { base, legal, tk, exch, us, ambiguous, one, forms: cap ? [base, cap] : [base] };
}
// does a headline speak about this company?  cz: also Czech case endings ("Applu", "Nvidie") for unambiguous names
function headlineMatches(title, m, cz) {
  const t = String(title || '');
  if (!m || !m.base) return false;
  // explicit ticker forms: "(NASDAQ: GRAB)", "EPA:ATO", "$GRAB", "GRAB stock", "akcie GRAB"
  if (m.tk && /^[A-Z0-9.]{1,10}$/.test(m.tk)) {
    const T = esc(m.tk);
    if (m.exch.length && new RegExp(`${W0}(?:${m.exch.join('|')})\\s*:\\s*${T}${W1}`, 'u').test(t)) return true;
    // cashtags and "TK stock" are US conventions (and short non-US tickers collide with US ones)
    if (m.us !== false && m.tk.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}$])\\$${T}${W1}`, 'u').test(t)) return true;
    if (m.tk.length >= 3 && new RegExp(`${W0}akci(?:e|í|ím)\\s+${T}${W1}`, 'u').test(t)) return true;
    if (m.us !== false && m.tk.length >= 3 && new RegExp(`${W0}${T}\\s+(?:stock|shares)${W1}`, 'u').test(t)) return true;
  }
  const B = (m.forms || [m.base]).map(esc).join('|');
  if (m.ambiguous) {
    // short or dictionary names need the legal name: "Atos SE", "Atos Group", "Grab Holdings", "Block Inc."
    return new RegExp(`${W0}(?:${B})\\s+${LEGAL}(?![\\p{L}\\p{N}])`, 'u').test(t) ||
      (m.legal !== m.base && new RegExp(`${W0}${esc(m.legal)}${W1}`, 'u').test(t));
  }
  if (new RegExp(`${W0}(?:${B})${W1}`, 'u').test(t)) return true;
  if (cz && m.one && m.base.length >= 5) {
    const stems = (m.forms || [m.base]).map(f => esc(/[aeo]$/i.test(f) ? f.slice(0, -1) : f)).join('|');
    if (new RegExp(`${W0}(?:${stems})(?:u|a|e|y|i|ou|em|ovi|ů|ům|ách|ii|ie|ií|iu)${W1}`, 'u').test(t)) return true;
  }
  return false;
}
// Google News query: the plain name for unambiguous companies, else the legal name OR the exchange ticker
function googleQuery(m, cz) {
  const terms = [];
  if (!m.ambiguous) terms.push(m.base);
  else {
    if (m.legal !== m.base) terms.push(m.legal);
    else terms.push(m.base + ' Group');
    if (m.tk) for (const e of m.exch.slice(0, 2)) terms.push(e + ':' + m.tk);
  }
  const q = terms.map(x => `"${x}"`).join(' OR ');
  return m.ambiguous ? `${q} when:7d` : `${q} ${cz ? 'akcie' : 'stock'} when:7d`;
}

const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const strip = s => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function parseRss(xml) {
  const out = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const tag = n => { const r = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`).exec(it); return r ? decode(r[1]).trim() : ''; };
    const source = tag('source');
    let title = strip(tag('title'));
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    out.push({ title, link: tag('link'), time: Date.parse(tag('pubDate')) || null, source });
  }
  return out;
}

class News {
  constructor({ lib, dir, now, settings }) {
    this.lib = lib;
    this.now = now || Date.now;
    this.settings = settings || (() => ({}));
    this.dir = dir;
    this.file = path.join(dir, 'news.json');
    this.imgDir = path.join(dir, 'news-img');
    const d = readJson(this.file, null) || {};
    this.d = { items: Array.isArray(d.items) ? d.items : [], lastRun: d.lastRun || 0, init: !!d.init };
    // re-check what was stored: older rule sets (untagged Yahoo items, loose Google matches) go away
    const bad = this.d.items.filter(x => !this.valid(x));
    if (bad.length) {
      this.d.items = this.d.items.filter(x => this.valid(x));
      for (const x of bad) if (x.img) { try { fs.unlinkSync(path.join(this.imgDir, x.img)); } catch {} }
      this.save();
    }
    this.running = null;
    this.metaQueue = Promise.resolve();
    this._t = null;
  }
  save() { try { atomicWrite(this.file, JSON.stringify(this.d)); } catch {} }
  saveSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.save(), 800); }

  feeds() { return { yahoo: true, google: true, googleCz: true, ...(this.settings().newsFeeds || {}) }; }
  enabled(x) { const off = this.settings().newsSources || {}; return off[x.pub] !== false; }
  // still passes the relevance rules? (Yahoo: tagged with one of its listings; Google: matched under the current rules)
  valid(x) {
    if (!x || x.v !== RULES || !Array.isArray(x.tickers) || !x.tickers.length) return false;
    if (x.src === 'yahoo') return Array.isArray(x.syms) && x.syms.some(s => tagged(x.tags, s));
    return x.src === 'google';
  }
  has(id) { const x = this.find(id); return !!x && this.valid(x); }

  // add or merge one article; returns the new item or null
  put(a) {
    if (!a.title || !a.url || !httpsOk(a.url)) return null;
    const k = titleKey(a.title);
    const ex = this.d.items.find(x => x.id === a.id || (k && x.tkey === k));
    if (ex) {
      for (const tk of a.tickers) if (!ex.tickers.includes(tk)) ex.tickers.push(tk);
      if (!ex.thumb && a.thumb) ex.thumb = a.thumb;
      if (a.src === 'yahoo') {
        ex.syms = [...new Set([...(ex.syms || []), ...a.syms])];
        if (!Array.isArray(ex.tags) || !ex.tags.length) ex.tags = a.tags;
        if (ex.src === 'google') { ex.url = a.url; ex.src = 'yahoo'; }   // prefer the direct link
      }
      return null;
    }
    const x = { ...a, v: RULES, tkey: k, added: this.now() };
    this.d.items.push(x);
    return x;
  }

  async yahoo(p, sym) {
    const r = await this.lib.fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=0&newsCount=12&listsCount=0`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const j = await r.json();
    const out = [];
    for (const it of j.news || []) {
      if (!it.uuid || !it.title) continue;
      if (!tagged(it.relatedTickers, sym)) continue;   // only articles Yahoo tagged with exactly this listing
      const res = (it.thumbnail && Array.isArray(it.thumbnail.resolutions)) ? it.thumbnail.resolutions : [];
      const best = res.filter(x => x && x.url && httpsOk(x.url)).sort((a, b) => Math.abs((a.width || 0) - 640) - Math.abs((b.width || 0) - 640))[0];
      const pub = pubKey(it.publisher);
      out.push({ id: 'y' + sha(it.uuid), src: 'yahoo', tickers: [p.ticker], syms: [sym], tags: it.relatedTickers.slice(0, 30).map(String), title: String(it.title).slice(0, 300), pub, publisher: pubName(pub, it.publisher),
        url: it.link, time: (Number(it.providerPublishTime) || 0) * 1000 || this.now(), thumb: best ? best.url : null });
    }
    return out;
  }

  async google(p, cz, sym) {
    const m = matcher({ name: p.name, sym, ticker: p.ticker });
    if (!m.base || m.base.length < 2 || FUNDISH.test(p.name || '')) return [];
    const q = googleQuery(m, cz);
    const loc = cz ? 'hl=cs&gl=CZ&ceid=CZ:cs' : 'hl=en-US&gl=US&ceid=US:en';
    const r = await this.lib.fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`, { headers: { Accept: 'application/rss+xml, application/xml' } });
    if (!r.ok) return [];
    const items = parseRss(await r.text()).slice(0, 12);
    return items.filter(x => x.title && x.link && headlineMatches(x.title, m, cz)).map(x => {
      const pub = pubKey(x.source);
      return { id: 'g' + sha(x.link), src: 'google', lang: cz ? 'cs' : 'en', tickers: [p.ticker], title: x.title.slice(0, 300), pub, publisher: pubName(pub, x.source),
        url: x.link, time: x.time || this.now(), thumb: null };
    });
  }

  // fetch news for the given positions; resolves to the newly added articles
  refresh(positions, force) {
    if (this.running) return this.running;
    if (!force && this.now() - this.d.lastRun < 30 * 60e3) return Promise.resolve([]);
    this.d.lastRun = this.now();
    const fd = this.feeds();
    this.running = (async () => {
      const fresh = [];
      for (const p of positions.slice(0, 40)) {
        let sym = null;
        try { sym = await this.lib.resolveSymbol(p.ticker, p.isin, p.price); } catch {}
        const meta = (this.lib.instrumentIndex && this.lib.instrumentIndex()[p.ticker]) || {};
        const pp = { ...p, name: p.name || meta.name || '' };
        const isFund = String(meta.type || '').toUpperCase() === 'ETF';
        const jobs = [];
        if (fd.yahoo && sym) jobs.push(this.yahoo(pp, sym));
        if (fd.google && !isFund) jobs.push(this.google(pp, false, sym));
        if (fd.googleCz && !isFund) jobs.push(this.google(pp, true, sym));
        for (const j of jobs) {
          let list = [];
          try { list = await j; } catch {}
          for (const a of list) {
            if (this.now() - a.time > 7 * DAY) continue;
            const x = this.put(a);
            if (x) fresh.push(x);
          }
        }
        await new Promise(r => setTimeout(r, 250));
      }
      // forget old articles (and their pictures)
      const cut = this.now() - KEEP;
      const gone = this.d.items.filter(x => x.time < cut);
      this.d.items = this.d.items.filter(x => x.time >= cut).sort((a, b) => b.time - a.time).slice(0, MAX);
      for (const x of gone) if (x.img) { try { fs.unlinkSync(path.join(this.imgDir, x.img)); } catch {} }
      const first = !this.d.init;
      this.d.init = true;
      this.save();
      return first ? fresh.filter(x => this.now() - x.time < DAY).slice(0, 3) : fresh;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  list({ ticker, source, limit = 60, offset = 0, held = [] } = {}) {
    let items = this.d.items.filter(x => this.enabled(x) && this.valid(x));
    if (ticker) items = items.filter(x => x.tickers.includes(ticker));
    if (source) items = items.filter(x => x.pub === source);
    items = items.sort((a, b) => b.time - a.time);
    return {
      total: items.length, lastRun: this.d.lastRun, running: !!this.running,
      items: items.slice(offset, offset + Math.min(200, limit)).map(x => ({ id: x.id, src: x.src, tickers: x.tickers, title: x.title, pub: x.pub,
        publisher: x.publisher, time: x.time, summary: x.summary || null, hasMeta: !!x.metaAt, hasImg: !!(x.img || x.thumb) }))
    };
  }

  // all publishers: the well-known ones + everything seen in the stored articles
  sources() {
    const off = this.settings().newsSources || {};
    const seen = {};
    for (const x of this.d.items) { const s = seen[x.pub] || (seen[x.pub] = { name: x.publisher, count: 0 }); s.count++; }
    const keys = new Set([...Object.keys(KNOWN), ...Object.keys(seen)]);
    return {
      feeds: this.feeds(),
      sources: [...keys].map(k => ({ key: k, name: KNOWN[k] ? KNOWN[k][0] : (seen[k] && seen[k].name) || k, group: KNOWN[k] ? KNOWN[k][1] : 'other',
        count: seen[k] ? seen[k].count : 0, on: off[k] !== false })).sort((a, b) => (b.count - a.count) || a.name.localeCompare(b.name))
    };
  }

  find(id) { return this.d.items.find(x => x.id === id) || null; }
  link(id) { const x = this.find(id); return x && httpsOk(x.url) ? x.url : null; }

  // teaser + picture of one article (read from the page once, then cached)
  meta(id) {
    const x = this.find(id);
    if (!x) return Promise.resolve(null);
    const job = this.metaQueue.then(() => this._meta(x)).catch(() => null);
    this.metaQueue = job.then(() => {}, () => {});
    return job;
  }
  async _meta(x) {
    if (!x.metaAt && x.src !== 'google') {
      x.metaAt = this.now();
      try {
        const r = await this.lib.fetch(x.url, { headers: { Accept: 'text/html' }, redirect: 'follow' });
        if (r.ok && /html/i.test((r.headers && r.headers.get && r.headers.get('content-type')) || '')) {
          const html = (await r.text()).slice(0, 600e3);
          const og = n => { const m = new RegExp(`<meta[^>]+(?:property|name)=["'](?:og:|twitter:)?${n}["'][^>]*>`, 'i').exec(html); const c = m && /content=["']([^"']*)["']/i.exec(m[0]); return c ? strip(c[1]) : null; };
          const desc = og('description');
          if (desc && desc.length > 20 && titleKey(desc) !== x.tkey) x.summary = desc.slice(0, 400);
          const im = og('image');
          if (!x.thumb && im && httpsOk(im)) x.thumb = im;
        }
      } catch {}
      if (!x.metaAt) x.metaAt = this.now();
      this.saveSoon();
    }
    return { id: x.id, summary: x.summary || null, image: await this.image(x) };
  }
  async image(x) {
    try { fs.mkdirSync(this.imgDir, { recursive: true }); } catch {}
    if (x.img) { try { return 'data:' + (x.imgType || 'image/jpeg') + ';base64,' + fs.readFileSync(path.join(this.imgDir, x.img)).toString('base64'); } catch { x.img = null; } }
    if (!x.thumb || x.imgFail) return null;
    try {
      const r = await this.lib.fetch(x.thumb, { headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5' } });
      const type = ((r.headers && r.headers.get && r.headers.get('content-type')) || '').split(';')[0].trim();
      if (!r.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) { x.imgFail = true; this.saveSoon(); return null; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200 || buf.length > 900e3) { x.imgFail = true; this.saveSoon(); return null; }
      x.img = x.id + '.' + type.split('/')[1]; x.imgType = type;
      fs.writeFileSync(path.join(this.imgDir, x.img), buf);
      this.saveSoon();
      return 'data:' + type + ';base64,' + buf.toString('base64');
    } catch { return null; }
  }
}

module.exports = { News, pubKey, pubName, parseRss, cleanName, KNOWN, tagged, matcher, headlineMatches, googleQuery };
