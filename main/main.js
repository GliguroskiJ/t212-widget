'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell, safeStorage, nativeTheme, net, nativeImage } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { Poller } = require('./t212');

const SIZES = {
  small: { w: 300, h: 304 },
  medium: { w: 620, h: 304 },
  large: { w: 620, h: 620 },
  rail: { w: 320, h: 704 }
};
const MARGIN = 28;            // transparent room around the card for its shadow
const SETTINGS_W = 760, SETTINGS_H = 680;

app.setAppUserModelId('cz.jovan.t212widget');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let store, poller, widget, settingsWin, tray;
let quitting = false;
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'app', 'icon.ico');
const ICON_PNG = path.join(ROOT, 'app', 'icon-32.png');

function effectiveSize() {
  const st = poller ? poller.status : 'loading';
  if (st === 'first-run') return 'medium';
  return SIZES[store.get('size')] ? store.get('size') : 'medium';
}

function winSize(sizeKey) {
  const s = SIZES[sizeKey];
  return { width: s.w + MARGIN * 2, height: s.h + MARGIN * 2 };
}

function clampToScreen(x, y, w, h) {
  const d = screen.getDisplayMatching({ x, y, width: w, height: h });
  const a = d.workArea;
  const nx = Math.min(Math.max(x, a.x - MARGIN), a.x + a.width - w + MARGIN);
  const ny = Math.min(Math.max(y, a.y - MARGIN), a.y + a.height - h + MARGIN);
  return { x: Math.round(nx), y: Math.round(ny) };
}

function defaultPos(w, h) {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - w - 12, y: a.y + 12 };
}

function broadcast(ch, payload) {
  for (const w of [widget, settingsWin]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
}

// ── widget window ────────────────────────────────────────────
function createWidget() {
  const size = effectiveSize();
  const { width, height } = winSize(size);
  let pos = store.get('widgetPos') || defaultPos(width, height);
  pos = clampToScreen(pos.x, pos.y, width, height);
  widget = new BrowserWindow({
    x: pos.x, y: pos.y, width, height,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false,
    alwaysOnTop: !!store.get('alwaysOnTop'),
    backgroundColor: '#00000000',
    title: 'T212 Widget',
    icon: ICON,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  widget.__size = size;
  widget.setOpacity(Math.min(1, Math.max(0.4, store.get('opacity') || 1)));
  widget.loadFile(path.join(ROOT, 'app', 'widget.html'));
  widget.once('ready-to-show', () => { if (store.get('showWidget')) widget.showInactive(); });
  let moveT;
  widget.on('moved', () => {
    clearTimeout(moveT);
    moveT = setTimeout(() => {
      if (!widget || widget.isDestroyed()) return;
      const [x, y] = widget.getPosition();
      store.set({ widgetPos: { x, y } });
    }, 300);
  });
  widget.on('close', e => { if (!quitting) { e.preventDefault(); hideWidget(); } });
  widget.on('closed', () => { widget = null; });
}

function applyWidgetSize() {
  if (!widget || widget.isDestroyed()) return;
  const size = effectiveSize();
  if (widget.__size === size) return;
  widget.__size = size;
  const { width, height } = winSize(size);
  const [x, y] = widget.getPosition();
  const p = clampToScreen(x, y, width, height);
  widget.setBounds({ x: p.x, y: p.y, width, height });
}

function showWidget() {
  store.set({ showWidget: true });
  if (!widget) createWidget(); else { widget.showInactive(); }
  broadcast('settings', store.all());
  rebuildTrayMenu();
}
function hideWidget() {
  store.set({ showWidget: false });
  if (widget) widget.hide();
  broadcast('settings', store.all());
  rebuildTrayMenu();
}

// ── settings window ──────────────────────────────────────────
function openSettings(tab) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (tab) settingsWin.webContents.send('goto-tab', tab);
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show(); settingsWin.focus();
    return;
  }
  const a = screen.getPrimaryDisplay().workArea;
  settingsWin = new BrowserWindow({
    width: SETTINGS_W, height: SETTINGS_H,
    x: Math.round(a.x + (a.width - SETTINGS_W) / 2), y: Math.round(a.y + (a.height - SETTINGS_H) / 2),
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    hasShadow: false, show: false, backgroundColor: '#00000000', title: 'T212 Widget — Settings', icon: ICON,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWin.loadFile(path.join(ROOT, 'app', 'settings.html'), { query: { tab: tab || '' } });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ── settings side effects ────────────────────────────────────
function applySettings(patch) {
  const prev = store.all();
  const next = store.set(patch);
  if ('startWithWindows' in patch) applyAutostart(next.startWithWindows);
  if (widget && !widget.isDestroyed()) {
    if ('alwaysOnTop' in patch) widget.setAlwaysOnTop(!!next.alwaysOnTop, 'floating');
    if ('opacity' in patch) widget.setOpacity(Math.min(1, Math.max(0.4, next.opacity)));
  }
  if ('size' in patch) applyWidgetSize();
  if ('showWidget' in patch && patch.showWidget !== prev.showWidget) { next.showWidget ? showWidget() : hideWidget(); }
  if ('env' in patch && patch.env !== prev.env) { poller.resetForNewAccount(); poller.cycle(); }
  if ('refreshSeconds' in patch || 'pauseWhenClosed' in patch || 'displayCurrency' in patch) poller.refreshNow();
  broadcast('settings', next);
  if ('range' in patch || 'displayCurrency' in patch) poller.emitState();
  rebuildTrayMenu();
  return next;
}

function applyAutostart(on) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: [], name: 'cz.jovan.t212widget' }); } catch {}
}

// ── tray ─────────────────────────────────────────────────────
function rebuildTrayMenu() {
  if (!tray) return;
  const s = store.all();
  const sizeItem = (k, label) => ({ label, type: 'radio', checked: s.size === k, click: () => applySettings({ size: k }) });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: s.showWidget ? 'Hide widget' : 'Show widget', click: () => (s.showWidget ? hideWidget() : showWidget()) },
    { label: 'Refresh now', click: () => poller.refreshNow() },
    { type: 'separator' },
    { label: 'Size', submenu: [sizeItem('small', 'Small  1×1'), sizeItem('medium', 'Medium  2×1'), sizeItem('large', 'Large  2×2'), sizeItem('rail', 'Rail')] },
    { label: 'Always on top', type: 'checkbox', checked: !!s.alwaysOnTop, click: m => applySettings({ alwaysOnTop: m.checked }) },
    { label: 'Lock position', type: 'checkbox', checked: !!s.lockPosition, click: m => applySettings({ lockPosition: m.checked }) },
    { label: 'Start with Windows', type: 'checkbox', checked: !!s.startWithWindows, click: m => applySettings({ startWithWindows: m.checked }) },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  let img = nativeImage.createFromPath(process.platform === 'win32' ? ICON : ICON_PNG);
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON_PNG);
  tray = new Tray(img);
  tray.setToolTip('T212 Widget');
  tray.on('click', () => ((widget && widget.isVisible()) ? hideWidget() : showWidget()));
  tray.on('double-click', () => openSettings());
  rebuildTrayMenu();
}

// ── IPC ──────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('init', () => ({ settings: store.all(), state: poller.payload(), version: app.getVersion(), dataDir: app.getPath('userData') }));
  ipcMain.handle('set-settings', (_e, patch) => applySettings(patch || {}));
  ipcMain.handle('refresh', () => { poller.refreshNow(); return true; });
  ipcMain.handle('recheck-dividends', () => { poller.recheckDividends(); return true; });
  ipcMain.handle('open-settings', (_e, tab) => { openSettings(tab); return true; });
  ipcMain.handle('hide-widget', () => { hideWidget(); return true; });
  ipcMain.handle('show-widget', () => { showWidget(); return true; });
  ipcMain.handle('quit', () => { quitting = true; app.quit(); return true; });
  ipcMain.handle('close-settings', () => { if (settingsWin) settingsWin.close(); return true; });
  ipcMain.handle('minimize-settings', () => { if (settingsWin) settingsWin.minimize(); return true; });
  ipcMain.handle('clear-history', () => { store.clearHistory(); poller.emitState(); return true; });
  ipcMain.handle('open-data-folder', () => { shell.openPath(app.getPath('userData')); return true; });
  ipcMain.handle('open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
  ipcMain.handle('reset-position', () => {
    if (!widget) return false;
    const { width, height } = winSize(effectiveSize());
    const p = defaultPos(width, height);
    widget.setPosition(p.x, p.y);
    store.set({ widgetPos: p });
    return true;
  });
  // manual window dragging (keeps hover effects alive, unlike -webkit-app-region)
  let drag = null;
  ipcMain.on('drag', (e, phase) => {
    if (!widget || BrowserWindow.fromWebContents(e.sender) !== widget) return;
    if (store.get('lockPosition')) return;
    const c = screen.getCursorScreenPoint();
    if (phase === 'start') {
      const b = widget.getBounds();
      drag = { cx: c.x, cy: c.y, x: b.x, y: b.y, w: b.width, h: b.height };
    } else if (phase === 'move' && drag) {
      widget.setBounds({ x: drag.x + c.x - drag.cx, y: drag.y + c.y - drag.cy, width: drag.w, height: drag.h });
    } else if (phase === 'end' && drag) {
      drag = null;
      const [x, y] = widget.getPosition();
      store.set({ widgetPos: { x, y } });
    }
  });
  ipcMain.on('set-ignore-mouse', (e, ignore) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w === widget) w.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.handle('connect', async (_e, { env, key, secret }) => {
    key = String(key || '').trim(); secret = String(secret || '').trim();
    if (!key || !secret) return { ok: false, message: 'Both the API key and the secret are required.' };
    const useEnv = env === 'demo' ? 'demo' : 'live';
    try {
      const info = await poller.verify(useEnv, { key, secret });
      const prevEnv = store.get('env');
      const prevCreds = store.getCreds();
      const sameAccount = prevCreds && prevEnv === useEnv && poller.raw && poller.raw.summary && poller.raw.summary.id === info.id;
      store.setCreds({ key, secret });
      store.set({ env: useEnv });
      if (!sameAccount) poller.resetForNewAccount();
      else poller.recheckDividends();
      poller.status = 'loading';
      applyWidgetSize();
      poller.cycle();
      broadcast('settings', store.all());
      return { ok: true, ...info };
    } catch (err) {
      const code = err.status || 0;
      const message = code === 401 ? 'Trading 212 returned 401 Unauthorized — check the key and secret.'
        : code === 403 ? 'Trading 212 returned 403 Forbidden — the key needs the Account data and Portfolio permissions.'
        : code === 429 ? 'Rate limited by Trading 212 — wait a few seconds and try again.'
        : err.message || String(err);
      return { ok: false, code, message };
    }
  });
  ipcMain.handle('disconnect', () => {
    store.clearCreds();
    poller.resetForNewAccount();
    poller.cycle();
    applyWidgetSize();
    return true;
  });
  ipcMain.handle('get-autostart', () => {
    if (!app.isPackaged) return store.get('startWithWindows');
    try { return app.getLoginItemSettings().openAtLogin; } catch { return store.get('startWithWindows'); }
  });
}

// ── boot ─────────────────────────────────────────────────────
app.on('second-instance', () => openSettings());
app.on('window-all-closed', e => { /* keep running in tray */ });
app.on('before-quit', () => { quitting = true; try { store.saveHistory(); } catch {} });

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  store = new Store(app.getPath('userData'), safeStorage);
  poller = new Poller({ store, fetchImpl: (u, o) => net.fetch(u, o) });
  if (!store.get('firstLaunchDone')) {
    store.set({ firstLaunchDone: true });
    applyAutostart(store.get('startWithWindows'));
  }
  registerIpc();
  poller.on('state', st => { broadcast('state', st); applyWidgetSize(); });
  createTray();
  createWidget();
  poller.start();
  // market open/closed flips & "opens in" countdown refresh
  setInterval(() => poller.emitState(), 60e3);
  screen.on('display-removed', () => {
    if (!widget) return;
    const [x, y] = widget.getPosition(); const [w, h] = widget.getSize();
    const p = clampToScreen(x, y, w, h); widget.setPosition(p.x, p.y);
  });
});
