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

let store, poller, widget, settingsWin, tray, popover;
const IS_MAC = process.platform === 'darwin';
let lastState = null;
let quitting = false;
const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'app', 'icon.ico');
const ICON_PNG = path.join(ROOT, 'app', 'icon-32.png');
const TRAY_TEMPLATE = path.join(ROOT, 'app', 'trayTemplate.png');

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
  for (const w of [widget, settingsWin, popover]) if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
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
  widget.once('ready-to-show', () => { if (desktopWanted()) widget.showInactive(); });
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

function desktopWanted() {
  return store.get('showWidget') && (!IS_MAC || store.get('macMode') !== 'menubar');
}
function showWidget() {
  store.set({ showWidget: true });
  if (IS_MAC && store.get('macMode') === 'menubar') store.set({ macMode: 'both' });
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

// ── macOS menu-bar panel ─────────────────────────────────────
function popoverSizeKey() {
  const st = poller ? poller.status : 'loading';
  if (st === 'first-run') return 'medium';
  return SIZES[store.get('popoverSize')] ? store.get('popoverSize') : 'medium';
}
function createPopover() {
  const size = popoverSizeKey();
  const { width, height } = winSize(size);
  popover = new BrowserWindow({
    width, height, show: false, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, backgroundColor: '#00000000', title: 'T212 Widget',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  });
  popover.__size = size;
  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popover.loadFile(path.join(ROOT, 'app', 'widget.html'), { query: { mode: 'popover' } });
  popover.on('blur', () => { if (popover && !popover.webContents.isDevToolsOpened()) popover.hide(); });
  popover.on('closed', () => { popover = null; });
}
function positionPopover() {
  if (!popover || !tray) return;
  const tb = tray.getBounds();
  const [w, h] = popover.getSize();
  const d = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
  const a = d.workArea;
  let x = Math.round(tb.x + tb.width / 2 - w / 2);
  x = Math.min(Math.max(x, a.x - MARGIN + 6), a.x + a.width - w + MARGIN - 6);
  const y = Math.round(a.y - MARGIN + 6);
  popover.setPosition(x, y, false);
}
function togglePopover() {
  if (!popover) createPopover();
  if (popover.isVisible()) { popover.hide(); return; }
  positionPopover();
  popover.show();
  popover.focus();
}
function applyPopoverSize() {
  if (!popover) return;
  const size = popoverSizeKey();
  if (popover.__size === size) return;
  popover.__size = size;
  const { width, height } = winSize(size);
  popover.setSize(width, height);
  if (popover.isVisible()) positionPopover();
}

// menu-bar title: portfolio value or day change next to the icon
function fmtNum(n, d) {
  const loc = store.get('numberFormat') === 'cs' ? 'cs-CZ' : 'en-US';
  return new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function updateTrayTitle() {
  if (!tray || !IS_MAC) return;
  const mode = store.get('menuBarText');
  const d = lastState && lastState.data;
  if (!d || mode === 'none') { tray.setTitle(''); return; }
  const arrow = d.dayAbs >= 0 ? '▲' : '▼';
  const txt = mode === 'change'
    ? `${arrow} ${fmtNum(Math.abs(d.dayPct), 2)} %`
    : `${fmtNum(d.value, 0)} ${d.currency}  ${arrow}${fmtNum(Math.abs(d.dayPct), 2)}%`;
  tray.setTitle(' ' + txt, { fontType: 'monospacedDigit' });
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
  settingsWin.once('ready-to-show', () => { settingsWin.show(); if (IS_MAC) app.focus({ steal: true }); });
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
  if ('popoverSize' in patch) applyPopoverSize();
  if ('menuBarText' in patch || 'numberFormat' in patch) updateTrayTitle();
  if (IS_MAC && 'macMode' in patch) {
    if (next.macMode === 'menubar') { if (widget) widget.hide(); }
    else { if (!next.showWidget) store.set({ showWidget: true }); if (!widget) createWidget(); else widget.showInactive(); }
  }
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
const TRAY_CS = {
  'Hide widget': 'Skrýt widget', 'Show widget': 'Zobrazit widget', 'Refresh now': 'Obnovit', 'Size': 'Velikost',
  'Small  1×1': 'Malý  1×1', 'Medium  2×1': 'Střední  2×1', 'Large  2×2': 'Velký  2×2', 'Rail': 'Panel',
  'Always on top': 'Vždy navrchu', 'Lock position': 'Zamknout pozici', 'Start with Windows': 'Spouštět s Windows',
  'Settings…': 'Nastavení…', 'Quit': 'Ukončit', 'Open at login': 'Spouštět po přihlášení',
  'Show panel': 'Zobrazit panel', 'Desktop widget': 'Widget na ploše',
  'Both the API key and the secret are required.': 'Je potřeba API klíč i tajný klíč.',
  'Trading 212 returned 401 Unauthorized — check the key and secret.': 'Trading 212 vrátil 401 Unauthorized — zkontrolujte klíč a tajný klíč.',
  'Trading 212 returned 403 Forbidden — the key needs the Account data and Portfolio permissions.': 'Trading 212 vrátil 403 Forbidden — klíč potřebuje oprávnění Account data a Portfolio.',
  'Rate limited by Trading 212 — wait a few seconds and try again.': 'Trading 212 omezil počet dotazů — počkejte pár sekund a zkuste to znovu.'
};
const tr = s => ((store && store.get('language')) !== 'en' && TRAY_CS[s]) || s;
function rebuildTrayMenu() {
  if (!tray) return;
  const s = store.all();
  const sizeItem = (k, label) => ({ label, type: 'radio', checked: s.size === k, click: () => applySettings({ size: k }) });
  const menu = Menu.buildFromTemplate([
    ...(IS_MAC ? [{ label: tr('Show panel'), click: () => togglePopover() },
      { label: tr('Desktop widget'), type: 'checkbox', checked: desktopWanted(), click: m => applySettings({ macMode: m.checked ? 'both' : 'menubar' }) }]
      : [{ label: s.showWidget ? tr('Hide widget') : tr('Show widget'), click: () => (s.showWidget ? hideWidget() : showWidget()) }]),
    { label: tr('Refresh now'), click: () => poller.refreshNow() },
    { type: 'separator' },
    { label: tr('Size'), submenu: [sizeItem('small', tr('Small  1×1')), sizeItem('medium', tr('Medium  2×1')), sizeItem('large', tr('Large  2×2')), sizeItem('rail', tr('Rail'))] },
    { label: tr('Always on top'), type: 'checkbox', checked: !!s.alwaysOnTop, click: m => applySettings({ alwaysOnTop: m.checked }) },
    { label: tr('Lock position'), type: 'checkbox', checked: !!s.lockPosition, click: m => applySettings({ lockPosition: m.checked }) },
    { label: IS_MAC ? tr('Open at login') : tr('Start with Windows'), type: 'checkbox', checked: !!s.startWithWindows, click: m => applySettings({ startWithWindows: m.checked }) },
    { type: 'separator' },
    { label: tr('Settings…'), click: () => openSettings() },
    { label: tr('Quit'), click: () => { quitting = true; app.quit(); } }
  ]);
  tray.__menu = menu;
  if (!IS_MAC) tray.setContextMenu(menu);   // on macOS left-click opens the panel, right-click the menu
}

function createTray() {
  let img;
  if (IS_MAC) { img = nativeImage.createFromPath(TRAY_TEMPLATE); img.setTemplateImage(true); }
  else img = nativeImage.createFromPath(process.platform === 'win32' ? ICON : ICON_PNG);
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON_PNG);
  tray = new Tray(img);
  tray.setToolTip('T212 Widget');
  if (IS_MAC) {
    tray.on('click', () => togglePopover());
    tray.on('right-click', () => tray.popUpContextMenu(tray.__menu));
  } else {
    tray.on('click', () => ((widget && widget.isVisible()) ? hideWidget() : showWidget()));
    tray.on('double-click', () => openSettings());
  }
  rebuildTrayMenu();
}

// ── IPC ──────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('init', () => ({ settings: store.all(), state: poller.payload(), version: app.getVersion(), dataDir: app.getPath('userData'), platform: process.platform }));
  ipcMain.handle('hide-popover', () => { if (popover) popover.hide(); return true; });
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
    if (!key || !secret) return { ok: false, message: tr('Both the API key and the secret are required.') };
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
      applyPopoverSize();
      poller.cycle();
      broadcast('settings', store.all());
      return { ok: true, ...info };
    } catch (err) {
      const code = err.status || 0;
      const message = code === 401 ? tr('Trading 212 returned 401 Unauthorized — check the key and secret.')
        : code === 403 ? tr('Trading 212 returned 403 Forbidden — the key needs the Account data and Portfolio permissions.')
        : code === 429 ? tr('Rate limited by Trading 212 — wait a few seconds and try again.')
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
  if (IS_MAC && app.dock) app.dock.hide();          // menu-bar app: no Dock icon
  store = new Store(app.getPath('userData'), safeStorage);
  poller = new Poller({ store, fetchImpl: (u, o) => net.fetch(u, o) });
  if (!store.get('firstLaunchDone')) {
    store.set({ firstLaunchDone: true });
    applyAutostart(store.get('startWithWindows'));
  }
  registerIpc();
  poller.on('state', st => { lastState = st; broadcast('state', st); applyWidgetSize(); applyPopoverSize(); updateTrayTitle(); });
  createTray();
  if (!IS_MAC || store.get('macMode') !== 'menubar') createWidget();
  if (IS_MAC) { createPopover(); if (!store.getCreds()) setTimeout(() => togglePopover(), 800); }
  poller.start();
  // market open/closed flips & "opens in" countdown refresh
  setInterval(() => poller.tick(), 30e3);
  screen.on('display-removed', () => {
    if (!widget) return;
    const [x, y] = widget.getPosition(); const [w, h] = widget.getSize();
    const p = clampToScreen(x, y, w, h); widget.setPosition(p.x, p.y);
  });
});
