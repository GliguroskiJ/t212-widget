import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { THEMES, UP, DOWN, applyTheme, applyMotion, agoStr } from './shared.js';

const api = window.api;
const F = "'Inter',sans-serif";
const TABS = [['account', 'Account'], ['widget', 'Widget'], ['appearance', 'Appearance'], ['data', 'Data'], ['system', 'System']];

// ── primitives (Nocturne) ────────────────────────────────────
function Seg({ value, options, onChange, size = 11.5 }) {
  return (
    <div style="display:inline-flex;gap:4px;padding:3px;border-radius:7px;background:rgba(233,233,237,.045);box-shadow:inset 0 0 0 1px rgba(233,233,237,.05)">
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
    if (r.ok) { setKey(''); setSecret(''); setMsg({ ok: true, text: `Connected · ${r.currency} account${r.id ? ' #' + r.id : ''}` }); }
    else setMsg({ ok: false, text: r.message });
  };
  let statusLine;
  if (!connected) statusLine = <><Dot color="var(--color-neutral-600)" /><span>Not connected</span></>;
  else if (st.status === 'error') statusLine = <><Dot color={DOWN} /><span>Connection problem — {st.error && st.error.message}</span></>;
  else statusLine = <><Dot color={UP} breathe /><span>Connected · {s.env === 'demo' ? 'Practice' : 'Live'}{d ? ` · ${d.accountCurrency} account${d.accountId ? ' #' + d.accountId : ''}` : ''}{st.lastSync ? ` · synced ${agoStr(st.lastSync, Date.now())}` : ''}</span></>;
  return (
    <>
      <div class="status">
        <span style={`display:flex;align-items:center;gap:8px;font:400 12px/1.4 ${F};color:var(--color-neutral-300);min-width:0`}>{statusLine}</span>
        <span style="flex:1"></span>
        {connected && <button type="button" class="btn btn-ghost" style="font-size:12.5px;color:var(--color-neutral-400)" onClick={() => { api.disconnect(); setMsg(null); }}>Disconnect</button>}
      </div>
      <Section label="API key pair">
        <p style={`font:400 12px/1.6 ${F};color:var(--color-neutral-400);margin:0 0 12px;max-width:68ch`}>
          Create a key in Trading 212 → Settings → API (Beta). Enable at least <span style="color:var(--color-accent-300)">Account data</span> and <span style="color:var(--color-accent-300)">Portfolio</span>
          {' '}(and <span style="color:var(--color-accent-300)">History</span> for dividends). No trading permissions needed.
          {' '}{st && st.encrypted ? 'Keys are encrypted on this PC with Windows DPAPI.' : 'Keys are stored locally on this PC.'}
          {' '}<a href="#" onClick={e => { e.preventDefault(); api.openExternal('https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key'); }}>How to create a key</a></p>
        <form onSubmit={e => { e.preventDefault(); connect(); }} style="display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;align-items:center;gap:14px">
            <label class="lbl" style="width:auto">Environment</label>
            <Seg value={env} onChange={setEnv} options={[['live', 'Live'], ['demo', 'Practice']]} />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div style="display:flex;flex-direction:column;gap:5px">
              <label class="lbl" style="display:flex;align-items:center;height:11px">API key</label>
              <input class="input mono" type="text" spellcheck={false} value={key} placeholder={connected ? 'Saved — paste to replace' : 'Paste API key'} onInput={e => setKey(e.currentTarget.value)} style="font-size:12px" />
            </div>
            <div style="display:flex;flex-direction:column;gap:5px">
              <label class="lbl" style="display:flex;align-items:center;height:11px;gap:5px">Secret key<i class="ph ph-lock-simple" style="font-size:11px;color:var(--color-accent-400)"></i></label>
              <div style="position:relative;display:flex;align-items:center">
                <input class="input mono" type={show ? 'text' : 'password'} spellcheck={false} value={secret} placeholder={connected ? '••••••••••••' : 'Paste secret'} onInput={e => setSecret(e.currentTarget.value)} style="padding-right:30px;font-size:12px" />
                <i class={'ph hov-icon ' + (show ? 'ph-eye-slash' : 'ph-eye')} onClick={() => setShow(v => !v)} style="position:absolute;right:9px;font-size:14px;color:var(--color-neutral-500)"></i>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:12px;align-items:center;min-height:32px">
            <button type="submit" class="btn btn-primary" disabled={busy || !key.trim() || !secret.trim()} style="font-size:13px">{connected ? 'Replace key' : 'Connect'}</button>
            {busy && <span style="display:flex;gap:8px;align-items:center">
              <span style="width:15px;height:15px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box"></span>
              <span style={`font:400 11.5px/1 ${F};color:var(--color-neutral-400)`}>Verifying key pair · fetching account currency</span></span>}
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
      <Section label="Size">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:8px">
          {SIZE_CARDS.map(([k, label, sub, w, h]) => {
            const sc = 64 / 704;
            return (
              <button type="button" class={'szc' + (s.size === k ? ' on' : '')} onClick={() => set({ size: k })}>
                <div style="height:70px;display:flex;align-items:center;justify-content:center">
                  <div class="szmini" style={`width:${Math.round(w * sc)}px;height:${Math.round(h * sc)}px`}></div>
                </div>
                <span style={`font:500 12px/1 ${F};color:var(--color-neutral-200)`}>{label}</span>
                <span style={`font:400 10.5px/1 ${F};color:var(--color-neutral-500)`}>{sub} · {w}×{h}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section label="Behaviour">
        <Row title="Show widget" desc="Hide it without quitting — the app keeps running in the tray."><Switch on={s.showWidget} onChange={v => set({ showWidget: v })} /></Row>
        <Row title="Large widget opens on" desc="The view shown in the 2 × 2 widget."><Seg value={s.largeView} onChange={v => set({ largeView: v })} options={[['chart', 'Chart'], ['positions', 'Positions'], ['alloc', 'Allocation']]} /></Row>
        <Row title="Chart range" desc="Also switchable right on the widget."><Seg value={s.range} onChange={v => set({ range: v })} options={[['1D', '1D'], ['1W', '1W'], ['1M', '1M'], ['1Y', '1Y'], ['ALL', 'ALL']]} size={11} /></Row>
      </Section>
    </>
  );
}

function AppearanceTab({ s, set }) {
  const pct = Math.round((s.opacity || 1) * 100);
  return (
    <>
      <Section label="Widget background">
        <div style="display:flex;gap:14px;padding:4px 0 12px">
          {Object.keys(THEMES).map(k => {
            const t = THEMES[k]; const on = s.theme === k;
            return (
              <div style="display:flex;flex-direction:column;align-items:center;gap:7px">
                <button type="button" class="swatch" title={t.label} onClick={() => set({ theme: k })}
                  style={`background:${t.swatch};box-shadow:${on ? 'inset 0 0 0 1px rgba(233,233,237,.2), 0 0 0 2px var(--color-accent)' : 'inset 0 0 0 1px rgba(233,233,237,.12)'}`}></button>
                <span style={`font:400 10px/1 ${F};color:${on ? 'var(--color-accent-300)' : 'var(--color-neutral-500)'}`}>{t.label}</span>
              </div>
            );
          })}
        </div>
      </Section>
      <Section label="Display">
        <Row title="Motion" desc="Subtle keeps number roll-ups but stops breathing and pulsing; Off shows final values immediately.">
          <Seg value={s.motion} onChange={v => set({ motion: v })} options={[['full', 'Full'], ['subtle', 'Subtle'], ['off', 'Off']]} /></Row>
        <Row title="Widget opacity" desc="Lets the desktop show through the whole widget.">
          <input type="range" class="rng" min="50" max="100" step="5" value={pct} onInput={e => set({ opacity: Number(e.currentTarget.value) / 100 })} style={`--p:${(pct - 50) * 2}%`} />
          <span class="tnum" style={`width:36px;text-align:right;font:400 12px/1 ${F};color:var(--color-neutral-300)`}>{pct}%</span></Row>
        <Row title="Number format"><Seg value={s.numberFormat} onChange={v => set({ numberFormat: v })} options={[['en', '1,284,640.50'], ['cs', '1 284 640,50']]} /></Row>
      </Section>
    </>
  );
}

function DataTab({ s, set }) {
  const [cleared, setCleared] = useState(false);
  return (
    <>
      <Section label="Sync">
        <Row title="Refresh every" desc="Trading 212 allows one account request per 5 s — 30 s keeps well inside the limit.">
          <Seg value={s.refreshSeconds} onChange={v => set({ refreshSeconds: v })} options={[[10, '10 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']]} size={11} /></Row>
        <Row title="Pause when markets are closed" desc="Outside Xetra and NYSE hours the widget shows the closed state and syncs only every 10 minutes.">
          <Switch on={s.pauseWhenClosed} onChange={v => set({ pauseWhenClosed: v })} /></Row>
      </Section>
      <Section label="Currency">
        <Row title="Display currency" desc="Account = no conversion. Others use daily ECB rates (frankfurter.dev).">
          <Seg value={s.displayCurrency} onChange={v => set({ displayCurrency: v })} options={[['account', 'Account'], ['CZK', 'CZK'], ['EUR', 'EUR'], ['USD', 'USD'], ['GBP', 'GBP']]} size={11} /></Row>
      </Section>
      <Section label="History">
        <Row title="Chart history" desc="The API has no portfolio history, so the chart is recorded on this PC from the first sync on. Day P/L is measured from the last value before midnight.">
          <button type="button" class="btn btn-secondary" style="font-size:12.5px" onClick={async () => { await api.clearHistory(); setCleared(true); setTimeout(() => setCleared(false), 2000); }}>
            {cleared ? <><i class="ph ph-check" style={`color:${UP}`}></i>Cleared</> : 'Clear history'}</button></Row>
      </Section>
    </>
  );
}

function SystemTab({ s, set, info }) {
  return (
    <>
      <Section label="Windows">
        <Row title="Start with Windows" desc="Launch the widget when you sign in. Settings and position are remembered."><Switch on={s.startWithWindows} onChange={v => set({ startWithWindows: v })} /></Row>
        <Row title="Keep on top" desc="Float above other windows instead of sitting on the desktop."><Switch on={s.alwaysOnTop} onChange={v => set({ alwaysOnTop: v })} /></Row>
        <Row title="Lock position" desc="Stops the widget from being dragged by accident."><Switch on={s.lockPosition} onChange={v => set({ lockPosition: v })} /></Row>
        <Row title="Widget position" desc="Move it back to the top-right corner of the main screen.">
          <button type="button" class="btn btn-secondary" style="font-size:12.5px" onClick={() => api.resetPosition()}>Reset position</button></Row>
      </Section>
      <Section label="App">
        <Row title="Data folder" desc={info.dataDir}>
          <button type="button" class="btn btn-secondary" style="font-size:12.5px" onClick={() => api.openDataFolder()}>Open</button></Row>
        <Row title={`T212 Widget ${info.version}`} desc="Unofficial desktop widget using the Trading 212 public API. Read-only.">
          <button type="button" class="btn btn-ghost" style={`font-size:12.5px;color:${DOWN}`} onClick={() => api.quit()}><i class="ph ph-power"></i>Quit app</button></Row>
      </Section>
    </>
  );
}

// ── shell ────────────────────────────────────────────────────
function App({ init }) {
  const [s, setS] = useState(init.settings);
  const [st, setSt] = useState(init.state);
  const q = new URLSearchParams(location.search).get('tab');
  const [tab, setTab] = useState(TABS.some(t => t[0] === q) ? q : (init.state && !init.state.connected ? 'account' : 'widget'));
  useEffect(() => { api.onSettings(setS); api.onState(setSt); api.onGotoTab(t => t && setTab(t)); }, []);
  useEffect(() => applyTheme(s.theme), [s.theme]);
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
      <div class="wg" style="width:704px;height:624px;display:flex;flex-direction:column">
        <div class="loop" style="position:absolute;width:300px;height:300px;left:-110px;top:-160px;border-radius:50%;background:radial-gradient(circle,rgba(145,132,217,.18),transparent 70%);filter:blur(14px);animation:nglow 8s ease-in-out infinite;pointer-events:none"></div>
        <div style="position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(145,132,217,.07),transparent 35%)"></div>
        <header class="titlebar">
          <div style="width:24px;height:24px;border-radius:6px;border:1px solid var(--color-accent-700);background:var(--color-accent-900);display:flex;align-items:center;justify-content:center;font:600 9.5px/1 ui-monospace,Menlo,monospace;color:var(--color-accent-300)">212</div>
          <span style={`font:500 13px/1 ${F};color:var(--color-neutral-200)`}>Settings</span>
          <span style={`font:400 11px/1 ${F};color:var(--color-neutral-600)`}>T212 Widget · v{init.version}</span>
          <span style="flex:1"></span>
          <button type="button" class="tb" title="Minimise" onClick={() => api.minimizeSettings()}><i class="ph ph-minus"></i></button>
          <button type="button" class="tb" title="Close" onClick={() => api.closeSettings()}><i class="ph ph-x"></i></button>
        </header>
        <nav style="position:relative;padding:0 28px">
          <Seg value={tab} onChange={setTab} options={TABS} />
        </nav>
        <main key={tab} class="scroll" style="position:relative;flex:1;min-height:0;padding:16px 28px 18px;display:flex;flex-direction:column;gap:14px;animation:nfade .4s ease both">
          {tab === 'account' && <AccountTab s={s} st={st} set={set} />}
          {tab === 'widget' && <WidgetTab s={s} set={set} />}
          {tab === 'appearance' && <AppearanceTab s={s} set={set} />}
          {tab === 'data' && <DataTab s={s} set={set} />}
          {tab === 'system' && <SystemTab s={s} set={set} info={init} />}
        </main>
        <footer style="position:relative;display:flex;align-items:center;gap:10px;margin:0 28px;padding:14px 0 18px;border-top:1px solid rgba(233,233,237,.08)">
          <i class="ph ph-check-circle" style="font-size:13px;color:var(--color-accent-400)"></i>
          <span style={`font:400 11px/1 ${F};color:var(--color-neutral-500)`}>Changes apply instantly and are remembered.</span>
          <span style="flex:1"></span>
          <button type="button" class="btn btn-primary" style="font-size:13px;padding:6px 16px" onClick={() => api.closeSettings()}>Done</button>
        </footer>
      </div>
    </div>
  );
}

api.init().then(init => {
  applyTheme(init.settings.theme);
  applyMotion(init.settings.motion);
  render(<App init={init} />, document.getElementById('root'));
});
