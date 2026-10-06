// Autostart against a fake Electron login-item API that mimics the Windows Run key.
const assert = require('assert');
const { isEnabled, apply, reconcile, state, NAME } = require('../main/autostart');
const EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\t212-widget\\T212 Widget.exe';
function fakeApp(items) {
  const reg = new Map(items.map(i => [i.name, { ...i }]));
  return {
    reg,
    getLoginItemSettings({ path = EXE } = {}) {
      const launchItems = [...reg.values()].map(i => ({ name: i.name, path: i.path, args: [], scope: 'user', enabled: i.enabled !== false }));
      const mine = launchItems.filter(i => i.path.toLowerCase() === path.toLowerCase());
      // like Electron: openAtLogin only looks at the value named after the AppUserModelId
      return { openAtLogin: !!reg.get(NAME), executableWillLaunchAtLogin: mine.some(i => i.enabled), launchItems };
    },
    setLoginItemSettings({ openAtLogin, name = NAME, path = EXE, enabled = true }) {
      if (openAtLogin) reg.set(name, { name, path, enabled }); else reg.delete(name);
    }
  };
}
// 1) the reported bug: old entry under another name → app starts at login, switch must show On
let app = fakeApp([{ name: 'electron.app.T212 Widget', path: '"' + EXE + '"' }]);
assert.equal(app.getLoginItemSettings().openAtLogin, false, 'Electron alone says Off');
assert.equal(isEnabled(app, 'win32', EXE), true, 'we say On');
// 2) turning it off removes the old entry too
apply(app, false, 'win32', EXE);
assert.equal(app.reg.size, 0); assert.equal(isEnabled(app, 'win32', EXE), false);
// 3) turning it on writes exactly one entry under our name
apply(app, true, 'win32', EXE); apply(app, true, 'win32', EXE);
assert.deepEqual([...app.reg.keys()], [NAME]); assert.equal(isEnabled(app, 'win32', EXE), true);
// 4) disabled in Task Manager → shown as Off, switching on re-enables
app = fakeApp([{ name: NAME, path: EXE, enabled: false }]);
assert.equal(isEnabled(app, 'win32', EXE), false);
apply(app, true, 'win32', EXE); assert.equal(isEnabled(app, 'win32', EXE), true);
// 5) entries of other apps are left alone
app = fakeApp([{ name: 'Spotify', path: 'C:\\Spotify.exe' }, { name: 'old', path: EXE }]);
apply(app, true, 'win32', EXE);
assert.deepEqual([...app.reg.keys()].sort(), [NAME, 'Spotify'].sort());
// 6) macOS keeps Electron's own state
const mac = { getLoginItemSettings: () => ({ openAtLogin: true }), setLoginItemSettings: o => { mac.last = o; } };
assert.equal(isEnabled(mac, 'darwin'), true); apply(mac, false, 'darwin'); assert.equal(mac.last.openAtLogin, false);
// 7) the reported bug: an update's uninstaller deleted the entry; user still wants autostart → written again, On
app = fakeApp([]);
assert.equal(state(app, 'win32', EXE), 'missing');
assert.equal(reconcile(app, true, 'win32', EXE), true); assert.deepEqual([...app.reg.keys()], [NAME]);
// 8) user switched it off in Task Manager → stays off, entry untouched
app = fakeApp([{ name: NAME, path: EXE, enabled: false }]);
assert.equal(reconcile(app, true, 'win32', EXE), false); assert.equal(app.reg.get(NAME).enabled, false);
// 9) not wanted and missing → stays off, nothing written
app = fakeApp([]); assert.equal(reconcile(app, false, 'win32', EXE), false); assert.equal(app.reg.size, 0);
// 10) turned on outside the app (old name) → On, tidied to one entry
app = fakeApp([{ name: 'electron.app.T212 Widget', path: EXE }]);
assert.equal(reconcile(app, false, 'win32', EXE), true); assert.deepEqual([...app.reg.keys()], [NAME]);
console.log('AUTOSTART TESTS PASSED');
