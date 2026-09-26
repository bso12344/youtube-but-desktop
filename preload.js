const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openCustomPip: (data) => ipcRenderer.invoke('open-custom-pip', data),
  updateDiscordPresence: (data) => ipcRenderer.send('discord-presence-update', data),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  notifyVideoEnded: (data) => ipcRenderer.send('video-ended', data)
});