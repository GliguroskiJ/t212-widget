// Squarified treemap (Bruls, Huizing, van Wijk 2000) + the nested sector → industry → stock layout
// of the S&P 500 heatmap. Pure functions, no DOM: unit-tested in scripts/test-treemap.js.

// rects for `values` inside rect {x, y, w, h}, in the same order as `values` (laid out largest first).
// Values ≤ 0 (or not numbers) get an empty rect.
export function squarify(values, rect) {
  const n = values.length;
  const out = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const idx = [];
  let total = 0;
  for (let i = 0; i < n; i++) { const v = Number(values[i]); if (v > 0 && isFinite(v)) { idx.push(i); total += v; } }
  let { x, y, w, h } = rect;
  if (!idx.length || !(w > 0) || !(h > 0)) return out;
  idx.sort((a, b) => values[b] - values[a] || a - b);
  const scale = (w * h) / total;
  const area = idx.map(i => values[i] * scale);
  // worst aspect ratio of a row with sum s, largest max, smallest min, laid along a side of length `side`
  const worst = (s, max, min, side) => { const s2 = s * s, l2 = side * side; return Math.max((l2 * max) / s2, s2 / (l2 * min)); };
  let i = 0;
  while (i < idx.length) {
    const side = Math.min(w, h);
    let j = i + 1, s = area[i];
    while (j < idx.length) {
      const ns = s + area[j];
      if (worst(ns, area[i], area[j], side) <= worst(s, area[i], area[j - 1], side)) { s = ns; j++; } else break;
    }
    const last = j >= idx.length;
    if (w >= h) {
      // a column on the left
      const cw = last ? w : s / h;
      let yy = y;
      for (let k = i; k < j; k++) {
        const ch = k === j - 1 ? y + h - yy : area[k] / cw;
        out[idx[k]] = { x, y: yy, w: cw, h: ch };
        yy += ch;
      }
      x += cw; w -= cw;
    } else {
      // a row along the top
      const rh = last ? h : s / w;
      let xx = x;
      for (let k = i; k < j; k++) {
        const rw = k === j - 1 ? x + w - xx : area[k] / rh;
        out[idx[k]] = { x: xx, y, w: rw, h: rh };
        xx += rw;
      }
      y += rh; h -= rh;
    }
    i = j;
  }
  return out;
}

// integer edges (neighbours share them exactly) minus a gutter on the right / bottom → crisp gaps
const snap = (r, g) => {
  const x0 = Math.round(r.x), y0 = Math.round(r.y), x1 = Math.round(r.x + r.w), y1 = Math.round(r.y + r.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0 - g), h: Math.max(0, y1 - y0 - g) };
};

const DEF = { sectorHead: 18, industryHead: 14, sectorGap: 4, industryGap: 2, tileGap: 1 };

// sectors: [{ key, name, children: [{ key, name, children: [{ key, value, …item }] }] }]
// → { sectors: [{ key, name, x, y, w, h, head }], industries: [{ key, name, sector, x, y, w, h, head }], tiles: [{ key, item, sector, industry, x, y, w, h }] }
// `head` = height of the title bar drawn on top (0 when the block is too small for one).
export function layoutHeatmap(sectors, W, H, opt = {}) {
  const o = { ...DEF, ...opt };
  const res = { sectors: [], industries: [], tiles: [] };
  if (!(W > 0) || !(H > 0) || !sectors || !sectors.length) return res;
  const sum = n => (n.children ? n.children.reduce((a, c) => a + sum(c), 0) : (Number(n.value) > 0 ? Number(n.value) : 0));
  const secs = sectors.map(s => ({ s, v: sum(s) })).filter(x => x.v > 0);
  // the outermost gutter falls outside the box, so the map touches all four edges
  const sr = squarify(secs.map(x => x.v), { x: 0, y: 0, w: W + o.sectorGap, h: H + o.sectorGap });
  secs.forEach(({ s }, si) => {
    const S = snap(sr[si], o.sectorGap);
    if (S.w <= 0 || S.h <= 0) return;
    const head = S.h >= o.sectorHead * 3 && S.w >= 64 ? o.sectorHead : 0;
    res.sectors.push({ key: s.key, name: s.name, ...S, head });
    const C = { x: S.x, y: S.y + head, w: S.w, h: S.h - head };
    const inds = (s.children || []).map(c => ({ c, v: sum(c) })).filter(x => x.v > 0);
    const ir = squarify(inds.map(x => x.v), { x: C.x, y: C.y, w: C.w + o.industryGap, h: C.h + o.industryGap });
    inds.forEach(({ c }, ii) => {
      const I = snap(ir[ii], o.industryGap);
      if (I.w <= 0 || I.h <= 0) return;
      const ih = I.h >= o.industryHead * 2.6 && I.w >= 48 ? o.industryHead : 0;
      res.industries.push({ key: c.key, name: c.name, sector: s.key, ...I, head: ih });
      const T = { x: I.x, y: I.y + ih, w: I.w, h: I.h - ih };
      const kids = (c.children || []).filter(k => Number(k.value) > 0);
      const tr = squarify(kids.map(k => Number(k.value)), { x: T.x, y: T.y, w: T.w + o.tileGap, h: T.h + o.tileGap });
      kids.forEach((k, ti) => {
        const R = snap(tr[ti], o.tileGap);
        if (R.w <= 0 || R.h <= 0) return;
        res.tiles.push({ key: k.key, item: k, sector: s.key, industry: c.key, ...R });
      });
    });
  });
  return res;
}

// finviz colour scale: deep red ≤ −3 %, grey around 0, deep green ≥ +3 %, smooth in between
const STOPS = [[-3, [246, 53, 56]], [-2, [191, 64, 69]], [-1, [139, 68, 78]], [0, [65, 69, 84]], [1, [53, 118, 78]], [2, [47, 158, 79]], [3, [48, 204, 90]]];
export const HEAT_STEPS = STOPS.map(s => s[0]);
export function heatColor(pct) {
  if (pct == null || !isFinite(pct)) return '#3a3d48';
  const p = Math.max(-3, Math.min(3, pct));
  let k = 0;
  while (k < STOPS.length - 2 && p > STOPS[k + 1][0]) k++;
  const [a, ca] = STOPS[k], [b, cb] = STOPS[k + 1];
  const f = (p - a) / (b - a);
  return '#' + ca.map((c, i) => Math.round(c + (cb[i] - c) * f).toString(16).padStart(2, '0')).join('');
}

// rough advance width of a ticker in em (Inter semibold capitals)
const emWidth = s => { let w = 0; for (const c of String(s)) w += /[.\-:]/.test(c) ? 0.32 : c === 'I' ? 0.3 : /[MW]/.test(c) ? 0.92 : /[GOQCDHNUV]/.test(c) ? 0.76 : /[0-9]/.test(c) ? 0.62 : 0.67; return w; };

// label sizes for a w × h tile showing `sym` (or a ticker length): ticker font size scales with the tile,
// tiny tiles show nothing, small ones only the ticker
export function tileText(w, h, sym) {
  const em = typeof sym === 'string' ? Math.max(1.3, emWidth(sym)) : Math.max(2, sym || 4) * 0.7;
  const fs = Math.max(0, Math.min(44, (w - 8) / em, h * 0.42));
  if (fs < 8 || w < 20 || h < 12) return { fs: 0, fs2: 0, ticker: false, pct: false };
  const fs2 = Math.max(8, Math.min(18, fs * 0.46));
  const pct = h >= fs * 1.15 + fs2 * 1.3 + 4 && w >= fs2 * 4.2 + 6;
  return { fs: Math.round(fs * 10) / 10, fs2: Math.round(fs2 * 10) / 10, ticker: true, pct };
}
