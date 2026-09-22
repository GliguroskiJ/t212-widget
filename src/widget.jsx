import { render } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import {
  UP, DOWN, accentRamp, applyTheme, applyMotion, makeFmt, agoStr, hhmm,
  linePath, areaPath, lastPt, tint, glow
} from './shared.js';

const api = window.api;
const F = "'Inter',sans-serif";

// ── hooks ────────────────────────────────────────────────────
function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

// digits roll toward the new value: val += (target - val) * 0.1 per frame
function useRolling(target, motion) {
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
function useFlash(value, motion) {
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
function Tile({ px = 22, muted }) {
  const fs = px <= 20 ? 8.5 : px <= 22 ? 9 : 9.5;
  const r = px <= 20 ? 5 : 6;
  return (
    <div style={`width:${px}px;height:${px}px;border-radius:${r}px;flex:none;display:flex;align-items:center;justify-content:center;font:600 ${fs}px/1 ui-monospace,Menlo,monospace;` +
      (muted ? 'border:1px solid var(--color-neutral-800);background:rgba(233,233,237,.04);color:var(--color-neutral-500)'
        : 'border:1px solid var(--color-accent-700);background:var(--color-accent-900);color:var(--color-accent-300)')}>212</div>
  );
}

const Dot = ({ color }) => <span class="breathe" style={`width:5px;height:5px;border-radius:50%;flex:none;background:${color}`}></span>;

const ClosedChip = () => (
  <span style={`display:inline-flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;background:rgba(233,233,237,.05);font:400 9.5px/1 ${F};color:var(--color-neutral-400)`}>
    <i class="ph ph-moon" style="font-size:10px"></i>Closed</span>
);

const Eyebrow = ({ children, size = 9.5, mb = 0 }) => (
  <span style={`font:400 ${size}px/1 ${F};letter-spacing:.13em;text-transform:uppercase;color:var(--color-neutral-600);${mb ? `margin-bottom:${mb}px` : ''}`}>{children}</span>
);

function Chart({ values, w, h, pad, sw = 1.5, color, gid, gop = .24, glowPx = 0, marker, mr = 2.6, pr = 4.5, draw = 1.1, fade = 1.2, fadeDelay = .3, grid, closed, animKey, style = '' }) {
  const line = linePath(values, w, h, pad);
  const area = areaPath(values, w, h, pad);
  const lp = lastPt(values, w, h, pad);
  if (closed) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={`display:block;opacity:.4;${style}`}>
        <path d={line} fill="none" stroke="var(--color-neutral-500)" stroke-width="1.4" stroke-linecap="round"></path>
      </svg>
    );
  }
  return (
    <svg key={animKey} viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={`display:block;overflow:visible;${style}`}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity={gop}></stop>
        <stop offset="100%" stop-color={color} stop-opacity="0"></stop></linearGradient></defs>
      {grid}
      <path d={area} fill={`url(#${gid})`} style={`animation:nfade ${fade}s ease ${fadeDelay}s both;transition:fill .7s ease`}></path>
      <path d={line} fill="none" stroke={color} stroke-width={sw} stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1"
        style={`animation:ndraw ${draw}s cubic-bezier(.4,0,.2,1) both;transition:stroke .7s ease;${glowPx ? `filter:drop-shadow(0 0 ${glowPx}px ${glow(color)})` : ''}`}></path>
      {marker && <circle class="pulse-dot" cx={lp[0].toFixed(1)} cy={lp[1].toFixed(1)} r={pr} fill={color} opacity=".5"></circle>}
      {marker && <circle cx={lp[0].toFixed(1)} cy={lp[1].toFixed(1)} r={mr} fill={color}></circle>}
    </svg>
  );
}

function RangeChips({ range, onPick, list, size = 10, padX = 7 }) {
  return list.map(r => {
    const on = r === range;
    return (
      <span class={'ia ' + (on ? '' : 'hov-range')} onClick={() => onPick(r)}
        style={`padding:3px ${padX}px;border-radius:4px;font:${on ? 500 : 400} ${size}px/1 ${F};border:1px solid ${on ? 'var(--color-accent-800)' : 'transparent'};` +
          (on ? 'color:var(--color-accent-300);background:var(--color-accent-900)' : 'color:var(--color-neutral-600);background:transparent')}>{r}</span>
    );
  });
}

function Btn({ kind = 'primary', onClick, children, style = '', disabled }) {
  return <button type="button" class={`btn btn-${kind} ia`} disabled={disabled} onClick={onClick} style={`font-size:13px;padding:6px 12px;${style}`}>{children}</button>;
}

// ── widget menu (dots-three) ─────────────────────────────────
function CornerMenu({ settings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', off); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  const act = fn => () => { setOpen(false); fn(); };
  const sizes = [['small', 'S', 'Small'], ['medium', 'M', 'Medium'], ['large', 'L', 'Large'], ['rail', 'R', 'Rail']];
  return (
    <div ref={ref} class="ia">
      <button type="button" class={'corner ia' + (open ? ' on' : '')} title="Menu" onClick={() => setOpen(o => !o)}>
        <i class="ph ph-dots-three" style="font-size:15px"></i></button>
      {open && (
        <div class="menu ia">
          <button class="mi" onClick={act(() => api.refresh())}><i class="ph ph-arrow-clockwise"></i>Refresh now</button>
          <div class="msep"></div>
          <div class="mlabel">Widget size</div>
          <div class="msizes">
            {sizes.map(([k, s, t]) => (
              <button class={'msz' + (settings.size === k ? ' on' : '')} title={t} onClick={() => api.setSettings({ size: k })}>{s}</button>
            ))}
          </div>
          <button class="mi" onClick={act(() => api.setSettings({ lockPosition: !settings.lockPosition }))}>
            <i class={'ph ' + (settings.lockPosition ? 'ph-lock-simple-open' : 'ph-lock-simple')}></i>{settings.lockPosition ? 'Unlock position' : 'Lock position'}</button>
          <button class="mi" onClick={act(() => api.setSettings({ alwaysOnTop: !settings.alwaysOnTop }))}>
            <i class="ph ph-push-pin"></i>{settings.alwaysOnTop ? 'Don’t keep on top' : 'Keep on top'}</button>
          <button class="mi" onClick={act(() => api.openSettings())}><i class="ph ph-gear-six"></i>Settings…</button>
          <div class="msep"></div>
          <button class="mi" onClick={act(() => api.hideWidget())}><i class="ph ph-eye-slash"></i>Hide widget</button>
          <button class="mi danger" onClick={act(() => api.quit())}><i class="ph ph-power"></i>Quit</button>
        </div>
      )}
    </div>
  );
}

// ── view model ───────────────────────────────────────────────
function useModel(st, settings) {
  const d = st && st.data;
  const motion = settings.motion;
  const val = useRolling(d ? d.value : null, motion);
  const flash = useFlash(d ? d.value : null, motion);
  const fmt = useMemo(() => makeFmt(settings.numberFormat), [settings.numberFormat]);
  if (!d) return { fmt, d: null };
  const dayAbs = d.dayAbs + ((val ?? d.value) - d.value);
  const prev = d.value - d.dayAbs;
  const dayPct = prev ? (dayAbs / prev) * 100 : 0;
  const trend = dayAbs >= 0 ? UP : DOWN;
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
    slices = slices.slice(0, 5).concat([{ sym: 'Other', weight: rest }]);
  }
  const maxS = Math.max(1, ...slices.map(s => s.weight));
  slices = slices.map((s, i) => ({ ...s, color: RAMP[i === slices.length - 1 && s.sym === 'Other' ? 5 : Math.min(i, 5)], allocStr: fmt(s.weight, 1), barW: (s.weight / maxS) * 88 + '%' }));
  return {
    d, fmt, cur, val, sp, values, positions, slices,
    trend, flashC,
    dayAbs, dayPct,
    dayPctStr: fmt.signed(dayPct, 2),
    dayAbsStr: fmt.signed(dayAbs, 0) + ' ' + cur,
    dayIcon: dayPct >= 0 ? 'ph ph-trend-up' : 'ph ph-trend-down',
    cashStr: fmt(d.cash, 0),
    divStr: d.dividendsYTD == null ? '—' : fmt(d.dividendsYTD, 0),
    allTimeStr: fmt.signed(d.allTimePL, 0),
    allTimePctStr: fmt.signed(d.allTimePct, 2),
    allTimeColor: d.allTimePL >= 0 ? UP : DOWN
  };
}

// ── sizes ────────────────────────────────────────────────────
function Pill({ m, closed, size = 11.5, icon = 10, pad = '3px 7px 3px 5px', extra = '' }) {
  if (closed) {
    return <span style={`align-self:flex-start;padding:3px 7px;border-radius:4px;background:rgba(233,233,237,.05);color:var(--color-neutral-400);font:500 ${size}px/1 ${F};font-variant-numeric:tabular-nums`}>{m.dayPctStr}% on the day</span>;
  }
  return (
    <span style={`display:inline-flex;align-items:center;gap:4px;padding:${pad};border-radius:4px;background:${tint(m.flashC)};color:${m.flashC};font:500 ${size}px/1 ${F};font-variant-numeric:tabular-nums;transition:background .7s ease,color .7s ease;white-space:nowrap`}>
      <i class={m.dayIcon} style={`font-size:${icon}px`}></i>{m.dayPctStr}%{extra}</span>
  );
}

function Small({ m, st, now, closed }) {
  return (
    <div style="width:300px;height:304px;padding:20px;display:flex;flex-direction:column;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:auto">
        <Tile px={20} muted={closed} />
        <span style={`font:500 11px/1 ${F};color:var(--color-neutral-${closed ? 500 : 400})`}>Portfolio</span>
        <span style="flex:1"></span>
        {closed ? <ClosedChip /> : <Dot color={m.trend} />}
      </div>
      <Eyebrow mb={8}>{closed ? 'At close' : 'Total value'}</Eyebrow>
      <div style={`display:flex;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums;${closed ? 'opacity:.72' : ''}`}>
        <span style={`font:300 28px/1 ${F};letter-spacing:-.03em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-${closed ? 600 : 500})`}>{m.cur}</span>
      </div>
      <div style="display:flex;margin-top:10px"><Pill m={m} closed={closed} /></div>
      <Chart values={m.values} w={260} h={46} pad={5} color={m.trend} gid="gS" closed={closed} style="margin-top:16px" animKey={st.range} />
      <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);margin-top:12px`}>
        {closed ? `Opens in ${st.market.opensIn || '—'} · ${st.market.names}` : `Updated ${agoStr(st.lastSync, now)}`}</span>
    </div>
  );
}

function Medium({ m, st, now, closed, settings }) {
  const setRange = r => api.setSettings({ range: r });
  return (
    <div style="width:620px;height:304px;padding:22px 24px;display:grid;grid-template-columns:250px 1fr;gap:26px;box-sizing:border-box;position:relative">
      <div style="position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(var(--acc-rgb),.09),transparent 45%)"></div>
      <div style="position:relative;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:22px">
          <Tile px={22} muted={closed} />
          <span style={`font:500 12px/1 ${F};color:var(--color-neutral-${closed ? 500 : 300})`}>Invest · Portfolio</span>
        </div>
        <Eyebrow size={10} mb={9}>{closed ? 'At close' : 'Total value'}</Eyebrow>
        <div style={`display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap;${closed ? 'opacity:.72' : ''}`}>
          <span style={`font:300 34px/1 ${F};letter-spacing:-.03em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
          <span style={`font:300 18px/1 ${F};color:var(--color-neutral-500)`}>{m.fmt.dec}{m.sp.dec}</span>
          <span style={`font:400 12px/1 ${F};color:var(--color-neutral-500);margin-left:4px`}>{m.cur}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
          <Pill m={m} closed={closed} size={12} icon={11} pad="4px 8px 4px 6px" />
          {!closed && <span style={`font:400 12px/1 ${F};color:var(--color-neutral-400);font-variant-numeric:tabular-nums;white-space:nowrap`}>{m.dayAbsStr} today</span>}
        </div>
        <span style="flex:1"></span>
        <div style="display:flex;gap:18px;padding-top:14px;border-top:1px solid rgba(233,233,237,.08)">
          <Stat label="Free cash" value={`${m.cashStr} ${m.cur}`} />
          <Stat label="All-time" value={m.allTimeStr} color={m.allTimeColor} />
        </div>
      </div>
      <div style="position:relative;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style={`display:flex;align-items:center;gap:5px;font:400 10px/1 ${F};color:var(--color-neutral-500);margin-right:auto`}>
            {closed ? <ClosedChip /> : <><Dot color={m.trend} />live · {agoStr(st.lastSync, now)}</>}</span>
          <RangeChips range={settings.range} onPick={setRange} list={['1D', '1W', '1M', '1Y']} />
        </div>
        <div style="flex:1;position:relative;margin-top:10px">
          <Chart values={m.values} w={296} h={126} pad={8} sw={1.7} color={m.trend} gid="gM" gop={.28} glowPx={7} marker
            draw={1.2} fade={1.3} fadeDelay={.35} closed={closed} animKey={settings.range}
            grid={<line x1="0" y1="63" x2="296" y2="63" stroke="rgba(233,233,237,.07)" stroke-width="1" stroke-dasharray="2 4"></line>} />
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          {m.positions.slice(0, 3).map(p => (
            <div class="hov-chip" title={p.name} style="flex:1;min-width:0;padding:8px 9px;border-radius:6px;background:rgba(233,233,237,.035);box-shadow:inset 0 0 0 1px rgba(233,233,237,.05);display:flex;flex-direction:column;gap:5px">
              <span style={`font:500 11px/1 ${F};color:var(--color-neutral-200);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{p.sym}</span>
              <span style={`font:400 10.5px/1 ${F};color:${p.color};font-variant-numeric:tabular-nums`}>{p.pctStr}%</span>
            </div>
          ))}
          {!m.positions.length && <span style={`font:400 11px/1.4 ${F};color:var(--color-neutral-600);padding:8px 0`}>No open positions</span>}
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, value, color }) => (
  <div style="display:flex;flex-direction:column;gap:3px">
    <span style={`font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-600)`}>{label}</span>
    <span style={`font:400 12.5px/1 ${F};color:${color || 'var(--color-neutral-300)'};font-variant-numeric:tabular-nums;white-space:nowrap`}>{value}</span>
  </div>
);

function Rail({ m, st, now, closed, settings }) {
  return (
    <div style="width:320px;height:704px;padding:22px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:8px">
        <Tile px={22} muted={closed} />
        <span style={`font:500 12px/1 ${F};color:var(--color-neutral-${closed ? 500 : 300})`}>Invest</span>
        <span style="flex:1"></span>
        {closed ? <ClosedChip /> :
          <span style={`display:flex;align-items:center;gap:5px;font:400 10px/1 ${F};color:var(--color-neutral-500)`}><Dot color={m.trend} />live</span>}
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        <Eyebrow>{closed ? 'At close' : 'Total value'}</Eyebrow>
        <div style={`display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;${closed ? 'opacity:.72' : ''}`}>
          <span style={`font:300 31px/1 ${F};letter-spacing:-.03em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
          <span style={`font:400 12px/1 ${F};color:var(--color-neutral-500)`}>{m.cur}</span>
        </div>
        <div style="display:flex;align-items:center;gap:9px">
          <Pill m={m} closed={closed} />
          {!closed && <span style={`font:400 11.5px/1 ${F};color:var(--color-neutral-400);font-variant-numeric:tabular-nums`}>{m.dayAbsStr}</span>}
        </div>
      </div>
      <Chart values={m.values} w={276} h={84} pad={6} sw={1.6} color={m.trend} gid="gR" gop={.26} glowPx={6} marker mr={2.4} draw={1.2} closed={closed} animKey={settings.range} />
      <div style="display:flex;flex-direction:column;gap:10px;min-height:0;flex:1">
        <Eyebrow>Holdings</Eyebrow>
        <div class="scroll" style="display:flex;flex-direction:column;gap:10px;min-height:0;margin-right:-6px;padding-right:6px">
          {m.positions.map(p => (
            <div class="hov-rail" style="display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:6px;background:rgba(233,233,237,.035);box-shadow:inset 0 0 0 1px rgba(233,233,237,.05);flex:none">
              <div style="display:flex;align-items:baseline;gap:8px;min-width:0">
                <span style={`font:500 11.5px/1 ${F};color:var(--color-neutral-200);flex:none`}>{p.sym}</span>
                <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{p.name}</span>
                <span style="flex:1"></span>
                <span style={`font:500 11px/1 ${F};color:${p.color};font-variant-numeric:tabular-nums;flex:none`}>{p.pctStr}%</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:3px;border-radius:2px;background:rgba(233,233,237,.06);overflow:hidden">
                  <GrowBar color={p.ramp} w={p.barW} dur={1.1} />
                </div>
                <span style={`font:400 10px/1 ${F};color:var(--color-neutral-500);font-variant-numeric:tabular-nums`}>{p.valStr}</span>
              </div>
            </div>
          ))}
          {!m.positions.length && <span style={`font:400 11px/1.4 ${F};color:var(--color-neutral-600)`}>No open positions</span>}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px solid rgba(233,233,237,.08)">
        <Stat label="Cash" value={m.cashStr} />
        <div style="text-align:right"><Stat label="Dividends YTD" value={m.divStr} /></div>
      </div>
      {closed && <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);margin-top:-8px`}>Opens in {st.market.opensIn || '—'} · {st.market.names}</span>}
    </div>
  );
}

// bars grow from 0 to their width on mount
function GrowBar({ color, w, dur = 1.2 }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  return <div style={`height:100%;background:${color};width:${on ? w : '0%'};transition:width ${dur}s cubic-bezier(.3,1,.3,1)`}></div>;
}

function axisLabels(series, range) {
  if (!series || series.length < 2) return ['', '', '', 'now'];
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const f = t => {
    const d = new Date(t);
    if (range === '1D') return hhmm(t);
    if (range === '1W') return d.toLocaleDateString('en-GB', { weekday: 'short' });
    if (range === '1M') return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  };
  return [f(t0), f(t0 + (t1 - t0) / 3), f(t0 + (2 * (t1 - t0)) / 3), 'now'];
}

function tabStyle(on) {
  return `border:0;cursor:pointer;padding:6px 13px;border-radius:5px;font:500 11.5px/1 ${F};transition:background .25s ease,color .25s ease;` +
    (on ? 'background:var(--color-accent-900);color:var(--color-accent-200);box-shadow:inset 0 0 0 1px var(--color-accent-800);'
      : 'background:transparent;color:var(--color-neutral-500);');
}

function Large({ m, st, now, closed, settings }) {
  const view = settings.largeView || 'chart';
  const setView = v => api.setSettings({ largeView: v });
  const [openRow, setOpenRow] = useState(null);
  return (
    <div style="width:620px;height:620px;padding:24px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box;position:relative">
      <div style="position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(var(--acc-rgb),.08),transparent 40%)"></div>
      <div style="position:relative;display:flex;align-items:center;gap:9px;padding-right:14px">
        <Tile px={24} muted={closed} />
        <span style={`font:500 13px/1 ${F};color:var(--color-neutral-${closed ? 500 : 200})`}>Trading 212 · Invest</span>
        <span style="flex:1"></span>
        {closed ? <ClosedChip /> :
          <span style={`display:flex;align-items:center;gap:5px;font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}><Dot color={m.trend} />live · {agoStr(st.lastSync, now)}</span>}
        <i class="ph ph-arrow-clockwise hov-icon ia" title="Refresh now" onClick={() => api.refresh()} style="font-size:14px;color:var(--color-neutral-600)"></i>
      </div>
      <div style="position:relative;display:flex;align-items:flex-end;gap:20px">
        <div style="display:flex;flex-direction:column;gap:9px">
          <Eyebrow>{closed ? 'At close' : 'Total value'}</Eyebrow>
          <div style={`display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap;${closed ? 'opacity:.72' : ''}`}>
            <span style={`font:300 42px/1 ${F};letter-spacing:-.035em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
            <span style={`font:300 20px/1 ${F};color:var(--color-neutral-500)`}>{m.fmt.dec}{m.sp.dec}</span>
            <span style={`font:400 13px/1 ${F};color:var(--color-neutral-500);margin-left:4px`}>{m.cur}</span>
          </div>
        </div>
        <span style="flex:1"></span>
        <div style="display:flex;flex-direction:column;gap:7px;align-items:flex-end">
          {closed ? <Pill m={m} closed /> : <Pill m={m} size={12.5} icon={11} pad="4px 8px 4px 6px" extra={' · ' + m.dayAbsStr} />}
          <span style={`font:400 11px/1 ${F};color:var(--color-neutral-500);font-variant-numeric:tabular-nums`}>All-time {m.allTimeStr} {m.cur} · {m.allTimePctStr}%</span>
        </div>
      </div>
      <div style="position:relative;display:flex;gap:4px;padding:3px;border-radius:7px;background:rgba(233,233,237,.045);box-shadow:inset 0 0 0 1px rgba(233,233,237,.05);align-self:flex-start">
        <button type="button" class="ia" onClick={() => setView('chart')} style={tabStyle(view === 'chart')}>Chart</button>
        <button type="button" class="ia" onClick={() => setView('positions')} style={tabStyle(view === 'positions')}>Positions</button>
        <button type="button" class="ia" onClick={() => setView('alloc')} style={tabStyle(view === 'alloc')}>Allocation</button>
      </div>

      {view === 'chart' && (
        <div key="chart" style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0;animation:nfade .4s ease both">
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <RangeChips range={settings.range} onPick={r => api.setSettings({ range: r })} list={['1D', '1W', '1M', '1Y', 'ALL']} size={10.5} padX={8} />
          </div>
          <Chart values={m.values} w={572} h={226} pad={12} sw={1.9} color={m.trend} gid="gL" gop={.3} glowPx={8} marker mr={2.8} pr={5}
            draw={1.35} fade={1.3} fadeDelay={.35} closed={closed} animKey={settings.range} style="margin-top:10px"
            grid={<>
              <line x1="0" y1="56" x2="572" y2="56" stroke="rgba(233,233,237,.055)" stroke-dasharray="2 5"></line>
              <line x1="0" y1="113" x2="572" y2="113" stroke="rgba(233,233,237,.07)" stroke-dasharray="2 5"></line>
              <line x1="0" y1="170" x2="572" y2="170" stroke="rgba(233,233,237,.055)" stroke-dasharray="2 5"></line></>} />
          <div style="display:flex;justify-content:space-between;margin-top:8px">
            {axisLabels(m.d.series, settings.range).map(l => <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600)`}>{l}</span>)}
          </div>
          <span style="flex:1"></span>
        </div>
      )}

      {view === 'positions' && (
        <div key="pos" class="scroll" style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0;gap:1px;animation:nfade .4s ease both;margin-right:-6px;padding-right:6px">
          {m.positions.map(p => {
            const open = openRow === p.ticker;
            return (
              <div class="hov-row ia" onClick={() => setOpenRow(o => (o === p.ticker ? null : p.ticker))}
                style={`cursor:pointer;border-radius:6px;padding:9px 10px;flex:none;background:${open ? 'rgba(var(--acc-rgb),.13)' : 'rgba(233,233,237,.03)'}`}>
                <div style="display:flex;align-items:center;gap:11px">
                  <span style={`width:44px;flex:none;font:500 11.5px/1 ${F};color:var(--color-neutral-200);overflow:hidden;text-overflow:ellipsis`}>{p.sym}</span>
                  <span style={`flex:1;font:400 11px/1 ${F};color:var(--color-neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{p.name}</span>
                  <svg viewBox="0 0 64 18" width="64" height="18" preserveAspectRatio="none" style="display:block;flex:none">
                    <path d={linePath(p.spark.length > 1 ? p.spark : [1, 1], 64, 18, 2)} fill="none" stroke={p.color} stroke-width="1.2" stroke-linecap="round" pathLength="1" stroke-dasharray="1" style="animation:ndraw .9s ease both"></path>
                  </svg>
                  <span style={`width:86px;flex:none;text-align:right;font:400 11.5px/1 ${F};color:var(--color-neutral-300);font-variant-numeric:tabular-nums`}>{p.valStr}</span>
                  <span style={`width:58px;flex:none;text-align:right;font:500 11.5px/1 ${F};color:${p.color};font-variant-numeric:tabular-nums`}>{p.pctStr}%</span>
                  <i class={open ? 'ph ph-caret-up' : 'ph ph-caret-down'} style="font-size:13px;color:var(--color-neutral-600)"></i>
                </div>
                {open && (
                  <div style="display:flex;gap:26px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(233,233,237,.08);animation:nfade .3s ease both">
                    <Mini label="Qty" value={m.fmt(p.qty, p.qty % 1 ? 4 : 0)} />
                    <Mini label="Avg price" value={`${m.fmt(p.avg, 2)} ${p.avgCur}`} />
                    <Mini label="P/L" value={`${m.fmt.signed(p.pl, 0)} ${m.cur}`} color={p.color} />
                    <Mini label="Weight" value={`${p.allocStr}%`} />
                  </div>
                )}
              </div>
            );
          })}
          {!m.positions.length && <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-600);padding:10px`}>No open positions yet.</span>}
          <span style="flex:1"></span>
        </div>
      )}

      {view === 'alloc' && <Alloc m={m} />}

      <div style="position:relative;display:flex;align-items:center;justify-content:space-between;padding-top:14px;border-top:1px solid rgba(233,233,237,.08)">
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>Free cash <span style="color:var(--color-neutral-300)">{m.cashStr} {m.cur}</span></span>
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>Dividends YTD <span style="color:var(--color-neutral-300)">{m.divStr} {m.cur}</span></span>
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>
          {closed ? `Opens in ${st.market.opensIn || '—'}` : `${m.d.holdings} holding${m.d.holdings === 1 ? '' : 's'} · ${m.d.markets} market${m.d.markets === 1 ? '' : 's'}`}</span>
      </div>
    </div>
  );
}

const Mini = ({ label, value, color }) => (
  <div style="display:flex;flex-direction:column;gap:4px">
    <span style={`font:400 9px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-600)`}>{label}</span>
    <span style={`font:400 11.5px/1 ${F};color:${color || 'var(--color-neutral-300)'};font-variant-numeric:tabular-nums`}>{value}</span>
  </div>
);

function Alloc({ m }) {
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
          <circle cx="70" cy="70" r="54" fill="none" stroke="rgba(233,233,237,.07)" stroke-width="11"></circle>
          {arcs.map(a => <circle cx="70" cy="70" r="54" fill="none" stroke={a.color} stroke-width="11" stroke-dasharray={a.dash} stroke-dashoffset={a.offset} style="transition:stroke-dasharray 1.2s cubic-bezier(.3,1,.3,1)"></circle>)}
        </svg>
        <div style="position:absolute;display:flex;flex-direction:column;align-items:center;gap:3px">
          <span style={`font:400 9px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:var(--color-neutral-600)`}>Invested</span>
          <span style={`font:300 17px/1 ${F};color:var(--color-neutral-200);font-variant-numeric:tabular-nums`}>{m.fmt(m.d.invested, 0)}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        {m.slices.map(s => (
          <div style="display:flex;align-items:center;gap:10px">
            <span style={`width:9px;height:9px;border-radius:3px;flex:none;background:${s.color}`}></span>
            <span style={`width:48px;flex:none;font:500 11.5px/1 ${F};color:var(--color-neutral-200);overflow:hidden;text-overflow:ellipsis`}>{s.sym}</span>
            <div style="flex:1;height:5px;border-radius:3px;background:rgba(233,233,237,.06);overflow:hidden"><GrowBar color={s.color} w={s.barW} /></div>
            <span style={`width:46px;text-align:right;font:400 11px/1 ${F};color:var(--color-neutral-400);font-variant-numeric:tabular-nums`}>{s.allocStr}%</span>
          </div>
        ))}
        {!m.slices.length && <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-600)`}>Nothing invested yet.</span>}
      </div>
    </div>
  );
}

// ── states ───────────────────────────────────────────────────
const DIMS = { small: [300, 304], medium: [620, 304], large: [620, 620], rail: [320, 704] };

function Loading({ size }) {
  const [w, h] = DIMS[size];
  const head = (
    <div style="display:flex;align-items:center;gap:7px">
      <div style="width:20px;height:20px;border-radius:5px;border:1px solid var(--color-neutral-800);background:rgba(233,233,237,.04)"></div>
      <div class="skel" style="width:68px;height:9px"></div>
      <span style="flex:1"></span>
      <i class="ph ph-arrow-clockwise spin" style="font-size:13px;color:var(--color-accent-400)"></i>
    </div>
  );
  if (size === 'small') {
    return (
      <div style={`width:${w}px;height:${h}px;padding:20px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box`}>
        {head}
        <div class="skel" style="width:52px;height:7px;margin-top:auto"></div>
        <div class="skel" style="width:170px;height:26px"></div>
        <div class="skel" style="width:74px;height:16px;border-radius:4px"></div>
        <div class="skel" style="width:100%;height:46px;margin-top:8px;border-radius:6px"></div>
        <div class="skel" style="width:92px;height:7px;margin-top:8px"></div>
      </div>
    );
  }
  if (size === 'medium') {
    return (
      <div style={`width:${w}px;height:${h}px;padding:22px 24px;display:grid;grid-template-columns:250px 1fr;gap:26px;box-sizing:border-box`}>
        <div style="display:flex;flex-direction:column;gap:14px">
          {head}
          <div class="skel" style="width:60px;height:7px;margin-top:10px"></div>
          <div class="skel" style="width:200px;height:32px"></div>
          <div class="skel" style="width:150px;height:18px"></div>
          <span style="flex:1"></span>
          <div class="skel" style="width:180px;height:26px"></div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div class="skel" style="width:100%;height:12px"></div>
          <div class="skel" style="width:100%;flex:1;border-radius:6px"></div>
          <div style="display:flex;gap:8px"><div class="skel" style="flex:1;height:40px;border-radius:6px"></div><div class="skel" style="flex:1;height:40px;border-radius:6px"></div><div class="skel" style="flex:1;height:40px;border-radius:6px"></div></div>
        </div>
      </div>
    );
  }
  return (
    <div style={`width:${w}px;height:${h}px;padding:24px;display:flex;flex-direction:column;gap:16px;box-sizing:border-box`}>
      {head}
      <div class="skel" style="width:60px;height:7px;margin-top:8px"></div>
      <div class="skel" style={`width:${size === 'rail' ? 190 : 260}px;height:36px`}></div>
      <div class="skel" style="width:120px;height:18px"></div>
      <div class="skel" style={`width:100%;height:${size === 'rail' ? 84 : 220}px;border-radius:6px`}></div>
      {[0, 1, 2, 3].map(() => <div class="skel" style="width:100%;height:30px;border-radius:6px"></div>)}
    </div>
  );
}

function errorCopy(err) {
  const k = err ? err.kind : 'network';
  const code = err && err.code ? err.code : '';
  const label = { 401: '401 Unauthorized', 403: '403 Forbidden', 429: '429 Too Many Requests' }[code] || (code ? `${code} error` : 'no response');
  return {
    title: { auth: 'API key expired or revoked', forbidden: 'Missing API permission', rate: 'Rate limited', server: 'Trading 212 is unavailable', network: 'Can’t reach Trading 212' }[k] || 'Sync failed',
    code: label,
    network: k === 'network',
    hint: k === 'forbidden' ? 'Give the key the Account data and Portfolio permissions.' : ''
  };
}

function ErrorBlock({ st, now, compact }) {
  const c = errorCopy(st.error);
  const secs = st.error && st.error.retryAt ? Math.max(0, Math.round((st.error.retryAt - now) / 1000)) : null;
  const hasData = !!st.data;
  return (
    <div style={`display:flex;flex-direction:column;justify-content:center;gap:${compact ? 9 : 12}px`}>
      <div style="display:flex;align-items:center;gap:9px">
        <i class="ph ph-warning-circle" style={`font-size:17px;color:${DOWN}`}></i>
        <span style={`font:500 ${compact ? 13 : 14}px/1.2 ${F};color:var(--color-neutral-200)`}>{c.title}</span>
      </div>
      <p style={`font:400 ${compact ? 11.5 : 12.5}px/1.6 ${F};color:var(--color-neutral-400);margin:0;max-width:36ch`}>
        {c.network ? 'No answer from Trading 212 — check your internet connection.' : <>Trading 212 returned <span class="mono" style={`font-size:${compact ? 10.5 : 11.5}px;color:${DOWN}`}>{c.code}</span>.</>}
        {' '}{c.hint}{hasData ? ' Values are from the last successful sync and are no longer live.' : ''}</p>
      <div style="display:flex;gap:9px;margin-top:4px">
        <Btn kind="primary" onClick={() => api.openSettings('account')}>Reconnect</Btn>
        <Btn kind="ghost" onClick={() => api.refresh()} style="color:var(--color-neutral-400)">Retry</Btn>
      </div>
      {secs != null && <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600);margin-top:2px`}>Next automatic retry in {secs} s</span>}
    </div>
  );
}

function ErrorView({ size, m, st, now }) {
  const [w, h] = DIMS[size];
  const last = m.d ? (
    <>
      <Eyebrow size={10} mb={9}>Last known · {hhmm(st.lastSync)}</Eyebrow>
      <div style="display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;opacity:.6">
        <span style={`font:300 ${size === 'small' ? 28 : 34}px/1 ${F};letter-spacing:-.03em;color:var(--color-neutral-300)`}>{m.sp.int}</span>
        <span style={`font:400 12px/1 ${F};color:var(--color-neutral-600)`}>{m.cur}</span>
      </div>
    </>
  ) : <Eyebrow size={10}>No data yet</Eyebrow>;
  const flat = m.d ? (
    <svg viewBox="0 0 250 40" width="100%" height="40" preserveAspectRatio="none" style="display:block;opacity:.3">
      <path d={linePath(m.values, 250, 40, 4)} fill="none" stroke="var(--color-neutral-600)" stroke-width="1.3"></path>
    </svg>
  ) : null;
  const head = label => (
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:22px">
      <Tile px={22} muted />
      <span style={`font:500 12px/1 ${F};color:var(--color-neutral-500)`}>{label}</span>
    </div>
  );
  if (size === 'medium' || size === 'large') {
    return (
      <div style={`width:${w}px;height:${h}px;padding:22px 24px;display:grid;grid-template-columns:250px 1fr;gap:26px;box-sizing:border-box;${size === 'large' ? 'grid-template-rows:1fr' : ''}`}>
        <div style="display:flex;flex-direction:column">
          {head(size === 'large' ? 'Trading 212 · Invest' : 'Invest · Portfolio')}
          {last}
          <span style="flex:1"></span>
          {flat}
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;padding-left:24px;border-left:1px solid rgba(233,233,237,.08)">
          <ErrorBlock st={st} now={now} />
        </div>
      </div>
    );
  }
  return (
    <div style={`width:${w}px;height:${h}px;padding:20px;display:flex;flex-direction:column;box-sizing:border-box`}>
      {head('Portfolio')}
      {last}
      <div style={`margin-top:${size === 'rail' ? 40 : 16}px;padding-top:${size === 'rail' ? 20 : 14}px;border-top:1px solid rgba(233,233,237,.08)`}>
        <ErrorBlock st={st} now={now} compact />
      </div>
      {size === 'rail' && <><span style="flex:1"></span>{flat}</>}
    </div>
  );
}

function Connect({ st, settings }) {
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
    if (!r.ok) setErr(r.message || 'Could not connect.');
  };
  const cur = settings.displayCurrency === 'account' ? 'Account' : settings.displayCurrency;
  return (
    <div style="width:620px;height:304px;padding:26px 28px;display:flex;flex-direction:column;gap:13px;box-sizing:border-box;position:relative">
      <div class="loop" style="position:absolute;width:260px;height:260px;left:-90px;top:-130px;border-radius:50%;background:radial-gradient(circle,rgba(var(--acc-rgb),.22),transparent 70%);filter:blur(14px);animation:nglow 8s ease-in-out infinite;pointer-events:none"></div>
      <div style="position:relative;display:flex;align-items:center;gap:9px">
        <Tile px={24} />
        <span style={`font:500 13px/1 ${F};color:var(--color-neutral-200)`}>Connect your account</span>
        <span style="flex:1"></span>
        <div class="ia" style="display:flex;gap:2px;padding:2px;border-radius:6px;background:rgba(233,233,237,.045);box-shadow:inset 0 0 0 1px rgba(233,233,237,.05)">
          {['live', 'demo'].map(e => (
            <button type="button" class="ia" onClick={() => setEnv(e)} style={`border:0;cursor:pointer;padding:4px 9px;border-radius:4px;font:500 10px/1 ${F};transition:background .25s ease,color .25s ease;` +
              (env === e ? 'background:var(--color-accent-900);color:var(--color-accent-200);box-shadow:inset 0 0 0 1px var(--color-accent-800)' : 'background:transparent;color:var(--color-neutral-500)')}>{e === 'live' ? 'Live' : 'Practice'}</button>
          ))}
        </div>
      </div>
      <p style={`position:relative;font:400 12.5px/1.55 ${F};color:var(--color-neutral-400);margin:0;max-width:62ch`}>
        Both keys come from Trading 212 → Settings → API. {st.encrypted ? 'Encrypted on this PC with Windows DPAPI' : 'Stored locally on this PC'}, read-only permissions are enough.</p>
      <form class="ia" onSubmit={e => { e.preventDefault(); go(); }} style="position:relative;display:flex;flex-direction:column;gap:13px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:520px">
          <div style="display:flex;flex-direction:column;gap:5px">
            <label style={`display:flex;align-items:center;height:11px;font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-500)`}>API key</label>
            <input class="input mono" type="text" value={key} spellcheck={false} autoFocus placeholder="Paste API key" onInput={e => setKey(e.currentTarget.value)} style="width:100%;font-size:12px" />
          </div>
          <div style="display:flex;flex-direction:column;gap:5px">
            <label style={`display:flex;align-items:center;height:11px;gap:5px;font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-500)`}>Secret key<i class="ph ph-lock-simple" style="font-size:11px;color:var(--color-accent-400)"></i></label>
            <div style="position:relative;display:flex;align-items:center">
              <input class="input mono" type={show ? 'text' : 'password'} value={secret} spellcheck={false} placeholder="Paste secret" onInput={e => setSecret(e.currentTarget.value)} style="width:100%;padding-right:30px;font-size:12px" />
              <i class={'ph hov-icon ia ' + (show ? 'ph-eye-slash' : 'ph-eye')} onClick={() => setShow(s => !s)} style="position:absolute;right:9px;font-size:14px;color:var(--color-neutral-500)"></i>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:2px;min-height:30px">
          <button type="submit" class="btn btn-primary ia" disabled={busy || !key.trim() || !secret.trim()} style="font-size:13px;padding:6px 12px">Connect</button>
          {busy && (
            <span style="display:flex;gap:8px;align-items:center">
              <span style="width:15px;height:15px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box"></span>
              <span style={`font:400 11.5px/1 ${F};color:var(--color-neutral-400)`}>Verifying key pair · fetching account currency</span>
            </span>
          )}
          {!busy && err && (
            <span style={`display:flex;gap:7px;align-items:center;font:400 11.5px/1.4 ${F};color:${DOWN};max-width:420px`}>
              <i class="ph ph-warning-circle" style="font-size:14px;flex:none"></i>{err}</span>
          )}
        </div>
      </form>
      <span style="flex:1"></span>
      <div style="position:relative;display:flex;gap:20px;padding-top:14px;border-top:1px solid rgba(233,233,237,.08)">
        <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>Refresh every <span style="color:var(--color-accent-300)">{settings.refreshSeconds} s</span></span>
        <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>Display currency <span style="color:var(--color-accent-300)">{cur}</span></span>
        <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>Read-only scope</span>
        <span style="flex:1"></span>
        <span class="ia hov-icon" onClick={() => api.openSettings()} style={`font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}>More settings</span>
      </div>
    </div>
  );
}

// ── app ──────────────────────────────────────────────────────
function App({ init }) {
  const [st, setSt] = useState(init.state);
  const [settings, setSettings] = useState(init.settings);
  const now = useNow(1000);
  useEffect(() => { api.onState(setSt); api.onSettings(setSettings); }, []);
  useEffect(() => applyTheme(settings.theme, settings.accent, settings.tint), [settings.theme, settings.accent, settings.tint]);
  useEffect(() => applyMotion(settings.motion), [settings.motion]);

  // click-through outside the card; manual dragging on the card
  useEffect(() => {
    let inside = null;
    const mv = e => {
      const i = !!(e.target && e.target.closest && e.target.closest('.wg'));
      if (i !== inside) { inside = i; api.setIgnoreMouse(!i); }
    };
    window.addEventListener('mousemove', mv);
    api.setIgnoreMouse(true);
    return () => window.removeEventListener('mousemove', mv);
  }, []);
  const dragging = useRef(false);
  const onDown = useCallback(e => {
    if (e.button !== 0 || settings.lockPosition) return;
    if (e.target.closest('.ia, button, input, a, label, form, .menu')) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    api.drag('start');
  }, [settings.lockPosition]);
  const onMove = useCallback(() => { if (dragging.current) api.drag('move'); }, []);
  const onUp = useCallback(e => {
    if (!dragging.current) return;
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    api.drag('end');
  }, []);

  const m = useModel(st, settings);
  const status = st.status;
  let size = settings.size;
  let body;
  if (status === 'first-run') { size = 'medium'; body = <Connect st={st} settings={settings} />; }
  else if (!st.data && status !== 'error') body = <Loading size={size} />;
  else if (status === 'error') body = <ErrorView size={size} m={m} st={st} now={now} />;
  else {
    const closed = status === 'closed';
    const P = { m, st: { ...st, range: settings.range }, now, closed, settings };
    body = size === 'small' ? <Small {...P} /> : size === 'large' ? <Large {...P} /> : size === 'rail' ? <Rail {...P} /> : <Medium {...P} />;
  }
  const [w, h] = DIMS[size] || DIMS.medium;
  return (
    <div class="stage">
      <div key={size + (status === 'first-run' ? '-fr' : '')} class={'wg' + (settings.lockPosition ? '' : ' draggable')} style={`width:${w}px;height:${h}px`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {body}
        {status !== 'first-run' && <CornerMenu settings={settings} />}
      </div>
    </div>
  );
}

api.init().then(init => {
  applyTheme(init.settings.theme, init.settings.accent, init.settings.tint);
  applyMotion(init.settings.motion);
  render(<App init={init} />, document.getElementById('root'));
});
