'use strict';
const { app, BrowserWindow, ipcMain, Tray, Menu, screen, shell, safeStorage, nativeTheme, net, nativeImage, dialog, powerMonitor, Notification } = require('electron');
const path = require('path');
const { Store } = require('./store');
const { Poller } = require('./t212');
const { Updater, installWindows, installMac, macBundle, macCanReplace } = require('./updater');

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

let store, poller, widget, settingsWin, tray, popover, updater;
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
  'Rate limited by Trading 212 — wait a few seconds and try again.': 'Trading 212 omezil počet dotazů — počkejte pár sekund a zkuste to znovu.',
  // updates
  'Check for updates…': 'Zkontrolovat aktualizace…',
  'Install update {v}…': 'Nainstalovat aktualizaci {v}…',
  'Downloading update… {p} %': 'Stahuji aktualizaci… {p} %',
  'Version {v} is available': 'Je k dispozici nová verze {v}',
  'You have {c}. Once installed, the widget restarts by itself.': 'Teď máš {c}. Po instalaci se widget sám znovu spustí.',
  'You have {c}.': 'Teď máš {c}.',
  'Download and install': 'Stáhnout a nainstalovat',
  'Open download page': 'Otevřít stránku ke stažení',
  'Not now': 'Teď ne',
  'Skip this version': 'Přeskočit tuto verzi',
  'You have the latest version': 'Máš nejnovější verzi',
  'T212 Widget {v} is up to date.': 'T212 Widget {v} je aktuální.',
  "Couldn't check for updates": 'Aktualizace se nepodařilo zkontrolovat',
  'Update failed': 'Aktualizace se nepovedla',
  'Downloading T212 Widget {v}…': 'Stahuji T212 Widget {v}…',
  'It installs and restarts by itself.': 'Nainstaluje se a spustí se sám.',
  'This is a development build — install the new version from the release page.': 'Tohle je vývojová verze — novou verzi nainstaluj ze stránky vydání.',
  'The release has no file for this computer — download it from the release page.': 'Vydání nemá soubor pro tenhle počítač — stáhni ho ze stránky vydání.',
  'macOS is running the app from a temporary location. Move T212 Widget to Applications and start it from there — then it can update itself.': 'macOS spouští aplikaci z dočasného umístění. Přesuň T212 Widget do složky Aplikace a spusť ho odtud — pak se bude umět aktualizovat sám.',
  'The app folder is read-only for your account, so it can\u2019t update itself in place.': 'Do složky s aplikací tvůj účet nemůže zapisovat, takže se nemůže aktualizovat sám.',
  'notfound': 'Na GitHubu není žádné vydání, nebo je repozitář soukromý a chybí token (Nastavení → Systém → Aktualizace).',
  'auth': 'GitHub token nefunguje — zkontroluj ho v Nastavení → Systém → Aktualizace.',
  'rate': 'GitHub dočasně omezil počet dotazů — zkusím to později.',
  'network': 'GitHub není dostupný — zkontroluj připojení.',
  'http': 'GitHub vrátil chybu.',
  'verify': 'Stažený soubor nejde ověřit proti vydání — instalace zrušena.',
  'noasset': 'Vydání nemá soubor pro tenhle počítač.',
  'Windows did not allow the installer to start:': 'Windows nedovolil spustit instalátor:',
  'It is downloaded here and you can run it yourself: {f}': 'Je stažený tady a můžeš ho spustit ručně: {f}',
  'Show installer': 'Zobrazit instalátor'
};
const ERR_EN = {
  notfound: 'No release on GitHub, or the repository is private and no token is set (Settings → System → Updates).',
  auth: 'The GitHub token doesn\u2019t work — check it in Settings → System → Updates.',
  rate: 'GitHub is rate limiting — will try again later.',
  network: 'GitHub is unreachable — check the connection.',
  http: 'GitHub returned an error.',
  verify: 'The download couldn\u2019t be verified against the release — not installing.',
  noasset: 'The release has no file for this computer.'
};
const tr = s => ((store && store.get('language')) !== 'en' && TRAY_CS[s]) || s;
const trv = (s, vars) => Object.entries(vars).reduce((a, [k, v]) => a.split('{' + k + '}').join(v), tr(s));
const errText = e => (e && ((store.get('language') !== 'en' ? TRAY_CS[e.kind] : ERR_EN[e.kind]) || e.message)) || '';
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
    updateMenuItem(),
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

// ── updates (GitHub Releases) ────────────────────────────────
// When: shortly after start (also covers turning the PC on — the app starts at login),
// after waking from sleep, every day at 12:00, and on demand. Nothing is downloaded without a yes.
const DAILY_HOUR = 12;
let updateBusy = false, dailyTimer = null, lastPrompt = { version: null, at: 0 }, lastUpdStatus = null;

function updateMenuItem() {
  const u = updater ? updater.state : { status: 'idle' };
  if (u.status === 'downloading') return { label: trv('Downloading update… {p} %', { p: Math.round((u.progress || 0) * 100) }), enabled: false };
  if (u.status === 'available') return { label: trv('Install update {v}…', { v: u.latest }), click: () => promptUpdate(true) };
  return { label: tr('Check for updates…'), click: () => manualCheck(true) };
}

function setupUpdater() {
  updater = new Updater({
    version: app.getVersion(),
    fetchImpl: (u, o) => net.fetch(u, o),
    getToken: () => store.getGhToken(),
    tmpDir: app.getPath('temp')
  });
  updater.on('state', u => {
    broadcast('update', u);
    if (tray) tray.setToolTip(u.status === 'downloading' ? trv('Downloading update… {p} %', { p: Math.round(u.progress * 100) }) : 'T212 Widget');
    if (u.status !== lastUpdStatus) { lastUpdStatus = u.status; rebuildTrayMenu(); }
  });
  setTimeout(() => autoCheck('startup'), 15e3);
  scheduleDaily();
  powerMonitor.on('resume', () => { scheduleDaily(); setTimeout(() => autoCheck('resume'), 20e3); });
}

function scheduleDaily() {
  clearTimeout(dailyTimer);
  const now = new Date(), next = new Date(now);
  next.setHours(DAILY_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  dailyTimer = setTimeout(() => { autoCheck('daily'); scheduleDaily(); }, next - now);
}

async function autoCheck(reason) {
  if (!store.get('autoUpdate') || updateBusy || !app.isPackaged) return;
  // waking up several times an hour shouldn't mean several checks or prompts
  if (reason === 'resume' && updater.state.checkedAt && Date.now() - updater.state.checkedAt < 3600e3) return;
  const u = await updater.check();
  if (u.status !== 'available' || store.get('skippedVersion') === u.latest) return;
  if (reason === 'resume' && lastPrompt.version === u.latest && Date.now() - lastPrompt.at < 4 * 3600e3) return;
  promptUpdate(false);
}

// from the tray (dialog for every outcome) or the settings window (result shows inline)
async function manualCheck(fromTray) {
  if (updateBusy) return updater.state;
  const u = await updater.check();
  if (u.status === 'available') promptUpdate(true);
  else if (fromTray && u.status === 'none') {
    focusForDialog();
    dialog.showMessageBox({ type: 'info', title: 'T212 Widget', message: tr('You have the latest version'), detail: trv('T212 Widget {v} is up to date.', { v: app.getVersion() }), buttons: ['OK'], noLink: true });
  } else if (fromTray && u.status === 'error') {
    focusForDialog();
    dialog.showMessageBox({ type: 'warning', title: 'T212 Widget', message: tr("Couldn't check for updates"), detail: errText(u.error), buttons: ['OK'], noLink: true });
  }
  return updater.state;
}

function focusForDialog() { if (IS_MAC) app.focus({ steal: true }); }

// why this install can't replace itself (dev build / no asset / macOS location) — null when it can
function installBlocker(u) {
  if (!app.isPackaged) return tr('This is a development build — install the new version from the release page.');
  if (!u.hasAsset) return tr('The release has no file for this computer — download it from the release page.');
  if (IS_MAC) {
    const c = macCanReplace(macBundle(app.getPath('exe')));
    if (!c.ok) return c.reason === 'translocated'
      ? tr('macOS is running the app from a temporary location. Move T212 Widget to Applications and start it from there — then it can update itself.')
      : tr('The app folder is read-only for your account, so it can’t update itself in place.');
  }
  return null;
}

async function promptUpdate(manual) {
  if (updateBusy || !updater || updater.state.status !== 'available') return;
  updateBusy = true;
  try {
    const u = updater.state;
    const blocker = installBlocker(u);
    focusForDialog();
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'T212 Widget',
      message: trv('Version {v} is available', { v: u.latest }),
      detail: [blocker ? trv('You have {c}.', { c: app.getVersion() }) : trv('You have {c}. Once installed, the widget restarts by itself.', { c: app.getVersion() }),
        u.notes, blocker].filter(Boolean).join('\n\n'),
      buttons: [blocker ? tr('Open download page') : tr('Download and install'), tr('Not now'), tr('Skip this version')],
      defaultId: 0, cancelId: 1, noLink: true
    });
    lastPrompt = { version: u.latest, at: Date.now() };
    if (response === 2) { store.set({ skippedVersion: u.latest }); broadcast('settings', store.all()); return; }
    if (response !== 0) return;
    if (store.get('skippedVersion') === u.latest) store.set({ skippedVersion: null });
    if (blocker) { shell.openExternal(u.url); return; }
    if (Notification.isSupported()) new Notification({ title: trv('Downloading T212 Widget {v}…', { v: u.latest }), body: tr('It installs and restarts by itself.'), silent: true }).show();
    const file = await updater.download();
    if (process.platform === 'win32') await installWindows(file);
    else if (IS_MAC) await installMac(file, macBundle(app.getPath('exe')), process.pid);
    quitting = true;
    try { store.saveHistory(); } catch {}
    app.quit();   // the installer (Windows) / swap script (macOS) starts the new version
  } catch (e) {
    focusForDialog();
    const file = updater && updater.file;
    const launch = e && e.kind === 'launch' && file;
    const detail = launch
      ? [tr('Windows did not allow the installer to start:'), e.message, trv('It is downloaded here and you can run it yourself: {f}', { f: file })].join('\n\n')
      : (errText(e) || String(e && e.message || e));
    const { response } = await dialog.showMessageBox({ type: 'error', title: 'T212 Widget', message: tr('Update failed'), detail,
      buttons: launch ? ['OK', tr('Show installer')] : ['OK'], defaultId: 0, cancelId: 0, noLink: true });
    if (launch && response === 1) shell.showItemInFolder(file);
  } finally {
    updateBusy = false;
  }
}

// ── IPC ──────────────────────────────────────────────────────
function registerIpc() {
  ipcMain.handle('init', () => ({ settings: store.all(), state: poller.payload(), version: app.getVersion(), dataDir: app.getPath('userData'), platform: process.platform,
    update: updater ? updater.state : null, hasGhToken: !!store.getGhToken(), packaged: app.isPackaged }));
  ipcMain.handle('update-check', () => manualCheck(false));
  ipcMain.handle('update-install', () => { promptUpdate(true); return true; });
  ipcMain.handle('set-gh-token', (_e, tok) => { try { store.setGhToken(tok ? String(tok) : null); } catch {} return !!store.getGhToken(); });
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
  ipcMain.handle('open-external', (_e, url) => { if (externalAllowed(url)) shell.openExternal(url); return true; });
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

// ── hardening ────────────────────────────────────────────────
// Our windows only ever show the bundled pages: a dropped link/file or a stray <a> must not
// load a foreign page next to window.api, and nothing may open new windows.
const EXTERNAL_HOSTS = ['trading212.com', 'github.com'];
function externalAllowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && EXTERNAL_HOSTS.some(h => u.hostname === h || u.hostname.endsWith('.' + h)); }
  catch { return false; }
}
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-navigate', e => e.preventDefault());
  wc.on('will-redirect', e => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => { if (externalAllowed(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-attach-webview', e => e.preventDefault());
});

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
  setupUpdater();
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
