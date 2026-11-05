// Squarified treemap + nested heatmap layout (src/treemap.js, an ES module shared with the renderer).
const assert = require('assert'); const fs = require('fs'); const path = require('path');

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/treemap.js'), 'utf8');
  const { squarify, layoutHeatmap, heatColor, tileText, HEAT_STEPS } = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(src));
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // ── squarify ──
  assert.deepStrictEqual(squarify([], { x: 0, y: 0, w: 10, h: 10 }), []);
  assert.deepStrictEqual(squarify([5], { x: 2, y: 3, w: 10, h: 4 }), [{ x: 2, y: 3, w: 10, h: 4 }], 'one value fills the rect');
  const z = squarify([0, -1, NaN], { x: 0, y: 0, w: 10, h: 10 });
  assert.ok(z.every(r => r.w === 0 && r.h === 0));
  assert.ok(squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 }).every(r => r.w === 0));

  // the classic example from the paper: 6 6 4 3 2 2 1 in 6 × 4
  const ex = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 6, h: 4 });
  ex.forEach((r, i) => assert.ok(near(r.w * r.h, [6, 6, 4, 3, 2, 2, 1][i]), 'area ∝ value'));
  assert.ok(near(ex[0].w, 3) && near(ex[0].h, 2) && near(ex[1].y, 2), 'first two share the left column');

  // random data: areas proportional, inside the rect, no overlaps, good aspect ratios, input order kept
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const vals = Array.from({ length: 300 }, () => Math.pow(rnd(), 3) * 1000 + 1);
  const R = { x: 10, y: 20, w: 1200, h: 700 };
  const rs = squarify(vals, R);
  const tot = vals.reduce((a, b) => a + b, 0);
  let area = 0, worst = 0, aspects = 0;
  rs.forEach((r, i) => {
    area += r.w * r.h;
    assert.ok(near(r.w * r.h, vals[i] / tot * R.w * R.h, 1e-6), 'area of #' + i);
    assert.ok(r.x >= R.x - 1e-6 && r.y >= R.y - 1e-6 && r.x + r.w <= R.x + R.w + 1e-6 && r.y + r.h <= R.y + R.h + 1e-6, 'inside');
    const a = Math.max(r.w / r.h, r.h / r.w); aspects += a; worst = Math.max(worst, a);
  });
  assert.ok(near(area, R.w * R.h), 'fills the rect');
  assert.ok(aspects / rs.length < 2.2, 'squarish on average (' + (aspects / rs.length).toFixed(2) + ')');
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    const ov = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    assert.ok(ov < 1e-6, 'no overlap ' + i + '/' + j);
  }

  // ── nested layout ──
  const sectors = [];
  let n = 0;
  for (let s = 0; s < 11; s++) {
    const inds = [];
    for (let k = 0; k < 2 + (s % 5); k++) {
      const kids = [];
      for (let m = 0; m < 3 + ((s + k) % 9); m++) kids.push({ key: 'S' + n++, value: Math.pow(rnd(), 2.5) * 3e12 + 5e9 });
      inds.push({ key: s + '/' + k, name: 'Ind ' + k, children: kids });
    }
    sectors.push({ key: 'sec' + s, name: 'Sector ' + s, children: inds });
  }
  sectors.push({ key: 'empty', name: 'Empty', children: [{ key: 'e', name: 'e', children: [{ key: 'nocap', value: null }] }] });
  const W = 1500, H = 800;
  const L = layoutHeatmap(sectors, W, H);
  assert.strictEqual(L.sectors.length, 11, 'empty sector left out');
  assert.ok(L.tiles.length <= n && L.tiles.length >= n * 0.97, 'every stock with a value gets a tile (bar sub-pixel ones)');
  assert.ok(layoutHeatmap(sectors, 4000, 3000).tiles.length >= n - 1);
  for (const t of [...L.sectors, ...L.industries, ...L.tiles]) {
    assert.ok(Number.isInteger(t.x) && Number.isInteger(t.y) && Number.isInteger(t.w) && Number.isInteger(t.h), 'integer px (crisp)');
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H, 'inside the map');
  }
  // the map reaches the right and bottom edges (outer gutter falls outside)
  assert.strictEqual(Math.max(...L.sectors.map(s => s.x + s.w)), W);
  assert.strictEqual(Math.max(...L.sectors.map(s => s.y + s.h)), H);
  // tiles never overlap and keep ≥1 px gaps; each tile sits inside its industry, below the label
  const ind = Object.fromEntries(L.industries.map(i => [i.key, i]));
  for (let i = 0; i < L.tiles.length; i++) {
    const a = L.tiles[i], I = ind[a.industry];
    assert.ok(a.x >= I.x && a.y >= I.y + I.head && a.x + a.w <= I.x + I.w && a.y + a.h <= I.y + I.h, 'tile inside its industry');
    for (let j = i + 1; j < L.tiles.length; j++) assert.ok(!overlap(a, L.tiles[j]), 'tiles overlap');
  }
  for (let i = 0; i < L.sectors.length; i++) for (let j = i + 1; j < L.sectors.length; j++) assert.ok(!overlap(L.sectors[i], L.sectors[j]));
  // sector areas follow the value (within rounding / header losses)
  const sv = sectors.slice(0, 11).map(s => s.children.reduce((a, c) => a + c.children.reduce((x, k) => x + k.value, 0), 0));
  const st = sv.reduce((a, b) => a + b, 0);
  L.sectors.forEach((s, i) => { const want = sv[sectors.findIndex(x => x.key === s.key)] / st * W * H; assert.ok(Math.abs(s.w * s.h - want) / want < 0.12 || want < 8000, 'sector area ' + s.key); });
  assert.ok(L.sectors.some(s => s.head > 0) && L.industries.some(i => i.head > 0), 'big blocks get title bars');
  assert.deepStrictEqual(layoutHeatmap([], 100, 100), { sectors: [], industries: [], tiles: [] });
  assert.strictEqual(layoutHeatmap(sectors, 0, 500).tiles.length, 0);
  // one-level indices (Dow, DAX, EURO STOXX): no industry bars, tiles fill the sector
  const L1 = layoutHeatmap(sectors, W, H, { industryHead: 0 });
  assert.ok(L1.industries.every(i => i.head === 0) && L1.sectors.some(s => s.head > 0));

  // ── colours ──
  assert.strictEqual(heatColor(-3), '#f63538'); assert.strictEqual(heatColor(-9), '#f63538');
  assert.strictEqual(heatColor(0), '#414554'); assert.strictEqual(heatColor(3), '#30cc5a'); assert.strictEqual(heatColor(12), '#30cc5a');
  assert.strictEqual(heatColor(1), '#35764e');
  assert.notStrictEqual(heatColor(0.5), heatColor(0)); assert.notStrictEqual(heatColor(0.5), heatColor(1));
  assert.strictEqual(heatColor(null), heatColor(NaN));
  assert.deepStrictEqual(HEAT_STEPS, [-3, -2, -1, 0, 1, 2, 3]);

  // ── labels ──
  assert.strictEqual(tileText(10, 10, 4).ticker, false, 'tiny tile: no text');
  const s = tileText(60, 20, 4); assert.ok(s.ticker && !s.pct, 'small tile: ticker only');
  const b = tileText(300, 200, 4); assert.ok(b.ticker && b.pct && b.fs > 30, 'big tile: big ticker + %');
  assert.ok(tileText(120, 80, 4).fs < b.fs, 'scales with the tile');
  assert.ok(tileText(120, 200, 'GOOGL').fs < tileText(120, 200, 'AB').fs, 'long tickers get a smaller font so they fit');
  assert.ok(tileText(200, 200, 'GOOGL').fs * 0.76 * 5 <= 200, 'wide ticker fits the tile');
  console.log('treemap ok');
})().catch(e => { console.error(e); process.exit(1); });
