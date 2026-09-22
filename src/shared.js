import { t } from './i18n.js';
// Shared tokens, theme switching and chart helpers (direction 1a · Glass slate)
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

// Background types. `stops` are [r,g,b,a] (158° gradient); `layers` add effects painted on top.
// `lightBg` themes get dark text when the text colour is on Auto.
export const THEMES = {
  acrylic: { label: 'Acrylic', stops: [[45, 48, 68, .95], [24, 26, 40, .97]], edge: '0 0 0 1px #3f424d,0 10px 30px rgba(0,0,0,.55)', hair: .5 },
  slate: { label: 'Flat slate', stops: [[35, 37, 50, 1]], edge: '0 0 0 1px #3f424d,0 8px 22px rgba(0,0,0,.45)', hairWhite: .18 },
  indigo: { label: 'Indigo', stops: [[53, 59, 128, .92], [38, 42, 96, .97]], edge: '0 0 0 1px #4c5397,0 10px 30px rgba(0,0,0,.5)', hair: .55, soft: true },
  clear: { label: 'Clear glass', stops: [[233, 233, 237, .12], [233, 233, 237, .075]], edge: '0 0 0 1px rgba(233,233,237,.16),0 12px 34px rgba(0,0,0,.4)', hairWhite: .3, glass: true },
  frost: { label: 'Smoked glass', stops: [[26, 28, 42, .66], [14, 15, 24, .78]], edge: '0 0 0 1px rgba(233,233,237,.14),0 12px 34px rgba(0,0,0,.45)', hairWhite: .35, glass: true,
    layers: [{ type: 'sheen', a: .07, stop: .38 }] },
  aurora: { label: 'Aurora', stops: [[20, 21, 36, .97], [13, 14, 24, .98]], edge: '0 0 0 1px #34374a,0 12px 34px rgba(0,0,0,.55)', hair: .6,
    layers: [{ type: 'blob', cx: .12, cy: -.1, r: .85, hue: 0, a: .38 }, { type: 'blob', cx: 1.05, cy: 1.1, r: .8, hue: 110, a: .26 }, { type: 'blob', cx: .7, cy: .2, r: .5, hue: -70, a: .12 }] },
  mesh: { label: 'Mesh', stops: [[22, 23, 34, .97]], edge: '0 0 0 1px #373a4c,0 12px 34px rgba(0,0,0,.5)', hair: .5,
    layers: [{ type: 'mesh', hues: [0, 55, -55, 170], l: .3, c: .075, a: .92 }] },
  ember: { label: 'Ember', stops: [[58, 30, 36, .96], [22, 15, 26, .98]], edge: '0 0 0 1px #4a3038,0 12px 34px rgba(0,0,0,.55)', hairWhite: .22,
    layers: [{ type: 'blob', cx: 1, cy: 1.15, r: .9, rgb: [224, 120, 70], a: .28 }, { type: 'sheen', a: .04, stop: .3 }] },
  blueprint: { label: 'Blueprint', stops: [[18, 26, 52, .97], [12, 17, 36, .98]], edge: '0 0 0 1px #2a3a66,0 10px 30px rgba(0,0,0,.5)', hair: .45,
    layers: [{ type: 'grid', step: 16, a: .09 }] },
  carbon: { label: 'Carbon', stops: [[28, 29, 34, 1], [17, 18, 22, 1]], edge: '0 0 0 1px #2f3036,0 8px 24px rgba(0,0,0,.6)', hairWhite: .14,
    layers: [{ type: 'weave', a: .045 }] },
  ink: { label: 'Ink', stops: [[27, 29, 44, 1], [20, 22, 34, 1]], edge: '0 0 0 1px #292b31,0 6px 18px rgba(0,0,0,.6)', hair: .32 },
  oled: { label: 'Pure black', stops: [[0, 0, 0, 1]], edge: '0 0 0 1px #26272c', hair: .4 },
  porcelain: { label: 'Porcelain', stops: [[247, 247, 251, .97], [228, 230, 240, .97]], edge: '0 0 0 1px rgba(20,22,40,.14),0 12px 30px rgba(0,0,0,.28)', hair: .55, lightBg: true,
    layers: [{ type: 'sheen', a: .5, stop: .3 }] }
};

function tintStop([r, g, b, a], hue, chroma, t) {
  if (!t) return [r, g, b, a];
  const [L, C] = rgb2oklch([r, g, b]);
  const [nr, ng, nb] = oklch2rgb(L, C * (1 - t) + chroma * t, hue);
  return [nr, ng, nb, a];
}
const css = ([r, g, b, a]) => a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
const accHex = a => (/^#[0-9a-f]{6}$/i.test(a || '') ? a : DEFAULT_ACCENT);

export function themeCss(key, accent = DEFAULT_ACCENT, tint = 0) {
  const t = THEMES[key] || THEMES.acrylic;
  const [, C, H] = rgb2oklch(hex2rgb(accHex(accent)));
  const tc = Math.min(0.085, Math.max(0.035, C * 0.7)) * (t.stops[0][3] < 0.5 || t.lightBg ? 1.4 : 1);
  const raw = t.stops.map(s => tintStop(s, H, t.lightBg ? tc * 0.5 : tc, Math.min(1, Math.max(0, tint))));
  const stops = raw.map(css);
  const bg = stops.length > 1 ? `linear-gradient(158deg,${stops[0]},${stops[1]})` : `linear-gradient(${stops[0]},${stops[0]})`;
  return { ...t, bg, raw, hue: H, chroma: C };
}

// ── text colour ──────────────────────────────────────────────
export const TEXT_PRESETS = [
  ['auto', 'Auto'], ['#e9e9ed', 'Soft white'], ['#ffffff', 'Bright white'], ['#f2e8d8', 'Warm'],
  ['#dde9f7', 'Ice'], ['#dcf3e6', 'Mint'], ['#1c1f2e', 'Dark']
];
const BASE_NEUTRAL = ['#f3f5fe', '#e4e7f5', '#cfd3e5', '#b2b6ca', '#9397ab', '#75798c', '#595d6c', '#3f424d', '#292b31'];
const BASE_N_LCH = BASE_NEUTRAL.map(h => rgb2oklch(hex2rgb(h)));
const L_TEXT = rgb2oklch(hex2rgb('#e9e9ed'))[0], L_900 = BASE_N_LCH[8][0];

export function resolveText(textColor, themeKey) {
  if (!textColor || textColor === 'auto') return (THEMES[themeKey] || {}).lightBg ? '#1c1f2e' : '#e9e9ed';
  return /^#[0-9a-f]{6}$/i.test(textColor) ? textColor.toLowerCase() : '#e9e9ed';
}
// neutral ramp for any text colour: 100 = most prominent … 900 = closest to the background
export function textRamp(hex) {
  if (hex === '#e9e9ed') return BASE_NEUTRAL.slice();
  const [L0, C0, H0] = rgb2oklch(hex2rgb(hex));
  const dark = L0 < 0.55;
  const Lb = dark ? 0.94 : 0.26;
  return BASE_N_LCH.map(([L]) => {
    const p = (L - L_900) / (L_TEXT - L_900);
    const Li = Math.min(0.995, Math.max(0.05, Lb + (L0 - Lb) * p));
    return rgbHex(oklch2rgb(Li, C0 * Math.max(0.25, Math.min(1, p)), H0));
  });
}

// P/L colours — darker on light backgrounds so they stay readable
export let UP = '#74c69a';
export let DOWN = '#e0777d';

export function applyTheme(key, accent = DEFAULT_ACCENT, tint = 0, textColor = 'auto') {
  const s = document.body.style;
  const acc = accHex(accent);
  const t = themeCss(key, acc, tint);
  const text = resolveText(textColor, key);
  const dark = rgb2oklch(hex2rgb(text))[0] < 0.55;
  // dark text ⇒ light surface: flip the accent ramp so "light" accent steps become the dark ones
  const ramp = dark ? accentRamp(acc).reverse() : accentRamp(acc);
  ramp.forEach((c, i) => s.setProperty(`--color-accent-${(i + 1) * 100}`, c));
  s.setProperty('--color-accent', dark ? ramp[6] : acc);
  s.setProperty('--acc-rgb', hex2rgb(acc).join(','));
  textRamp(text).forEach((c, i) => s.setProperty(`--color-neutral-${(i + 1) * 100}`, c));
  s.setProperty('--color-text', text);
  s.setProperty('--ink-rgb', hex2rgb(text).join(','));
  s.setProperty('--color-divider', `rgba(${hex2rgb(text).join(',')},.16)`);
  UP = dark ? '#23875a' : '#74c69a';
  DOWN = dark ? '#c23f4b' : '#e0777d';
  s.setProperty('--wg-bg', t.bg);
  s.setProperty('--wg-edge', t.edge);
  // opaque surface for popovers + inputs that follows background type, colour and text
  const m = t.raw[0];
  let menu;
  if (t.lightBg) menu = [m[0], m[1], m[2]];
  else if (m[3] >= 0.9 && !t.layers) menu = [m[0], m[1], m[2]];
  else { const c = tintStop([34, 36, 50, 1], t.hue, 0.04, Math.min(1, tint + 0.25)); menu = [c[0], c[1], c[2]]; }
  if (dark && !t.lightBg) menu = [236, 237, 243];                // dark text on a dark theme: use a light menu
  if (!dark && t.lightBg) menu = [34, 36, 50];                   // light text on a light theme: use a dark menu
  s.setProperty('--menu-bg', `rgb(${menu.join(',')})`);
  s.setProperty('--color-surface', `rgb(${menu.join(',')})`);
  s.setProperty('--menu-edge', `rgba(${hex2rgb(text).join(',')},.16)`);
  const hairC = t.hair ? (t.soft ? `color-mix(in srgb, ${ramp[1]} ${t.hair * 100}%, transparent)` : `rgba(${hex2rgb(acc).join(',')},${t.hair})`) : `rgba(255,255,255,${t.hairWhite || .18})`;
  s.setProperty('--wg-hair', `linear-gradient(to right,transparent,${hairC},transparent)`);
}

export function applyMotion(m) {
  const b = document.body.classList;
  b.remove('m-full', 'm-subtle', 'm-off');
  b.add('m-' + (m || 'full'));
}

// Card background rendered pixel-by-pixel with triangular dithering.
// Windows composites transparent windows without gradient dithering, which showed
// up as diagonal bands; baking the gradient into an image removes them.
const bgCache = new Map();
export function ditheredBg(key, accent, tint, w, h, overlayAlpha = 0, overlayStop = 0.45) {
  const id = [key, accent, tint, w, h, overlayAlpha, overlayStop].join('|');
  if (bgCache.has(id)) return bgCache.get(id);
  const t = themeCss(key, accent, tint);
  const a0 = t.raw[0], a1 = t.raw[1] || t.raw[0];
  const acc = hex2rgb(accHex(accent));
  const [aL, aC, aH] = rgb2oklch(acc);
  const hueRgb = (off, L = 0.62, C = Math.max(0.09, aC)) => oklch2rgb(L, C, (aH + off + 360) % 360);
  const layers = (t.layers || []).map(l => {
    if (l.type === 'blob') return { ...l, col: l.rgb || hueRgb(l.hue || 0) };
    if (l.type === 'mesh') return { ...l, cols: l.hues.map(o => oklch2rgb(l.l, l.c, (aH + o + 360) % 360)) };
    return l;
  });
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const ang = 158 * Math.PI / 180, sx = Math.sin(ang), sy = -Math.cos(ang);
  const len = Math.abs(w * sx) + Math.abs(h * sy);
  const cx = w / 2, cy = h / 2, diag = Math.hypot(w, h);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const dith = () => rnd() - rnd();                     // triangular, ±1 LSB
  for (let y = 0; y < h; y++) {
    const ov = overlayAlpha ? Math.max(0, 1 - y / (h * overlayStop)) * overlayAlpha : 0;
    for (let x = 0; x < w; x++) {
      const tt = Math.min(1, Math.max(0, ((x + 0.5 - cx) * sx + (y + 0.5 - cy) * sy) / len + 0.5));
      let A = a0[3] + (a1[3] - a0[3]) * tt;
      // premultiplied colour
      let r = a0[0] * a0[3] + (a1[0] * a1[3] - a0[0] * a0[3]) * tt;
      let g = a0[1] * a0[3] + (a1[1] * a1[3] - a0[1] * a0[3]) * tt;
      let b = a0[2] * a0[3] + (a1[2] * a1[3] - a0[2] * a0[3]) * tt;
      const over = (cr, cg, cb, k) => { r = cr * k + r * (1 - k); g = cg * k + g * (1 - k); b = cb * k + b * (1 - k); A = k + A * (1 - k); };
      for (const l of layers) {
        if (l.type === 'blob') {
          const d = Math.hypot(x - l.cx * w, y - l.cy * h) / (l.r * diag);
          const k = Math.max(0, 1 - d); if (k > 0) over(l.col[0], l.col[1], l.col[2], l.a * k * k * (3 - 2 * k));
        } else if (l.type === 'mesh') {
          const u = x / w, v = y / h, c = l.cols;
          const mix = i => (c[0][i] * (1 - u) + c[1][i] * u) * (1 - v) + (c[2][i] * (1 - u) + c[3][i] * u) * v;
          over(mix(0), mix(1), mix(2), l.a);
        } else if (l.type === 'sheen') {
          const k = Math.max(0, 1 - y / (h * l.stop)); if (k > 0) over(255, 255, 255, l.a * k * k);
        } else if (l.type === 'grid') {
          const gx = x % l.step, gy = y % l.step;
          if (gx === 0 && gy === 0) over(acc[0], acc[1], acc[2], l.a * 4);
          else if (gx === 0 || gy === 0) over(acc[0], acc[1], acc[2], l.a * 0.35);
        } else if (l.type === 'weave') {
          const band = ((x + y) >> 2) & 1, cross = ((x - y + 4096) >> 2) & 1;
          const k = band ^ cross ? l.a : -l.a * 0.6;
          if (k > 0) over(255, 255, 255, k); else over(0, 0, 0, -k);
        }
      }
      if (ov) over(acc[0], acc[1], acc[2], ov);
      const i = (y * w + x) * 4;
      px[i] = Math.round(r / A + dith());
      px[i + 1] = Math.round(g / A + dith());
      px[i + 2] = Math.round(b / A + dith());
      px[i + 3] = Math.round(A * 255 + dith());
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL('image/png');
  if (bgCache.size > 40) bgCache.clear();
  bgCache.set(id, url);
  return url;
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
  if (!lastSync) return t('never');
  const s = Math.max(0, Math.round((now - lastSync) / 1000));
  if (s < 2) return t('just now');
  if (s < 60) return t('{n}s ago', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('{n}m ago', { n: m });
  const d = new Date(lastSync);
  return t('at {t}', { t: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') });
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
