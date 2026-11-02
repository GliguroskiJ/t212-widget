// News (feeds, sources, dedupe, teaser + picture), notifications (news, price-move alerts, calendar events).
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
const { Notifier } = require('../main/notify');
const { News, pubKey, parseRss, cleanName, tagged, matcher, headlineMatches, googleQuery } = require('../main/news');
const now = Date.UTC(2026, 9, 21, 12);
let pct = 1.5;
const yahoo = [
  { uuid: 'a1', title: 'Atos SE posts Q3 revenue', publisher: 'Reuters', link: 'https://example.com/a1', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATO.PA'],
    thumbnail: { resolutions: [{ url: 'https://img.example.com/a1.jpg', width: 640, height: 360 }, { url: 'https://img.example.com/s.jpg', width: 140, height: 140 }] } },
  { uuid: 'a2', title: 'Unrelated market wrap', publisher: 'Zacks', link: 'https://example.com/a2', providerPublishTime: now / 1000 - 3600, relatedTickers: ['SPY'] },
  { uuid: 'a3', title: 'Atos: Simply Wall St looks at the balance sheet', publisher: 'Simply Wall St.', link: 'https://example.com/a3', providerPublishTime: now / 1000 - 2 * 86400, relatedTickers: ['ATO.PA'] },
  { uuid: 'a4', title: 'Bad link', publisher: 'GlobeNewswire', link: 'javascript:alert(1)', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATO.PA'] },
  { uuid: 'a6', title: 'Atos outlook (untagged)', publisher: 'Reuters', link: 'https://example.com/a6', providerPublishTime: now / 1000 - 3600 },
  { uuid: 'a7', title: 'Atos outlook (empty tags)', publisher: 'Reuters', link: 'https://example.com/a7', providerPublishTime: now / 1000 - 3600, relatedTickers: [] },
  { uuid: 'a8', title: 'Atossa Therapeutics doses first patient', publisher: 'GlobeNewswire', link: 'https://example.com/a8', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATOS'] },
  { uuid: 'a9', title: 'Atmos Energy raises dividend', publisher: 'Zacks', link: 'https://example.com/a9', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATO'] }
];
const rss = `<rss><channel>
<item><title>Atos SE posts Q3 revenue - Reuters</title><link>https://news.google.com/rss/articles/x1</link><pubDate>${new Date(now - 3600e3).toUTCString()}</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Atos SE shares jump &amp; rally - Bloomberg</title><link>https://news.google.com/rss/articles/x2</link><pubDate>${new Date(now - 7200e3).toUTCString()}</pubDate><source url="https://www.bloomberg.com">Bloomberg</source></item>
<item><title>Atossa Therapeutics stock soars on trial data - Benzinga</title><link>https://news.google.com/rss/articles/x3</link><pubDate>${new Date(now - 3000e3).toUTCString()}</pubDate><source>Benzinga</source></item>
<item><title>Atos shares slide on guidance - MarketWatch</title><link>https://news.google.com/rss/articles/x4</link><pubDate>${new Date(now - 3000e3).toUTCString()}</pubDate><source>MarketWatch</source></item>
</channel></rss>`;
const rssCz = `<rss><channel><item><title>Akcie Atos SE rostou - Patria.cz</title><link>https://news.google.com/rss/articles/c1</link><pubDate>${new Date(now - 5000e3).toUTCString()}</pubDate><source url="https://www.patria.cz">Patria.cz</source></item></channel></rss>`;
const IMG = Buffer.alloc(2000, 9);
const calls = [];
const lib = {
  resolveSymbol: async () => 'ATO.PA',
  instrumentIndex: () => ({ ATOp_EQ: { name: 'Atos SE', type: 'STOCK' }, VWRPl_EQ: { name: 'Vanguard FTSE All-World (Acc)', type: 'ETF' } }),
  dayQuote: async () => ({ last: 100 * (1 + pct / 100), prevClose: 100, currency: 'EUR' }),
  fetch: async u => {
    calls.push(u);
    if (u.includes('finance/search')) return new Response(JSON.stringify({ news: yahoo }), { headers: { 'content-type': 'application/json' } });
    if (u.includes('news.google.com/rss/search')) return new Response(u.includes('ceid=CZ') ? rssCz : rss, { headers: { 'content-type': 'application/xml' } });
    if (u === 'https://example.com/a1') return new Response('<html><head><meta property="og:description" content="Revenue rose 4 % &amp; margins improved in the third quarter."><meta property="og:image" content="https://img.example.com/og.jpg"></head></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (u.startsWith('https://img.example.com/')) return new Response(IMG, { headers: { 'content-type': 'image/jpeg' } });
    return new Response('', { status: 404 });
  }
};
(async () => {
  // helpers
  assert.equal(pubKey('Simply Wall St.'), 'simplywallst'); assert.equal(pubKey('GuruFocus.com'), 'gurufocus'); assert.equal(pubKey('Zacks Investment Research'), 'zacks');
  assert.equal(pubKey('Associated Press Finance'), 'ap'); assert.equal(pubKey('GlobeNewswire Inc.'), 'globenewswire'); assert.equal(pubKey('The Motley Fool'), 'motleyfool');
  assert.equal(cleanName('Atos SE'), 'Atos'); assert.equal(cleanName('Grab Holdings Ltd'), 'Grab Holdings'); assert.equal(cleanName('Apple Inc.'), 'Apple');
  assert.equal(parseRss(rss)[1].title, 'Atos SE shares jump & rally');
  // relevance: Yahoo tags must name exactly this listing
  assert.ok(tagged(['ATO.PA', 'SPY'], 'ato.pa')); assert.ok(!tagged(['ATOS'], 'ATO.PA')); assert.ok(!tagged(['ATO'], 'ATO.PA'));
  assert.ok(!tagged([], 'ATO.PA')); assert.ok(!tagged(undefined, 'ATO.PA')); assert.ok(tagged(['BRK.B'], 'BRK-B'));
  // relevance: Google headlines
  const atos = matcher({ name: 'Atos SE', sym: 'ATO.PA', ticker: 'ATOp_EQ' });
  const grab = matcher({ name: 'Grab Holdings Ltd', sym: 'GRAB', ticker: 'GRAB_US_EQ' });
  const grab1 = matcher({ name: 'Grab', sym: 'GRAB', ticker: 'GRAB_US_EQ' });
  const nvda = matcher({ name: 'NVIDIA Corporation', sym: 'NVDA', ticker: 'NVDA_US_EQ' });
  const tsla = matcher({ name: 'Tesla', sym: 'TSLA', ticker: 'TSLA_US_EQ' });
  assert.ok(atos.ambiguous && !grab.ambiguous && grab1.ambiguous && !tsla.ambiguous);
  const yes = (t, m, cz) => assert.ok(headlineMatches(t, m, cz), 'should match: ' + t);
  const no = (t, m, cz) => assert.ok(!headlineMatches(t, m, cz), 'should not match: ' + t);
  no('Atossa Therapeutics shares surge 40%', atos); no('Atossa Therapeutics (NASDAQ: ATOS) reports data', atos);
  no('Atos shares slide on guidance', atos); no('Kronos and Atos-like deals', atos);
  yes('Atos SE wins contract', atos); yes('Atos Group cuts debt', atos); yes('Shares of Atos (EPA:ATO) rise', atos); yes('Akcie Atos SE rostou', atos, true);
  no('Investors grab a share of the AI boom', grab); no('Grab a share of these 3 stocks', grab); no('Grab a share of these 3 stocks', grab1);
  no('Smash-and-grab holdings', grab);
  yes('Grab Holdings (NASDAQ: GRAB) reports Q3', grab); yes('Grab Holdings beats estimates', grab); yes('Why $GRAB is up today', grab);
  yes('GRAB stock jumps after earnings', grab); yes('Grab Holdings Ltd. posts profit', grab1); yes('(NASDAQ:GRAB) slides', grab1);
  no('$GRABX rallies', grab); no('Grab stock jumps', grab1);
  yes('Tesla recalls 2 million cars', tsla); no('Teslas everywhere', tsla); yes('Akcie Tesly padají', tsla, true); no('Akcie Tesly padají', tsla);
  yes('Nvidia beats again', matcher({ name: 'Nvidia', sym: 'NVDA' })); yes('Nvidia beats again', nvda); yes('NVIDIA beats again', nvda); no('Nvidias', nvda);
  assert.equal(googleQuery(grab, false), '"Grab Holdings" stock when:7d');
  assert.equal(googleQuery(grab1, false), '"Grab Group" OR "NASDAQ:GRAB" OR "NYSE:GRAB" when:7d');
  assert.equal(googleQuery(atos, true), '"Atos SE" OR "EPA:ATO" OR "EURONEXT:ATO" when:7d');
  // Yahoo symbol not resolved: a non-US T212 ticker must not borrow US exchange prefixes / cashtags (Atmos Energy is NYSE: ATO)
  const atosU = matcher({ name: 'Atos SE', sym: null, ticker: 'ATOp_EQ' });
  assert.deepStrictEqual(atosU.exch, []); assert.ok(!atosU.us);
  no('Atmos Energy (NYSE: ATO) raises dividend', atosU); no('Why $ATO is up', atosU); no('ATO stock hits record', atosU); yes('Atos SE wins contract', atosU);
  no('ATO stock hits record', atos); yes('Shares of Atos (EPA:ATO) rise', atos);
  assert.equal(googleQuery(atosU, false), '"Atos SE" when:7d');
  assert.ok(matcher({ name: 'Grab', sym: null, ticker: 'GRAB_US_EQ' }).us);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212n-'));
  let settings = {};
  const news = new News({ lib, dir, now: () => now, settings: () => settings });
  const pos = [{ ticker: 'ATOp_EQ', sym: 'ATO', name: 'Atos SE' }, { ticker: 'VWRPl_EQ', sym: 'VWRP', name: 'Vanguard FTSE All-World (Acc)' }];
  const fresh1 = await news.refresh(pos);
  assert.ok(fresh1.length <= 3, 'first run: only a few of the newest are announced');
  let l = news.list();
  assert.deepEqual(l.items.map(x => x.title), ['Atos SE posts Q3 revenue', 'Akcie Atos SE rostou', 'Atos SE shares jump & rally', 'Atos: Simply Wall St looks at the balance sheet'],
    'untagged / wrongly tagged Yahoo items and loose Google headlines (Atossa, plain "Atos") rejected');
  assert.ok(calls.some(u => u.includes('rss/search') && decodeURIComponent(u).includes('"Atos SE" OR "EPA:ATO"')), 'strict Google query');
  const a1 = l.items[0];
  assert.equal(a1.src, 'yahoo', 'the same story from Google keeps the direct Yahoo link');
  assert.deepEqual(a1.tickers, ['ATOp_EQ', 'VWRPl_EQ'], 'one article, both instruments');
  assert.ok(!calls.some(u => u.includes('rss/search') && u.includes('Vanguard')), 'no Google search for ETFs');
  assert.equal(news.link(a1.id), 'https://example.com/a1');
  // teaser + picture
  const m = await news.meta(a1.id);
  assert.equal(m.summary, 'Revenue rose 4 % & margins improved in the third quarter.');
  assert.ok(m.image.startsWith('data:image/jpeg;base64,'));
  assert.ok(calls.includes('https://img.example.com/a1.jpg'), 'Yahoo thumbnail preferred over og:image');
  const n1 = calls.length; await news.meta(a1.id); assert.equal(calls.length, n1, 'cached');
  // sources
  const src = news.sources();
  assert.ok(src.sources.find(x => x.key === 'reuters' && x.count === 1 && x.on));
  assert.ok(src.sources.find(x => x.key === 'gurufocus' && x.count === 0), 'well-known sources listed even without articles');
  settings = { newsSources: { simplywallst: false } };
  assert.ok(!news.list().items.some(x => x.pub === 'simplywallst'), 'switched-off source hidden');
  assert.equal(news.list({ source: 'bloomberg' }).items.length, 1);
  // second run: throttled, then nothing new
  assert.deepEqual(await news.refresh(pos), []);
  assert.deepEqual(await news.refresh(pos, true), []);
  yahoo.push({ uuid: 'a5', title: 'Atos signs a new contract', publisher: 'Business Wire', link: 'https://example.com/a5', providerPublishTime: now / 1000 - 600, relatedTickers: ['ATO.PA'] });
  const fresh2 = await news.refresh(pos, true);
  assert.deepEqual(fresh2.map(x => x.title), ['Atos signs a new contract']);
  news.save();
  assert.equal(new News({ lib, dir, now: () => now, settings: () => settings }).list().total, 4, 'persisted (one source off)');

  // articles stored under the old rules disappear on load (with their notifications)
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 't212n-'));
  const old = [
    { id: 'yold', src: 'yahoo', tickers: ['ATOp_EQ'], title: 'Atossa Therapeutics rallies', pub: 'zacks', publisher: 'Zacks', url: 'https://example.com/o1', time: now - 3600e3 },
    { id: 'gold', src: 'google', tickers: ['GRAB_US_EQ'], title: 'Grab a share of these dividend stocks', pub: 'fool', publisher: 'Fool', url: 'https://example.com/o2', time: now - 3600e3 },
    { id: 'ybad', v: 2, src: 'yahoo', tickers: ['ATOp_EQ'], syms: ['ATO.PA'], tags: ['ATOS'], title: 'Atossa again', pub: 'zacks', publisher: 'Zacks', url: 'https://example.com/o3', time: now - 3600e3 },
    { id: 'yok', v: 2, src: 'yahoo', tickers: ['ATOp_EQ'], syms: ['ATO.PA'], tags: ['ATO.PA'], title: 'Atos SE results', pub: 'reuters', publisher: 'Reuters', url: 'https://example.com/o4', time: now - 3600e3 }
  ];
  fs.writeFileSync(path.join(dir2, 'news.json'), JSON.stringify({ items: old, lastRun: now, init: true }));
  const nOld = new Notifier({ lib, dir: dir2, now: () => now });
  nOld.addNews(old, pos);
  assert.equal(nOld.list({ kind: 'news' }).items.length, 4);
  const news2 = new News({ lib, dir: dir2, now: () => now, settings: () => ({}) });
  assert.deepEqual(news2.list().items.map(x => x.id), ['yok']);
  assert.ok(news2.has('yok') && !news2.has('yold') && !news2.has('gold') && !news2.has('ybad'));
  assert.equal(nOld.pruneNews(id => news2.has(id)), 3);
  assert.deepEqual(nOld.list({ kind: 'news' }).items.map(x => x.newsId), ['yok']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir2, 'news.json'), 'utf8')).items.length, 1, 'cleaned file saved');

  // Grab: the "grab a share of" headline never becomes news or a notification
  const gcalls = [];
  const glib = { resolveSymbol: async () => 'GRAB', instrumentIndex: () => ({ GRAB_US_EQ: { name: 'Grab Holdings Ltd', type: 'STOCK' } }),
    fetch: async u => {
      gcalls.push(u);
      if (u.includes('finance/search')) return new Response(JSON.stringify({ news: [
        { uuid: 'g1', title: 'Grab a share of these 3 growth stocks', publisher: 'Motley Fool', link: 'https://example.com/g1', providerPublishTime: now / 1000 - 600, relatedTickers: ['AAPL', 'MSFT'] },
        { uuid: 'g2', title: 'Grab a share of the rally', publisher: 'Motley Fool', link: 'https://example.com/g2', providerPublishTime: now / 1000 - 600 },
        { uuid: 'g3', title: 'Grab beats on revenue', publisher: 'Reuters', link: 'https://example.com/g3', providerPublishTime: now / 1000 - 700, relatedTickers: ['GRAB'] }
      ] }), { headers: { 'content-type': 'application/json' } });
      if (u.includes('news.google.com/rss/search')) return new Response(`<rss><channel>
<item><title>Investors grab a share of the AI boom - CNBC</title><link>https://news.google.com/rss/articles/k1</link><pubDate>${new Date(now - 900e3).toUTCString()}</pubDate><source>CNBC</source></item>
<item><title>Grab Holdings (NASDAQ: GRAB) reports Q3 - Business Wire</title><link>https://news.google.com/rss/articles/k2</link><pubDate>${new Date(now - 800e3).toUTCString()}</pubDate><source>Business Wire</source></item>
</channel></rss>`, { headers: { 'content-type': 'application/xml' } });
      return new Response('', { status: 404 });
    } };
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 't212n-'));
  fs.writeFileSync(path.join(dir3, 'news.json'), JSON.stringify({ items: [], init: true }));
  const gnews = new News({ lib: glib, dir: dir3, now: () => now, settings: () => ({ newsFeeds: { googleCz: false } }) });
  const gpos = [{ ticker: 'GRAB_US_EQ', sym: 'GRAB', name: 'Grab Holdings Ltd' }];
  const gfresh = await gnews.refresh(gpos, true);
  assert.deepEqual(gfresh.map(x => x.title).sort(), ['Grab Holdings (NASDAQ: GRAB) reports Q3', 'Grab beats on revenue']);
  assert.deepEqual(gnews.find(gfresh.find(x => x.src === 'yahoo').id).tags, ['GRAB']);
  const gn = new Notifier({ lib: glib, dir: dir3, now: () => now });
  assert.equal(gn.addNews(gfresh, gpos), 2);
  assert.ok(!gn.list().items.some(x => /grab a share/i.test(x.title)), 'no "grab a share of" notification');

  // notifications
  const n = new Notifier({ lib, dir, now: () => now });
  const out = [];
  n.on('fresh', items => out.push(...items));
  assert.equal(n.addNews(fresh2, pos), 1);
  assert.equal(n.addNews(fresh2, pos), 0, 'once');
  assert.equal(out[0].type, 'news'); assert.equal(out[0].newsId, fresh2[0].id); assert.equal(out[0].sym, 'ATO');
  // alerts
  n.setAlert('ATOp_EQ', 3, { sym: 'ATO', name: 'Atos' });
  assert.equal(await n.checkAlerts(pos), 0);
  pct = -3.4; assert.equal(await n.checkAlerts(pos), 1);
  assert.equal(out[out.length - 1].type, 'alert');
  assert.equal(await n.checkAlerts(pos), 0, 'once a day per direction');
  pct = 3.1; assert.equal(await n.checkAlerts(pos), 1, 'other direction fires');
  // events
  assert.equal(n.checkEvents([{ ticker: 'ATOp_EQ', sym: 'ATO', type: 'earnings', time: now + 3600e3 }, { ticker: 'X', type: 'earnings', time: now + 5 * 86400e3 }]), 1);
  assert.equal(n.checkEvents([{ ticker: 'ATOp_EQ', sym: 'ATO', type: 'earnings', time: now + 3600e3 }]), 0);
  assert.equal(n.unread(), 4);
  n.markRead('all'); assert.equal(n.unread(), 0);
  n.setAlert('ATOp_EQ', 0); assert.deepEqual(n.list().alerts, {});
  n.save();
  const n2 = new Notifier({ lib, dir, now: () => now });
  assert.equal(n2.list().items.length, 4);
  console.log('NOTIFY + NEWS TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
