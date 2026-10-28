// News (feeds, sources, dedupe, teaser + picture), notifications (news, price-move alerts, calendar events).
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
const { Notifier } = require('../main/notify');
const { News, pubKey, parseRss, cleanName } = require('../main/news');
const now = Date.UTC(2026, 9, 21, 12);
let pct = 1.5;
const yahoo = [
  { uuid: 'a1', title: 'Atos posts Q3 revenue', publisher: 'Reuters', link: 'https://example.com/a1', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATO.PA'],
    thumbnail: { resolutions: [{ url: 'https://img.example.com/a1.jpg', width: 640, height: 360 }, { url: 'https://img.example.com/s.jpg', width: 140, height: 140 }] } },
  { uuid: 'a2', title: 'Unrelated market wrap', publisher: 'Zacks', link: 'https://example.com/a2', providerPublishTime: now / 1000 - 3600, relatedTickers: ['SPY'] },
  { uuid: 'a3', title: 'Atos: Simply Wall St looks at the balance sheet', publisher: 'Simply Wall St.', link: 'https://example.com/a3', providerPublishTime: now / 1000 - 2 * 86400, relatedTickers: ['ATO.PA'] },
  { uuid: 'a4', title: 'Bad link', publisher: 'GlobeNewswire', link: 'javascript:alert(1)', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATO.PA'] }
];
const rss = `<rss><channel>
<item><title>Atos posts Q3 revenue - Reuters</title><link>https://news.google.com/rss/articles/x1</link><pubDate>${new Date(now - 3600e3).toUTCString()}</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Atos shares jump &amp; rally - Bloomberg</title><link>https://news.google.com/rss/articles/x2</link><pubDate>${new Date(now - 7200e3).toUTCString()}</pubDate><source url="https://www.bloomberg.com">Bloomberg</source></item>
</channel></rss>`;
const rssCz = `<rss><channel><item><title>Akcie Atosu rostou - Patria.cz</title><link>https://news.google.com/rss/articles/c1</link><pubDate>${new Date(now - 5000e3).toUTCString()}</pubDate><source url="https://www.patria.cz">Patria.cz</source></item></channel></rss>`;
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
  assert.equal(parseRss(rss)[1].title, 'Atos shares jump & rally');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212n-'));
  let settings = {};
  const news = new News({ lib, dir, now: () => now, settings: () => settings });
  const pos = [{ ticker: 'ATOp_EQ', sym: 'ATO', name: 'Atos SE' }, { ticker: 'VWRPl_EQ', sym: 'VWRP', name: 'Vanguard FTSE All-World (Acc)' }];
  const fresh1 = await news.refresh(pos);
  assert.ok(fresh1.length <= 3, 'first run: only a few of the newest are announced');
  let l = news.list();
  assert.deepEqual(l.items.map(x => x.title), ['Atos posts Q3 revenue', 'Akcie Atosu rostou', 'Atos shares jump & rally', 'Atos: Simply Wall St looks at the balance sheet']);
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
