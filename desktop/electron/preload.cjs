const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dungeonMaestro', {
  getBootstrapData: () => ipcRenderer.invoke('dashboard:get-bootstrap-data'),
  saveBotToken: (token) => ipcRenderer.invoke('dashboard:save-bot-token', token),
  startSession: (payload) => ipcRenderer.invoke('session:start', payload),
  endSession: () => ipcRenderer.invoke('session:end'),
  skipTrack: () => ipcRenderer.invoke('hud:skip-track'),
  approveTransition: () => ipcRenderer.invoke('hud:approve-transition'),
  dismissTransition: () => ipcRenderer.invoke('hud:dismiss-transition'),
  onStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
})