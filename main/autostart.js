'use strict';
// "Start with Windows" / "Open at login".
// Windows: the state is read straight from the registry (reg query) — Electron's getLoginItemSettings
// reported Off even with a correct, enabled entry. Writing still goes through Electron, which works.
//   HKCU\…\Run                          value cz.jovan.t212widget = "…\T212 Widget.exe"
//   HKCU\…\Explorer\StartupApproved\Run  REG_BINARY, first byte 02 = enabled, 03 = disabled in Task Manager
//                                        (no value at all = enabled)
// Three cases: 'on', 'disabled' (turned off in Windows — respect it), 'missing' (write it again if wanted).
const { execFileSync } = require('child_process');

const NAME = 'cz.jovan.t212widget';
const RUN = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const APPROVED = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';
const EXE_NAME = /t212 widget\.exe/i;

const norm = p => String(p || '').replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
const path = require('path');
// full path to reg.exe (not via PATH, so nothing else called "reg" can stand in)
const REG_EXE = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
const regExec = (args) => execFileSync(REG_EXE, args, { encoding: 'latin1', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });

// one value from `reg query <key> /v <name>`; null when it doesn't exist
function regValue(key, name, exec = regExec) {
  let out;
  try { out = exec(['query', key, '/v', name]); } catch { return null; }   // exit code 1 = not found
  for (const line of String(out).split(/\r?\n/)) {
    const m = line.match(/^\s+(.+?)\s{2,}(REG_\w+)\s{2,}(.*)$/) || line.match(/^\s+(.+?)\s{2,}(REG_\w+)\s*$/);
    if (m && m[1] === name) return { type: m[2], data: (m[3] || '').trim() };
  }
  return null;
}

function state(app, platform = process.platform, exe = process.execPath, exec = regExec) {
  if (platform !== 'win32') {
    try { return app.getLoginItemSettings().openAtLogin ? 'on' : 'missing'; } catch { return 'missing'; }
  }
  const run = regValue(RUN, NAME, exec);
  if (run && (norm(run.data.split('" ')[0]) === norm(exe) || EXE_NAME.test(run.data))) {
    const ok = regValue(APPROVED, NAME, exec);
    if (ok && ok.type === 'REG_BINARY' && (parseInt(ok.data.slice(0, 2), 16) & 1) === 1) return 'disabled';
    return 'on';
  }
  // an entry under another name (older builds) still starts us — Electron can find those by path
  try {
    const s = app.getLoginItemSettings({ path: exe, args: [] });
    if ((s.launchItems || []).some(i => norm(i.path) === norm(exe) && i.enabled !== false)) return 'on';
  } catch {}
  return 'missing';
}
const isEnabled = (app, platform, exe, exec) => state(app, platform, exe, exec) === 'on';

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
//   on (any reason)   → On (and tidy duplicates under old names)
function reconcile(app, wanted, platform = process.platform, exe = process.execPath, exec = regExec) {
  const st = state(app, platform, exe, exec);
  if (wanted && st === 'missing') { apply(app, true, platform, exe); return state(app, platform, exe, exec) === 'on'; }
  if (st === 'on') { apply(app, true, platform, exe); return true; }
  return false;
}

module.exports = { state, isEnabled, apply, reconcile, regValue, NAME, RUN, APPROVED };
