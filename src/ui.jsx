// Shared building blocks of the widget and the app window — one design, one source.
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import {
  UP, DOWN, accentRamp, makeFmt, agoStr, hhmm, pts, linePath, areaPath, tint, glow
} from './shared.js';
import { t, locale } from './i18n.js';

const api = window.api;
export const F = "'Inter',sans-serif";

// ── hooks ────────────────────────────────────────────────────
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// digits roll toward the new value: val += (target - val) * 0.1 per frame
export function useRolling(target, motion) {
  const [val, setVal] = useState(target);
  const cur = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    if (target == null) return;
    cancelAnimationFrame(raf.current);
    if (motion === 'off' || cur.current == null) { cur.current = target; setVal(target); return; }
    const eps = Math.max(0.004, Math.abs(target) * 3e-7);
    const k = motion === 'subtle' ? 0.2 : 0.1;
    const step = () => {
      const d = target - cur.current;
      if (Math.abs(d) < eps) { cur.current = target; setVal(target); return; }
      cur.current += d * k;
      setVal(cur.current);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, motion]);
  return val;
}

// tick flash: 1100 ms of the tick direction's colour
export function useFlash(value, motion) {
  const [flash, setFlash] = useState(0);
  const prev = useRef(null);
  useEffect(() => {
    if (value == null) return;
    if (prev.current != null && value !== prev.current && motion !== 'off') {
      setFlash(value > prev.current ? 1 : -1);
      const t = setTimeout(() => setFlash(0), 1100);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return flash;
}

// ── small pieces ─────────────────────────────────────────────
// The app mark: rising bars with a trend line (same geometry as the app icon, scripts/make-icon.py)
export function Mark({ size = 18, muted, bar, line }) {
  const b = bar || (muted ? 'var(--color-neutral-600)' : 'var(--color-accent-400)');
  const l = line || (muted ? 'var(--color-neutral-400)' : UP);
  return (
    <svg viewBox="3 3 18 18" width={size} height={size} style="display:block;flex:none;overflow:visible" aria-hidden="true">
      <rect x="5" y="12.5" width="3" height="5.5" rx=".9" fill={b} opacity=".8"></rect>
      <rect x="10.5" y="9.5" width="3" height="8.5" rx=".9" fill={b} opacity=".8"></rect>
      <rect x="16" y="6.5" width="3" height="11.5" rx=".9" fill={b} opacity=".8"></rect>
      <path d="M4.6 13.4 L9.4 10.6 L13.4 11.9 L19.4 5.6" fill="none" stroke={l} stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path>
      <circle cx="19.4" cy="5.6" r="1.7" fill={muted ? 'var(--color-neutral-300)' : '#d9fff0'}></circle>
    </svg>
  );
}

export function Tile({ px = 22, muted }) {
  const r = px <= 20 ? 5 : px <= 24 ? 6 : 7;
  return (
    <div style={`width:${px}px;height:${px}px;border-radius:${r}px;flex:none;display:flex;align-items:center;justify-content:center;box-sizing:border-box;` +
      (muted ? 'border:1px solid var(--color-neutral-800);background:rgba(var(--ink-rgb),.04)'
        : 'border:1px solid var(--color-accent-700);background:linear-gradient(150deg,var(--color-accent-800),var(--color-accent-900) 70%);box-shadow:0 0 12px rgba(var(--acc-rgb),.18)')}>
      <Mark size={Math.round(px * 0.68)} muted={muted} />
    </div>
  );
}

export const Dot = ({ color }) => <span class="breathe" style={`width:5px;height:5px;border-radius:50%;flex:none;background:${color}`}></span>;

export const ClosedChip = () => (
  <span style={`display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;background:rgba(var(--ink-rgb),.05);font:400 9.5px/1 ${F};color:var(--color-neutral-400)`}>
    <i class="ph ph-moon" style="font-size:10px"></i>{t('Closed')}</span>
);

export const Eyebrow = ({ children, size = 9.5, mb = 0 }) => (
  <span style={`font:400 ${size}px/1 ${F};letter-spacing:.13em;text-transform:uppercase;color:var(--color-neutral-600);${mb ? `margin-bottom:${mb}px` : ''}`}>{children}</span>
);

export function useSize() {
  const ref = useRef(null);
  const [size, setSize] = useState(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize(p => (p && Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

// A chart that fills its flex container (measured, so dots stay round)
export function FillChart(props) {
  const [ref, size] = useSize();
  return (
    <div ref={ref} style={`flex:1;min-height:40px;position:relative;${props.wrapStyle || ''}`}>
      {size && size.w > 10 && size.h > 10 && <div style="position:absolute;inset:0"><Chart {...props} w={size.w} h={size.h} style="" /></div>}
    </div>
  );
}

// Value under the pointer: crosshair, point and a small glass tooltip.
// The tooltip slides from left- to right-anchored as you move, so it never leaves the chart.
export function ChartTip({ tip, x, y, w }) {
  const frac = w ? x / w : 0.5;
  const above = y > 52;
  return (
    <div class="chart-tip" style={`position:absolute;left:${(frac * 100).toFixed(2)}%;top:${y.toFixed(1)}px;` +
      `transform:translate(${-Math.round(frac * 100)}%,${above ? 'calc(-100% - 11px)' : '11px'});` +
      `pointer-events:none;z-index:6;white-space:nowrap;padding:7px 9px 6px;border-radius:7px;` +
      `background:rgba(10,11,18,.84);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);` +
      `box-shadow:0 6px 18px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.07)`}>
      <div style={`font:500 12px/1 ${F};color:var(--color-neutral-100);font-variant-numeric:tabular-nums;letter-spacing:-.01em`}>{tip.value}</div>
      <div style={`display:flex;gap:7px;margin-top:5px;font:400 10px/1 ${F};font-variant-numeric:tabular-nums`}>
        <span style="color:var(--color-neutral-500)">{tip.time}{tip.est ? ' · ' + t('est.') : ''}</span>
        <span style={`color:${tip.up ? UP : DOWN}`}>{tip.chg} · {tip.pct}%</span>
      </div>
    </div>
  );
}

export function Chart({ values, tipFor, w, h, pad, sw = 1.5, color, gid, gop = .24, glowPx = 0, marker, mr = 2.6, pr = 4.5, draw = 1.1, fade = 1.2, fadeDelay = .3, grid, closed, animKey, style = '' }) {
  const [hov, setHov] = useState(null);
  const P = pts(values, w, h, pad);
  const line = linePath(values, w, h, pad);
  const area = areaPath(values, w, h, pad);
  const lp = P[P.length - 1];
  const g = typeof grid === 'function' ? grid(w, h) : grid;
  const onMove = e => {
    if (!tipFor) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setHov(Math.round(fx * (P.length - 1)));
  };
  const leave = () => setHov(null);
  const tip = hov != null && tipFor ? tipFor(Math.min(hov, values.length - 1)) : null;
  const hp = tip ? P[Math.min(hov, P.length - 1)] : null;
  const hc = closed ? 'var(--color-neutral-300)' : color;
  const cross = hp && (
    <g style="pointer-events:none">
      <line x1={hp[0].toFixed(1)} y1="0" x2={hp[0].toFixed(1)} y2={h} stroke="rgba(var(--ink-rgb),.24)" stroke-width="1" stroke-dasharray="2 3"></line>
      <circle cx={hp[0].toFixed(1)} cy={hp[1].toFixed(1)} r={pr + 1.5} fill={hc} opacity=".22"></circle>
      <circle cx={hp[0].toFixed(1)} cy={hp[1].toFixed(1)} r={mr + 0.6} fill={hc} stroke="rgba(0,0,0,.4)" stroke-width="1"></circle>
    </g>
  );
  const wrap = svg => (
    <div style={`position:relative;${tipFor ? 'cursor:crosshair' : ''}`} onMouseMove={onMove} onMouseLeave={leave} onPointerDown={leave}>
      {svg}
      {tip && <ChartTip tip={tip} x={hp[0]} y={hp[1]} w={w} />}
    </div>
  );
  if (closed) {
    return wrap(
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={`display:block;overflow:visible;${style}`}>
        <path d={line} fill="none" stroke="var(--color-neutral-500)" stroke-width="1.4" stroke-linecap="round" style="opacity:.4"></path>
        {cross}
      </svg>
    );
  }
  return wrap(
    <svg key={animKey} viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={`display:block;overflow:visible;${style}`}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity={gop}></stop>
        <stop offset="100%" stop-color={color} stop-opacity="0"></stop></linearGradient></defs>
      {g}
      <path d={area} fill={`url(#${gid})`} style={`animation:nfade ${fade}s ease ${fadeDelay}s both;transition:fill .7s ease`}></path>
      <path d={line} fill="none" stroke={color} stroke-width={sw} stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1"
        style={`animation:ndraw ${draw}s cubic-bezier(.4,0,.2,1) both;transition:stroke .7s ease;${glowPx ? `filter:drop-shadow(0 0 ${glowPx}px ${glow(color)})` : ''}`}></path>
      {marker && <circle class="pulse-dot" cx={lp[0].toFixed(1)} cy={lp[1].toFixed(1)} r={pr} fill={color} opacity={hp ? '.2' : '.5'}></circle>}
      {marker && <circle cx={lp[0].toFixed(1)} cy={lp[1].toFixed(1)} r={mr} fill={color} opacity={hp ? '.45' : '1'}></circle>}
      {cross}
    </svg>
  );
}

// ── period helpers ───────────────────────────────────────────
export const PERIOD_WORD = { '1D': 'today', '1W': 'past week', '1M': 'past month', '1Y': 'past year', 'ALL': 'all time' };
export const dm = ts => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' });

// "today" / "past week" … or "since 22. 9." while the history doesn't reach that far back yet
export function periodLabel(per) {
  if (per.partial && per.from) return t('since {d}', { d: dm(per.from) });
  return t(PERIOD_WORD[per.range] || 'today');
}

export function tipTime(ts, range) {
  const d = new Date(ts);
  if (range === '1D') return hhmm(ts);
  if (range === '1W') return d.toLocaleDateString(locale(), { weekday: 'short' }) + ' ' + hhmm(ts);
  if (range === '1M') return dm(ts) + ' ' + hhmm(ts);
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'numeric', year: 'numeric' });
}

// Tooltip data for chart point i: value then, and the change since the start of the range
// (measured on P/L like the pill, so the last point matches it exactly)
export function chartTip(d, per, fmt, i) {
  const s = d.series;
  if (!s || !s[i]) return null;
  const [ts, v, pl, est] = s[i];
  const chg = pl != null && per.basePl != null ? pl - per.basePl : v - s[0][1];
  const base = v - chg;
  return {
    value: fmt(v, 2) + ' ' + d.currency,
    time: tipTime(ts, per.range),
    chg: fmt.signed(chg, 0),
    pct: fmt.signed(base ? (chg / base) * 100 : 0, 2),
    up: chg >= 0,
    est: !!est
  };
}

export function spanStr(series, range) {
  if (!series || series.length < 2) return '';
  const a = series[0][0], b = series[series.length - 1][0];
  const f = range === '1D' ? hhmm
    : range === '1W' || range === '1M' ? dm
      : ts => new Date(ts).toLocaleDateString(locale(), { month: 'numeric', year: '2-digit' });
  return `${f(a)} – ${f(b)}`;
}

// Low–high of the visible range with a marker at the current value
export function RangeBar({ m, range, closed, series }) {
  const vals = m.values;
  const lo = Math.min(...vals, m.val), hi = Math.max(...vals, m.val);
  const pos = hi > lo ? (m.val - lo) / (hi - lo) : 0.5;
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 120); return () => clearTimeout(t); }, []);
  const pct = (on ? pos : 0) * 100;
  return (
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:baseline">
        <Eyebrow>{range === 'ALL' ? t('All-time range') : t('{r} range', { r: range })}</Eyebrow>
        <span style="flex:1"></span>
        <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);font-variant-numeric:tabular-nums`}>{t('{x}% spread', { x: m.fmt.signed(hi > lo ? ((hi - lo) / lo) * 100 : 0, 2) })}</span>
      </div>
      <div style="position:relative;height:4px;border-radius:2px;background:rgba(var(--ink-rgb),.06)">
        <div style={`position:absolute;left:0;top:0;bottom:0;border-radius:2px;width:${pct}%;background:${closed ? 'var(--color-neutral-700)' : 'linear-gradient(to right,var(--color-accent-800),var(--color-accent-500))'};transition:width 1.1s cubic-bezier(.3,1,.3,1)`}></div>
        <div style={`position:absolute;top:50%;left:${pct}%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:${closed ? 'var(--color-neutral-500)' : 'var(--color-accent-300)'};box-shadow:0 0 0 2px rgba(0,0,0,.25)${closed ? '' : ',0 0 10px rgba(var(--acc-rgb),.6)'};transition:left 1.1s cubic-bezier(.3,1,.3,1)`}></div>
      </div>
      <div style={`display:flex;justify-content:space-between;font:400 10.5px/1 ${F};color:var(--color-neutral-500);font-variant-numeric:tabular-nums`}>
        <span>{m.fmt(lo, 0)}</span>
        <span style="font-size:9.5px;color:var(--color-neutral-600)">{spanStr(series, range)}</span>
        <span>{m.fmt(hi, 0)}</span>
      </div>
    </div>
  );
}

export function RangeChips({ range, onPick, list, size = 10, padX = 7 }) {
  return list.map(r => {
    const on = r === range;
    return (
      <span class={'ia ' + (on ? '' : 'hov-range')} onClick={() => onPick(r)}
        style={`padding:3px ${padX}px;border-radius:4px;font:${on ? 500 : 400} ${size}px/1 ${F};border:1px solid ${on ? 'var(--color-accent-800)' : 'transparent'};` +
          (on ? 'color:var(--color-accent-300);background:var(--color-accent-900)' : 'color:var(--color-neutral-600);background:transparent')}>{r}</span>
    );
  });
}

export function Btn({ kind = 'primary', onClick, children, style = '', disabled }) {
  return <button type="button" class={`btn btn-${kind} ia`} disabled={disabled} onClick={onClick} style={`font-size:13px;padding:6px 12px;${style}`}>{children}</button>;
}

// ── view model ───────────────────────────────────────────────
export function useModel(st, settings) {
  const d = st && st.data;
  const motion = settings.motion;
  const val = useRolling(d ? d.value : null, motion);
  const flash = useFlash(d ? d.value : null, motion);
  const fmt = useMemo(() => makeFmt(settings.numberFormat), [settings.numberFormat]);
  if (!d) return { fmt, d: null };
  // change over the selected range (1D = today); older builds of main only sent dayAbs
  const per = d.period || { range: '1D', abs: d.dayAbs, pct: d.dayPct, basePl: null, from: null, partial: false };
  const roll = (val ?? d.value) - d.value;
  const chgAbs = per.abs + roll;
  const prev = d.value - per.abs;
  const chgPct = per.range === 'ALL' ? per.pct : prev ? (chgAbs / prev) * 100 : 0;
  const chgLabel = periodLabel(per);
  const trend = chgAbs >= 0 ? UP : DOWN;
  const flashC = flash > 0 ? UP : flash < 0 ? DOWN : trend;
  const cur = d.currency;
  const sp = fmt.split(val ?? d.value);
  const values = (d.series && d.series.length ? d.series.map(p => p[1]) : [d.value, d.value]);
  const ar = accentRamp(settings.accent || '#9184d9');
  const RAMP = [ar[3], ar[4], ar[5], ar[6], ar[7], '#4b4f5e'];
  const maxW = Math.max(1, ...d.positions.map(p => p.weight));
  const positions = d.positions.map((p, i) => ({
    ...p,
    color: p.plPct >= 0 ? UP : DOWN,
    pctStr: fmt.signed(p.plPct, 2),
    valStr: fmt(p.value, 0),
    allocStr: fmt(p.weight, 1),
    ramp: RAMP[Math.min(i, RAMP.length - 1)],
    barW: (p.weight / maxW) * 88 + '%'
  }));
  // allocation: five biggest + "Other"
  let slices = positions.map(p => ({ sym: p.sym, weight: p.weight }));
  if (slices.length > 6) {
    const rest = slices.slice(5).reduce((a, p) => a + p.weight, 0);
    slices = slices.slice(0, 5).concat([{ sym: t('Other'), weight: rest, other: true }]);
  }
  const maxS = Math.max(1, ...slices.map(s => s.weight));
  slices = slices.map((s, i) => ({ ...s, color: RAMP[s.other ? 5 : Math.min(i, 5)], allocStr: fmt(s.weight, 1), barW: (s.weight / maxS) * 88 + '%' }));
  return {
    d, fmt, cur, val, sp, values, positions, slices,
    trend, flashC,
    per, chgAbs, chgPct, chgLabel,
    chgPctStr: fmt.signed(chgPct, 2),
    chgAbsStr: fmt.signed(chgAbs, 0) + ' ' + cur,
    chgIcon: chgPct >= 0 ? 'ph ph-trend-up' : 'ph ph-trend-down',
    tipFor: i => chartTip(d, per, fmt, i),
    cashStr: fmt(d.cash, 0),
    divStr: d.dividendsYTD == null ? '—' : fmt(d.dividendsYTD, 0) + ' ' + cur,
    divFull: d.dividendsYTD == null ? '—' : fmt(d.dividendsYTD, 0) + ' ' + cur,
    divTitle: st.divError ? `Dividends: ${st.divError.message}` : '',
    allTimeStr: fmt.signed(d.allTimePL, 0),
    allTimePctStr: fmt.signed(d.allTimePct, 2),
    allTimeColor: d.allTimePL >= 0 ? UP : DOWN
  };
}

// ── sizes ────────────────────────────────────────────────────
export function Pill({ m, closed, size = 11.5, icon = 10, pad = '3px 7px 3px 5px', extra = '' }) {
  if (closed) {
    return <span style={`align-self:flex-start;padding:3px 7px;border-radius:4px;background:rgba(var(--ink-rgb),.05);color:var(--color-neutral-400);font:500 ${size}px/1 ${F};font-variant-numeric:tabular-nums`}>{t('{x}% {p}', { x: m.chgPctStr, p: m.chgLabel })}</span>;
  }
  return (
    <span style={`display:inline-flex;align-items:center;gap:4px;padding:${pad};border-radius:4px;background:${tint(m.flashC)};color:${m.flashC};font:500 ${size}px/1 ${F};font-variant-numeric:tabular-nums;transition:background .7s ease,color .7s ease;white-space:nowrap`}>
      <i class={m.chgIcon} style={`font-size:${icon}px`}></i>{m.chgPctStr}%{extra}</span>
  );
}

export const Stat = ({ label, value, color, title }) => (
  <div style="display:flex;flex-direction:column;gap:3px;min-width:0" title={title || ''}>
    <span style={`font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-600)`}>{label}</span>
    <span style={`font:400 12.5px/1 ${F};color:${color || 'var(--color-neutral-300)'};font-variant-numeric:tabular-nums;white-space:nowrap`}>{value}</span>
  </div>
);

// bars grow from 0 to their width on mount
export function GrowBar({ color, w, dur = 1.2 }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  return <div style={`height:100%;background:${color};width:${on ? w : '0%'};transition:width ${dur}s cubic-bezier(.3,1,.3,1)`}></div>;
}

export function axisLabels(series, range) {
  if (!series || series.length < 2) return ['', '', '', t('now')];
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const f = t => {
    const d = new Date(t);
    if (range === '1D') return hhmm(t);
    if (range === '1W') return d.toLocaleDateString(locale(), { weekday: 'short' });
    if (range === '1M') return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    return d.toLocaleDateString(locale(), { month: 'short', year: '2-digit' });
  };
  return [f(t0), f(t0 + (t1 - t0) / 3), f(t0 + (2 * (t1 - t0)) / 3), t('now')];
}

export function tabStyle(on) {
  return `border:0;cursor:pointer;padding:6px 13px;border-radius:5px;font:500 11.5px/1 ${F};transition:background .25s ease,color .25s ease;` +
    (on ? 'background:var(--color-accent-900);color:var(--color-accent-200);box-shadow:inset 0 0 0 1px var(--color-accent-800);'
      : 'background:transparent;color:var(--color-neutral-500);');
}

export const Mini = ({ label, value, color }) => (
  <div style="display:flex;flex-direction:column;gap:4px">
    <span style={`font:400 9px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-600)`}>{label}</span>
    <span style={`font:400 11.5px/1 ${F};color:${color || 'var(--color-neutral-300)'};font-variant-numeric:tabular-nums`}>{value}</span>
  </div>
);

export function Alloc({ m }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 260); return () => clearTimeout(t); }, []);
  const C = 2 * Math.PI * 54;
  let cum = 0;
  const arcs = m.slices.map(s => {
    const len = on ? (s.weight / 100) * C * 0.985 : 0;
    const off = -(cum / 100) * C;
    cum += s.weight;
    return { color: s.color, dash: len.toFixed(1) + ' ' + C.toFixed(1), offset: off.toFixed(1) };
  });
  return (
    <div key="alloc" style="position:relative;flex:1;min-height:0;display:grid;grid-template-columns:200px 1fr;gap:24px;align-items:center;animation:nfade .4s ease both">
      <div style="position:relative;display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 140 140" width="188" height="188" style="display:block;transform:rotate(-90deg)">
          <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(var(--ink-rgb),.07)" stroke-width="11"></circle>
          {arcs.map(a => <circle cx="70" cy="70" r="54" fill="none" stroke={a.color} stroke-width="11" stroke-dasharray={a.dash} stroke-dashoffset={a.offset} style="transition:stroke-dasharray 1.2s cubic-bezier(.3,1,.3,1)"></circle>)}
        </svg>
        <div style="position:absolute;display:flex;flex-direction:column;align-items:center;gap:3px">
          <span style={`font:400 9px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:var(--color-neutral-600)`}>{t('Invested')}</span>
          <span style={`font:300 17px/1 ${F};color:var(--color-neutral-200);font-variant-numeric:tabular-nums`}>{m.fmt(m.d.invested, 0)}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        {m.slices.map(s => (
          <div style="display:flex;align-items:center;gap:10px">
            <span style={`width:9px;height:9px;border-radius:3px;flex:none;background:${s.color}`}></span>
            <span style={`width:48px;flex:none;font:500 11.5px/1 ${F};color:var(--color-neutral-200);overflow:hidden;text-overflow:ellipsis`}>{s.sym}</span>
            <div style="flex:1;height:5px;border-radius:3px;background:rgba(var(--ink-rgb),.06);overflow:hidden"><GrowBar color={s.color} w={s.barW} /></div>
            <span style={`width:46px;text-align:right;font:400 11px/1 ${F};color:var(--color-neutral-400);font-variant-numeric:tabular-nums`}>{s.allocStr}%</span>
          </div>
        ))}
        {!m.slices.length && <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-600)`}>{t('Nothing invested yet.')}</span>}
      </div>
    </div>
  );
}

export function errorCopy(err) {
  const k = err ? err.kind : 'network';
  const code = err && err.code ? err.code : '';
  const label = { 401: '401 Unauthorized', 403: '403 Forbidden', 429: '429 Too Many Requests' }[code] || (code ? `${code} error` : 'no response');
  return {
    title: t({ auth: 'API key expired or revoked', forbidden: 'Missing API permission', rate: 'Rate limited', server: 'Trading 212 is unavailable', network: 'Can\u2019t reach Trading 212' }[k] || 'Sync failed'),
    network: k === 'network',
    code: label,
    hint: k === 'forbidden' ? t('The API key is missing the \u201c{p}\u201d permission \u2014 create a new key with Account data, Portfolio and History \u2013 Dividends.', { p: (err && err.scope) || 'Account data' }) : ''
  };
}

export function Connect({ st, settings }) {
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [env, setEnv] = useState(settings.env || 'live');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setErr(''); setBusy(true);
    const r = await api.connect({ env, key, secret });
    setBusy(false);
    if (!r.ok) setErr(r.message || t('Could not connect.'));
  };
  const cur = settings.displayCurrency === 'account' ? t('Account') : settings.displayCurrency;
  return (
    <div style="width:620px;height:304px;padding:26px 28px;display:flex;flex-direction:column;gap:13px;box-sizing:border-box;position:relative">
      <div class="loop" style="position:absolute;width:260px;height:260px;left:-90px;top:-130px;border-radius:50%;background:radial-gradient(circle,rgba(var(--acc-rgb),.22),transparent 70%);filter:blur(14px);animation:nglow 8s ease-in-out infinite;pointer-events:none"></div>
      <div style="position:relative;display:flex;align-items:center;gap:9px">
        <Tile px={24} />
        <span style={`font:500 13px/1 ${F};color:var(--color-neutral-200)`}>{t('Connect your account')}</span>
        <span style="flex:1"></span>
        <div class="ia" style="display:flex;gap:2px;padding:2px;border-radius:6px;background:rgba(var(--ink-rgb),.045);box-shadow:inset 0 0 0 1px rgba(var(--ink-rgb),.05)">
          {['live', 'demo'].map(e => (
            <button type="button" class="ia" onClick={() => setEnv(e)} style={`border:0;cursor:pointer;padding:4px 9px;border-radius:4px;font:500 10px/1 ${F};transition:background .25s ease,color .25s ease;` +
              (env === e ? 'background:var(--color-accent-900);color:var(--color-accent-200);box-shadow:inset 0 0 0 1px var(--color-accent-800)' : 'background:transparent;color:var(--color-neutral-500)')}>{e === 'live' ? t('Live') : t('Practice')}</button>
          ))}
        </div>
      </div>
      <p style={`position:relative;font:400 12.5px/1.55 ${F};color:var(--color-neutral-400);margin:0;max-width:62ch`}>
        {t('Trading 212 → Settings → API (Beta) → Generate API key. Tick')} <span style="color:var(--color-accent-300)">Account data</span>, <span style="color:var(--color-accent-300)">Portfolio</span> {t('and')} <span style="color:var(--color-accent-300)">History – Dividends</span> {t('— nothing else is needed.')} {st.encrypted ? (st.platform === 'darwin' ? t('Encrypted in the macOS Keychain.') : t('Encrypted on this PC with Windows DPAPI.')) : t('Stored locally on this PC.')}</p>
      <form class="ia" onSubmit={e => { e.preventDefault(); go(); }} style="position:relative;display:flex;flex-direction:column;gap:13px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px">
          <div style="display:flex;flex-direction:column;gap:5px">
            <label style={`display:flex;align-items:center;height:11px;font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-500)`}>{t('API key')}</label>
            <input class="input mono" type="text" value={key} spellcheck={false} autoFocus placeholder={t('Paste API key')} onInput={e => setKey(e.currentTarget.value)} style="width:100%;font-size:12px" />
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <label style={`display:flex;align-items:center;height:11px;gap:5px;font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-500)`}>{t('Secret key')}<i class="ph ph-lock-simple" style="font-size:11px;color:var(--color-accent-400)"></i></label>
            <div style="position:relative;display:flex;align-items:center">
              <input class="input mono" type={show ? 'text' : 'password'} value={secret} spellcheck={false} placeholder={t('Paste secret')} onInput={e => setSecret(e.currentTarget.value)} style="width:100%;padding-right:30px;font-size:12px" />
              <i class={'ph hov-icon ia ' + (show ? 'ph-eye-slash' : 'ph-eye')} onClick={() => setShow(s => !s)} style="position:absolute;right:9px;font-size:14px;color:var(--color-neutral-500)"></i>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:2px;min-height:30px">
          <button type="submit" class="btn btn-primary ia" disabled={busy || !key.trim() || !secret.trim()} style="font-size:13px;padding:6px 12px">{t('Connect')}</button>
          {busy && (
            <span style="display:flex;gap:8px;align-items:center">
              <span style="width:15px;height:15px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box"></span>
              <span style={`font:400 11.5px/1 ${F};color:var(--color-neutral-400)`}>{t('Verifying key pair · fetching account currency')}</span>
            </span>
          )}
          {!busy && err && (
            <span style={`display:flex;gap:7px;align-items:center;font:400 11.5px/1.4 ${F};color:${DOWN};max-width:420px`}>
              <i class="ph ph-warning-circle" style="font-size:14px;flex:none"></i>{err}</span>
          )}
        </div>
      </form>
      <span style="flex:1"></span>
      <div style="position:relative;display:flex;gap:20px;padding-top:14px;border-top:1px solid rgba(var(--ink-rgb),.08)">
        <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>{t('Refresh every')} <span style="color:var(--color-accent-300)">{settings.refreshSeconds} s</span></span>
        <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>{t('Display currency')} <span style="color:var(--color-accent-300)">{cur}</span></span>
        <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>{t('Read-only scope')}</span>
        <span style="flex:1"></span>
        <span class="ia hov-icon" onClick={() => api.openSettings()} style={`font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}>{t('More settings')}</span>
      </div>
    </div>
  );
}
