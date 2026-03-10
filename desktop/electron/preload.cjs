const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dungeonMaestro', {
  getBootstrapData: () => ipcRenderer.invoke('dashboard:get-bootstrap-data'),
  saveBotToken: (token) => ipcRenderer.invoke('dashboard:save-bot-token', token),
  refreshDiscordTargets: () => ipcRenderer.invoke('dashboard:refresh-discord-targets'),
  setDiscordGuild: (guildId) => ipcRenderer.invoke('dashboard:set-discord-guild', guildId),
  setDiscordVoiceChannel: (channelId) => ipcRenderer.invoke('dashboard:set-discord-voice-channel', channelId),
  setOutputMode: (outputMode) => ipcRenderer.invoke('dashboard:set-output-mode', outputMode),
  togglePinnedHud: () => ipcRenderer.invoke('window:toggle-pinned-hud'),
  startSession: (payload) => ipcRenderer.invoke('session:start', payload),
  updateSessionSettings: (payload) => ipcRenderer.invoke('session:update-settings', payload),
  updatePlaybackSettings: (payload) => ipcRenderer.invoke('playback:update-settings', payload),
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