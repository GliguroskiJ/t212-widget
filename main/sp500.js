'use strict';
// S&P 500 heatmap data — now one of the index heatmaps in ./indices (kept for the existing callers/tests).
const I = require('./indices');

class SP500 extends I.IndexMap {
  constructor(o = {}) { super({ ...o, index: 'sp500' }); }
}

module.exports = { SP500, parseWikitext: t => I.parseWikitext(t, 'sp500'), parseHtml: h => I.parseHtml(h, 'sp500'), parseQuotes: I.parseQuotes,
  yahooSymbol: I.yahooSymbol, cleanWiki: I.cleanWiki, t212Map: I.t212Map };
