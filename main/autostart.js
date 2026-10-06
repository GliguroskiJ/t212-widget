'use strict';
// "Start with Windows" / "Open at login".
// Windows: Electron looks for the Run-key value under the app's own name; builds that wrote it under
// another name kept starting the app while the switch showed Off. Installing a new version also used to
// delete the entry (the old uninstaller runs during an update). So we look at the real entry by our
// executable, under any name, and tell three cases apart:
//   'on'       entry present and enabled
//   'disabled' entry present but switched off in Task Manager / Settings → Startup apps (respect that)
//   'missing'  no entry — if the user wants autostart, it simply gets written again
const NAME = 'cz.jovan.t212widget';

const norm = p => String(p || '').replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();

function state(app, platform = process.platform, exe = process.execPath) {
  try {
    if (platform !== 'win32') return app.getLoginItemSettings().openAtLogin ? 'on' : 'missing';
    const s = app.getLoginItemSettings({ path: exe, args: [] });
    const mine = (s.launchItems || []).filter(i => norm(i.path) === norm(exe));
    if (s.executableWillLaunchAtLogin || mine.some(i => i.enabled !== false)) return 'on';
    if (mine.length || s.openAtLogin) return 'disabled';
    return 'missing';
  } catch { return 'missing'; }
}
const isEnabled = (app, platform, exe) => state(app, platform, exe) === 'on';

function apply(app, on, platform = process.platform, exe = process.execPath) {
  try {
    if (platform !== 'win32') { app.setLoginItemSettings({ openAtLogin: !!on }); return; }
    const s = app.getLoginItemSettings({ path: exe, args: [] });
    for (const i of s.launchItems || []) {            // leftovers under other names → remove
      if (i.name !== NAME && norm(i.path) === norm(exe)) app.setLoginItemSettings({ openAtLogin: false, name: i.name, path: i.path, args: i.args || [] });
    }
    app.setLoginItemSettings({ openAtLogin: !!on, enabled: true, path: exe, args: [], name: NAME });
  } catch {}
}

// On start: what should the switch show, and does the entry need writing again?
//   wanted + missing  → write it again (an installer or cleanup removed it) → On
//   wanted + disabled → the user turned it off in Windows → Off
//   not wanted + on   → it was turned on outside the app (or by an old build) → On
function reconcile(app, wanted, platform = process.platform, exe = process.execPath) {
  const st = state(app, platform, exe);
  if (wanted && st === 'missing') { apply(app, true, platform, exe); return state(app, platform, exe) === 'on'; }
  if (st === 'on') { apply(app, true, platform, exe); return true; }   // also tidies old duplicate names
  return false;
}

module.exports = { state, isEnabled, apply, reconcile, NAME };
