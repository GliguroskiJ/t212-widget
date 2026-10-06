'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  setSettings: patch => ipcRenderer.invoke('set-settings', patch),
  refresh: () => ipcRenderer.invoke('refresh'),
  recheckDividends: () => ipcRenderer.invoke('recheck-dividends'),
  openSettings: tab => ipcRenderer.invoke('open-settings', tab),
  hideWidget: () => ipcRenderer.invoke('hide-widget'),
  hidePopover: () => ipcRenderer.invoke('hide-popover'),
  showWidget: () => ipcRenderer.invoke('show-widget'),
  quit: () => ipcRenderer.invoke('quit'),
  closeSettings: () => ipcRenderer.invoke('close-settings'),
  minimizeSettings: () => ipcRenderer.invoke('minimize-settings'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  resetPosition: () => ipcRenderer.invoke('reset-position'),
  connect: payload => ipcRenderer.invoke('connect', payload),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  setGithubToken: tok => ipcRenderer.invoke('set-gh-token', tok),
  onUpdate: cb => ipcRenderer.on('update', (_e, u) => cb(u)),
  drag: phase => ipcRenderer.send('drag', phase),
  setIgnoreMouse: ignore => ipcRenderer.send('set-ignore-mouse', ignore),
  onState: cb => ipcRenderer.on('state', (_e, s) => cb(s)),
  onSettings: cb => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onGotoTab: cb => ipcRenderer.on('goto-tab', (_e, t) => cb(t))
});
