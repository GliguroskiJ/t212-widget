// Sidebar order + hidden tabs (src/navorder.js).
const assert = require('assert');
const { mergeOrder, navItems, visibleNav, moveKey, toggleHidden } = require('../src/navorder');
const { DEFAULTS } = require('../main/store');

const mk = keys => keys.map(k => [k, k.toUpperCase(), 'ph-' + k]);
const OLD = mk(['overview', 'holdings', 'watchlist', 'news', 'activity', 'orders', 'pies', 'calendar', 'notifications', 'reports', 'tax']);
const NEW = mk(['overview', 'holdings', 'watchlist', 'news', 'heatmap', 'activity', 'orders', 'pies', 'calendar', 'notifications', 'reports', 'tax']);
const keys = l => l.map(x => x[0]);

// 1) defaults: empty / missing / garbage saved order → the current order
assert.deepEqual(DEFAULTS.navOrder, []); assert.deepEqual(DEFAULTS.navHidden, []);
assert.deepEqual(mergeOrder(OLD, []), keys(OLD));
assert.deepEqual(mergeOrder(OLD, undefined), keys(OLD));
assert.deepEqual(mergeOrder(OLD, ['nope', 'gone']), keys(OLD));
assert.deepEqual(keys(visibleNav(NEW, [], [])), keys(NEW));

// 2) unknown / removed keys and duplicates are dropped, missing known keys come back
assert.deepEqual(mergeOrder(OLD, ['tax', 'oldtab', 'overview', 'tax', 'holdings']),
  ['tax', 'overview', 'holdings', 'watchlist', 'news', 'activity', 'orders', 'pies', 'calendar', 'notifications', 'reports']);

// 3) a tab added later lands next to its default neighbour, not at the end
const saved = ['news', 'overview', 'tax', 'holdings', 'watchlist', 'activity', 'orders', 'pies', 'calendar', 'notifications', 'reports'];
const m = mergeOrder(NEW, saved);
assert.equal(m.length, NEW.length);
assert.equal(m[m.indexOf('news') + 1], 'heatmap');
assert.deepEqual(m.slice(0, 3), ['news', 'heatmap', 'overview']);
// new first tab with nothing before it → before its successor
const FIRST = mk(['home', 'overview', 'holdings']);
assert.deepEqual(mergeOrder(FIRST, ['holdings', 'overview']), ['holdings', 'home', 'overview']);
// two new consecutive tabs keep their default order
const TWO = mk(['overview', 'news', 'a', 'b', 'tax']);
assert.deepEqual(mergeOrder(TWO, ['tax', 'news', 'overview']), ['tax', 'news', 'a', 'b', 'overview']);

// 4) hidden: filtered from the sidebar, kept in the editor; overview can never be hidden
assert.deepEqual(keys(visibleNav(NEW, [], ['tax', 'pies', 'overview', 'ghost'])).includes('tax'), false);
assert.ok(keys(visibleNav(NEW, [], ['overview'])).includes('overview'));
const all = mk(['overview', 'x', 'y']);
assert.deepEqual(keys(visibleNav(all, [], ['overview', 'x', 'y'])), ['overview']);
const items = navItems(NEW, saved, ['pies']);
assert.equal(items.length, NEW.length);
assert.equal(items.find(i => i.key === 'pies').hidden, true);
assert.equal(items.find(i => i.key === 'overview').locked, true);
assert.equal(items[1].label, 'HEATMAP');
assert.deepEqual(toggleHidden([], 'overview', true), []);
assert.deepEqual(toggleHidden(['tax'], 'pies', true), ['tax', 'pies']);
assert.deepEqual(toggleHidden(['tax', 'pies'], 'tax', false), ['pies']);

// 5) moving: index in the full order; back to the default order saves []
let o = moveKey(OLD, [], 'tax', 0);
assert.deepEqual(o.slice(0, 2), ['tax', 'overview']);
o = moveKey(OLD, o, 'tax', 99);
assert.deepEqual(o, []);
assert.deepEqual(moveKey(OLD, [], 'holdings', 2).slice(0, 3), ['overview', 'watchlist', 'holdings']);
assert.deepEqual(moveKey(OLD, [], 'ghost', 0), []);

console.log('navorder ok');
