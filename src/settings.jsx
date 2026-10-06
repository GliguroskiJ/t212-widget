import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { THEMES, UP, DOWN, applyTheme, applyMotion, agoStr, ACCENT_PRESETS, DEFAULT_ACCENT, ditheredBg, TEXT_PRESETS, resolveText } from './shared.js';
import { t, setLang } from './i18n.js';
import { marketStatus } from '../main/market.js';

const api = window.api;
let MAC = false;
const F = "'Inter',sans-serif";
const TABS = () => [['account', t('Account')], ['widget', t('Widget')], ['appearance', t('Appearance')], ['data', t('Data')], ['system', t('System')]];

// ── primitives (Nocturne) ────────────────────────────────────
function Seg({ value, options, onChange, size = 11.5 }) {
  return (
    <div style="display:inline-flex;gap:4px;padding:3px;border-radius:7px;background:rgba(var(--ink-rgb),.045);box-shadow:inset 0 0 0 1px rgba(var(--ink-rgb),.05)">
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <button type="button" onClick={() => onChange(v)} style={`border:0;cursor:pointer;padding:6px 12px;border-radius:5px;font:500 ${size}px/1 ${F};white-space:nowrap;transition:background .25s ease,color .25s ease,box-shadow .25s ease;` +
            (on ? 'background:var(--color-accent-900);color:var(--color-accent-200);box-shadow:inset 0 0 0 1px var(--color-accent-800);'
              : 'background:transparent;color:var(--color-neutral-500);')} class={on ? '' : 'seg-h'}>{label}</button>
        );
      })}
    </div>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} class={'sw' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <span class="knob"></span>
    </button>
  );
}

function Row({ title, desc, children, top }) {
  return (
    <div class="row" style={top ? 'align-items:flex-start' : ''}>
      <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1">
        <span style={`font:500 12.5px/1.2 ${F};color:var(--color-neutral-200)`}>{title}</span>
        {desc && <span style={`font:400 11.5px/1.5 ${F};color:var(--color-neutral-500);max-width:54ch`}>{desc}</span>}
      </div>
      <div style="flex:none;display:flex;align-items:center;gap:8px">{children}</div>
    </div>
  );
}

const Section = ({ label, children }) => (
  <div style="display:flex;flex-direction:column;gap:2px">
    <span style={`font:400 9.5px/1 ${F};letter-spacing:.13em;text-transform:uppercase;color:var(--color-neutral-600);margin:6px 0 6px`}>{label}</span>
    {children}
  </div>
);

const Dot = ({ color, breathe }) => <span class={breathe ? 'breathe' : ''} style={`width:6px;height:6px;border-radius:50%;flex:none;background:${color}`}></span>;

const Perm = ({ on, name, why, warn, err }) => {
  const [busy, setBusy] = useState(false);
  const msg = err ? (err.code === 401 || err.code === 403
    ? t('Trading 212 refused it ({c}) — tick \u201cHistory – Dividends\u201d on the key', { c: err.code })
    : t('couldn\u2019t load ({c}) — will retry', { c: err.code ? err.code : t('network') })) : why;
  return (
    <div style="display:flex;align-items:flex-start;gap:8px">
      <i class={'ph ' + (warn ? 'ph-warning-circle' : on ? 'ph-check-circle' : 'ph-minus-circle')} style={`font-size:15px;margin-top:1px;color:${warn ? DOWN : on ? UP : 'var(--color-neutral-600)'}`}></i>
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
        <span style={`font:500 12px/1.3 ${F};color:${on ? 'var(--color-neutral-200)' : 'var(--color-neutral-500)'}`}>{name}</span>
        <span title={err ? err.message : ''} style={`font:400 11px/1.3 ${F};color:${warn ? DOWN : 'var(--color-neutral-500)'}`}>{msg}</span>
        {err && <a href="#" style="font-size:11px;margin-top:2px" onClick={async e => { e.preventDefault(); setBusy(true); await api.recheckDividends(); setTimeout(() => setBusy(false), 1500); }}>{busy ? t('Checking…') : t('Check again')}</a>}
      </div>
    </div>
  );
};

// ── tabs ─────────────────────────────────────────────────────
function AccountTab({ s, st, set }) {
  const [env, setEnv] = useState(s.env);
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => setEnv(s.env), [s.env]);
  const connected = st && st.connected;
  const d = st && st.data;
  const connect = async () => {
    setMsg(null); setBusy(true);
    const r = await api.connect({ env, key, secret });
    setBusy(false);
    if (r.ok) { setKey(''); setSecret(''); setMsg({ ok: true, text: t('Connected · {c} account{id}', { c: r.currency, id: r.id ? ' #' + r.id : '' }) }); }
    else setMsg({ ok: false, text: r.message });
  };
  let statusLine;
  if (!connected) statusLine = <><Dot color="var(--color-neutral-600)" /><span>{t('Not connected')}</span></>;
  else if (st.status === 'error') statusLine = <><Dot color={DOWN} /><span>{t('Connection problem — {m}', { m: st.error ? st.error.message : '' })}</span></>;
  else statusLine = <><Dot color={UP} breathe /><span>{t('Connected')} · {s.env === 'demo' ? t('Practice') : t('Live')}{d ? ` · ${t('{c} account', { c: d.accountCurrency })}${d.accountId ? ' #' + d.accountId : ''}` : ''}{st.lastSync ? ` · ${t('synced {x}', { x: agoStr(st.lastSync, Date.now()) })}` : ''}</span></>;
  return (
    <>
      <div class="status">
        <span style={`display:flex;align-items:center;gap:8px;font:400 12px/1.4 ${F};color:var(--color-neutral-300);min-width:0`}>{statusLine}</span>
        <span style="flex:1"></span>
        {connected && <button type="button" class="btn btn-ghost" style="font-size:12.5px;color:var(--color-neutral-400)" onClick={() => { api.disconnect(); setMsg(null); }}>{t('Disconnect')}</button>}
      </div>
      <Section label={t('API key pair')}>
        <div class="perm">
          <span style={`font:500 12px/1.3 ${F};color:var(--color-neutral-200)`}>{t('Which API key permissions to tick')}</span>
          <span style={`font:400 11.5px/1.5 ${F};color:var(--color-neutral-500)`}>{t('Trading 212 → Settings → API (Beta) → Generate API key. The widget only reads data.')}</span>
          <div class="perm-grid">
            <Perm on name="Account data" why={t('total value, cash, P/L')} />
            <Perm on name="Portfolio" why={t('positions and allocation')} />
            <Perm on name="History – Dividends" why={t('Dividends YTD (optional)')} warn={st && st.divError} err={st && st.divError} />
            <Perm name={t('Everything else')} why={t('Orders, Pies, Metadata, other History — leave off')} />
          </div>
          <span style={`font:400 11.5px/1.5 ${F};color:var(--color-neutral-500)`}>
            {st && st.encrypted ? (MAC ? t('Keys are encrypted in the macOS Keychain.') : t('Keys are encrypted on this PC with Windows DPAPI.')) : t('Keys are stored locally on this PC.')}
            {' '}<a href="#" onClick={e => { e.preventDefault(); api.openExternal('https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key'); }}>{t('How to create a key')}</a></span>
        </div>
        <form onSubmit={e => { e.preventDefault(); connect(); }} style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;gap:14px">
            <label class="lbl" style="width:auto">{t('Environment')}</label>
            <Seg value={env} onChange={setEnv} options={[['live', t('Live')], ['demo', t('Practice')]]} />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="display:flex;flex-direction:column;gap:5px">
              <label class="lbl" style="display:flex;align-items:center;height:11px">{t('API key')}</label>
              <input class="input mono" type="text" spellcheck={false} value={key} placeholder={connected ? t('Saved — paste to replace') : t('Paste API key')} onInput={e => setKey(e.currentTarget.value)} style="font-size:12px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:5px">
              <label class="lbl" style="display:flex;align-items:center;height:11px;gap:5px">{t('Secret key')}<i class="ph ph-lock-simple" style="font-size:11px;color:var(--color-accent-400)"></i></label>
              <div style="position:relative;display:flex;align-items:center">
                <input class="input mono" type={show ? 'text' : 'password'} spellcheck={false} value={secret} placeholder={connected ? '••••••••••••' : t('Paste secret')} onInput={e => setSecret(e.currentTarget.value)} style="padding-right:30px;font-size:12px" />
                <i class={'ph hov-icon ' + (show ? 'ph-eye-slash' : 'ph-eye')} onClick={() => setShow(v => !v)} style="position:absolute;right:9px;font-size:14px;color:var(--color-neutral-500)"></i>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;min-height:32px">
            <button type="submit" class="btn btn-primary" disabled={busy || !key.trim() || !secret.trim()} style="font-size:13px">{connected ? t('Replace key') : t('Connect')}</button>
            {busy && <span style="display:flex;gap:8px;align-items:center">
              <span style="width:15px;height:15px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box"></span>
              <span style={`font:400 11.5px/1 ${F};color:var(--color-neutral-400)`}>{t('Verifying key pair · fetching account currency')}</span></span>}
            {!busy && msg && <span style={`display:flex;gap:7px;align-items:center;font:400 11.5px/1.4 ${F};color:${msg.ok ? UP : DOWN}`}>
              <i class={'ph ' + (msg.ok ? 'ph-check-circle' : 'ph-warning-circle')} style="font-size:14px;flex:none"></i>{msg.text}</span>}
          </div>
        </form>
      </Section>
    </>
  );
}

const SIZE_CARDS = [
  ['small', 'Small', '1 × 1', 300, 304],
  ['medium', 'Medium', '2 × 1', 620, 304],
  ['large', 'Large', '2 × 2', 620, 620],
  ['rail', 'Rail', 'side panel', 320, 704]
];

function WidgetTab({ s, set }) {
  return (
    <>
      <Section label={t('Size')}>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:8px">
          {SIZE_CARDS.map(([k, label, sub, w, h]) => {
            const sc = 64 / 704;
            const mw = Math.round(w * sc), mh = Math.round(h * sc);
            return (
              <button type="button" class={'szc' + (s.size === k ? ' on' : '')} onClick={() => set({ size: k })}>
                <div style="height:70px;display:flex;align-items:center;justify-content:center">
                  <div class="szmini" style={`width:${mw}px;height:${mh}px;background:url(${ditheredBg(s.theme, s.accent, s.tint || 0, mw, mh)}) 0 0/100% 100%`}></div>
                </div>
                <span style={`font:500 12px/1 ${F};color:var(--color-neutral-200)`}>{t(label)}</span>
                <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}>{t(sub)} · {w}×{h}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section label={t('Behaviour')}>
        <Row title={t('Show widget')} desc={t('Hide it without quitting — the app keeps running in the tray.')}><Switch on={s.showWidget} onChange={v => set({ showWidget: v })} /></Row>
        <Row title={t('Large widget opens on')} desc={t('The view shown in the 2 × 2 widget.')}><Seg value={s.largeView} onChange={v => set({ largeView: v })} options={[['chart', t('Chart')], ['positions', t('Positions')], ['alloc', t('Allocation')]]} /></Row>
        <Row title={t('Chart range')} desc={t('Also switchable right on the widget.')}><Seg value={s.range} onChange={v => set({ range: v })} options={[['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['1Y', '1Y'], ['ALL', 'ALL']]} size={11} /></Row>
      </Section>
    </>
  );
}

function ColourPicker({ s, set }) {
  const acc = (s.accent || DEFAULT_ACCENT).toLowerCase();
  const [hex, setHex] = useState(acc);
  useEffect(() => setHex(acc), [acc]);
  const isPreset = ACCENT_PRESETS.some(([c]) => c === acc);
  const commitHex = v => {
    let h = v.trim().toLowerCase(); if (!h.startsWith('#')) h = '#' + h;
    if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + h.slice(1).split('').map(c => c + c).join('');
    if (/^#[0-9a-f]{6}$/.test(h)) set({ accent: h }); else setHex(acc);
  };
  return (
    <div class="row" style="flex-direction:column;align-items:stretch;gap:12px">
      <div style="display:flex;align-items:center;gap:20px">
        <div style="display:flex;flex-direction:column;gap:4px;flex:1">
          <span style={`font:500 12.5px/1.2 ${F};color:var(--color-neutral-200)`}>{t('Accent colour')}</span>
          <span style={`font:400 11.5px/1.5 ${F};color:var(--color-neutral-500)`}>{t('Tile, chips, tabs, highlights and glows. Gains and losses stay green / red.')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="acc-prev" style={`background:${acc}`}></span>
          <input class="input mono" value={hex} spellcheck={false} maxLength={7} onInput={e => setHex(e.currentTarget.value)}
            onBlur={e => commitHex(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            style="width:92px;min-height:30px;padding:4px 8px;font-size:12px;text-transform:lowercase" />
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        {ACCENT_PRESETS.map(([c, name]) => (
          <button type="button" class={'dotc' + (c === acc ? ' on' : '')} title={t(name)} onClick={() => set({ accent: c })} style={`--c:${c}`}></button>
        ))}
        <label class={'dotc custom' + (!isPreset ? ' on' : '')} title={t('Custom colour')} style={!isPreset ? `--c:${acc}` : ''}>
          <i class="ph ph-eyedropper"></i>
          <input type="color" value={acc} onInput={e => set({ accent: e.currentTarget.value })} />
        </label>
        <span style="flex:1"></span>
        {acc !== DEFAULT_ACCENT && <button type="button" class="btn btn-ghost" style="font-size:12px;color:var(--color-neutral-400)" onClick={() => set({ accent: DEFAULT_ACCENT, tint: 0 })}>{t('Reset')}</button>}
      </div>
    </div>
  );
}

function TextColour({ s, set }) {
  const cur = s.textColor || 'auto';
  const isPreset = TEXT_PRESETS.some(([c]) => c === cur);
  const sw = ditheredBg(s.theme, s.accent, s.tint || 0, 44, 32);
  return (
    <div class="row" style="flex-direction:column;align-items:stretch;gap:12px">
      <div style="display:flex;flex-direction:column;gap:4px">
        <span style={`font:500 12.5px/1.2 ${F};color:var(--color-neutral-200)`}>{t('Text colour')}</span>
        <span style={`font:400 11.5px/1.5 ${F};color:var(--color-neutral-500)`}>{t('Auto picks dark text on light backgrounds. Applies to the widget, its menu and this window.')}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        {TEXT_PRESETS.map(([c, name]) => {
          const col = c === 'auto' ? resolveText('auto', s.theme) : c;
          const on = cur === c;
          return (
            <button type="button" class={'txc' + (on ? ' on' : '')} title={t(name)} onClick={() => set({ textColor: c })}>
              <span class="txs" style={`background:url(${sw}) 0 0/100% 100%;color:${col}`}>Aa</span>
              <span class="txl">{t(name)}</span>
            </button>
          );
        })}
        <label class={'txc' + (!isPreset ? ' on' : '')} title={t('Custom colour')}>
          <span class="txs" style={`background:url(${sw}) 0 0/100% 100%;color:${!isPreset ? cur : 'var(--color-neutral-300)'}`}><i class="ph ph-eyedropper"></i></span>
          <span class="txl">{!isPreset ? cur : t('Custom colour')}</span>
          <input type="color" value={!isPreset ? cur : '#e9e9ed'} onInput={e => set({ textColor: e.currentTarget.value })} />
        </label>
      </div>
    </div>
  );
}

function AppearanceTab({ s, set }) {
  const pct = Math.round((s.opacity || 1) * 100);
  return (
    <>
      <Section label={t('Background')}>
        <div class="thgrid">
          {Object.keys(THEMES).map(k => {
            const on = s.theme === k;
            return (
              <button type="button" class={'thc' + (on ? ' on' : '')} onClick={() => set({ theme: k })} title={t(THEMES[k].label)}>
                <span class="ths" style={`background:url(${ditheredBg(k, s.accent, s.tint || 0, 76, 48)}) 0 0/100% 100%;box-shadow:${THEMES[k].edge.split(',')[0]}`}>
                  <span style={`color:${resolveText(s.textColor, k)};font:300 13px/1 ${F};letter-spacing:-.02em`}>1,284</span>
                </span>
                <span class="txl">{t(THEMES[k].label)}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section label={t('Colour')}>
        <ColourPicker s={s} set={set} />
        <Row title={t('Tint the background')} desc={t('Blends the colour into the background type. 0 % keeps the original look.')}>
          <input type="range" class="rng" min="0" max="100" step="5" value={Math.round((s.tint || 0) * 100)} onInput={e => set({ tint: Number(e.currentTarget.value) / 100 })} style={`--p:${Math.round((s.tint || 0) * 100)}%`} />
          <span class="tnum" style={`width:36px;text-align:right;font:400 12px/1 ${F};color:var(--color-neutral-300)`}>{Math.round((s.tint || 0) * 100)}%</span></Row>
      </Section>
      <Section label={t('Text colour')}>
        <TextColour s={s} set={set} />
      </Section>
      <Section label={t('Display')}>
        <Row title={t('Motion')} desc={t('Subtle keeps number roll-ups but stops breathing and pulsing; Off shows final values immediately.')}>
          <Seg value={s.motion} onChange={v => set({ motion: v })} options={[['full', t('Full')], ['subtle', t('Subtle')], ['off', t('Off')]]} /></Row>
        <Row title={t('Widget opacity')} desc={t('Lets the desktop show through the whole widget.')}>
          <input type="range" class="rng" min="50" max="100" step="5" value={pct} onInput={e => set({ opacity: Number(e.currentTarget.value) / 100 })} style={`--p:${(pct - 50) * 2}%`} />
          <span class="tnum" style={`width:36px;text-align:right;font:400 12px/1 ${F};color:var(--color-neutral-300)`}>{pct}%</span></Row>
        <Row title={t('Number format')}><Seg value={s.numberFormat} onChange={v => set({ numberFormat: v })} options={[['en', '1,284,640.50'], ['cs', '1 284 640,50']]} /></Row>
      </Section>
    </>
  );
}

function DataTab({ s, set, st }) {
  const [cleared, setCleared] = useState(false);
  const mk = marketStatus(new Date(), st && st.marketCodes);
  return (
    <>
      <Section label={t('Sync')}>
        <Row title={t('Refresh every')} desc={t('Trading 212 allows one account request per 5 s — 30 s keeps well inside the limit.')}>
          <Seg value={s.refreshSeconds} onChange={v => set({ refreshSeconds: v })} options={[[10, '10 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']]} size={11} /></Row>
        <Row title={t('Pause when markets are closed')} desc={t('Uses the exchanges of your holdings ({x}). While they are closed the widget shows the closed state and syncs every 10 minutes.', { x: mk.names })}>
          <Switch on={s.pauseWhenClosed} onChange={v => set({ pauseWhenClosed: v })} /></Row>
      </Section>
      <Section label={t('Currency')}>
        <Row title={t('Display currency')} desc={t('Account = no conversion. Others use daily ECB rates (frankfurter.dev).')}>
          <Seg value={s.displayCurrency} onChange={v => set({ displayCurrency: v })} options={[['account', t('Account')], ['CZK', 'CZK'], ['EUR', 'EUR'], ['USD', 'USD'], ['GBP', 'GBP']]} size={11} /></Row>
      </Section>
      <Section label={t('History')}>
        <Row title={t('Fill gaps in the chart')} desc={t('When the PC was off, the missing part is rebuilt from market prices (Yahoo Finance) using your current holdings.')}>
          <Switch on={s.fillGaps !== false} onChange={v => set({ fillGaps: v })} /></Row>
        <Row title={t('Chart history')} desc={t('Stored on this PC — about 1 MB even after years. Day P/L is measured from the last value before midnight.')}>
          <button type="button" class="btn btn-secondary" style="font-size:12.5px" onClick={async () => { await api.clearHistory(); setCleared(true); setTimeout(() => setCleared(false), 2000); }}>
            {cleared ? <><i class="ph ph-check" style={`color:${UP}`}></i>{t('Cleared')}</> : t('Clear history')}</button></Row>
      </Section>
    </>
  );
}

// ── updates ──────────────────────────────────────────────────
const UPD_ERR = {
  notfound: 'No release on GitHub, or the repository is private and no token is set.',
  auth: 'The GitHub token doesn’t work — check it below.',
  rate: 'GitHub is rate limiting — will try again later.',
  network: 'GitHub is unreachable — check the connection.',
  http: 'GitHub returned an error.',
  verify: 'The download couldn’t be verified against the release — not installing.',
  noasset: 'The release has no file for this computer.'
};

function updateLine(u, now) {
  if (!u) return t('Not checked yet');
  switch (u.status) {
    case 'checking': return t('Checking…');
    case 'available': return t('Version {v} is available.', { v: u.latest });
    case 'downloading': return t('Downloading {p} %', { p: Math.round((u.progress || 0) * 100) });
    case 'ready': return t('Installing — the widget restarts in a moment.');
    case 'none': return t('You have the latest version · checked {x}', { x: agoStr(u.checkedAt, now) });
    case 'error': return t(UPD_ERR[u.error && u.error.kind] || 'GitHub returned an error.');
    default: return t('Not checked yet');
  }
}

function Updates({ s, set, info }) {
  const [u, setU] = useState(info.update);
  const [hasTok, setHasTok] = useState(!!info.hasGhToken);
  const [tok, setTok] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { api.onUpdate(setU); const i = setInterval(() => setNow(Date.now()), 15e3); return () => clearInterval(i); }, []);
  const busy = u && (u.status === 'checking' || u.status === 'downloading' || u.status === 'ready');
  const saveTok = async v => { const ok = await api.setGithubToken(v); setHasTok(ok); setTok(''); if (ok) api.checkUpdate(); };
  const err = u && u.status === 'error';
  return (
    <Section label={t('Updates')}>
      <Row title={t('Version {v}', { v: info.version })} desc={<span style={err ? `color:${DOWN}` : ''}>{updateLine(u, now)}</span>}>
        {u && u.status === 'available'
          ? <button type="button" class="btn btn-primary" style="font-size:12.5px" onClick={() => api.installUpdate()}><i class="ph ph-download-simple"></i>{t('Install {v}', { v: u.latest })}</button>
          : <button type="button" class="btn btn-secondary" style="font-size:12.5px" disabled={busy} onClick={() => api.checkUpdate()}>
              {u && u.status === 'checking'
                ? <span style="width:12px;height:12px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box"></span>
                : <i class="ph ph-arrows-clockwise"></i>}
              {t('Check for updates')}</button>}
      </Row>
      {u && u.status === 'downloading' && (
        <div style="height:3px;border-radius:2px;background:rgba(var(--ink-rgb),.07);overflow:hidden;margin:-4px 0 6px">
          <div style={`height:100%;width:${Math.round((u.progress || 0) * 100)}%;background:linear-gradient(to right,var(--color-accent-700),var(--color-accent-400));transition:width .3s ease`}></div>
        </div>
      )}
      <Row title={t('Check automatically')} desc={t('When the app starts (also after turning the PC on), after waking from sleep and every day at 12:00. Nothing is downloaded until you say yes.')}>
        <Switch on={s.autoUpdate !== false} onChange={v => set({ autoUpdate: v })} /></Row>
      {s.skippedVersion && <Row title={t('Skipped version')} desc={t('Version {v} won’t be offered automatically.', { v: s.skippedVersion })}>
        <button type="button" class="btn btn-ghost" style="font-size:12.5px" onClick={() => set({ skippedVersion: null })}>{t('Offer again')}</button></Row>}
      <Row top title={t('GitHub token')} desc={hasTok
        ? t('Saved and encrypted. Only needed while the repository is private.')
        : t('Only needed while the repository is private: a fine-grained token with read-only access to Contents of t212-widget.')}>
        {hasTok
          ? <button type="button" class="btn btn-ghost" style={`font-size:12.5px;color:${DOWN}`} onClick={() => saveTok(null)}>{t('Remove')}</button>
          : <form style="display:flex;gap:8px" onSubmit={e => { e.preventDefault(); if (tok.trim()) saveTok(tok.trim()); }}>
              <input class="input mono" type="password" spellcheck={false} value={tok} placeholder="github_pat_…" onInput={e => setTok(e.currentTarget.value)} style="width:170px;font-size:12px" />
              <button type="submit" class="btn btn-secondary" style="font-size:12.5px" disabled={!tok.trim()}>{t('Save')}</button>
            </form>}
      </Row>
    </Section>
  );
}

function SystemTab({ s, set, info }) {
  return (
    <>
      <Section label={t('Language')}>
        <Row title={t('Language')} desc={t('Widget, menus and this window.')}><Seg value={s.language || 'cs'} onChange={v => set({ language: v })} options={[['cs', 'Čeština'], ['en', 'English']]} /></Row>
      </Section>
      {MAC && <Section label={t('Menu bar')}>
        <Row title={t('Show portfolio in')} desc={t('Menu bar = click the icon at the top of the screen. Desktop = floating widget like on Windows.')}>
          <Seg value={s.macMode || 'menubar'} onChange={v => set({ macMode: v })} options={[['menubar', t('Menu bar')], ['desktop', t('Desktop')], ['both', t('Both')]]} /></Row>
        <Row title={t('Text next to the icon')}>
          <Seg value={s.menuBarText || 'value'} onChange={v => set({ menuBarText: v })} options={[['value', t('Value')], ['change', t('Day change')], ['none', t('Icon only')]]} /></Row>
        <Row title={t('Panel size')} desc={t('Size of the panel that opens from the menu bar.')}>
          <Seg value={s.popoverSize || 'medium'} onChange={v => set({ popoverSize: v })} options={[['small', t('Small')], ['medium', t('Medium')], ['large', t('Large')], ['rail', t('Rail')]]} /></Row>
      </Section>}
      <Section label={MAC ? 'macOS' : t('Windows')}>
        <Row title={MAC ? t('Open at login') : t('Start with Windows')} desc={t('Launch the widget when you sign in. Settings and position are remembered.')}><Switch on={s.startWithWindows} onChange={v => set({ startWithWindows: v })} /></Row>
        <Row title={t('Keep on top')} desc={t('Float above other windows instead of sitting on the desktop.')}><Switch on={s.alwaysOnTop} onChange={v => set({ alwaysOnTop: v })} /></Row>
        <Row title={t('Lock position')} desc={t('Stops the widget from being dragged by accident.')}><Switch on={s.lockPosition} onChange={v => set({ lockPosition: v })} /></Row>
        <Row title={t('Widget position')} desc={t('Move it back to the top-right corner of the main screen.')}>
          <button type="button" class="btn btn-secondary" style="font-size:12.5px" onClick={() => api.resetPosition()}>{t('Reset position')}</button></Row>
      </Section>
      <Updates s={s} set={set} info={info} />
      <Section label={t('App')}>
        <Row title={t('Data folder')} desc={info.dataDir}>
          <button type="button" class="btn btn-secondary" style="font-size:12.5px" onClick={() => api.openDataFolder()}>{t('Open')}</button></Row>
        <Row title={`T212 Widget ${info.version}`} desc={t('Unofficial desktop widget using the Trading 212 public API. Read-only.')}>
          <button type="button" class="btn btn-ghost" style={`font-size:12.5px;color:${DOWN}`} onClick={() => api.quit()}><i class="ph ph-power"></i>{t('Quit app')}</button></Row>
      </Section>
    </>
  );
}

// ── shell ────────────────────────────────────────────────────
function App({ init }) {
  const [s, setS] = useState(init.settings);
  const [st, setSt] = useState(init.state);
  const q = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState(TABS().some(x => x[0] === q) ? q : (init.state && !init.state.connected ? 'account' : 'widget'));
  useEffect(() => { api.onSettings(setS); api.onState(setSt); api.onGotoTab(t => t && setTab(t)); }, []);
  const themeKey = [s.theme, s.accent, s.tint, s.textColor].join('|');
  const applied = useRef('');
  if (applied.current !== themeKey) { applied.current = themeKey; applyTheme(s.theme, s.accent, s.tint, s.textColor); }
  setLang(s.language || 'cs');
  useEffect(() => applyMotion(s.motion), [s.motion]);
  useEffect(() => { api.getAutostart().then(v => { if (typeof v === 'boolean' && v !== s.startWithWindows) setS(x => ({ ...x, startWithWindows: v })); }); }, []);
  const set = patch => { setS(x => ({ ...x, ...patch })); api.setSettings(patch); };
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') api.closeSettings(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div class="stage">
      <div class="wg" style={`width:704px;height:624px;display:flex;flex-direction:column;background:url(${ditheredBg(s.theme, s.accent, s.tint || 0, 704, 624, 0.07, 0.35)}) 0 0/100% 100% no-repeat`}>
        <div class="loop" style="position:absolute;width:300px;height:300px;left:-110px;top:-160px;border-radius:50%;background:radial-gradient(circle,rgba(var(--acc-rgb),.18),transparent 70%);filter:blur(14px);animation:nglow 8s ease-in-out infinite;pointer-events:none"></div>
        <header class="titlebar">
          <div style="width:24px;height:24px;border-radius:6px;border:1px solid var(--color-accent-700);background:var(--color-accent-900);display:flex;align-items:center;justify-content:center;font:600 9.5px/1 ui-monospace,Menlo,monospace;color:var(--color-accent-300)">212</div>
          <span style={`font:500 13px/1 ${F};color:var(--color-neutral-200)`}>{t('Settings')}</span>
          <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>T212 Widget · v{init.version}</span>
          <span style="flex:1"></span>
          <button type="button" class="tb" title={t('Minimise')} onClick={() => api.minimizeSettings()}><i class="ph ph-minus"></i></button>
          <button type="button" class="tb" title={t('Close')} onClick={() => api.closeSettings()}><i class="ph ph-x"></i></button>
        </header>
        <nav style="position:relative;padding:0 28px">
          <Seg value={tab} onChange={setTab} options={TABS()} />
        </nav>
        <main key={tab} class="scroll" style="position:relative;flex:1;min-height:0;padding:16px 28px 18px;display:flex;flex-direction:column;gap:14px;animation:nfade .4s ease both">
          {tab === 'account' && <AccountTab s={s} st={st} set={set} />}
          {tab === 'widget' && <WidgetTab s={s} set={set} />}
          {tab === 'appearance' && <AppearanceTab s={s} set={set} />}
          {tab === 'data' && <DataTab s={s} set={set} st={st} />}
          {tab === 'system' && <SystemTab s={s} set={set} info={init} />}
        </main>
        <footer style="position:relative;display:flex;align-items:center;gap:10px;margin:0 28px;padding:14px 0 18px;border-top:1px solid rgba(var(--ink-rgb),.08)">
          <i class="ph ph-check-circle" style="font-size:13px;color:var(--color-accent-400)"></i>
          <span style={`font:400 11px/1 ${F};color:var(--color-neutral-500)`}>{t('Changes apply instantly and are remembered.')}</span>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-primary" style="font-size:13px;padding:6px 16px" onClick={() => api.closeSettings()}>{t('Done')}</button>
        </footer>
      </div>
    </div>
  );
}

api.init().then(init => {
  applyTheme(init.settings.theme, init.settings.accent, init.settings.tint, init.settings.textColor);
  setLang(init.settings.language || 'cs');
  MAC = init.platform === 'darwin';
  applyMotion(init.settings.motion);
  render(<App init={init} />, document.getElementById('root'));
});
