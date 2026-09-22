// Shared tokens, theme switching and chart helpers (direction 1a · Glass slate)
export const UP = '#74c69a';
export const DOWN = '#e0777d';
export const RAMP = ['#b5abfc', '#968ae0', '#796cbf', '#5d5294', '#423a6a', '#4b4f5e'];

export const THEMES = {
  acrylic: {
    label: 'Acrylic', swatch: 'linear-gradient(158deg,#2d3044,#181a28)',
    wg: 'linear-gradient(158deg,rgba(45,48,68,.94),rgba(24,26,40,.96))',
    edge: '0 0 0 1px #3f424d,0 10px 30px rgba(0,0,0,.55)', blur: 'blur(18px)',
    hair: 'linear-gradient(to right,transparent,rgba(145,132,217,.5),transparent)',
    wall: 'radial-gradient(120% 100% at 18% 0%,#282b48 0%,#191c2e 55%,#12141f 100%)'
  },
  slate: {
    label: 'Flat slate', swatch: '#232532',
    wg: '#232532', edge: '0 0 0 1px #3f424d,0 8px 22px rgba(0,0,0,.45)', blur: 'none',
    hair: 'linear-gradient(to right,transparent,rgba(233,233,237,.18),transparent)',
    wall: 'radial-gradient(120% 100% at 18% 0%,#22243a 0%,#17192a 60%,#101220 100%)'
  },
  indigo: {
    label: 'Indigo', swatch: 'linear-gradient(158deg,#353b80,#262a60)',
    wg: 'linear-gradient(158deg,rgba(53,59,128,.9),rgba(38,42,96,.96))',
    edge: '0 0 0 1px #4c5397,0 10px 30px rgba(0,0,0,.5)', blur: 'blur(18px)',
    hair: 'linear-gradient(to right,transparent,rgba(213,209,253,.55),transparent)',
    wall: 'radial-gradient(120% 100% at 18% 0%,#2f3468 0%,#1c1f3c 60%,#12141f 100%)'
  },
  clear: {
    label: 'Clear glass', swatch: 'linear-gradient(158deg,rgba(233,233,237,.16),rgba(233,233,237,.04))',
    wg: 'linear-gradient(158deg,rgba(233,233,237,.10),rgba(233,233,237,.03))',
    edge: '0 0 0 1px rgba(233,233,237,.16),0 12px 34px rgba(0,0,0,.4)', blur: 'blur(26px)',
    hair: 'linear-gradient(to right,transparent,rgba(233,233,237,.3),transparent)',
    wall: 'radial-gradient(120% 100% at 18% 0%,#3a3f63 0%,#1e2136 55%,#12141f 100%)'
  },
  ink: {
    label: 'Ink', swatch: '#161826',
    wg: 'linear-gradient(158deg,#1b1d2c,#141622)',
    edge: '0 0 0 1px #292b31,0 6px 18px rgba(0,0,0,.6)', blur: 'none',
    hair: 'linear-gradient(to right,transparent,rgba(145,132,217,.32),transparent)',
    wall: 'radial-gradient(120% 100% at 18% 0%,#1d1f31 0%,#141622 60%,#0d0f1a 100%)'
  }
};

export function applyTheme(key) {
  const t = THEMES[key] || THEMES.acrylic;
  const s = document.body.style;
  s.setProperty('--wg-bg', t.wg);
  s.setProperty('--wg-edge', t.edge);
  s.setProperty('--wg-blur', t.blur);
  s.setProperty('--wg-hair', t.hair);
  s.setProperty('--wall-bg', t.wall);
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
