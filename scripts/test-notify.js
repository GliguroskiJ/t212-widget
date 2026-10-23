// Notifications: news (deduped, tagged), price-move alerts (once a day per direction), calendar events.
const assert = require('assert'); const os = require('os'); const fs = require('fs'); const path = require('path');
const { Notifier } = require('../main/notify');
const now = Date.UTC(2026, 9, 21, 12);
let pct = 1.5;
const news = [
  { uuid: 'a1', title: 'Atos posts Q3 revenue', publisher: 'Reuters', link: 'https://example.com/a1', providerPublishTime: now / 1000 - 3600, relatedTickers: ['ATO.PA'] },
  { uuid: 'a2', title: 'Unrelated market wrap', link: 'https://example.com/a2', providerPublishTime: now / 1000 - 3600, relatedTickers: ['SPY'] },
  { uuid: 'a3', title: 'Old story', link: 'javascript:alert(1)', providerPublishTime: now / 1000 - 3 * 86400, relatedTickers: ['ATO.PA'] }
];
const lib = {
  resolveSymbol: async () => 'ATO.PA',
  dayQuote: async () => ({ last: 100 * (1 + pct / 100), prevClose: 100, currency: 'EUR' }),
  fetch: async () => new Response(JSON.stringify({ news }), { headers: { 'content-type': 'application/json' } })
};
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't212n-'));
  const n = new Notifier({ lib, dir, now: () => now });
  const fresh = [];
  n.on('fresh', items => fresh.push(...items));
  const pos = [{ ticker: 'ATOp_EQ', sym: 'ATO', name: 'Atos' }];
  assert.equal(await n.checkNews(pos), 2);
  assert.deepEqual(fresh.map(x => x.title), ['Atos posts Q3 revenue'], 'only the unread story goes to the system notification');
  let l = n.list();
  assert.deepEqual(l.items.map(x => x.title), ['Atos posts Q3 revenue', 'Old story']);
  assert.equal(l.items[0].read, false, 'fresh news unread');
  assert.equal(l.items[1].read, true, 'older news on the first run is not shouted about');
  assert.equal(n.link(l.items[0].id), 'https://example.com/a1');
  assert.equal(n.link(l.items[1].id), null, 'only https links open');
  assert.equal(await n.checkNews(pos), 0, 'throttled');
  assert.equal(await n.checkNews(pos, true), 0, 'already seen');
  // alerts
  n.setAlert('ATOp_EQ', 3, { sym: 'ATO', name: 'Atos' });
  assert.equal(await n.checkAlerts(pos), 0);
  pct = -3.4; assert.equal(await n.checkAlerts(pos), 1);
  assert.equal(fresh[fresh.length - 1].type, 'alert');
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
  assert.equal(n2.list().items.length, 5);
  console.log('NOTIFY TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
