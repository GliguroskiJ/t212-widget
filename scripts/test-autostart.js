// Autostart against a fake Windows registry (`reg query` output exactly as Windows prints it)
// and a fake Electron that — like on the real machine — reports Off for our entry.
const assert = require('assert');
const { state, isEnabled, apply, reconcile, regValue, NAME, RUN, APPROVED } = require('../main/autostart');
const EXE = 'C:\\Users\\gligu\\AppData\\Local\\Programs\\t212-widget\\T212 Widget.exe';

function machine(run, approved = {}) {
  const reg = { [RUN]: new Map(Object.entries(run)), [APPROVED]: new Map(Object.entries(approved)) };
  const exec = args => {                                     // reg query <key> /v <name>
    const [, key, , name] = args;
    const v = reg[key] && reg[key].get(name);
    if (v == null) { const e = new Error('ERROR: The system was unable to find the specified registry key or value.'); e.status = 1; throw e; }
    const type = key === APPROVED ? 'REG_BINARY' : 'REG_SZ';
    return `\r\n${key.replace('HKCU', 'HKEY_CURRENT_USER')}\r\n    ${name}    ${type}    ${v}\r\n\r\n`;
  };
  const app = {
    getLoginItemSettings: () => ({ openAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] }),   // what Electron told us
    setLoginItemSettings({ openAtLogin, name = NAME, path = EXE, enabled = true }) {
      if (openAtLogin) { reg[RUN].set(name, `"${path}"`); if (enabled) reg[APPROVED].delete(name); }
      else { reg[RUN].delete(name); reg[APPROVED].delete(name); }
    }
  };
  return { reg, exec, app };
}
const THEIRS = { OneDrive: '"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background', 'Docker Desktop': 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe',
  'electron.app.CurseForge': 'C:\\Users\\gligu\\AppData\\Local\\Programs\\CurseForge Windows\\CurseForge.exe --minimized' };
const THEIRS_OK = { Steam: '020000000000000000000000', Discord: '030000006a1b2c3d4e5f6071', 'Docker Desktop': '030000000000000000000000' };

// 1) exactly the reported machine: entry present, nothing in StartupApproved, Electron says Off → we say On
let m = machine({ ...THEIRS, [NAME]: `"${EXE}"` }, THEIRS_OK);
assert.equal(state(m.app, 'win32', EXE, m.exec), 'on');
assert.equal(isEnabled(m.app, 'win32', EXE, m.exec), true);
assert.equal(reconcile(m.app, true, 'win32', EXE, m.exec), true);
// 2) parsing: names with spaces, binary data
assert.deepEqual(regValue(RUN, 'Docker Desktop', m.exec), { type: 'REG_SZ', data: 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe' });
assert.equal(regValue(APPROVED, 'Steam', m.exec).data, '020000000000000000000000');
assert.equal(regValue(RUN, 'Nope', m.exec), null);
// 3) switched off in Task Manager (first byte 03) → 'disabled', reconcile keeps it off and doesn't touch it
m = machine({ [NAME]: `"${EXE}"` }, { [NAME]: '030000000000000000000000' });
assert.equal(state(m.app, 'win32', EXE, m.exec), 'disabled');
assert.equal(reconcile(m.app, true, 'win32', EXE, m.exec), false);
assert.equal(m.reg[APPROVED].get(NAME), '030000000000000000000000');
// 4) enabled flag 02 → on
m = machine({ [NAME]: `"${EXE}"` }, { [NAME]: '020000000000000000000000' });
assert.equal(state(m.app, 'win32', EXE, m.exec), 'on');
// 5) an update's uninstaller removed it, user wants it → written again → On
m = machine(THEIRS, THEIRS_OK);
assert.equal(state(m.app, 'win32', EXE, m.exec), 'missing');
assert.equal(reconcile(m.app, true, 'win32', EXE, m.exec), true);
assert.equal(m.reg[RUN].get(NAME), `"${EXE}"`);
// 6) not wanted and missing → stays off, nothing written
m = machine(THEIRS); assert.equal(reconcile(m.app, false, 'win32', EXE, m.exec), false); assert.ok(!m.reg[RUN].has(NAME));
// 7) toggle on/off round trip through apply()
m = machine(THEIRS);
apply(m.app, true, 'win32', EXE); assert.equal(isEnabled(m.app, 'win32', EXE, m.exec), true);
apply(m.app, false, 'win32', EXE); assert.equal(isEnabled(m.app, 'win32', EXE, m.exec), false);
// 8) other apps' entries are never touched
assert.equal(m.reg[RUN].size, Object.keys(THEIRS).length);
// 9) reg.exe unavailable → falls back to "missing", never throws
assert.equal(state(m.app, 'win32', EXE, () => { throw new Error('ENOENT'); }), 'missing');
// 10) macOS keeps Electron's own state
const mac = { getLoginItemSettings: () => ({ openAtLogin: true }), setLoginItemSettings: o => { mac.last = o; } };
assert.equal(isEnabled(mac, 'darwin'), true); apply(mac, false, 'darwin'); assert.equal(mac.last.openAtLogin, false);
console.log('AUTOSTART TESTS PASSED');
