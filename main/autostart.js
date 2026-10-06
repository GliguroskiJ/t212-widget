'use strict';
// "Start with Windows" / "Open at login".
// Windows: Electron looks for the Run-key value under the app's own name. Builds that wrote it under
// another name kept starting the app at login while the switch showed Off — and switching it off
// wouldn't remove that old entry. So: read the state by our executable (any name), and keep exactly
// one entry under NAME.
const NAME = 'cz.jovan.t212widget';

const norm = p => String(p || '').replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();

function isEnabled(app, platform = process.platform, exe = process.execPath) {
  try {
    if (platform !== 'win32') return !!app.getLoginItemSettings().openAtLogin;
    const s = app.getLoginItemSettings({ path: exe, args: [] });
    if (s.executableWillLaunchAtLogin) return true;
    // not deactivated in Task Manager and pointing at us, under whatever name
    return (s.launchItems || []).some(i => norm(i.path) === norm(exe) && i.enabled !== false);
  } catch { return false; }
}

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

module.exports = { isEnabled, apply, NAME };
