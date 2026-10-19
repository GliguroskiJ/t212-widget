import { render } from 'preact';
import { useState, useEffect, useRef, useMemo, useCallback } from 'preact/hooks';
import {
  UP, DOWN, applyTheme, ditheredBg, applyMotion, agoStr, hhmm, linePath
} from './shared.js';
import {
  F, useNow, Tile, Dot, ClosedChip, Eyebrow, FillChart, Chart, RangeBar, RangeChips, Btn, useModel,
  Pill, Stat, GrowBar, axisLabels, tabStyle, Mini, Alloc, errorCopy, Connect
} from './ui.jsx';
import { t, setLang, locale } from './i18n.js';
import { marketStatus } from '../main/market.js';

const api = window.api;
const POPOVER = new URLSearchParams(location.search).get('mode') === 'popover';
const SIZE_KEY = POPOVER ? 'popoverSize' : 'size';


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
      <button type="button" class={'corner ia' + (open ? ' on' : '')} title={t('Menu')} onClick={() => setOpen(o => !o)}>
        <i class="ph ph-dots-three" style="font-size:15px"></i></button>
      {open && (
        <div class="menu ia">
          <button class="mi" onClick={act(() => api.refresh())}><i class="ph ph-arrow-clockwise"></i>{t('Refresh now')}</button>
          <div class="msep"></div>
          <div class="mlabel">{t('Widget size')}</div>
          <div class="msizes">
            {sizes.map(([k, s, tt]) => (
              <button class={'msz' + (settings[SIZE_KEY] === k ? ' on' : '')} title={t(tt)} onClick={() => api.setSettings({ [SIZE_KEY]: k })}>{s}</button>
            ))}
          </div>
          {!POPOVER && <>
          <button class="mi" onClick={act(() => api.setSettings({ lockPosition: !settings.lockPosition }))}>
            <i class={'ph ' + (settings.lockPosition ? 'ph-lock-simple-open' : 'ph-lock-simple')}></i>{settings.lockPosition ? t('Unlock position') : t('Lock position')}</button>
          <button class="mi" onClick={act(() => api.setSettings({ alwaysOnTop: !settings.alwaysOnTop }))}>
            <i class="ph ph-push-pin"></i>{settings.alwaysOnTop ? t('Don\u2019t keep on top') : t('Keep on top')}</button>
          </>}
          <button class="mi" onClick={act(() => api.openApp())}><i class="ph ph-app-window"></i>{t('Open app')}</button>
          <button class="mi" onClick={act(() => api.openSettings())}><i class="ph ph-gear-six"></i>{t('Settings…')}</button>
          <div class="msep"></div>
          {!POPOVER && <button class="mi" onClick={act(() => api.hideWidget())}><i class="ph ph-eye-slash"></i>{t('Hide widget')}</button>}
          <button class="mi danger" onClick={act(() => api.quit())}><i class="ph ph-power"></i>{t('Quit')}</button>
        </div>
      )}
    </div>
  );
}


function Small({ m, st, now, closed }) {
  return (
    <div style="width:300px;height:304px;padding:20px;display:flex;flex-direction:column;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:20px">
        <Tile px={20} muted={closed} />
        <span style={`font:500 11px/1 ${F};color:var(--color-neutral-${closed ? 500 : 400})`}>Portfolio</span>
        <span style="flex:1"></span>
        {closed ? <ClosedChip /> : <Dot color={m.trend} />}
      </div>
      <Eyebrow mb={8}>{closed ? t('At close') : t('Total value')}</Eyebrow>
      <div style={`display:flex;align-items:baseline;gap:3px;font-variant-numeric:tabular-nums;${closed ? 'opacity:.72' : ''}`}>
        <span style={`font:300 28px/1 ${F};letter-spacing:-.03em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-${closed ? 600 : 500})`}>{m.cur}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px">
        <Pill m={m} closed={closed} />
        {!closed && <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-500);white-space:nowrap`}>{m.chgLabel}</span>}
      </div>
      <FillChart values={m.values} tipFor={m.tipFor} pad={5} color={m.trend} gid="gS" closed={closed} animKey={st.range} marker glowPx={5} mr={2.3} wrapStyle="margin-top:16px" />
      <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);margin-top:12px`}>
        {closed ? `${t('Opens in {x}', { x: st.market.opensIn || '—' })} · ${st.market.names}` : t('Updated {x}', { x: agoStr(st.lastSync, now) })}</span>
    </div>
  );
}

function Medium({ m, st, now, closed, settings }) {
  const setRange = r => api.setSettings({ range: r });
  return (
    <div style="width:620px;height:304px;padding:22px 24px;display:grid;grid-template-columns:250px 1fr;gap:26px;box-sizing:border-box;position:relative">
      <div style="position:relative;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:22px">
          <Tile px={22} muted={closed} />
          <span style={`font:500 12px/1 ${F};color:var(--color-neutral-${closed ? 500 : 300})`}>Invest · Portfolio</span>
        </div>
        <Eyebrow size={10} mb={9}>{closed ? t('At close') : t('Total value')}</Eyebrow>
        <div style={`display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap;${closed ? 'opacity:.72' : ''}`}>
          <span style={`font:300 34px/1 ${F};letter-spacing:-.03em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
          <span style={`font:300 18px/1 ${F};color:var(--color-neutral-500)`}>{m.fmt.dec}{m.sp.dec}</span>
          <span style={`font:400 12px/1 ${F};color:var(--color-neutral-500);margin-left:4px`}>{m.cur}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
          <Pill m={m} closed={closed} size={12} icon={11} pad="4px 8px 4px 6px" />
          {!closed && <span style={`font:400 12px/1 ${F};color:var(--color-neutral-400);font-variant-numeric:tabular-nums;white-space:nowrap`}>{m.chgAbsStr} {m.chgLabel}</span>}
        </div>
        <span style="flex:1"></span>
        <RangeBar m={m} range={settings.range} closed={closed} series={m.d.series} />
        <span style="flex:1"></span>
        <div style="display:flex;gap:16px;padding-top:14px;border-top:1px solid rgba(var(--ink-rgb),.08)">
          <Stat label={t('Free cash')} value={`${m.cashStr} ${m.cur}`} />
          <Stat label={t('All-time')} value={m.allTimeStr} color={m.allTimeColor} />
          <Stat label={t('Dividends')} value={m.divStr} title={m.divTitle} />
        </div>
      </div>
      <div style="position:relative;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end">
          <span style={`display:flex;align-items:center;gap:5px;font:400 10px/1 ${F};color:var(--color-neutral-500);margin-right:auto`}>
            {closed ? <ClosedChip /> : <><Dot color={m.trend} />{t('live')} · {agoStr(st.lastSync, now)}</>}</span>
          <RangeChips range={settings.range} onPick={setRange} list={['1D', '1W', '1M', '1Y']} />
        </div>
        <FillChart values={m.values} tipFor={m.tipFor} pad={8} sw={1.7} color={m.trend} gid="gM" gop={.28} glowPx={7} marker
          draw={1.2} fade={1.3} fadeDelay={.35} closed={closed} animKey={settings.range} wrapStyle="margin-top:10px"
          grid={(w, h) => <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="rgba(var(--ink-rgb),.07)" stroke-width="1" stroke-dasharray="2 4"></line>} />
        <div style="display:flex;gap:8px;margin-top:8px">
          {m.positions.slice(0, 3).map(p => (
            <div class="hov-chip" title={p.name} style="flex:1;min-width:0;padding:8px 9px;border-radius:6px;background:rgba(var(--ink-rgb),.035);box-shadow:inset 0 0 0 1px rgba(var(--ink-rgb),.05);display:flex;flex-direction:column;gap:5px">
              <span style={`font:500 11px/1 ${F};color:var(--color-neutral-200);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{p.sym}</span>
              <span style={`font:400 10.5px/1 ${F};color:${p.color};font-variant-numeric:tabular-nums`}>{p.pctStr}%</span>
            </div>
          ))}
          {!m.positions.length && <span style={`font:400 11px/1.4 ${F};color:var(--color-neutral-600);padding:8px 0`}>{t('No open positions')}</span>}
        </div>
      </div>
    </div>
  );
}


function Rail({ m, st, now, closed, settings }) {
  return (
    <div style="width:320px;height:704px;padding:22px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:8px">
        <Tile px={22} muted={closed} />
        <span style={`font:500 12px/1 ${F};color:var(--color-neutral-${closed ? 500 : 300})`}>Invest</span>
        <span style="flex:1"></span>
        {closed ? <ClosedChip /> :
          <span style={`display:flex;align-items:center;gap:5px;font:400 10px/1 ${F};color:var(--color-neutral-500)`}><Dot color={m.trend} />{t('live')}</span>}
      </div>
      <div style="display:flex;flex-direction:column;gap:9px">
        <Eyebrow>{closed ? t('At close') : t('Total value')}</Eyebrow>
        <div style={`display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;${closed ? 'opacity:.72' : ''}`}>
          <span style={`font:300 31px/1 ${F};letter-spacing:-.03em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
          <span style={`font:400 12px/1 ${F};color:var(--color-neutral-500)`}>{m.cur}</span>
        </div>
        <div style="display:flex;align-items:center;gap:9px">
          <Pill m={m} closed={closed} />
          {!closed && <span style={`font:400 11.5px/1 ${F};color:var(--color-neutral-400);font-variant-numeric:tabular-nums;white-space:nowrap`}>{m.chgAbsStr} {m.chgLabel}</span>}
        </div>
      </div>
      <Chart values={m.values} tipFor={m.tipFor} w={276} h={84} pad={6} sw={1.6} color={m.trend} gid="gR" gop={.26} glowPx={6} marker mr={2.4} draw={1.2} closed={closed} animKey={settings.range} />
      <div style="display:flex;flex-direction:column;gap:10px;min-height:0;flex:1">
        <Eyebrow>{t('Holdings')}</Eyebrow>
        <div class="scroll" style="display:flex;flex-direction:column;gap:10px;min-height:0;margin-right:-6px;padding-right:6px">
          {m.positions.map(p => (
            <div class="hov-rail" style="display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:6px;background:rgba(var(--ink-rgb),.035);box-shadow:inset 0 0 0 1px rgba(var(--ink-rgb),.05);flex:none">
              <div style="display:flex;align-items:baseline;gap:8px;min-width:0">
                <span style={`font:500 11.5px/1 ${F};color:var(--color-neutral-200);flex:none`}>{p.sym}</span>
                <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}>{p.name}</span>
                <span style="flex:1"></span>
                <span style={`font:500 11px/1 ${F};color:${p.color};font-variant-numeric:tabular-nums;flex:none`}>{p.pctStr}%</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <div style="flex:1;height:3px;border-radius:2px;background:rgba(var(--ink-rgb),.06);overflow:hidden">
                  <GrowBar color={p.ramp} w={p.barW} dur={1.1} />
                </div>
                <span style={`font:400 10px/1 ${F};color:var(--color-neutral-500);font-variant-numeric:tabular-nums`}>{p.valStr}</span>
              </div>
            </div>
          ))}
          {!m.positions.length && <span style={`font:400 11px/1.4 ${F};color:var(--color-neutral-600)`}>{t('No open positions')}</span>}
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:14px;border-top:1px solid rgba(var(--ink-rgb),.08)">
        <Stat label={t('Cash')} value={`${m.cashStr} ${m.cur}`} />
        <div style="text-align:right"><Stat label={t('Dividends YTD')} value={m.divFull} title={m.divTitle} /></div>
      </div>
      {closed && <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600);margin-top:-8px`}>{t('Opens in {x}', { x: st.market.opensIn || '—' })} · {st.market.names}</span>}
    </div>
  );
}


function Large({ m, st, now, closed, settings }) {
  const view = settings.largeView || 'chart';
  const setView = v => api.setSettings({ largeView: v });
  const [openRow, setOpenRow] = useState(null);
  return (
    <div style="width:620px;height:620px;padding:24px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box;position:relative">
      <div style="position:relative;display:flex;align-items:center;gap:9px;padding-right:14px">
        <Tile px={24} muted={closed} />
        <span style={`font:500 13px/1 ${F};color:var(--color-neutral-${closed ? 500 : 200})`}>Trading 212 · Invest</span>
        <span style="flex:1"></span>
        {closed ? <ClosedChip /> :
          <span style={`display:flex;align-items:center;gap:5px;font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}><Dot color={m.trend} />{t('live')} · {agoStr(st.lastSync, now)}</span>}
        <i class="ph ph-arrow-clockwise hov-icon ia" title={t('Refresh now')} onClick={() => api.refresh()} style="font-size:14px;color:var(--color-neutral-600)"></i>
      </div>
      <div style="position:relative;display:flex;align-items:flex-end;gap:20px">
        <div style="display:flex;flex-direction:column;gap:9px">
          <Eyebrow>{closed ? t('At close') : t('Total value')}</Eyebrow>
          <div style={`display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;white-space:nowrap;${closed ? 'opacity:.72' : ''}`}>
            <span style={`font:300 42px/1 ${F};letter-spacing:-.035em;${closed ? 'color:var(--color-neutral-200)' : ''}`}>{m.sp.int}</span>
            <span style={`font:300 20px/1 ${F};color:var(--color-neutral-500)`}>{m.fmt.dec}{m.sp.dec}</span>
            <span style={`font:400 13px/1 ${F};color:var(--color-neutral-500);margin-left:4px`}>{m.cur}</span>
          </div>
        </div>
        <span style="flex:1"></span>
        <div style="display:flex;flex-direction:column;gap:7px;align-items:flex-end">
          {closed ? <Pill m={m} closed /> : <Pill m={m} size={12.5} icon={11} pad="4px 8px 4px 6px" extra={' · ' + m.chgAbsStr} />}
          <span style={`font:400 11px/1 ${F};color:var(--color-neutral-500);font-variant-numeric:tabular-nums`}>
            {m.per.range === 'ALL' ? m.chgLabel : <>{m.chgLabel} · {t('All-time {v} · {p}%', { v: m.allTimeStr + ' ' + m.cur, p: m.allTimePctStr })}</>}</span>
        </div>
      </div>
      <div style="position:relative;display:flex;gap:4px;padding:3px;border-radius:7px;background:rgba(var(--ink-rgb),.045);box-shadow:inset 0 0 0 1px rgba(var(--ink-rgb),.05);align-self:flex-start">
        <button type="button" class="ia" onClick={() => setView('chart')} style={tabStyle(view === 'chart')}>{t('Chart')}</button>
        <button type="button" class="ia" onClick={() => setView('positions')} style={tabStyle(view === 'positions')}>{t('Positions')}</button>
        <button type="button" class="ia" onClick={() => setView('alloc')} style={tabStyle(view === 'alloc')}>{t('Allocation')}</button>
      </div>

      {view === 'chart' && (
        <div key="chart" style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0;animation:nfade .4s ease both">
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <RangeChips range={settings.range} onPick={r => api.setSettings({ range: r })} list={['1D', '1W', '1M', '1Y', 'ALL']} size={10.5} padX={8} />
          </div>
          <FillChart values={m.values} tipFor={m.tipFor} pad={12} sw={1.9} color={m.trend} gid="gL" gop={.3} glowPx={8} marker mr={2.8} pr={5}
            draw={1.35} fade={1.3} fadeDelay={.35} closed={closed} animKey={settings.range} wrapStyle="margin-top:10px"
            grid={(w, h) => [0.25, 0.5, 0.75].map(f => <line x1="0" y1={h * f} x2={w} y2={h * f} stroke={f === 0.5 ? 'rgba(var(--ink-rgb),.07)' : 'rgba(var(--ink-rgb),.055)'} stroke-dasharray="2 5"></line>)} />
          <div style="display:flex;justify-content:space-between;margin-top:8px">
            {axisLabels(m.d.series, settings.range).map(l => <span style={`font:400 10px/1 ${F};color:var(--color-neutral-600)`}>{l}</span>)}
          </div>
        </div>
      )}

      {view === 'positions' && (
        <div key="pos" class="scroll" style="position:relative;display:flex;flex-direction:column;flex:1;min-height:0;gap:1px;animation:nfade .4s ease both;margin-right:-6px;padding-right:6px">
          {m.positions.map(p => {
            const open = openRow === p.ticker;
            return (
              <div class="hov-row ia" onClick={() => setOpenRow(o => (o === p.ticker ? null : p.ticker))}
                style={`cursor:pointer;border-radius:6px;padding:9px 10px;flex:none;background:${open ? 'rgba(var(--acc-rgb),.13)' : 'rgba(var(--ink-rgb),.03)'}`}>
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
                  <div style="display:flex;gap:26px;margin-top:10px;padding-top:10px;border-top:1px solid rgba(var(--ink-rgb),.08);animation:nfade .3s ease both">
                    <Mini label={t('Qty')} value={m.fmt(p.qty, p.qty % 1 ? 4 : 0)} />
                    <Mini label={t('Avg price')} value={`${m.fmt(p.avg, 2)} ${p.avgCur}`} />
                    <Mini label={t('P/L')} value={`${m.fmt.signed(p.pl, 0)} ${m.cur}`} color={p.color} />
                    <Mini label={t('Weight')} value={`${p.allocStr}%`} />
                  </div>
                )}
              </div>
            );
          })}
          {!m.positions.length && <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-600);padding:10px`}>{t('No open positions yet.')}</span>}
          <span style="flex:1"></span>
        </div>
      )}

      {view === 'alloc' && <Alloc m={m} />}

      <div style="position:relative;display:flex;align-items:center;justify-content:space-between;padding-top:14px;border-top:1px solid rgba(var(--ink-rgb),.08)">
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>{t('Free cash')} <span style="color:var(--color-neutral-300)">{m.cashStr} {m.cur}</span></span>
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`} title={m.divTitle}>{t('Dividends YTD')} <span style="color:var(--color-neutral-300)">{m.divStr}</span></span>
        <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>
          {closed ? t('Opens in {x}', { x: st.market.opensIn || '—' }) : t('{n} holdings · {m} markets', { n: m.d.holdings, m: m.d.markets })}</span>
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
      <div style="width:20px;height:20px;border-radius:5px;border:1px solid var(--color-neutral-800);background:rgba(var(--ink-rgb),.04)"></div>
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
        {c.network ? t('No answer from Trading 212 — check your internet connection.') : <>{t('Trading 212 returned')} <span class="mono" style={`font-size:${compact ? 10.5 : 11.5}px;color:${DOWN}`}>{c.code}</span>.</>}
        {' '}{c.hint}{hasData ? ' ' + t('Values are from the last successful sync and are no longer live.') : ''}</p>
      <div style="display:flex;gap:9px;margin-top:4px">
        <Btn kind="primary" onClick={() => api.openSettings('account')}>{t('Reconnect')}</Btn>
        <Btn kind="ghost" onClick={() => api.refresh()} style="color:var(--color-neutral-400)">{t('Retry')}</Btn>
      </div>
      {secs != null && <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-600);margin-top:2px`}>{t('Next automatic retry in {n} s', { n: secs })}</span>}
    </div>
  );
}

function ErrorView({ size, m, st, now }) {
  const [w, h] = DIMS[size];
  const last = m.d ? (
    <>
      <Eyebrow size={10} mb={9}>{t('Last known · {t}', { t: hhmm(st.lastSync) })}</Eyebrow>
      <div style="display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;opacity:.6">
        <span style={`font:300 ${size === 'small' ? 28 : 34}px/1 ${F};letter-spacing:-.03em;color:var(--color-neutral-300)`}>{m.sp.int}</span>
        <span style={`font:400 12px/1 ${F};color:var(--color-neutral-600)`}>{m.cur}</span>
      </div>
    </>
  ) : <Eyebrow size={10}>{t('No data yet')}</Eyebrow>;
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
        <div style="display:flex;flex-direction:column;justify-content:center;padding-left:24px;border-left:1px solid rgba(var(--ink-rgb),.08)">
          <ErrorBlock st={st} now={now} />
        </div>
      </div>
    );
  }
  return (
    <div style={`width:${w}px;height:${h}px;padding:20px;display:flex;flex-direction:column;box-sizing:border-box`}>
      {head(t('Portfolio'))}
      {last}
      <div style={`margin-top:${size === 'rail' ? 40 : 16}px;padding-top:${size === 'rail' ? 20 : 14}px;border-top:1px solid rgba(var(--ink-rgb),.08)`}>
        <ErrorBlock st={st} now={now} compact />
      </div>
      {size === 'rail' && <><span style="flex:1"></span>{flat}</>}
    </div>
  );
}


// ── app ──────────────────────────────────────────────────────
function App({ init }) {
  const [st, setSt] = useState(init.state);
  const [settings, setSettings] = useState(init.settings);
  const now = useNow(1000);
  useEffect(() => { api.onState(setSt); api.onSettings(setSettings); }, []);
  const themeKey = [settings.theme, settings.accent, settings.tint, settings.textColor].join('|');
  const applied = useRef('');
  if (applied.current !== themeKey) { applied.current = themeKey; applyTheme(settings.theme, settings.accent, settings.tint, settings.textColor); }
  setLang(settings.language || 'cs');
  useEffect(() => applyMotion(settings.motion), [settings.motion]);

  // click-through outside the card; manual dragging on the card
  useEffect(() => {
    let inside = null;
    const mv = e => {
      if (POPOVER) return;
      const i = !!(e.target && e.target.closest && e.target.closest('.wg'));
      if (i !== inside) { inside = i; api.setIgnoreMouse(!i); }
    };
    window.addEventListener('mousemove', mv);
    if (!POPOVER) api.setIgnoreMouse(true);
    return () => window.removeEventListener('mousemove', mv);
  }, []);
  const dragging = useRef(false);
  const onDown = useCallback(e => {
    if (POPOVER || e.button !== 0 || settings.lockPosition) return;
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

  // market clock runs locally so "Opens in" counts down live and flips exactly on time
  const market = useMemo(() => marketStatus(new Date(now), st.marketCodes), [Math.floor(now / 1000), (st.marketCodes || []).join()]);
  useEffect(() => {
    if (!POPOVER) return;
    const k = e => { if (e.key === 'Escape') api.hidePopover(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const m = useModel(st, settings);
  const status = (st.status === 'live' || st.status === 'closed') && st.data
    ? (market.open || !settings.pauseWhenClosed ? 'live' : 'closed') : st.status;
  let size = settings[SIZE_KEY] || 'medium';
  let body;
  if (status === 'first-run') { size = 'medium'; body = <Connect st={st} settings={settings} />; }
  else if (!st.data && status !== 'error') body = <Loading size={size} />;
  else if (status === 'error') body = <ErrorView size={size} m={m} st={st} now={now} />;
  else {
    const closed = status === 'closed';
    const P = { m, st: { ...st, market, range: settings.range }, now, closed, settings };
    body = size === 'small' ? <Small {...P} /> : size === 'large' ? <Large {...P} /> : size === 'rail' ? <Rail {...P} /> : <Medium {...P} />;
  }
  const [w, h] = DIMS[size] || DIMS.medium;
  const ov = status === 'first-run' || status === 'error' || !st.data ? [0, 0] : size === 'medium' ? [0.09, 0.45] : size === 'large' ? [0.08, 0.4] : [0, 0];
  const bg = useMemo(() => ditheredBg(settings.theme, settings.accent, settings.tint || 0, w, h, ov[0], ov[1]),
    [settings.theme, settings.accent, settings.tint, w, h, ov[0], ov[1]]);
  return (
    <div class="stage">
      <div key={size + (status === 'first-run' ? '-fr' : '')} class={'wg' + (settings.lockPosition || POPOVER ? '' : ' draggable')} style={`width:${w}px;height:${h}px;background:url(${bg}) 0 0/100% 100% no-repeat`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {body}
        {status !== 'first-run' && <CornerMenu settings={settings} />}
      </div>
    </div>
  );
}

api.init().then(init => {
  applyTheme(init.settings.theme, init.settings.accent, init.settings.tint, init.settings.textColor);
  setLang(init.settings.language || 'cs');
  applyMotion(init.settings.motion);
  render(<App init={init} />, document.getElementById('root'));
});
