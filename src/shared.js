// Shared tokens, theme switching and chart helpers (direction 1a · Glass slate)
export const UP = '#74c69a';
export const DOWN = '#e0777d';
export const RAMP = ['#b5abfc', '#968ae0', '#796cbf', '#5d5294', '#423a6a', '#4b4f5e'];

// ── colour maths (OKLCH) ─────────────────────────────────────
const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const delin = c => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function rgb2oklch([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
function oklch2rgbRaw(L, C, H) {
  const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
function oklch2rgb(L, C, H) {
  let c = C;
  for (let i = 0; i < 30; i++) { // reduce chroma until in sRGB gamut
    const v = oklch2rgbRaw(L, c, H);
    if (v.every(x => x >= -0.0005 && x <= 1.0005)) return v.map(x => Math.round(Math.min(255, Math.max(0, delin(Math.min(1, Math.max(0, x)))))));
    c *= 0.9;
  }
  return oklch2rgbRaw(L, 0, H).map(x => Math.round(delin(Math.min(1, Math.max(0, x)))));
}
const rgbHex = a => '#' + a.map(x => x.toString(16).padStart(2, '0')).join('');

export const DEFAULT_ACCENT = '#9184d9';
const BASE_RAMP = ['#f5f4ff', '#e7e5fe', '#d2cefd', '#b5abfc', '#968ae0', '#796cbf', '#5d5294', '#423a6a', '#2b2741'];
const BASE_LCH = BASE_RAMP.map(h => rgb2oklch(hex2rgb(h)));
const BASE_C = rgb2oklch(hex2rgb(DEFAULT_ACCENT))[1];

// Nocturne accent ramp re-generated for any colour: same lightness steps, the colour's hue and chroma
export function accentRamp(hex) {
  if (!/^#?[0-9a-f]{3,6}$/i.test(hex || '') || hex.toLowerCase() === DEFAULT_ACCENT) return BASE_RAMP.slice();
  const [, C, H] = rgb2oklch(hex2rgb(hex));
  const k = C / BASE_C;
  return BASE_LCH.map(([L, c]) => rgbHex(oklch2rgb(L, c * k, H)));
}

export const ACCENT_PRESETS = [
  ['#9184d9', 'Nocturne'], ['#6f8fe8', 'Blue'], ['#4fb3c8', 'Cyan'], ['#5fbf8f', 'Green'],
  ['#d9b45a', 'Gold'], ['#e0895e', 'Orange'], ['#e07a9b', 'Rose'], ['#8e97aa', 'Steel']
];

// Background types. Stops are [r,g,b,a]; the chosen colour can tint them.
export const THEMES = {
  acrylic: { label: 'Acrylic', stops: [[45, 48, 68, .95], [24, 26, 40, .97]], edge: '0 0 0 1px #3f424d,0 10px 30px rgba(0,0,0,.55)', hair: .5 },
  slate: { label: 'Flat slate', stops: [[35, 37, 50, 1]], edge: '0 0 0 1px #3f424d,0 8px 22px rgba(0,0,0,.45)', hair: 0, hairWhite: .18 },
  indigo: { label: 'Indigo', stops: [[53, 59, 128, .92], [38, 42, 96, .97]], edge: '0 0 0 1px #4c5397,0 10px 30px rgba(0,0,0,.5)', hair: .55, light: true },
  clear: { label: 'Clear glass', stops: [[233, 233, 237, .12], [233, 233, 237, .075]], edge: '0 0 0 1px rgba(233,233,237,.16),0 12px 34px rgba(0,0,0,.4)', hair: 0, hairWhite: .3 },
  ink: { label: 'Ink', stops: [[27, 29, 44, 1], [20, 22, 34, 1]], edge: '0 0 0 1px #292b31,0 6px 18px rgba(0,0,0,.6)', hair: .32 }
};

function tintStop([r, g, b, a], hue, chroma, t) {
  if (!t) return [r, g, b, a];
  const [L, C] = rgb2oklch([r, g, b]);
  const [nr, ng, nb] = oklch2rgb(L, C * (1 - t) + chroma * t, hue);
  return [nr, ng, nb, a];
}
const css = ([r, g, b, a]) => a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;

export function themeCss(key, accent = DEFAULT_ACCENT, tint = 0) {
  const t = THEMES[key] || THEMES.acrylic;
  const [, C, H] = rgb2oklch(hex2rgb(/^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ACCENT));
  const tc = Math.min(0.085, Math.max(0.035, C * 0.7)) * (t.stops[0][3] < 0.5 ? 1.4 : 1);
  const stops = t.stops.map(s => css(tintStop(s, H, tc, Math.min(1, Math.max(0, tint)))));
  const bg = stops.length > 1 ? `linear-gradient(158deg,${stops[0]},${stops[1]})` : `linear-gradient(${stops[0]},${stops[0]})`;
  return { bg, edge: t.edge, hair: t.hair, hairWhite: t.hairWhite, light: t.light, swatch: bg };
}

export function applyTheme(key, accent = DEFAULT_ACCENT, tint = 0) {
  const s = document.body.style;
  const ramp = accentRamp(accent);
  const acc = /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_ACCENT;
  ramp.forEach((c, i) => s.setProperty(`--color-accent-${(i + 1) * 100}`, c));
  s.setProperty('--color-accent', acc);
  s.setProperty('--acc-rgb', hex2rgb(acc).join(','));
  const t = themeCss(key, acc, tint);
  s.setProperty('--wg-bg', t.bg);
  s.setProperty('--wg-edge', t.edge);
  const hairC = t.hair ? (t.light ? `color-mix(in srgb, ${ramp[1]} ${t.hair * 100}%, transparent)` : `rgba(${hex2rgb(acc).join(',')},${t.hair})`) : `rgba(233,233,237,${t.hairWhite})`;
  s.setProperty('--wg-hair', `linear-gradient(to right,transparent,${hairC},transparent)`);
}

export function applyMotion(m) {
  const b = document.body.classList;
  b.remove('m-full', 'm-subtle', 'm-off');
  b.add('m-' + (m || 'full'));
}

// ── number formatting ────────────────────────────────────────
const nfCache = {};
export function makeFmt(numberFormat) {
  const loc = numberFormat === 'cs' ? 'cs-CZ' : 'en-US';
  const dec = numberFormat === 'cs' ? ',' : '.';
  const f = (n, d = 0) => {
    const k = loc + d;
    if (!nfCache[k]) nfCache[k] = new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
    return nfCache[k].format(n == null || isNaN(n) ? 0 : n);
  };
  f.dec = dec;
  f.signed = (n, d = 0) => (n >= 0 ? '+' : '') + f(n, d);
  f.split = v => {
    const whole = Math.trunc(v);
    let cents = Math.round(Math.abs(v - whole) * 100);
    let w = whole;
    if (cents === 100) { cents = 0; w += v >= 0 ? 1 : -1; }
    return { int: (v < 0 && w === 0 ? '-' : '') + f(w, 0), dec: String(cents).padStart(2, '0') };
  };
  return f;
}

export function agoStr(lastSync, now) {
  if (!lastSync) return 'never';
  const s = Math.max(0, Math.round((now - lastSync) / 1000));
  if (s < 2) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm ago';
  const d = new Date(lastSync);
  return 'at ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function hhmm(ts) {
  if (!ts) return '--:--';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// ── chart geometry ───────────────────────────────────────────
export function pts(series, w, h, pad) {
  const s = series && series.length ? series : [0, 0];
  const arr = s.length === 1 ? [s[0], s[0]] : s;
  const min = Math.min(...arr), max = Math.max(...arr), r = max - min;
  return arr.map((v, i) => [
    (i / (arr.length - 1)) * w,
    r ? pad + (1 - (v - min) / r) * (h - pad * 2) : h / 2
  ]);
}
export function linePath(series, w, h, pad) {
  return pts(series, w, h, pad).map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
}
export function areaPath(series, w, h, pad) {
  return linePath(series, w, h, pad) + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
}
export function lastPt(series, w, h, pad) {
  const p = pts(series, w, h, pad);
  return p[p.length - 1];
}

export const tint = c => `color-mix(in srgb, ${c} 15%, transparent)`;
export const glow = c => `color-mix(in srgb, ${c} 40%, transparent)`;
