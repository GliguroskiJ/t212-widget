// The update window: same card, background, colour and text as the widget.
import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { applyTheme, applyMotion, ditheredBg, UP, DOWN } from './shared.js';
import { t, setLang } from './i18n.js';
import { updErr, BLOCKER } from './updtext.js';

const api = window.api;
const F = "'Inter',sans-serif";
const W = 480, H = 350;

const Tile = () => (
  <div style="width:22px;height:22px;border-radius:6px;border:1px solid var(--color-accent-700);background:var(--color-accent-900);display:flex;align-items:center;justify-content:center;font:600 9px/1 ui-monospace,Menlo,monospace;color:var(--color-accent-300);flex:none">212</div>
);
const Eyebrow = ({ children }) => (
  <span style={`font:400 9.5px/1 ${F};letter-spacing:.13em;text-transform:uppercase;color:var(--color-neutral-600)`}>{children}</span>
);
const Spinner = () => (
  <span style="width:16px;height:16px;border-radius:50%;border:1.5px solid var(--color-accent-500);border-top-color:transparent;animation:nspin .9s linear infinite;box-sizing:border-box;flex:none"></span>
);

function Body({ d, u }) {
  const pct = Math.round(((u && u.progress) || 0) * 100);
  const answer = a => api.updateAnswer(a);
  const Btn = ({ kind = 'secondary', a, children, style = '' }) =>
    <button type="button" class={`btn btn-${kind}`} style={`font-size:12.5px;padding:6px 13px;${style}`} onClick={() => answer(a)}>{children}</button>;

  if (d.mode === 'available') {
    const blocked = d.blocker && BLOCKER[d.blocker];
    return (
      <>
        <Eyebrow>{t('New version')}</Eyebrow>
        <span style={`font:300 22px/1.15 ${F};letter-spacing:-.02em;color:var(--color-neutral-100);margin-top:8px`}>{t('Version {v} is ready', { v: d.latest })}</span>
        <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-400);margin-top:6px`}>
          {blocked ? t('You have {c}.', { c: d.current }) : t('You have {c} · the widget restarts by itself after installing.', { c: d.current })}</span>
        <div class="scroll notes">{d.notes || t('No release notes.')}</div>
        {blocked && <div style={`display:flex;gap:8px;align-items:flex-start;margin-top:10px;font:400 11.5px/1.45 ${F};color:var(--color-neutral-300)`}>
          <i class="ph ph-info" style="font-size:14px;color:var(--color-accent-400);flex:none;margin-top:1px"></i><span>{t(blocked)}</span></div>}
        <div class="foot">
          <Btn kind="ghost" a="skip" style="color:var(--color-neutral-500);padding-left:4px">{t('Skip this version')}</Btn>
          <span style="flex:1"></span>
          <Btn a="later">{t('Not now')}</Btn>
          {blocked ? <Btn kind="primary" a="open"><i class="ph ph-arrow-square-out"></i>{t('Open download page')}</Btn>
            : <Btn kind="primary" a="install"><i class="ph ph-download-simple"></i>{t('Download and install')}</Btn>}
        </div>
      </>
    );
  }
  if (d.mode === 'downloading' || d.mode === 'installing') {
    const dl = d.mode === 'downloading';
    return (
      <>
        <Eyebrow>{dl ? t('Downloading') : t('Installing')}</Eyebrow>
        <span style={`font:300 22px/1.15 ${F};letter-spacing:-.02em;color:var(--color-neutral-100);margin-top:8px`}>{t('T212 Widget {v}', { v: d.latest })}</span>
        <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-400);margin-top:6px`}>
          {dl ? t('The file is checked against the release before anything is installed.') : t('The widget closes and starts again in a moment.')}</span>
        <span style="flex:1"></span>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
          {dl ? <span style={`font:300 30px/1 ${F};letter-spacing:-.03em;color:var(--color-neutral-100);font-variant-numeric:tabular-nums`}>{pct}<span style="font-size:15px;color:var(--color-neutral-500)"> %</span></span>
            : <span style="display:flex;align-items:center;gap:10px"><Spinner /><span style={`font:400 12.5px/1 ${F};color:var(--color-neutral-300)`}>{t('Installing…')}</span></span>}
        </div>
        <div style="height:4px;border-radius:2px;background:rgba(var(--ink-rgb),.08);overflow:hidden">
          <div class={dl ? '' : 'indet'} style={`height:100%;width:${dl ? pct : 35}%;border-radius:2px;background:linear-gradient(to right,var(--color-accent-700),var(--color-accent-400));box-shadow:0 0 10px rgba(var(--acc-rgb),.5);transition:width .3s ease`}></div>
        </div>
      </>
    );
  }
  if (d.mode === 'uptodate') {
    return (
      <>
        <Eyebrow>{t('Updates')}</Eyebrow>
        <div style="display:flex;align-items:center;gap:12px;margin-top:14px">
          <i class="ph ph-check-circle" style={`font-size:30px;color:${UP}`}></i>
          <div style="display:flex;flex-direction:column;gap:5px">
            <span style={`font:300 21px/1.15 ${F};letter-spacing:-.02em;color:var(--color-neutral-100)`}>{t('You have the latest version')}</span>
            <span style={`font:400 12px/1.4 ${F};color:var(--color-neutral-400)`}>{t('T212 Widget {v} is up to date.', { v: d.current })}</span>
          </div>
        </div>
        <span style="flex:1"></span>
        <div class="foot"><span style="flex:1"></span><Btn kind="primary" a="ok">OK</Btn></div>
      </>
    );
  }
  // error
  const launch = d.error && d.error.kind === 'launch';
  return (
    <>
      <Eyebrow>{t('Updates')}</Eyebrow>
      <div style="display:flex;align-items:flex-start;gap:12px;margin-top:14px">
        <i class="ph ph-warning-circle" style={`font-size:28px;color:${DOWN};flex:none`}></i>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <span style={`font:300 20px/1.2 ${F};letter-spacing:-.02em;color:var(--color-neutral-100)`}>{d.phase === 'check' ? t('Couldn’t check for updates') : t('Update failed')}</span>
          <span style={`font:400 12px/1.5 ${F};color:var(--color-neutral-300)`}>{launch ? t('Windows did not allow the installer to start:') : updErr(d.error)}</span>
        </div>
      </div>
      {launch ? <div class="scroll notes" style="margin-top:12px">
        {d.error.message}{d.file ? <><br /><br />{t('It is downloaded here and you can run it yourself:')}<br /><span class="mono">{d.file}</span></> : null}</div>
        : <span style="flex:1"></span>}
      <div class="foot">
        <span style="flex:1"></span>
        {d.file && <Btn a="show"><i class="ph ph-folder-open"></i>{t('Show installer')}</Btn>}
        <Btn kind="primary" a="ok">OK</Btn>
      </div>
    </>
  );
}

function App({ init, dlg }) {
  const [s, setS] = useState(init.settings);
  const [d, setD] = useState(dlg);
  const [u, setU] = useState(init.update);
  useEffect(() => { api.onSettings(setS); api.onUpdate(setU); api.onUpdateDialog(setD); }, []);
  applyTheme(s.theme, s.accent, s.tint, s.textColor);
  setLang(s.language || 'cs');
  useEffect(() => applyMotion(s.motion), [s.motion]);
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && d && (d.mode !== 'downloading' && d.mode !== 'installing')) api.updateAnswer('later'); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [d]);
  if (!d) return null;
  const busy = d.mode === 'downloading' || d.mode === 'installing';
  return (
    <div class="stage">
      <div class="wg" style={`width:${W}px;height:${H}px;display:flex;flex-direction:column;background:url(${ditheredBg(s.theme, s.accent, s.tint || 0, W, H, 0.08, 0.4)}) 0 0/100% 100% no-repeat`}>
        <header class="titlebar" style="padding:18px 16px 0 22px">
          <Tile />
          <span style={`font:500 12.5px/1 ${F};color:var(--color-neutral-200)`}>T212 Widget</span>
          <span style="flex:1"></span>
          <button type="button" class="tb" title={busy ? t('Hide') : t('Close')} onClick={() => (busy ? api.closeUpdate() : api.updateAnswer('later'))}><i class="ph ph-x"></i></button>
        </header>
        <main key={d.mode} style="position:relative;flex:1;min-height:0;display:flex;flex-direction:column;padding:16px 24px 20px;animation:nfade .35s ease both">
          <Body d={d} u={u} />
        </main>
      </div>
    </div>
  );
}

Promise.all([api.init(), api.getUpdateDialog()]).then(([init, dlg]) => {
  applyTheme(init.settings.theme, init.settings.accent, init.settings.tint, init.settings.textColor);
  setLang(init.settings.language || 'cs');
  applyMotion(init.settings.motion);
  render(<App init={init} dlg={dlg} />, document.getElementById('root'));
});
