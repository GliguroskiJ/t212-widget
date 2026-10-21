// The full app window: overview, holdings, instrument detail, activity, pending orders, pies,
// CSV reports and settings. Same Nocturne design, components and theme as the widget.
// Read-only — nothing here can place, change or cancel an order or a pie.
import { render, createContext } from 'preact';
import { useState, useEffect, useRef, useMemo, useContext, useCallback } from 'preact/hooks';
import { UP, DOWN, applyTheme, ditheredBg, applyMotion, makeFmt, agoStr, hhmm, linePath, accentRamp, tint } from './shared.js';
import { t, setLang, locale } from './i18n.js';
import {
  F, useNow, Tile, Mark, Dot, Eyebrow, FillChart, Chart, RangeChips, useModel, Pill, GrowBar, axisLabels, Alloc, Connect, errorCopy
} from './ui.jsx';
import { SETTINGS_TABS, setMac, Seg, AccountTab, AppearanceTab, DataTab, SystemTab, WidgetTab } from './settings-tabs.jsx';

const api = window.api;
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);
let MAC = false;

// ── data hooks ───────────────────────────────────────────────
// Calls a library method in main; re-runs when one of the `on` kinds changes there.
function useLib(method, args, deps = [], on = []) {
  const { libTick } = useApp();
  const [res, setRes] = useState({ data: null, err: null, loading: true });
  const [n, setN] = useState(0);
  const tick = on.length ? on.map(k => libTick[k] || 0).join(':') : '';
  useEffect(() => {
    let live = true;
    setRes(r => ({ ...r, loading: true }));
    api.lib(method, args).then(r => {
      if (!live) return;
      if (r && r.error) setRes(p => ({ data: p.data, err: r.error, loading: false }));
      else setRes({ data: r, err: null, loading: false });
    });
    return () => { live = false; };
  }, [...deps, tick, n]);
  return { ...res, reload: () => setN(x => x + 1) };
}

const dfmt = (ts, opt) => (ts ? new Date(ts).toLocaleDateString(locale(), opt || { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dtfmt = ts => (ts ? dfmt(ts) + ' ' + hhmm(ts) : '—');
const monthLabel = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(locale(), { month: 'short' }); };

// ── small pieces ─────────────────────────────────────────────
const Card = ({ title, right, children, style = '', pad = 18, cls = '' }) => (
  <section class={'card ' + cls} style={`padding:${pad}px;${style}`}>
    {(title || right) && (
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;min-height:20px">
        {title && <span class="card-title">{title}</span>}
        <span style="flex:1"></span>
        {right}
      </div>
    )}
    {children}
  </section>
);

const More = ({ onClick, children }) => <a class="link" onClick={onClick}>{children}<i class="ph ph-caret-right"></i></a>;

const Kpi = ({ label, value, sub, color, title, onClick }) => (
  <div class={'card kpi' + (onClick ? ' click' : '')} title={title || ''} onClick={onClick}>
    <span style={`font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-600)`}>{label}</span>
    <span style={`font:400 18px/1.1 ${F};letter-spacing:-.02em;color:${color || 'var(--color-neutral-100)'};font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`}>{value}</span>
    {sub && <span style={`font:400 11px/1.2 ${F};color:var(--color-neutral-500);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`}>{sub}</span>}
  </div>
);

const Chip = ({ children, color, bg }) => (
  <span style={`display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border-radius:4px;font:500 10.5px/1 ${F};white-space:nowrap;color:${color || 'var(--color-neutral-400)'};background:${bg || 'rgba(var(--ink-rgb),.06)'}`}>{children}</span>
);
const Side = ({ side }) => side === 'SELL'
  ? <Chip color={DOWN} bg={tint(DOWN)}>{t('Sell')}</Chip>
  : <Chip color={UP} bg={tint(UP)}>{t('Buy')}</Chip>;

const Spinner = ({ size = 14 }) => <span style={`width:${size}px;height:${size}px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box;display:inline-block;flex:none`}></span>;

function Empty({ icon = 'ph-tray', title, text, children }) {
  return (
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:46px 20px;text-align:center">
      <span class="empty-ico"><i class={'ph ' + icon}></i></span>
      <span style={`font:500 13px/1.3 ${F};color:var(--color-neutral-200)`}>{title}</span>
      {text && <span style={`font:400 12px/1.55 ${F};color:var(--color-neutral-500);max-width:52ch`}>{text}</span>}
      {children}
    </div>
  );
}

// a section that needs an API permission the key may not have
function Gate({ status, perm, children, loading, retry, inCard }) {
  if (status && status.state === 'forbidden') {
    const body = (
      <Empty icon="ph-lock-simple" title={t('The API key is missing “{p}”', { p: perm })}
        text={t('Create a new key in Trading 212 → Settings → API (Beta) with this permission ticked and paste it in Settings → Account. Everything else keeps working.')}>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn btn-primary" style="font-size:12.5px" onClick={() => useNav().go('settings', 'account')}>{t('Open settings')}</button>
          {retry && <button class="btn btn-ghost" style="font-size:12.5px" onClick={retry}>{t('Check again')}</button>}
        </div>
      </Empty>
    );
    return inCard ? body : <section class="card gate" style="grid-column:1/-1">{body}</section>;
  }
  if (loading) return <div style="display:flex;justify-content:center;padding:40px"><Spinner size={18} /></div>;
  return children;
}

let navRef = null;
const useNav = () => navRef;

// distinct colours for charts and allocation (not tied to the accent, so slices are easy to tell apart)
export const CAT = ['#8b9cff', '#5fd4b0', '#f5b85c', '#f2789f', '#b48cff', '#4fc3e8', '#e8875a', '#a8d672'];
const OTHER = '#5a5e6e';
const catColor = i => CAT[i % CAT.length];
// colour of a holding = its place by value (same as in the allocation donut)
const holdColor = (ticker, positions) => { const i = positions.findIndex(p => p.ticker === ticker); return i < 0 ? OTHER : i < CAT.length ? catColor(i) : OTHER; };

// company logos (Trading 212 icon store via main, cached on disk) — batched, shared by all rows
const logoStore = { map: {}, pending: new Set(), subs: new Set(), timer: null };
function requestLogo(tk) {
  if (!tk || tk in logoStore.map || logoStore.pending.has(tk)) return;
  logoStore.pending.add(tk);
  clearTimeout(logoStore.timer);
  logoStore.timer = setTimeout(async () => {
    const list = [...logoStore.pending];
    logoStore.pending.clear();
    const r = await api.lib('logos', { tickers: list });
    for (const tk of list) logoStore.map[tk] = (r && !r.error && r[tk]) || null;
    logoStore.subs.forEach(f => f());
  }, 40);
}
function useLogo(tk) {
  const [, set] = useState(0);
  useEffect(() => { const f = () => set(x => x + 1); logoStore.subs.add(f); requestLogo(tk); return () => logoStore.subs.delete(f); }, [tk]);
  return logoStore.map[tk];
}
function Logo({ ticker, sym, lg, badge, badgeColor }) {
  const src = useLogo(ticker);
  return (
    <span class={'sym' + (lg ? ' lg' : '') + (src ? ' img' : '')}>
      {src ? <img src={src} alt="" draggable={false} /> : (sym || '?').slice(0, 4)}
      {badge && <i class={'sym-badge ph ' + badge} style={badgeColor ? `color:${badgeColor}` : ''}></i>}
    </span>
  );
}

// small toasts (bottom right)
let toastRef = null;
const toast = (text, icon = 'ph-check-circle') => toastRef && toastRef(text, icon);
function Toasts() {
  const [list, setList] = useState([]);
  toastRef = (text, icon) => {
    const id = Math.random();
    setList(l => [...l.slice(-2), { id, text, icon }]);
    setTimeout(() => setList(l => l.map(x => (x.id === id ? { ...x, out: true } : x))), 2600);
    setTimeout(() => setList(l => l.filter(x => x.id !== id)), 3000);
  };
  return <div class="toasts">{list.map(x => <div key={x.id} class={'toast' + (x.out ? ' out' : '')}><i class={'ph ' + x.icon}></i>{x.text}</div>)}</div>;
}

function Sparkline({ values, color, w = 72, h = 20 }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} preserveAspectRatio="none" style="display:block;flex:none">
      <path d={linePath(values && values.length > 1 ? values : [1, 1], w, h, 2)} fill="none" stroke={color} stroke-width="1.2" stroke-linecap="round" pathLength="1" stroke-dasharray="1" style="animation:ndraw .9s ease both"></path>
    </svg>
  );
}

// monthly bars (dividends, deposits) with a hover tooltip
function Bars({ months, series, fmt, cur, height = 120 }) {
  const [hov, setHov] = useState(null);
  const max = Math.max(1e-9, ...months.map(k => series.reduce((a, s) => a + Math.abs(s.get(k) || 0), 0)));
  return (
    <div style="position:relative">
      <div style={`display:flex;align-items:flex-end;gap:4px;height:${height}px`} onMouseLeave={() => setHov(null)}>
        {months.map((k, i) => {
          const parts = series.map(s => ({ c: s.color, v: Math.abs(s.get(k) || 0) }));
          const tot = parts.reduce((a, p) => a + p.v, 0);
          return (
            <div onMouseEnter={() => setHov(i)} style="flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;cursor:default">
              <div style={`display:flex;flex-direction:column-reverse;height:${(tot / max) * 100}%;min-height:${tot ? 2 : 0}px;border-radius:3px;overflow:hidden;opacity:${hov == null || hov === i ? 1 : .45};transition:opacity .2s ease,height .9s cubic-bezier(.3,1,.3,1)`}>
                {parts.map(p => <div style={`flex:${p.v};background:${p.c}`}></div>)}
              </div>
            </div>
          );
        })}
      </div>
      <div style="display:flex;gap:4px;margin-top:7px">
        {months.map((k, i) => <span style={`flex:1;text-align:center;font:400 9.5px/1 ${F};color:var(--color-neutral-${hov === i ? 300 : 600})`}>{months.length > 14 && i % 2 ? '' : monthLabel(k)}</span>)}
      </div>
      {hov != null && (
        <div class="chart-tip" style={`position:absolute;top:-6px;left:${((hov + 0.5) / months.length) * 100}%;transform:translate(-50%,-100%);pointer-events:none;white-space:nowrap;padding:7px 9px 6px;border-radius:7px;background:rgba(10,11,18,.84);backdrop-filter:blur(10px);box-shadow:0 6px 18px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.07);z-index:5`}>
          <div style={`font:500 11px/1 ${F};color:var(--color-neutral-300);margin-bottom:5px`}>{(() => { const [y, m] = months[hov].split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }); })()}</div>
          {series.map(s => <div style={`display:flex;gap:8px;align-items:center;font:400 11px/1.5 ${F};color:var(--color-neutral-200);font-variant-numeric:tabular-nums`}>
            <span style={`width:7px;height:7px;border-radius:2px;background:${s.color}`}></span>{s.label} <span style="margin-left:auto">{fmt(s.get(months[hov]) || 0, 0)} {cur}</span></div>)}
        </div>
      )}
    </div>
  );
}
function lastMonths(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}

// donut + legend from any list of {label, value}
function Donut({ items, fmt, center, centerLabel, size = 170 }) {
  const total = items.reduce((a, x) => a + Math.max(0, x.value), 0) || 1;
  let list = items.filter(x => x.value > 0).sort((a, b) => b.value - a.value).map(x => ({ ...x, weight: (x.value / total) * 100 }));
  if (list.length > 6) {
    const rest = list.slice(5).reduce((a, x) => a + x.weight, 0);
    list = list.slice(0, 5).concat([{ label: t('Other'), weight: rest, other: true }]);
  }
  const maxS = Math.max(1, ...list.map(s => s.weight));
  const m = {
    fmt, d: { invested: center },
    slices: list.map((s, i) => ({ sym: s.label, weight: s.weight, color: s.other ? OTHER : catColor(i), allocStr: fmt(s.weight, 1), barW: (s.weight / maxS) * 88 + '%' }))
  };
  return <div class="donut" style={`--dsize:${size}px`}><Alloc m={m} key={list.map(x => x.label).join()} />{centerLabel && <span class="donut-lbl">{centerLabel}</span>}</div>;
}

// ── sortable table ───────────────────────────────────────────
function Table({ cols, rows, sort, setSort, onRow, empty, rowKey }) {
  return (
    <div class="tbl">
      <div class="tr th">
        {cols.map(c => (
          <span class={'td' + (c.sort ? ' sortable' : '')} style={`flex:${c.flex || 1};${c.w ? `flex:none;width:${c.w}px;` : ''}text-align:${c.align || 'left'}`}
            onClick={c.sort ? () => setSort(s => ({ key: c.sort, dir: s.key === c.sort ? -s.dir : -1 })) : undefined}>
            {c.label}{sort && sort.key === c.sort && <i class={'ph ' + (sort.dir < 0 ? 'ph-caret-down' : 'ph-caret-up')} style="font-size:10px;margin-left:3px"></i>}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={rowKey ? rowKey(r) : i} class={'tr' + (onRow ? ' click' : '')} onClick={onRow ? () => onRow(r) : undefined}>
          {cols.map(c => <span class="td" style={`flex:${c.flex || 1};${c.w ? `flex:none;width:${c.w}px;` : ''}text-align:${c.align || 'left'};${c.style ? c.style(r) : ''}`}>{c.render(r)}</span>)}
        </div>
      ))}
      {!rows.length && empty}
    </div>
  );
}
function sortRows(rows, sort) {
  if (!sort || !sort.key) return rows;
  return rows.slice().sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (typeof x === 'string' || typeof y === 'string') return String(x || '').localeCompare(String(y || '')) * sort.dir * -1;
    return ((x ?? -Infinity) - (y ?? -Infinity)) * sort.dir;
  });
}

const SymCell = ({ sym, name, ticker, dot }) => (
  <span class="sc" style="display:flex;align-items:center;gap:10px;min-width:0">
    <Logo ticker={ticker} sym={sym} />
    {dot && <span style={`width:6px;height:6px;border-radius:50%;flex:none;margin-left:-4px;background:${dot}`}></span>}
    <span style="display:flex;flex-direction:column;gap:3px;min-width:0">
      <span style={`font:500 12.5px/1.1 ${F};color:var(--color-neutral-100);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{sym}</span>
      <span style={`font:400 11px/1.1 ${F};color:var(--color-neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{name}</span>
    </span>
  </span>
);

// ── pages ────────────────────────────────────────────────────
const APP_RANGES = ['1D', '1W', '1M', '1Y', 'ALL'];

function Hero({ m, closed, range, setRange }) {
  const { d } = m;
  return (
    <Card style="grid-column:1/-1;display:flex;flex-direction:column;min-height:330px" pad={22}>
      <div style="display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap">
        <div style="display:flex;flex-direction:column;gap:10px">
          <Eyebrow size={10}>{closed ? t('At close') : t('Total value')}</Eyebrow>
          <div style={`display:flex;align-items:baseline;gap:5px;font-variant-numeric:tabular-nums;white-space:nowrap`}>
            <span style={`font:300 46px/1 ${F};letter-spacing:-.035em`}>{m.sp.int}</span>
            <span style={`font:300 22px/1 ${F};color:var(--color-neutral-500)`}>{m.fmt.dec}{m.sp.dec}</span>
            <span style={`font:400 14px/1 ${F};color:var(--color-neutral-500);margin-left:4px`}>{m.cur}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <Pill m={m} closed={closed} size={12.5} icon={11} pad="4px 8px 4px 6px" extra={' · ' + m.chgAbsStr} />
            <span style={`font:400 12px/1 ${F};color:var(--color-neutral-500)`}>{m.chgLabel}</span>
          </div>
        </div>
        <span style="flex:1"></span>
        <div style="display:flex;gap:6px;align-self:flex-start"><RangeChips range={range} onPick={setRange} list={APP_RANGES} size={11} padX={9} /></div>
      </div>
      <FillChart values={m.values} tipFor={m.tipFor} rangeFor={m.rangeFor} pad={14} sw={2} color={m.trend} gid="gApp" gop={.3} glowPx={8} marker mr={3} pr={5.5}
        draw={1.3} fade={1.3} fadeDelay={.3} closed={closed} animKey={range} wrapStyle="margin-top:16px;min-height:180px"
        grid={(w, h) => [0.25, 0.5, 0.75].map(f => <line x1="0" y1={h * f} x2={w} y2={h * f} stroke="rgba(var(--ink-rgb),.055)" stroke-dasharray="2 5"></line>)} />
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        {axisLabels(d.series, range).map(l => <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>{l}</span>)}
      </div>
    </Card>
  );
}

function Overview({ m, closed }) {
  const { settings, setAppRange, st, nav, libTick } = useApp();
  const d = m.d;
  const stats = useLib('stats', {}, [], ['orders', 'dividends', 'transactions', 'account']);
  const act = useLib('recent', { limit: 8 }, [], ['orders', 'dividends', 'transactions', 'account']);
  const quotes = useLib('quotes', { positions: d.positions.map(p => ({ ticker: p.ticker, isin: p.isin, price: p.price })) }, [d.positions.map(p => p.ticker).join()]);
  const [allocBy, setAllocBy] = useState('holding');
  const fx = d.fx || 1;
  const S = stats.data;
  const cur = d.currency;
  const money = (v, dd = 0) => (v == null ? '—' : m.fmt(v, dd) + ' ' + cur);
  const allocItems = useMemo(() => {
    if (allocBy === 'holding') return d.positions.map(p => ({ label: p.sym, value: p.value }));
    const key = allocBy === 'currency' ? p => p.avgCur || '?' : p => marketName(p.ticker);
    const acc = {};
    for (const p of d.positions) acc[key(p)] = (acc[key(p)] || 0) + p.value;
    if (d.cash > 0 && allocBy === 'currency') acc[t('Cash') + ' ' + d.accountCurrency] = (acc[t('Cash') + ' ' + d.accountCurrency] || 0) + d.cash;
    return Object.entries(acc).map(([label, value]) => ({ label, value }));
  }, [allocBy, d.positions, d.cash]);
  const q = quotes.data || {};
  const movers = d.positions.filter(p => q[p.ticker]).map(p => ({ ...p, day: q[p.ticker].pct })).sort((a, b) => Math.abs(b.day) - Math.abs(a.day)).slice(0, 6);
  return (
    <div class="grid">
      <Hero m={m} closed={closed} range={settings.appRange || '1M'} setRange={setAppRange} />
      <div class="kpis" style="grid-column:1/-1">
        <Kpi label={t('Free cash')} value={money(d.cash)} sub={d.reserved || d.inPies ? t('{a} reserved · {b} in pies', { a: m.fmt(d.reserved || 0, 0), b: m.fmt(d.inPies || 0, 0) }) : t('available to invest')} />
        <Kpi label={t('Invested')} value={money(d.invested)} sub={t('cost {v}', { v: money(d.totalCost) })} />
        <Kpi label={t('Unrealised P/L')} value={(d.unrealizedPL >= 0 ? '+' : '') + money(d.unrealizedPL)} color={d.unrealizedPL >= 0 ? UP : DOWN} sub={m.fmt.signed(d.totalCost ? d.unrealizedPL / d.totalCost * 100 : 0, 2) + ' %'} onClick={() => nav.go('holdings')} />
        <Kpi label={t('Realised P/L')} value={(d.realizedPL >= 0 ? '+' : '') + money(d.realizedPL)} color={d.realizedPL >= 0 ? UP : DOWN} sub={t('all-time {v} · {p} %', { v: m.allTimeStr, p: m.allTimePctStr })} onClick={() => nav.go('activity', 'orders')} />
        <Kpi label={t('Dividends YTD')} value={m.divStr} title={m.divTitle} sub={S && S.dividends.count ? t('{v} in total', { v: money(S.dividends.total * fx) }) : t('this calendar year')} onClick={() => nav.go('activity', 'dividends')} />
        <Kpi label={t('Net deposits')} value={S && S.cash.complete ? money(S.cash.net * fx) : S && S.cash.net ? money(S.cash.net * fx) : '—'}
          sub={S && (S.cash.deposits || S.cash.withdrawals) ? t('in {a} · out {b}', { a: m.fmt(S.cash.deposits * fx, 0), b: m.fmt(S.cash.withdrawals * fx, 0) }) : (st.lib && st.lib.transactions && st.lib.transactions.state === 'forbidden' ? t('needs History – Transactions') : t('loading history…'))}
          onClick={() => nav.go('activity', 'transactions')} />
      </div>

      <Card title={t('Holdings')} right={<More onClick={() => nav.go('holdings')}>{t('All {n}', { n: d.positions.length })}</More>} style="grid-column:span 7">
        <div style="display:flex;flex-direction:column;gap:2px">
          {d.positions.slice(0, 7).map(p => (
            <div class="lrow click" onClick={() => nav.go('instrument', p.ticker)}>
              <SymCell sym={p.sym} name={p.name} ticker={p.ticker} />
              <Sparkline values={p.spark} color={p.plPct >= 0 ? UP : DOWN} />
              <span class="num" style="width:110px;text-align:right">{m.fmt(p.value, 0)}</span>
              <span class="num" style={`width:70px;text-align:right;color:${p.plPct >= 0 ? UP : DOWN}`}>{m.fmt.signed(p.plPct, 2)}%</span>
            </div>
          ))}
          {!d.positions.length && <Empty icon="ph-chart-pie-slice" title={t('No open positions yet.')} />}
        </div>
      </Card>
      <Card title={t('Allocation')} style="grid-column:span 5" right={<Seg value={allocBy} onChange={setAllocBy} size={10.5} options={[['holding', t('Holding')], ['currency', t('Currency')], ['market', t('Market')]]} />}>
        <Donut items={allocItems} fmt={m.fmt} center={allocBy === 'currency' ? d.invested + d.cash : d.invested} />
      </Card>

      <Card title={t('Today’s movers')} style="grid-column:span 5" right={<>{quotes.loading && !quotes.data ? <Spinner size={12} /> : <span class="muted">{t('vs. previous close')}</span>}<More onClick={() => nav.go('holdings')}>{t('Holdings')}</More></>}>
        {movers.length ? movers.map(p => (
          <div class="lrow click" onClick={() => nav.go('instrument', p.ticker)}>
            <SymCell sym={p.sym} name={p.name} ticker={p.ticker} />
            <span class="num" style="width:112px;text-align:right;color:var(--color-neutral-400)">{m.fmt(q[p.ticker].last, 2)} {q[p.ticker].currency || ''}</span>
            <span style="width:76px;display:flex;justify-content:flex-end"><Chip color={p.day >= 0 ? UP : DOWN} bg={tint(p.day >= 0 ? UP : DOWN)}>{m.fmt.signed(p.day, 2)}%</Chip></span>
          </div>
        )) : <Empty icon="ph-pulse" title={quotes.loading ? t('Loading prices…') : t('No price data')} text={quotes.loading ? '' : t('Day moves come from Yahoo Finance and may be missing for some instruments.')} />}
      </Card>
      <Card title={t('Recent activity')} style="grid-column:span 7" right={<More onClick={() => nav.go('activity')}>{t('Activity')}</More>}>
        {act.data && act.data.length ? act.data.map(x => <ActivityRow x={x} fmt={m.fmt} fx={fx} cur={cur} compact />)
          : <Empty icon="ph-clock-counter-clockwise" title={act.loading || (st.lib && st.lib.syncing) ? t('Downloading your history…') : t('No activity yet')}
            text={t('Trades, dividends and deposits appear here once the history is downloaded.')} />}
      </Card>
    </div>
  );
}

const MARKET_NAMES = { US: 'USA', DE: 'Německo', GB: 'UK', FR: 'Francie', NL: 'Nizozemsko', ES: 'Španělsko', IT: 'Itálie', CH: 'Švýcarsko', BE: 'Belgie', IE: 'Irsko', AT: 'Rakousko', CZ: 'Česko', CA: 'Kanada', HK: 'Hongkong', PT: 'Portugalsko' };
const MARKET_EN = { US: 'USA', DE: 'Germany', GB: 'UK', FR: 'France', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', CH: 'Switzerland', BE: 'Belgium', IE: 'Ireland', AT: 'Austria', CZ: 'Czechia', CA: 'Canada', HK: 'Hong Kong', PT: 'Portugal' };
function marketName(ticker) {
  let m = /_([A-Z]{2})_EQ$/.exec(ticker || '');
  let code = m ? m[1] : null;
  if (!code) { m = /([a-z])_EQ$/.exec(ticker || ''); code = m ? ({ d: 'DE', l: 'GB', p: 'FR', a: 'NL', e: 'ES', m: 'IT', s: 'CH', b: 'BE', i: 'IE', v: 'AT', h: 'HK' }[m[1]] || null) : null; }
  if (!code) return t('Other');
  return (locale() === 'cs-CZ' ? MARKET_NAMES : MARKET_EN)[code] || code;
}

// one row of the activity feed (trade, dividend or cash movement)
const TX_LABEL = () => ({ DEPOSIT: t('Deposit'), WITHDRAW: t('Withdrawal'), FEE: t('Fee'), TRANSFER: t('Transfer'), INTEREST_ON_FREE_CASH: t('Interest on cash'), LENDING_INTEREST: t('Lending interest') });
function ActivityRow({ x, fmt, fx, cur, compact }) {
  const nav = useNav();
  const conv = v => (v == null ? null : v * fx);
  if (x.kind === 'dividends') {
    return (
      <div class="lrow click" onClick={() => nav.go('instrument', x.ticker)}>
        <Logo ticker={x.ticker} sym={x.sym} badge="ph-coins" badgeColor={UP} />
        <span style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1">
          <span class="t1">{t('Dividend')} · {x.sym}</span>
          <span class="t2">{dfmt(x.time)}{x.qty ? ' · ' + t('{q} shares × {p} {c}', { q: fmt(x.qty, x.qty % 1 ? 3 : 0), p: fmt(x.perShare || 0, 4), c: x.tickerCurrency || '' }) : ''}</span>
        </span>
        <span class="num amt" style={`color:${UP}`}>+{fmt(conv(x.amount), 2)} {cur}</span>
      </div>
    );
  }
  if (x.kind === 'transactions') {
    const neg = x.type === 'WITHDRAW' || x.type === 'FEE' || x.amount < 0;
    const icon = x.type === 'DEPOSIT' || (x.type === 'TRANSFER' && x.amount >= 0) ? 'ph-arrow-down-left' : x.type === 'WITHDRAW' || x.type === 'TRANSFER' ? 'ph-arrow-up-right' : x.type === 'FEE' ? 'ph-receipt' : 'ph-percent';
    return (
      <div class="lrow">
        <span class="ico"><i class={'ph ' + icon}></i></span>
        <span style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1">
          <span class="t1">{x.type === 'TRANSFER' ? (x.amount >= 0 ? t('Deposit') : t('Withdrawal')) : (TX_LABEL()[x.type] || x.type)}</span>
          <span class="t2">{dtfmt(x.time)}{x.type === 'TRANSFER' ? ' · ' + (x.amount >= 0 ? t('from another Trading 212 account') : t('to another Trading 212 account')) : x.type === 'WITHDRAW' ? ' · ' + t('to bank or card payment') : ''}</span>
        </span>
        <span class="num amt" style={`color:${neg ? 'var(--color-neutral-300)' : UP}`}>{neg ? '−' : '+'}{fmt(Math.abs(x.currency && x.currency !== cur ? x.amount : conv(x.amount)), 2)} {x.currency && x.currency !== cur && fx === 1 ? x.currency : cur}</span>
      </div>
    );
  }
  const fillNote = x.fillType && x.fillType !== 'TRADE' ? ' · ' + x.fillType.replace(/_/g, ' ').toLowerCase() : '';
  const unfilled = x.fillType == null && !((x.qty || 0) > 0 && (x.status === 'FILLED' || x.status === 'PARTIALLY_FILLED'));
  if (unfilled) {
    const st = { CANCELLED: t('Cancelled'), REJECTED: t('Rejected'), EXPIRED: t('Expired') }[x.status] || t('Not executed');
    return (
      <div class="lrow click" style="opacity:.62" onClick={() => nav.go('instrument', x.ticker)}>
        <Logo ticker={x.ticker} sym={x.sym} badge="ph-x" badgeColor="var(--color-neutral-400)" />
        <span style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1">
          <span class="t1">{x.side === 'SELL' ? t('Sell order') : t('Buy order')} {x.sym}{!compact && <span style="color:var(--color-neutral-500);font-weight:400"> · {x.name}</span>}</span>
          <span class="t2">{dtfmt(x.time)}{x.reqQty ? ' · ' + fmt(x.reqQty, x.reqQty % 1 ? 4 : 0) + ' ' + t('pcs') : ''}{x.price ? ' @ ' + fmt(x.price, 2) + ' ' + (x.instrCur || '') : ''}{x.type ? ' · ' + typeName(x.type) : ''}</span>
        </span>
        <span class="amt" style="display:flex;justify-content:flex-end"><Chip>{st}</Chip></span>
      </div>
    );
  }
  return (
    <div class="lrow click" onClick={() => nav.go('instrument', x.ticker)}>
      <Logo ticker={x.ticker} sym={x.sym} badge={x.side === 'SELL' ? 'ph-arrow-up-right' : 'ph-arrow-down-left'} badgeColor={x.side === 'SELL' ? DOWN : UP} />
      <span style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1">
        <span class="t1">{x.side === 'SELL' ? t('Sold') : t('Bought')} {x.sym}{!compact && <span style="color:var(--color-neutral-500);font-weight:400"> · {x.name}</span>}</span>
        <span class="t2">{dtfmt(x.time)} · {fmt(x.qty || 0, (x.qty || 0) % 1 ? 4 : 0)} × {fmt(x.price || 0, 2)} {x.instrCur || ''}{x.type ? ' · ' + typeName(x.type) : ''}{fillNote}</span>
      </span>
      {!compact && <span class="num" style={`width:150px;text-align:right;color:${(x.realized || 0) >= 0 ? UP : DOWN}`} title={t('Realised P/L')}>{x.realized ? t('P/L {v}', { v: fmt.signed(conv(x.realized), 2) }) : ''}</span>}
      {!compact && <span class="num" style="width:130px;text-align:right;color:var(--color-neutral-500)" title={t('Fees and taxes of this trade (e.g. FX fee)')}>{x.fees ? t('fee {v}', { v: fmt(Math.abs(conv(x.fees)), 2) }) : ''}</span>}
      <span class="num amt">{fmt(Math.abs(conv(x.value) || 0), 2)} {cur}</span>
    </div>
  );
}
const typeName = ty => ({ MARKET: t('Market'), LIMIT: t('Limit'), STOP: t('Stop'), STOP_LIMIT: t('Stop limit') }[ty] || ty);

// ── holdings ─────────────────────────────────────────────────
function Holdings({ m }) {
  const { nav } = useApp();
  const d = m.d;
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'value', dir: -1 });
  const quotes = useLib('quotes', { positions: d.positions.map(p => ({ ticker: p.ticker, isin: p.isin, price: p.price })) }, [d.positions.map(p => p.ticker).join()]);
  const qq = quotes.data || {};
  const rows = sortRows(d.positions.filter(p => !q || (p.sym + ' ' + p.name + ' ' + (p.isin || '')).toLowerCase().includes(q.toLowerCase()))
    .map(p => ({ ...p, day: qq[p.ticker] ? qq[p.ticker].pct : null })), sort);
  const totPl = d.positions.reduce((a, p) => a + p.pl, 0);
  const cols = [
    { label: t('Instrument'), flex: 2.4, sort: 'sym', render: p => <SymCell sym={p.sym} name={p.name} ticker={p.ticker} /> },
    { label: t('Qty'), align: 'right', sort: 'qty', render: p => <span class="num">{m.fmt(p.qty, p.qty % 1 ? 4 : 0)}</span> },
    { label: t('Avg price'), align: 'right', sort: 'avg', render: p => <span class="num">{m.fmt(p.avg, 2)} <span class="muted">{p.avgCur}</span></span> },
    { label: t('Price'), align: 'right', sort: 'price', render: p => <span class="num">{m.fmt(p.price, 2)}</span> },
    { label: t('Today'), align: 'right', sort: 'day', render: p => p.day == null ? <span class="muted">{quotes.loading ? '…' : '—'}</span> : <span class="num" style={`color:${p.day >= 0 ? UP : DOWN}`}>{m.fmt.signed(p.day, 2)}%</span> },
    { label: t('Value'), align: 'right', sort: 'value', render: p => <span class="num" style="color:var(--color-neutral-100)">{m.fmt(p.value, 0)}</span> },
    { label: t('P/L'), align: 'right', sort: 'pl', render: p => <span class="num" style={`color:${p.pl >= 0 ? UP : DOWN}`}>{m.fmt.signed(p.pl, 0)}</span> },
    { label: '%', w: 74, align: 'right', sort: 'plPct', render: p => <span class="num" style={`color:${p.plPct >= 0 ? UP : DOWN}`}>{m.fmt.signed(p.plPct, 2)}%</span> },
    { label: t('Weight'), w: 80, align: 'right', sort: 'weight', render: p => (
      <span style="display:flex;align-items:center;gap:7px;justify-content:flex-end">
        <span style={`width:7px;height:7px;border-radius:2px;flex:none;background:${holdColor(p.ticker, d.positions)}`}></span>
        <span class="num">{m.fmt(p.weight, 1)}%</span></span>) }
  ];
  return (
    <div class="grid">
      <div class="kpis" style="grid-column:1/-1">
        <Kpi label={t('Positions')} value={d.positions.length} sub={t('{m} markets', { m: d.markets })} />
        <Kpi label={t('Value')} value={m.fmt(d.invested, 0) + ' ' + m.cur} sub={t('cost {v}', { v: m.fmt(d.totalCost, 0) + ' ' + m.cur })} />
        <Kpi label={t('Unrealised P/L')} value={m.fmt.signed(totPl, 0) + ' ' + m.cur} color={totPl >= 0 ? UP : DOWN} sub={m.fmt.signed(d.totalCost ? totPl / d.totalCost * 100 : 0, 2) + ' %'} />
        <Kpi label={t('Best')} value={rows.length ? [...d.positions].sort((a, b) => b.plPct - a.plPct)[0].sym : '—'} color={UP}
          sub={d.positions.length ? m.fmt.signed([...d.positions].sort((a, b) => b.plPct - a.plPct)[0].plPct, 2) + ' %' : ''} />
        <Kpi label={t('Worst')} value={d.positions.length ? [...d.positions].sort((a, b) => a.plPct - b.plPct)[0].sym : '—'} color={DOWN}
          sub={d.positions.length ? m.fmt.signed([...d.positions].sort((a, b) => a.plPct - b.plPct)[0].plPct, 2) + ' %' : ''} />
      </div>
      <Card style="grid-column:1/-1" title={t('All positions')} right={
        <div class="search sm"><i class="ph ph-magnifying-glass"></i><input class="input" placeholder={t('Filter')} value={q} onInput={e => setQ(e.currentTarget.value)} /></div>}>
        <Table cols={cols} rows={rows} sort={sort} setSort={setSort} rowKey={p => p.ticker} onRow={p => nav.go('instrument', p.ticker)}
          empty={<Empty icon="ph-chart-pie-slice" title={q ? t('Nothing matches “{q}”', { q }) : t('No open positions yet.')} />} />
      </Card>
      {d.positions.length > 0 && (
        <Card style="grid-column:1/-1" title={t('Portfolio composition')} right={<span class="muted">{t('share of invested value')}</span>}>
          <WeightBar positions={d.positions} fmt={m.fmt} cur={m.cur} />
        </Card>
      )}
    </div>
  );
}

// one horizontal bar split by holding, with a legend; hover shows the value
function WeightBar({ positions, fmt, cur }) {
  const { nav } = useApp();
  const [hov, setHov] = useState(null);
  const [on, setOn] = useState(false);
  useEffect(() => { const h = setTimeout(() => setOn(true), 80); return () => clearTimeout(h); }, []);
  const tot = positions.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  const segs = positions.filter(p => p.value > 0).map(p => ({ ...p, w: (p.value / tot) * 100, color: holdColor(p.ticker, positions) }));
  const h = hov != null ? segs[hov] : null;
  return (
    <div>
      <div class="wbar" onMouseLeave={() => setHov(null)}>
        {segs.map((s, i) => (
          <div class="wseg" onMouseEnter={() => setHov(i)} onClick={() => nav.go('instrument', s.ticker)}
            style={`width:${on ? s.w : 0}%;background:${s.color};opacity:${hov == null || hov === i ? 1 : .35};transition-delay:${i * 40}ms`}
            title={`${s.sym} · ${fmt(s.w, 1)} %`}></div>
        ))}
      </div>
      <div style="height:18px;margin-top:8px;font:400 11.5px/18px 'Inter',sans-serif;color:var(--color-neutral-400);font-variant-numeric:tabular-nums">
        {h ? <span><span style={`color:${h.color};font-weight:500`}>{h.sym}</span> · {h.name} · {fmt(h.value, 0)} {cur} · {fmt(h.w, 1)} %</span> : ''}
      </div>
      <div class="wlegend">
        {segs.map((s, i) => (
          <button class={'wleg' + (hov === i ? ' on' : '')} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => nav.go('instrument', s.ticker)}>
            <span style={`width:9px;height:9px;border-radius:3px;flex:none;background:${s.color}`}></span>
            <span style="color:var(--color-neutral-100);font-weight:500">{s.sym}</span>
            <span class="num" style="color:var(--color-neutral-400)">{fmt(s.w, 1)} %</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── instrument detail ────────────────────────────────────────
const PRICE_RANGES = ['1D', '1W', '1M', '3M', '1Y', '5Y', 'MAX'];
function priceTipTime(ts, r) {
  if (r === '1D') return hhmm(ts);
  if (r === '1W') return new Date(ts).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' ' + hhmm(ts);
  return dfmt(ts);
}

function Instrument({ ticker, m }) {
  const { nav } = useApp();
  const d = m.d;
  const pos = d.positions.find(p => p.ticker === ticker) || null;
  const [range, setRange] = useState('1Y');
  const info = useLib('instrument', { ticker }, [ticker], ['orders', 'dividends', 'instruments']);
  const I = info.data;
  const pr = useLib('prices', { ticker, isin: (pos && pos.isin) || (I && I.isin), range, refPrice: pos && pos.price }, [ticker, range]);
  const P = pr.data;
  const perf = useLib('performance', { ticker, isin: (pos && pos.isin) || (I && I.isin), refPrice: pos && pos.price }, [ticker]);
  const vals = P && P.pts && P.pts.length > 1 ? P.pts.map(p => p[1]) : null;
  const first = vals ? (range === '1D' && P.meta && P.meta.prevClose ? P.meta.prevClose : vals[0]) : null;
  const last = P ? P.last : null;
  const chg = vals ? last - first : 0;
  const up = chg >= 0;
  const pcur = (P && P.meta && P.meta.currency) || (I && I.currency) || (pos && pos.avgCur) || '';
  const tipFor = i => {
    const p = P.pts[i]; if (!p) return null;
    const c = p[1] - first;
    return { value: m.fmt(p[1], 2) + ' ' + pcur, time: priceTipTime(p[0], range), chg: m.fmt.signed(c, 2), pct: m.fmt.signed(first ? c / first * 100 : 0, 2), up: c >= 0 };
  };
  const rangeFor = (i, j) => {
    const a0 = P.pts[i], b0 = P.pts[j]; if (!a0 || !b0) return null;
    const c = b0[1] - a0[1];
    return { chg: m.fmt.signed(c, 2) + ' ' + pcur, pct: m.fmt.signed(a0[1] ? c / a0[1] * 100 : 0, 2), from: priceTipTime(a0[0], range), to: priceTipTime(b0[0], range), up: c >= 0 };
  };
  // average buy price as a dashed line (same scale as the chart)
  const avgLine = (w, h) => {
    if (!vals || !pos || !pos.avg || (pcur && pos.avgCur && pcur.toUpperCase() !== pos.avgCur.toUpperCase())) return null;
    const lo = Math.min(...vals), hi = Math.max(...vals), pad = 14;
    if (pos.avg < lo || pos.avg > hi || hi === lo) return null;
    const y = pad + (1 - (pos.avg - lo) / (hi - lo)) * (h - pad * 2);
    return <g><line x1="0" y1={y} x2={w} y2={y} stroke="var(--color-accent-400)" stroke-opacity=".55" stroke-dasharray="4 4"></line>
      <text x={w - 4} y={y - 5} text-anchor="end" style={`font:400 10px ${F};fill:var(--color-accent-300)`}>{t('avg {p}', { p: m.fmt(pos.avg, 2) })}</text></g>;
  };
  const ext = String(ticker).startsWith('yf:');
  const name = (pos && pos.name) || (ext && P && P.meta && P.meta.name) || (I && I.name) || ticker;
  const sym = (pos && pos.sym) || (I && I.sym) || ticker;
  const fx = d.fx || 1;
  const meta = P && P.meta;
  return (
    <div class="grid">
      <Card style="grid-column:1/-1;min-height:360px;display:flex;flex-direction:column" pad={22}>
        <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
          <Logo ticker={ticker} sym={sym} lg />
          <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
            <span style={`font:500 17px/1.2 ${F};color:var(--color-neutral-100)`}>{name}</span>
            <span style={`display:flex;gap:8px;align-items:center;flex-wrap:wrap;font:400 11.5px/1 ${F};color:var(--color-neutral-500)`}>
              <span class="mono">{sym}</span>
              {I && I.isin && <span class="mono">· {I.isin}</span>}
              {I && I.type && <Chip>{I.type}</Chip>}
              {I && I.hours && <Chip color={I.hours.open ? UP : 'var(--color-neutral-400)'} bg={I.hours.open ? tint(UP) : undefined}>
                <i class={'ph ' + (I.hours.open ? 'ph-circle' : 'ph-moon')} style="font-size:9px"></i>{I.hours.exchange} · {I.hours.open ? t('open') : t('closed')}{I.hours.next ? ' · ' + (I.hours.open ? t('closes {t}', { t: hhmm(I.hours.next) }) : t('opens {t}', { t: dfmt(I.hours.next, { weekday: 'short' }) + ' ' + hhmm(I.hours.next) })) : ''}</Chip>}
              {ext ? <>{(I && I.exchange) || (P && P.meta && P.meta.exchange) ? <Chip>{(I && I.exchange) || P.meta.exchange}</Chip> : null}
                <Chip color="var(--color-accent-300)" bg="var(--color-accent-900)"><i class="ph ph-eye" style="font-size:10px"></i>{t('Watch only — not in Trading 212')}</Chip></>
                : !I || !I.hours ? <Chip>{marketName(ticker)}</Chip> : null}
            </span>
          </div>
          <span style="flex:1"></span>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:7px">
            <span style={`font:300 30px/1 ${F};letter-spacing:-.03em;font-variant-numeric:tabular-nums`}>{last != null ? m.fmt(last, 2) : pos ? m.fmt(pos.price, 2) : '—'} <span style="font-size:13px;color:var(--color-neutral-500)">{pcur}</span></span>
            {vals && <Chip color={up ? UP : DOWN} bg={tint(up ? UP : DOWN)}><i class={'ph ' + (up ? 'ph-trend-up' : 'ph-trend-down')}></i>{m.fmt.signed(first ? chg / first * 100 : 0, 2)}% · {m.fmt.signed(chg, 2)} · {range}</Chip>}
          </div>
        </div>
        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:14px"><RangeChips range={range} onPick={setRange} list={PRICE_RANGES} size={11} padX={9} /></div>
        {vals ? (
          <FillChart values={vals} tipFor={tipFor} rangeFor={rangeFor} pad={14} sw={1.8} color={up ? UP : DOWN} gid="gIns" gop={.26} glowPx={6} marker draw={1.1} animKey={range + ticker}
            wrapStyle="margin-top:10px;min-height:200px" grid={(w, h) => [[0.25, 0.5, 0.75].map(f => <line x1="0" y1={h * f} x2={w} y2={h * f} stroke="rgba(var(--ink-rgb),.055)" stroke-dasharray="2 5"></line>), avgLine(w, h)]} />
        ) : (
          <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:200px">
            {pr.loading ? <Spinner size={18} /> : <span class="muted">{t('No price history for this instrument (Yahoo Finance doesn’t know it).')}</span>}
          </div>
        )}
        {vals && <div style="display:flex;justify-content:space-between;margin-top:8px">{[0, 1, 2, 3].map(i => {
          const p = P.pts[Math.min(P.pts.length - 1, Math.round(i / 3 * (P.pts.length - 1)))];
          return <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600)`}>{range === '1D' ? hhmm(p[0]) : dfmt(p[0], range === '5Y' || range === 'MAX' ? { month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' })}</span>;
        })}</div>}
        <span style={`font:400 10px/1 ${F};color:var(--color-neutral-700);margin-top:10px`}>{t('Prices: Yahoo Finance{s}, may be delayed.', { s: P && P.symbol ? ' (' + P.symbol + ')' : '' })}</span>
      </Card>

      {pos && (
        <div class="kpis" style="grid-column:1/-1">
          <Kpi label={t('Your position')} value={m.fmt(pos.value, 0) + ' ' + m.cur} sub={t('{q} shares · {w} % of portfolio', { q: m.fmt(pos.qty, pos.qty % 1 ? 4 : 0), w: m.fmt(pos.weight, 1) })} />
          <Kpi label={t('Avg price')} value={m.fmt(pos.avg, 2) + ' ' + pos.avgCur} sub={t('now {p}', { p: m.fmt(pos.price, 2) })} />
          <Kpi label={t('Unrealised P/L')} value={m.fmt.signed(pos.pl, 0) + ' ' + m.cur} color={pos.pl >= 0 ? UP : DOWN} sub={m.fmt.signed(pos.plPct, 2) + ' %' + (pos.fxImpact ? ' · ' + t('FX {v}', { v: m.fmt.signed(pos.fxImpact, 0) }) : '')} />
          <Kpi label={t('Realised P/L')} value={I ? m.fmt.signed(I.realized * fx, 0) + ' ' + m.cur : '—'} color={I && I.realized < 0 ? DOWN : I && I.realized > 0 ? UP : undefined} sub={I ? t('fees {v}', { v: m.fmt(I.fees * fx, 2) }) : ''} />
          <Kpi label={t('Dividends received')} value={I ? m.fmt(I.dividendTotal * fx, 2) + ' ' + m.cur : '—'} sub={I ? t('{n} payments', { n: I.dividends.length }) : ''} />
        </div>
      )}
      {meta && (
        <Card title={t('Price range')} style="grid-column:span 6" right={<span class="muted">{pcur}</span>}>
          <div style="display:flex;flex-direction:column;gap:22px;padding-top:4px">
            {meta.dayLow != null && <RangeMeter label={t('Today')} lo={meta.dayLow} hi={meta.dayHigh} cur={last} fmt={m.fmt} mark={meta.open} markLabel={t('open')} />}
            {meta.low52 != null && <RangeMeter label={t('52 weeks')} lo={meta.low52} hi={meta.high52} cur={last} fmt={m.fmt} mark={pos && (!pos.avgCur || !pcur || pos.avgCur.toUpperCase() === pcur.toUpperCase()) ? pos.avg : null} markLabel={t('your avg')} delay={.15} />}
            {perf.data && perf.data.low5 != null && <RangeMeter label={t('5 years')} lo={perf.data.low5} hi={perf.data.high5} cur={last} fmt={m.fmt} delay={.3} />}
          </div>
        </Card>
      )}
      {(meta || I) && (
        <Card title={t('Key facts')} style="grid-column:span 6">
          <div class="facts two">
            <Fact label={t('Previous close')} value={meta && meta.prevClose != null ? m.fmt(meta.prevClose, 2) : '—'} />
            <Fact label={t('Open price')} value={meta && meta.open != null ? m.fmt(meta.open, 2) : '—'} />
            <Fact label={t('Volume')} value={meta && meta.volume != null ? m.fmt(meta.volume, 0) : '—'} />
            <Fact label={t('Exchange')} value={(I && I.hours && I.hours.exchange) || (meta && meta.exchange) || '—'} />
            <Fact label={t('Currency')} value={pcur || '—'} />
            <Fact label={t('Type')} value={(I && I.type) || '—'} />
            <Fact label="ISIN" value={(I && I.isin) || (pos && pos.isin) || '—'} />
            <Fact label={pos ? t('First bought') : t('Market')} value={pos && pos.opened ? dfmt(pos.opened) : marketName(ticker)} />
          </div>
        </Card>
      )}
      {perf.data && (
        <Card title={t('Performance')} style="grid-column:1/-1" right={<span class="muted">{t('price change, without dividends')}</span>}>
          <div class="perf">
            {[['w1', '1T'], ['m1', '1M'], ['m3', '3M'], ['m6', '6M'], ['ytd', t('YTD')], ['y1', '1R'], ['y3', '3R'], ['y5', '5R']].map(([k, l], i) => {
              const v = perf.data[k];
              const max = Math.max(1, ...['w1', 'm1', 'm3', 'm6', 'ytd', 'y1', 'y3', 'y5'].map(x => Math.abs(perf.data[x] || 0)));
              return (
                <div class="perf-i" style={`animation-delay:${i * .04}s`}>
                  <span class="lbl">{l}</span>
                  <span class="num" style={`font-size:14px;color:${v == null ? 'var(--color-neutral-600)' : v >= 0 ? UP : DOWN}`}>{v == null ? '—' : m.fmt.signed(v, 2) + '%'}</span>
                  <span class="perf-bar"><GrowBar color={v >= 0 ? UP : DOWN} w={v == null ? '0%' : Math.max(3, Math.abs(v) / max * 100) + '%'} dur={1} /></span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {I && I.pending && I.pending.length > 0 && (
        <Card title={t('Pending orders')} style="grid-column:1/-1" right={<More onClick={() => nav.go('orders')}>{t('All orders')}</More>}>{I.pending.map(o => <PendingRow o={o} fmt={m.fmt} />)}</Card>
      )}
      {!ext && <Card title={t('Your trades')} style="grid-column:span 7" right={I && I.orders.length ? <More onClick={() => nav.go('activity', 'orders|' + sym)}>{t('In Activity')}</More> : null}>
        {I && I.orders.length ? I.orders.slice(0, 40).map(x => <ActivityRow x={{ ...x, kind: 'orders' }} fmt={m.fmt} fx={fx} cur={m.cur} compact />)
          : <Empty icon="ph-swap" title={info.loading ? t('Loading…') : t('No trades in the downloaded history')} />}
      </Card>}
      {!ext && <Card title={t('Dividends')} style="grid-column:span 5" right={I && I.dividends.length ? <More onClick={() => nav.go('activity', 'dividends|' + sym)}>{t('In Activity')}</More> : null}>
        {I && I.dividends.length ? I.dividends.slice(0, 40).map(x => <ActivityRow x={{ ...x, kind: 'dividends' }} fmt={m.fmt} fx={fx} cur={m.cur} compact />)
          : <Empty icon="ph-coins" title={info.loading ? t('Loading…') : t('No dividends from this instrument yet')} />}
      </Card>}
    </div>
  );
}
// low–high bar with an animated marker for the current price (and an optional second mark)
function RangeMeter({ label, lo, hi, cur, fmt, mark, markLabel, delay = 0 }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const h = setTimeout(() => setOn(true), 120 + delay * 1000); return () => clearTimeout(h); }, []);
  const span = hi - lo || 1;
  const pos = v => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
  const p = cur != null ? pos(cur) : 50;
  return (
    <div class="rmeter">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
        <span class="lbl">{label}</span>
        <span style="flex:1"></span>
        {cur != null && <span class="muted">{t('{p} % of range', { p: fmt(p, 0) })}</span>}
      </div>
      <div class="rtrack">
        <div class="rfill" style={`width:${on ? p : 0}%`}></div>
        {mark != null && mark >= lo && mark <= hi && <div class="rmark" style={`left:${pos(mark)}%`} title={markLabel + ' ' + fmt(mark, 2)}><span>{markLabel}</span></div>}
        <div class="rdot" style={`left:${on ? p : 0}%`}></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:9px;font:400 11.5px/1 'Inter',sans-serif;color:var(--color-neutral-400);font-variant-numeric:tabular-nums">
        <span>{fmt(lo, 2)}</span>{cur != null && <span style="color:var(--color-neutral-100);font-weight:500">{fmt(cur, 2)}</span>}<span>{fmt(hi, 2)}</span>
      </div>
    </div>
  );
}

const Fact = ({ label, value }) => (
  <div style="display:flex;flex-direction:column;gap:5px;min-width:0">
    <span style={`font:400 9.5px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:var(--color-neutral-600)`}>{label}</span>
    <span style={`font:400 13px/1.2 ${F};color:var(--color-neutral-200);font-variant-numeric:tabular-nums`}>{value}</span>
  </div>
);

// ── activity ─────────────────────────────────────────────────
function Activity({ m, tab: arg0 }) {
  const { st, nav } = useApp();
  // route arg: "orders" or "orders|AAPL" (opened from an instrument → pre-filtered)
  const [tab0, q0] = String(arg0 || '').split('|');
  const [tab, setTab] = useState(tab0 || 'orders');
  useEffect(() => { if (tab0) setTab(tab0); }, [tab0]);
  const [q, setQ] = useState(q0 || '');
  const [type, setType] = useState('');
  const [limit, setLimit] = useState(60);
  useEffect(() => { setLimit(60); setType(''); }, [tab]);
  const list = useLib('activity', { kind: tab, q, type, limit }, [tab, q, type, limit], [tab, 'account']);
  const stats = useLib('stats', {}, [], ['orders', 'dividends', 'transactions', 'account']);
  const S = stats.data;
  const fx = m.d.fx || 1;
  const L = st.lib || {};
  const ks = L[tab] || {};
  const cur = m.cur;
  const money = (v, d = 0) => m.fmt(v * fx, d) + ' ' + cur;
  const months = lastMonths(24);
  const typeOpts = tab === 'orders' ? [['', t('All')], ['BUY', t('Buys')], ['SELL', t('Sells')], ['UNFILLED', t('Not executed')]]
    : tab === 'transactions' ? [['', t('All')], ['IN', t('Deposits')], ['OUT', t('Withdrawals')], ['INTEREST_ON_FREE_CASH', t('Interest')]] : null;
  const permName = { orders: 'History – Orders', dividends: 'History – Dividends', transactions: 'History – Transactions' }[tab];
  return (
    <div class="grid">
      <div style="grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <Seg value={tab} onChange={v => nav.go('activity', v)} options={[['orders', t('Trades')], ['dividends', t('Dividends')], ['transactions', t('Deposits & withdrawals')]]} />
        <span style="flex:1"></span>
        <span class="muted" style="display:flex;align-items:center;gap:7px">
          {ks.state === 'syncing' && <Spinner size={11} />}
          {ks.state === 'syncing' ? t('Downloading… {n} so far', { n: ks.count || 0 }) : ks.syncedAt ? t('{n} items · synced {x}', { n: ks.count || 0, x: agoStr(ks.syncedAt, Date.now()) }) : ''}
        </span>
        <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" disabled={L.syncing} onClick={() => { api.lib('sync', { kinds: [tab] }); toast(t('Syncing history…'), 'ph-arrows-clockwise'); }}><i class="ph ph-arrows-clockwise"></i>{t('Sync')}</button>
      </div>
      <Gate status={ks} perm={permName} retry={() => api.lib('retry', { kind: tab })}>
        {S && tab === 'dividends' && <>
          <div class="kpis" style="grid-column:1/-1">
            <Kpi label={t('This year')} value={money(S.dividends.ytd)} />
            <Kpi label={t('Last 12 months')} value={money(S.dividends.last12)} sub={t('≈ {v} a month', { v: money(S.dividends.last12 / 12) })} />
            <Kpi label={t('All-time')} value={money(S.dividends.total)} sub={t('{n} payments', { n: S.dividends.count })} />
            <Kpi label={t('Yield on cost')} value={m.d.totalCost ? m.fmt(S.dividends.last12 * fx / m.d.totalCost * 100, 2) + ' %' : '—'} sub={t('last 12 months ÷ cost')} />
          </div>
          <Card title={t('Dividends by month')} style="grid-column:span 8">
            <Bars months={months} fmt={m.fmt} cur={cur} series={[{ label: t('Dividends'), color: CAT[1], get: k => (S.dividends.byMonth[k] || 0) * fx }]} />
          </Card>
          <Card title={t('Top payers')} style="grid-column:span 4">
            {S.dividends.byTicker.slice(0, 6).map(x => (
              <div class="lrow click" onClick={() => nav.go('instrument', x.ticker)}>
                <SymCell sym={x.sym} name={x.name} ticker={x.ticker} />
                <span class="num">{m.fmt(x.amount * fx, 0)} {cur}</span>
              </div>))}
          </Card>
        </>}
        {S && tab === 'transactions' && <>
          <div class="kpis" style="grid-column:1/-1">
            <Kpi label={t('Deposited')} value={money(S.cash.deposits)} sub={t('incl. transfers from other accounts')} />
            <Kpi label={t('Withdrawn')} value={money(S.cash.withdrawals)} sub={t('incl. card payments and transfers')} />
            <Kpi label={t('Net deposits')} value={money(S.cash.net)} sub={t('portfolio now {v}', { v: m.fmt(m.d.value, 0) })} />
            <Kpi label={t('Interest')} value={money(S.cash.interest)} color={S.cash.interest > 0 ? UP : undefined} sub={S.cash.fees ? t('fees {v}', { v: money(S.cash.fees, 2) }) : ''} />
          </div>
          <Card title={t('Deposits & withdrawals by month')} style="grid-column:1/-1">
            <Bars months={months} fmt={m.fmt} cur={cur} series={[
              { label: t('Deposits'), color: UP, get: k => (S.cash.byMonth[k] ? S.cash.byMonth[k].in : 0) * fx },
              { label: t('Withdrawals'), color: DOWN, get: k => (S.cash.byMonth[k] ? S.cash.byMonth[k].out : 0) * fx }]} />
          </Card>
        </>}
        {S && tab === 'orders' && (
          <div class="kpis" style="grid-column:1/-1">
            <Kpi label={t('Trades')} value={S.orders.count} sub={t('{b} buys · {s} sells', { b: S.orders.buys, s: S.orders.sells }) + (S.orders.unfilled ? ' · ' + t('{n} not executed', { n: S.orders.unfilled }) : '')} />
            <Kpi label={t('Bought')} value={money(S.orders.bought)} />
            <Kpi label={t('Sold')} value={money(S.orders.sold)} />
            <Kpi label={t('Realised P/L')} value={(S.orders.realized >= 0 ? '+' : '') + money(S.orders.realized)} color={S.orders.realized >= 0 ? UP : DOWN} sub={t('from sells in the history')} />
            <Kpi label={t('Fees & taxes')} value={money(S.orders.fees, 2)} sub={t('FX fees, stamp duty…')} />
          </div>
        )}
        <Card style="grid-column:1/-1" title={tab === 'orders' ? t('Trades') : tab === 'dividends' ? t('Payments') : t('Movements')} right={
          <div style="display:flex;gap:10px;align-items:center">
            {typeOpts && <Seg value={type} onChange={setType} options={typeOpts} size={10.5} />}
            {tab !== 'transactions' && <div class="search sm"><i class="ph ph-magnifying-glass"></i><input class="input" placeholder={t('Filter')} value={q} onInput={e => setQ(e.currentTarget.value)} /></div>}
          </div>}>
          {list.data && list.data.items.length ? <>
            {list.data.items.map(x => <ActivityRow x={{ ...x, kind: tab }} fmt={m.fmt} fx={fx} cur={cur} />)}
            {list.data.total > list.data.items.length && (
              <div style="display:flex;justify-content:center;padding-top:12px">
                <button class="btn btn-secondary" style="font-size:12.5px" onClick={() => setLimit(l => l + 100)}>{t('Show more ({n} left)', { n: list.data.total - list.data.items.length })}</button>
              </div>)}
          </> : <Empty icon="ph-clock-counter-clockwise" title={ks.state === 'syncing' || list.loading ? t('Downloading your history…') : q ? t('Nothing matches “{q}”', { q }) : t('Nothing here yet')}
            text={ks.state === 'syncing' ? t('The first download can take a few minutes — Trading 212 allows 20 history requests a minute.') : ''} />}
        </Card>
      </Gate>
    </div>
  );
}

// ── pending orders ───────────────────────────────────────────
const STATUS_LABEL = () => ({ NEW: t('Waiting'), LOCAL: t('Waiting'), UNCONFIRMED: t('Unconfirmed'), CONFIRMED: t('Confirmed'), PARTIALLY_FILLED: t('Partly filled'), CANCELLING: t('Cancelling'), REPLACING: t('Replacing') });
function PendingRow({ o, fmt }) {
  const nav = useNav();
  const price = o.type === 'STOP_LIMIT' ? `${fmt(o.stopPrice, 2)} → ${fmt(o.limitPrice, 2)}` : o.limitPrice != null ? fmt(o.limitPrice, 2) : o.stopPrice != null ? fmt(o.stopPrice, 2) : t('market');
  return (
    <div class="lrow click" onClick={() => nav.go('instrument', o.ticker)}>
      <span style="width:62px;display:flex"><Side side={o.side} /></span>
      <SymCell sym={o.sym} name={o.name} ticker={o.ticker} />
      <span class="t2" style="width:120px">{typeName(o.type)}{o.tif ? ' · ' + (o.tif === 'DAY' ? t('day') : 'GTC') : ''}{o.extended ? ' · ' + t('ext.') : ''}</span>
      <span class="num" style="width:110px;text-align:right">{o.qty != null ? fmt(o.qty, o.qty % 1 ? 4 : 0) + ' ' + t('pcs') : o.value != null ? fmt(o.value, 2) : '—'}</span>
      <span class="num" style="width:130px;text-align:right">{price} <span class="muted">{o.instrCur || o.currency || ''}</span></span>
      <span style="width:110px;display:flex;justify-content:flex-end"><Chip>{STATUS_LABEL()[o.status] || o.status}</Chip></span>
      <span class="t2" style="width:120px;text-align:right">{dtfmt(o.created)}</span>
    </div>
  );
}
function Orders({ m }) {
  const { st } = useApp();
  const res = useLib('pending', {}, [], ['account']);
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); await api.lib('pending', { force: true }); res.reload(); setTimeout(() => setBusy(false), 5200); };
  const list = res.data || [];
  return (
    <div class="grid">
      <Card style="grid-column:1/-1" title={t('Pending orders')} right={<>
        <span class="muted">{t('Read-only — manage orders in Trading 212.')}</span>
        <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" disabled={busy} onClick={refresh}>{busy ? <Spinner size={11} /> : <i class="ph ph-arrows-clockwise"></i>}{t('Refresh')}</button></>}>
        <Gate inCard status={st.lib && st.lib.pending} perm="Orders – Read" loading={res.loading && !res.data} retry={refresh}>
          {res.err && !list.length ? <Empty icon="ph-warning-circle" title={t('Couldn’t load orders')} text={res.err.message} />
            : list.length ? list.map(o => <PendingRow o={o} fmt={m.fmt} />)
              : <Empty icon="ph-check-circle" title={t('No pending orders')} text={t('Limit, stop and other waiting orders show up here.')} />}
        </Gate>
      </Card>
    </div>
  );
}

// ── pies ─────────────────────────────────────────────────────
const PIE_STATUS = () => ({ AHEAD: [t('Ahead'), UP], ON_TRACK: [t('On track'), 'var(--color-accent-300)'], BEHIND: [t('Behind'), DOWN] });
function Pies({ m, id }) {
  const { st, nav } = useApp();
  const res = useLib('pies', {}, [], ['pies', 'account']);
  if (id != null) return <PieDetail id={id} m={m} />;
  const list = res.data || [];
  return (
    <div class="grid">
      <div style="grid-column:1/-1">
        <Gate status={st.lib && st.lib.pies} perm="Pies – Read" loading={res.loading && !res.data} retry={() => api.lib('retry', { kind: 'pies' })}>
          {list.length ? (
            <div class="pies">
              {list.map(p => {
                const [sl, sc] = PIE_STATUS()[p.status] || [p.status, 'var(--color-neutral-400)'];
                const up = (p.result || 0) >= 0;
                return (
                  <div class="card click pie" onClick={() => nav.go('pies', p.id)}>
                    <div style="display:flex;align-items:center;gap:10px">
                      <span class="sym"><i class="ph ph-chart-pie-slice" style="font-size:14px"></i></span>
                      <span style={`font:500 13.5px/1.2 ${F};color:var(--color-neutral-100);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{p.name || t('Pie #{id}', { id: p.id })}</span>
                      {p.status && <Chip color={sc}>{sl}</Chip>}
                    </div>
                    <div style="display:flex;align-items:baseline;gap:6px;margin-top:16px">
                      <span style={`font:300 24px/1 ${F};letter-spacing:-.02em;font-variant-numeric:tabular-nums`}>{m.fmt((p.value || 0) * (m.d.fx || 1), 0)}</span>
                      <span class="muted">{m.cur}</span>
                      <span style="flex:1"></span>
                      <span class="num" style={`color:${up ? UP : DOWN}`}>{m.fmt.signed((p.result || 0) * (m.d.fx || 1), 0)} · {m.fmt.signed(p.resultPct || 0, 2)}%</span>
                    </div>
                    {p.goal ? <>
                      <div style="height:4px;border-radius:2px;background:rgba(var(--ink-rgb),.07);overflow:hidden;margin-top:14px"><GrowBar color="linear-gradient(to right,var(--color-accent-700),var(--color-accent-400))" w={Math.min(100, (p.progress || 0) * 100) + '%'} /></div>
                      <span class="t2" style="margin-top:7px">{t('{p} % of goal {g}', { p: m.fmt((p.progress || 0) * 100, 0), g: m.fmt(p.goal, 0) })}{p.endDate ? ' · ' + dfmt(p.endDate) : ''}</span>
                    </> : <span class="t2" style="margin-top:14px">{t('No goal set')}</span>}
                    <div style="display:flex;gap:16px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(var(--ink-rgb),.07)">
                      <Fact label={t('Invested')} value={m.fmt((p.invested || 0) * (m.d.fx || 1), 0)} />
                      <Fact label={t('Cash')} value={m.fmt((p.cash || 0) * (m.d.fx || 1), 0)} />
                      <Fact label={t('Dividends')} value={p.dividends ? m.fmt((p.dividends.gained || 0) * (m.d.fx || 1), 0) : '—'} />
                      <Fact label={t('Holdings')} value={p.count == null ? '…' : p.count} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <Card><Empty icon="ph-chart-pie-slice" title={res.err ? t('Couldn’t load pies') : t('No pies')} text={res.err ? res.err.message : t('Pies you create in Trading 212 show up here.')} /></Card>}
        </Gate>
      </div>
    </div>
  );
}

function PieDetail({ id, m }) {
  const { nav } = useApp();
  const res = useLib('pie', { id }, [id], ['pies']);
  const p = res.data;
  const fx = m.d.fx || 1;
  if (!p) return <Card><div style="display:flex;justify-content:center;padding:40px">{res.err ? <span class="muted">{res.err.message}</span> : <Spinner size={18} />}</div></Card>;
  const [sl, sc] = PIE_STATUS()[p.status] || [p.status || '', 'var(--color-neutral-400)'];
  return (
    <div class="grid">
      <div class="kpis" style="grid-column:1/-1">
        <Kpi label={p.name || t('Pie #{id}', { id: p.id })} value={m.fmt((p.value || 0) * fx, 0) + ' ' + m.cur} sub={p.status ? sl : ''} color={undefined} />
        <Kpi label={t('Result')} value={m.fmt.signed((p.result || 0) * fx, 0) + ' ' + m.cur} color={(p.result || 0) >= 0 ? UP : DOWN} sub={m.fmt.signed(p.resultPct || 0, 2) + ' %'} />
        <Kpi label={t('Invested')} value={m.fmt((p.invested || 0) * fx, 0) + ' ' + m.cur} sub={p.created ? t('since {d}', { d: dfmt(p.created) }) : ''} />
        <Kpi label={t('Goal')} value={p.goal ? m.fmt(p.goal, 0) : '—'} sub={p.goal ? t('{p} % reached', { p: m.fmt((p.progress || 0) * 100, 0) }) + (p.endDate ? ' · ' + dfmt(p.endDate) : '') : t('No goal set')} />
        <Kpi label={t('Dividends')} value={p.dividends ? m.fmt((p.dividends.gained || 0) * fx, 2) + ' ' + m.cur : '—'}
          sub={p.dividendAction ? (p.dividendAction === 'REINVEST' ? t('reinvested') : t('paid to cash')) : ''} />
      </div>
      <Card title={t('Composition')} style="grid-column:span 8" right={<><span class="muted">{t('current vs. target share')}</span><More onClick={() => nav.go('pies')}>{t('All pies')}</More></>}>
        {p.instruments.map((i, ix) => (
          <div class="lrow click" onClick={() => nav.go('instrument', i.ticker)}>
            <SymCell sym={i.sym} name={i.name} ticker={i.ticker} />
            {i.issues.length > 0 && <Chip color={DOWN} bg={tint(DOWN)}><i class="ph ph-warning"></i>{i.issues.map(x => x.name.replace(/_/g, ' ').toLowerCase()).join(', ')}</Chip>}
            <span style="width:150px;display:flex;flex-direction:column;gap:4px">
              <span style="position:relative;height:5px;border-radius:3px;background:rgba(var(--ink-rgb),.07)">
                <span style={`position:absolute;left:0;top:0;bottom:0;border-radius:3px;width:${Math.min(100, (i.current || 0) * 2)}%;background:${ix < 5 ? catColor(ix) : OTHER}`}></span>
                <span style={`position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:1px;left:${Math.min(100, (i.expected || 0) * 2)}%;background:var(--color-neutral-200)`} title={t('target')}></span>
              </span>
              <span class="t2" style="display:flex;justify-content:space-between"><span>{m.fmt(i.current || 0, 1)} %</span><span>{t('target {p} %', { p: m.fmt(i.expected || 0, 1) })}</span></span>
            </span>
            <span class="num" style="width:100px;text-align:right">{m.fmt((i.value || 0) * fx, 0)}</span>
            <span class="num" style={`width:74px;text-align:right;color:${(i.result || 0) >= 0 ? UP : DOWN}`}>{m.fmt.signed(i.resultPct || 0, 2)}%</span>
          </div>
        ))}
      </Card>
      <Card title={t('Allocation')} style="grid-column:span 4">
        <Donut items={p.instruments.map(i => ({ label: i.sym, value: i.value || 0 }))} fmt={m.fmt} center={(p.value || 0) * fx} size={150} />
      </Card>
    </div>
  );
}

// ── reports (CSV export) ─────────────────────────────────────
// date field in the app's style: shows "1. 1. 2026", opens a month calendar (weeks start on Monday)
const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const parseIso = s => { const [y, m, d] = String(s || '').split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
function DateInput({ value, onChange, min, max, align }) {
  const [open, setOpen] = useState(false);
  const cur = parseIso(value) || new Date();
  const [view, setView] = useState(new Date(cur.getFullYear(), cur.getMonth(), 1));
  const ref = useRef(null);
  useEffect(() => { if (open) setView(new Date(cur.getFullYear(), cur.getMonth(), 1)); }, [open]);
  useEffect(() => {
    if (!open) return;
    const off = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', off); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); };
  }, [open]);
  const lo = parseIso(min), hi = parseIso(max);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const startOff = (first.getDay() + 6) % 7;                       // Monday first
  const days = [];
  for (let i = 0; i < 42; i++) days.push(new Date(view.getFullYear(), view.getMonth(), 1 - startOff + i));
  const wk = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: 'short' }).replace('.', ''));
  const pick = d => { if ((lo && d < lo) || (hi && d > hi)) return; onChange(isoOf(d)); setOpen(false); };
  const shift = n => setView(v => new Date(v.getFullYear(), v.getMonth() + n, 1));
  return (
    <div class="dpick" ref={ref}>
      <button type="button" class={'input dbtn' + (open ? ' on' : '')} onClick={() => setOpen(o => !o)}>
        <span class="num" style="font-size:12.5px">{cur.getDate()}. {cur.getMonth() + 1}. {cur.getFullYear()}</span>
        <i class="ph ph-calendar-blank"></i>
      </button>
      {open && (
        <div class={'dpop' + (align === 'right' ? ' r' : '')}>
          <div class="dhead">
            <button type="button" class="tb" onClick={() => shift(-1)}><i class="ph ph-caret-left"></i></button>
            <span style="flex:1;text-align:center;font:500 12.5px/1 'Inter',sans-serif;color:var(--color-neutral-100);text-transform:capitalize">{view.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</span>
            <button type="button" class="tb" onClick={() => shift(1)}><i class="ph ph-caret-right"></i></button>
          </div>
          <div class="dgrid">
            {wk.map(w => <span class="dwk">{w}</span>)}
            {days.map(d => {
              const sel = isoOf(d) === value, out = d.getMonth() !== view.getMonth(), dis = (lo && d < lo) || (hi && d > hi);
              return <button type="button" disabled={dis} class={'dday' + (sel ? ' sel' : '') + (out ? ' out' : '') + (+d === +today ? ' today' : '')} onClick={() => pick(d)}>{d.getDate()}</button>;
            })}
          </div>
          <div class="dfoot">
            <button type="button" class="btn btn-ghost" style="font-size:11.5px" onClick={() => pick(today)}>{t('Today')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const isoDay = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function Reports({ m }) {
  const { st } = useApp();
  const res = useLib('exports', {}, [], ['exports', 'account']);
  const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const [from, setFrom] = useState(isoDay(yearStart));
  const [to, setTo] = useState(isoDay(Date.now()));
  const [inc, setInc] = useState({ orders: true, dividends: true, transactions: true, interest: true });
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [msg, setMsg] = useState(null);
  const [dl, setDl] = useState({});
  const list = res.data || [];
  const pending = list.some(r => ['Queued', 'Processing', 'Running'].includes(r.status));
  useEffect(() => {
    if (!pending) return;
    const i = setInterval(() => { api.lib('exports', { force: true }).then(() => res.reload()); }, 62e3);
    return () => clearInterval(i);
  }, [pending]);
  const create = async () => {
    setMsg(null); setBusy(true);
    const f = new Date(from + 'T00:00:00').getTime(), tt = new Date(to + 'T23:59:59').getTime();
    const r = await api.lib('requestExport', { from: f, to: tt, ...inc });
    if (r && r.error) setMsg({ ok: false, text: r.error.message });
    else { toast(t('Report requested'), 'ph-file-csv'); setMsg({ ok: true, text: t('Report requested — Trading 212 prepares it in a minute or two.') }); setTimeout(() => { api.lib('exports', { force: true }).then(() => res.reload()); }, 8000); }
    // Trading 212 allows one report request per 30 s — show the wait instead of a dead button
    const until = Date.now() + 31e3;
    setWait(31);
    const iv = setInterval(() => { const s = Math.ceil((until - Date.now()) / 1000); setWait(s > 0 ? s : 0); if (s <= 0) { clearInterval(iv); setBusy(false); } }, 1000);
  };
  const download = async r => {
    setDl(x => ({ ...x, [r.id]: 'busy' }));
    const out = await api.lib('download', { id: r.id });
    setDl(x => ({ ...x, [r.id]: out && out.saved ? 'done' : out && out.error ? 'err' : null }));
  };
  const presets = [[t('This year'), yearStart, Date.now()], [t('Last year'), new Date(new Date().getFullYear() - 1, 0, 1).getTime(), yearStart - 1], [t('Last 12 months'), Date.now() - 365 * 86400e3, Date.now()]];
  const STAT = { Finished: [t('Ready'), UP], Failed: [t('Failed'), DOWN], Canceled: [t('Cancelled'), 'var(--color-neutral-500)'] };
  return (
    <div class="grid">
      <Card title={t('New CSV report')} style="grid-column:span 5">
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">{presets.map(([l, a, b]) => <button class="btn btn-secondary" style="font-size:11.5px;padding:4px 9px" onClick={() => { setFrom(isoDay(a)); setTo(isoDay(b)); }}>{l}</button>)}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="display:flex;flex-direction:column;gap:6px"><span class="lbl">{t('From')}</span><DateInput value={from} max={to} onChange={setFrom} /></div>
            <div style="display:flex;flex-direction:column;gap:6px"><span class="lbl">{t('To')}</span><DateInput value={to} min={from} onChange={setTo} align="right" /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            {[['orders', t('Trades')], ['dividends', t('Dividends')], ['transactions', t('Deposits & withdrawals')], ['interest', t('Interest')]].map(([k, l]) => (
              <label class="check"><input type="checkbox" checked={inc[k]} onChange={e => setInc(x => ({ ...x, [k]: e.currentTarget.checked }))} /><span>{l}</span></label>
            ))}
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <button class="btn btn-primary" style="font-size:13px" disabled={busy || !from || !to || !Object.values(inc).some(Boolean)} onClick={create}>{busy && !wait ? <Spinner size={12} /> : <i class="ph ph-file-csv"></i>}{t('Create report')}</button>
            {wait > 0 && <span class="muted">{t('Next report possible in {n} s', { n: wait })}</span>}
            {!Object.values(inc).some(Boolean) && <span class="muted">{t('Tick at least one type of data')}</span>}
          </div>
          {msg && <span style={`display:flex;gap:7px;align-items:flex-start;font:400 11.5px/1.5 ${F};color:${msg.ok ? 'var(--color-neutral-400)' : DOWN}`}><i class={'ph ' + (msg.ok ? 'ph-hourglass' : 'ph-warning-circle')} style="font-size:14px;flex:none"></i>{msg.text}</span>}
          <span class="t2" style="line-height:1.5;white-space:normal">{t('The same CSV as Trading 212 → History → Export. It is saved where you choose; the app keeps no copy.')}</span>
        </div>
      </Card>
      <Card title={t('Reports')} style="grid-column:span 7" right={pending ? <span class="muted" style="display:flex;gap:6px;align-items:center"><Spinner size={11} />{t('preparing…')}</span> : null}>
        <Gate inCard status={st.lib && st.lib.exports} perm="History – Orders / Dividends / Transactions" loading={res.loading && !res.data}>
          {list.length ? list.map(r => {
            const [sl, sc] = STAT[r.status] || [t('Preparing'), 'var(--color-accent-300)'];
            const inc = r.include || {};
            const parts = [inc.includeOrders && t('Trades'), inc.includeDividends && t('Dividends'), inc.includeTransactions && t('Transactions'), inc.includeInterest && t('Interest')].filter(Boolean);
            return (
              <div class="lrow">
                <span class="ico"><i class="ph ph-file-csv"></i></span>
                <span style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:0">
                  <span class="t1">{dfmt(r.from)} – {dfmt(r.to)}</span>
                  <span class="t2">{parts.join(' · ') || '—'} · #{r.id}</span>
                </span>
                <span style="width:110px;display:flex;justify-content:flex-end"><Chip color={sc}>{sl}</Chip></span>
                <span style="width:120px;display:flex;justify-content:flex-end">
                  {r.status === 'Finished' && r.link && <button class="btn btn-secondary" style="font-size:12px;padding:5px 10px" disabled={dl[r.id] === 'busy'} onClick={() => download(r)}>
                    {dl[r.id] === 'busy' ? <Spinner size={11} /> : dl[r.id] === 'done' ? <i class="ph ph-check" style={`color:${UP}`}></i> : <i class="ph ph-download-simple"></i>}{t('Download')}</button>}
                </span>
              </div>
            );
          }) : <Empty icon="ph-file-csv" title={res.err ? t('Couldn’t load reports') : t('No reports yet')} text={res.err ? res.err.message : t('Create one on the left — it appears here when it is ready.')} />}
        </Gate>
      </Card>
    </div>
  );
}

// ── settings page ────────────────────────────────────────────
function SettingsPage({ tab, init }) {
  const { settings: s, st, set, nav } = useApp();
  const tabs = SETTINGS_TABS();
  const cur = tabs.some(x => x[0] === tab) ? tab : 'account';
  return (
    <div class="settings-page">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <Seg value={cur} onChange={v => nav.go('settings', v)} options={tabs.map(([k, l]) => [k, l])} />
        <span style="flex:1"></span>
        <span class="muted" style="display:flex;align-items:center;gap:6px"><i class="ph ph-check-circle" style="color:var(--color-accent-400)"></i>{t('Changes apply instantly and are remembered.')}</span>
      </div>
      <div key={cur} style="display:flex;flex-direction:column;gap:14px;max-width:880px;animation:nfade .35s ease both">
        {cur === 'account' && <AccountTab s={s} st={st} set={set} lib={st.lib} />}
        {cur === 'widget' && <WidgetTab s={s} set={set} />}
        {cur === 'appearance' && <AppearanceTab s={s} set={set} />}
        {cur === 'data' && <DataTab s={s} set={set} st={st} info={init} lib={st.lib} />}
        {cur === 'system' && <SystemTab s={s} set={set} info={init} />}
      </div>
    </div>
  );
}

// ── shell ────────────────────────────────────────────────────
const NAV = () => [
  ['overview', t('Overview'), 'ph-squares-four'],
  ['holdings', t('Holdings'), 'ph-chart-pie-slice'],
  ['activity', t('Activity'), 'ph-clock-counter-clockwise'],
  ['orders', t('Orders'), 'ph-list-checks'],
  ['pies', t('Pies'), 'ph-circle-half'],
  ['reports', t('Reports'), 'ph-file-csv']
];

function Search() {
  const { nav, st } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef(null);
  const held = ((st.data && st.data.positions) || []).map(p => p.ticker);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    const h = setTimeout(() => api.lib('search', { q, held }).then(r => { setRes(Array.isArray(r) ? r : []); setSel(0); }), 120);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {
    const off = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current && ref.current.querySelector('input').focus(); } };
    window.addEventListener('mousedown', off); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', key); };
  }, []);
  const pick = r => { setOpen(false); setQ(''); nav.go('instrument', r.ticker); };
  return (
    <div ref={ref} class="search" style="width:340px;position:relative">
      <i class="ph ph-magnifying-glass"></i>
      <input class="input" placeholder={t('Search any stock, ETF or index')} value={q} onFocus={() => setOpen(true)}
        onInput={e => { setQ(e.currentTarget.value); setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(res.length - 1, s + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
          else if (e.key === 'Enter' && res[sel]) pick(res[sel]);
          else if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); }
        }} />
      <span class="kbd">{MAC ? '⌘K' : 'Ctrl K'}</span>
      {open && q.trim() && (
        <div class="menu sres">
          {res.map((r, i) => (
            <button class={'mi' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
              <Logo ticker={r.ticker} sym={r.sym} />
              <span style="display:flex;flex-direction:column;gap:3px;min-width:0;flex:1">
                <span style="color:var(--color-neutral-100);font-weight:500">{r.sym}</span>
                <span style="color:var(--color-neutral-500);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{r.name}</span>
              </span>
              {r.held && <Chip color="var(--color-accent-300)" bg="var(--color-accent-900)">{t('held')}</Chip>}
              {r.external && <Chip>{t('watch only')}</Chip>}
              <span class="muted" style="font-size:10.5px;white-space:nowrap">{r.type || ''} {r.external ? (r.exchange || '') : (r.currency || '')}</span>
            </button>
          ))}
          {!res.length && <div class="mlabel" style="text-transform:none;letter-spacing:0;font-size:11.5px;line-height:1.5">{t('No match')}</div>}
        </div>
      )}
    </div>
  );
}

function WinControls() {
  if (MAC) return null;
  return (
    <div class="winctl nodrag">
      <button class="tb" title={t('Minimise')} onClick={() => api.appWindow('minimize')}><i class="ph ph-minus"></i></button>
      <button class="tb" title={t('Maximise')} onClick={() => api.appWindow('maximize')}><i class="ph ph-square"></i></button>
      <button class="tb close" title={t('Close')} onClick={() => api.appWindow('close')}><i class="ph ph-x"></i></button>
    </div>
  );
}

// boot: logo with a pulse while the first data arrives, then it lifts away
function Boot({ ready, bg }) {
  const [min, setMin] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => { const h = setTimeout(() => setMin(true), 1100); return () => clearTimeout(h); }, []);
  const out = ready && min;
  useEffect(() => { if (!out) return; const h = setTimeout(() => setGone(true), 700); return () => clearTimeout(h); }, [out]);
  if (gone) return null;
  return (
    <div class={'boot' + (out ? ' out' : '')} style={`background-image:url(${bg})`}>
      <div class="boot-logo"><span class="boot-ring"></span><span class="boot-ring r2"></span><span class="boot-tile"><Mark size={42} /></span></div>
      <span class="boot-name">Trading 212 <span>· Invest</span></span>
      <span class="boot-bar"><i></i></span>
    </div>
  );
}

function SideStatus({ st, now }) {
  const L = st.lib || {};
  const live = st.status === 'live';
  const syncing = L.syncing && ['orders', 'dividends', 'transactions'].some(k => L[k] && L[k].state === 'syncing');
  return (
    <div class="side-status">
      <span style="display:flex;align-items:center;gap:7px">
        <Dot color={st.status === 'error' ? DOWN : live ? UP : 'var(--color-neutral-500)'} />
        <span>{st.status === 'error' ? t('Connection problem') : st.status === 'closed' ? t('Markets closed') : st.connected ? t('Live') : t('Not connected')}</span>
        <span style="flex:1"></span>
        <span class="muted">{st.lastSync ? agoStr(st.lastSync, now) : ''}</span>
      </span>
      {syncing && <span style="display:flex;align-items:center;gap:7px;color:var(--color-neutral-500)"><Spinner size={10} />{t('Downloading history…')}</span>}
      <span style="color:var(--color-neutral-600)">{st.env === 'demo' ? t('Practice') : t('Live')}{st.data && st.data.accountId ? ' · #' + st.data.accountId : ''}</span>
    </div>
  );
}

function titleFor(route, m) {
  const [p, a] = route;
  if (p === 'instrument') {
    const pos = m.d && m.d.positions.find(x => x.ticker === a);
    return pos ? pos.sym : (a || '').replace(/^yf:/, '').replace(/_EQ$/, '').replace(/_[A-Z]{2}$/, '');
  }
  if (p === 'settings') return t('Settings');
  if (p === 'pies' && a != null) return t('Pie');
  return (NAV().find(x => x[0] === p) || [0, ''])[1];
}

function App({ init }) {
  const [st, setSt] = useState(init.state);
  const [settings, setSettings] = useState(init.settings);
  const [libStatus, setLibStatus] = useState(init.lib || {});
  const [libTick, setLibTick] = useState({});
  const [series, setSeries] = useState(null);
  const [route, setRoute] = useState(() => parseRoute(init.route));
  const hist = useRef([]);
  const now = useNow(1000);
  useEffect(() => {
    api.onState(setSt); api.onSettings(setSettings);
    api.onLib(e => {
      if (e.status) setLibStatus(e.status);
      setLibTick(x => ({ ...x, [e.what]: (x[e.what] || 0) + 1, ...(e.what === 'sync-done' ? { orders: (x.orders || 0) + 1, dividends: (x.dividends || 0) + 1, transactions: (x.transactions || 0) + 1 } : {}) }));
    });
    api.onAppGoto(r => go(...parseRoute(r)));
  }, []);
  const themeKey = [settings.theme, settings.accent, settings.tint, settings.textColor, settings.bgColor, (settings.bgColors || []).join()].join('|');
  const applied = useRef('');
  if (applied.current !== themeKey) { applied.current = themeKey; applyTheme(settings.theme, settings.accent, settings.tint, settings.textColor, settings.bgColor, settings.bgColors); }
  setLang(settings.language || 'cs');
  useEffect(() => applyMotion(settings.motion), [settings.motion]);

  const appRange = settings.appRange || '1M';
  useEffect(() => { api.lib('series', { range: appRange }).then(r => r && !r.error && setSeries(r)); }, [appRange, st.lastSync, st.data && st.data.value, settings.displayCurrency]);

  const go = (page, arg) => {
    setRoute(r => { if (r[0] !== page || r[1] !== arg) hist.current.push(r); return [page, arg]; });
    const main = document.querySelector('.main-scroll'); if (main) main.scrollTop = 0;
  };
  const back = () => { const r = hist.current.pop(); if (r) setRoute(r); };
  const nav = { go, back };
  navRef = nav;
  useEffect(() => {
    const k = e => { if (e.altKey && e.key === 'ArrowLeft') back(); if (e.key === 'BrowserBack') back(); };
    const mb = e => { if (e.button === 3) back(); };
    window.addEventListener('keydown', k); window.addEventListener('mouseup', mb);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('mouseup', mb); };
  }, []);

  const set = patch => { setSettings(x => ({ ...x, ...patch })); api.setSettings(patch); };
  const setAppRange = r => set({ appRange: r });
  const stFull = { ...st, lib: libStatus };
  const stApp = useMemo(() => (st.data && series ? { ...st, data: { ...st.data, series: series.series, period: series.period } } : st), [st, series]);
  const m = useModel(stApp, settings);

  // background: the widget's dithered card, rendered for the window size (debounced on resize)
  const [dim, setDim] = useState([window.innerWidth, window.innerHeight]);
  useEffect(() => {
    let h; const on = () => { clearTimeout(h); h = setTimeout(() => setDim([window.innerWidth, window.innerHeight]), 220); };
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on);
  }, []);
  // full window resolution (patterns stay crisp), no card rim — the window has its own corners
  const bg = useMemo(() => ditheredBg(settings.theme, settings.accent, settings.tint || 0, Math.max(200, dim[0]), Math.max(200, dim[1]), 0.05, 0.3, { noRim: true }),
    [settings.theme, settings.accent, settings.tint, settings.bgColor, (settings.bgColors || []).join(), dim[0], dim[1]]);

  const market = st.market || {};
  const closed = st.status === 'closed' || (st.data && settings.pauseWhenClosed && market.open === false && st.status !== 'live');
  const [page, arg] = route;
  let body;
  if (!st.connected && page !== 'settings') {
    body = (
      <div style="display:flex;justify-content:center;padding-top:40px">
        <div class="wg" style={`width:620px;height:304px;background:url(${ditheredBg(settings.theme, settings.accent, settings.tint || 0, 620, 304)}) 0 0/100% 100% no-repeat`}>
          <Connect st={st} settings={settings} />
        </div>
      </div>
    );
  } else if (!m.d && page !== 'settings') {
    body = st.status === 'error' ? <ErrorCard st={st} now={now} /> : <div style="display:flex;justify-content:center;padding:80px"><Spinner size={22} /></div>;
  } else if (page === 'settings') body = <SettingsPage tab={arg} init={init} />;
  else if (page === 'holdings') body = <Holdings m={m} />;
  else if (page === 'instrument') body = <Instrument key={arg} ticker={arg} m={m} />;
  else if (page === 'activity') body = <Activity m={m} tab={arg} />;
  else if (page === 'orders') body = <Orders m={m} />;
  else if (page === 'pies') body = <Pies m={m} id={arg} />;
  else if (page === 'reports') body = <Reports m={m} />;
  else body = <Overview m={m} closed={closed} />;

  const ctx = { st: stFull, settings, set, setAppRange, nav, libTick, init };
  const widgetOn = !!settings.showWidget && (!MAC || settings.macMode !== 'menubar');
  const ready = !!st.data || !st.connected || st.status === 'error';
  return (
    <Ctx.Provider value={ctx}>
      <div class={'appwin' + (MAC ? ' mac' : '')} style={`background-image:url(${bg})`}>
        <aside class="side">
          <div class="brand drag">
            <Tile px={26} />
            <span style="display:flex;flex-direction:column;gap:3px">
              <span style={`font:500 13px/1 ${F};color:var(--color-neutral-100)`}>Trading 212</span>
              <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}>Invest · v{init.version}</span>
            </span>
          </div>
          <nav class="nav">
            {NAV().map(([k, label, icon]) => (
              <button class={'nav-i' + (page === k || (k === 'holdings' && page === 'instrument' && !String(arg).startsWith('yf:')) ? ' on' : '')} onClick={() => go(k)}>
                <i class={'ph ' + icon}></i><span>{label}</span>
                {k === 'orders' && libStatus.pendingCount ? <span class="badge">{libStatus.pendingCount}</span> : null}
              </button>
            ))}
            <span style="flex:1"></span>
            <button class={'nav-i' + (widgetOn ? ' w-on' : '')} title={widgetOn ? t('Hide the widget') : t('Show the widget on the desktop')} onClick={() => {
              if (widgetOn) { api.hideWidget(); toast(t('Widget hidden'), 'ph-eye-slash'); }
              else { api.showWidget(); toast(MAC && settings.macMode === 'menubar' ? t('Widget shown on the desktop and in the menu bar') : t('Widget shown on the desktop'), 'ph-app-window'); }
            }}>
              <i class="ph ph-app-window"></i><span>{t('Widget')}</span>
              <span class={'sw mini' + (widgetOn ? ' on' : '')} aria-hidden="true"><span class="knob"></span></span>
            </button>
            <button class={'nav-i' + (page === 'settings' ? ' on' : '')} onClick={() => go('settings', 'account')}><i class="ph ph-gear-six"></i><span>{t('Settings')}</span></button>
          </nav>
          <SideStatus st={stFull} now={now} />
        </aside>
        <div class="mainpane">
          <header class="top drag">
            {hist.current.length > 0 && <button class="tb nodrag" title={t('Back')} onClick={back}><i class="ph ph-arrow-left"></i></button>}
            <span style={`font:500 18px/1 ${F};letter-spacing:-.01em;color:var(--color-neutral-100)`}>{titleFor(route, m)}</span>
            <span style="flex:1"></span>
            <div class="nodrag" style="display:flex;align-items:center;gap:10px">
              {st.connected && <Search />}
              <button class="tb" title={t('Refresh now')} onClick={() => { api.refresh(); api.lib('sync'); }}><i class="ph ph-arrow-clockwise"></i></button>
            </div>
            <WinControls />
          </header>
          <main class="main-scroll scroll" key={page + ':' + (page === 'settings' ? '' : arg)}>{body}</main>
        </div>
        <Toasts />
        {settings.motion !== 'off' && <Boot ready={ready} bg={bg} />}
      </div>
    </Ctx.Provider>
  );
}

function ErrorCard({ st, now }) {
  const c = errorCopy(st.error);
  const secs = st.error && st.error.retryAt ? Math.max(0, Math.round((st.error.retryAt - now) / 1000)) : null;
  return (
    <Card style="max-width:560px;margin:60px auto">
      <Empty icon="ph-warning-circle" title={c.title} text={(c.network ? t('No answer from Trading 212 — check your internet connection.') : t('Trading 212 returned') + ' ' + c.code + '. ') + ' ' + c.hint}>
        <div style="display:flex;gap:10px;margin-top:6px">
          <button class="btn btn-primary" style="font-size:12.5px" onClick={() => navRef.go('settings', 'account')}>{t('Reconnect')}</button>
          <button class="btn btn-ghost" style="font-size:12.5px" onClick={() => api.refresh()}>{t('Retry')}</button>
        </div>
        {secs != null && <span class="t2">{t('Next automatic retry in {n} s', { n: secs })}</span>}
      </Empty>
    </Card>
  );
}

function parseRoute(r) {
  const [p, ...rest] = String(r || 'overview').split('/');
  const a = rest.join('/');
  const page = ['overview', 'holdings', 'instrument', 'activity', 'orders', 'pies', 'reports', 'settings'].includes(p) ? p : 'overview';
  return [page, a === '' ? undefined : page === 'pies' ? Number(a) : a];
}

api.init().then(init => {
  applyTheme(init.settings.theme, init.settings.accent, init.settings.tint, init.settings.textColor, init.settings.bgColor, init.settings.bgColors);
  setLang(init.settings.language || 'cs');
  MAC = init.platform === 'darwin';
  setMac(MAC);
  applyMotion(init.settings.motion);
  render(<App init={init} />, document.getElementById('root'));
});
