const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dungeonMaestro', {
  getBootstrapData: () => ipcRenderer.invoke('dashboard:get-bootstrap-data'),
  previewTrackSource: (source) => ipcRenderer.invoke('dashboard:preview-track-source', source),
  createSessionCollection: (name) => ipcRenderer.invoke('dashboard:create-session-collection', name),
  addSoundscapeToCollection: (collectionId, soundscapeId) => ipcRenderer.invoke('dashboard:add-soundscape-to-collection', collectionId, soundscapeId),
  removeSoundscapeFromCollection: (collectionId, soundscapeId) => ipcRenderer.invoke('dashboard:remove-soundscape-from-collection', collectionId, soundscapeId),
  deleteSessionCollection: (collectionId) => ipcRenderer.invoke('dashboard:delete-session-collection', collectionId),
  reorderCollectionSoundscapes: (collectionId, sourceSoundscapeId, beforeSoundscapeId) => ipcRenderer.invoke('dashboard:reorder-collection-soundscapes', collectionId, sourceSoundscapeId, beforeSoundscapeId),
  saveSoundscapeEdits: (soundscapeId, payload) => ipcRenderer.invoke('dashboard:save-soundscape-edits', soundscapeId, payload),
  saveCollectionEdits: (collectionId, payload) => ipcRenderer.invoke('dashboard:save-collection-edits', collectionId, payload),
  deleteSoundscape: (soundscapeId) => ipcRenderer.invoke('dashboard:delete-soundscape', soundscapeId),
  deleteCollection: (collectionId) => ipcRenderer.invoke('dashboard:delete-collection', collectionId),
  saveBotToken: (token) => ipcRenderer.invoke('dashboard:save-bot-token', token),
  refreshDiscordTargets: () => ipcRenderer.invoke('dashboard:refresh-discord-targets'),
  setDiscordGuild: (guildId) => ipcRenderer.invoke('dashboard:set-discord-guild', guildId),
  setDiscordVoiceChannel: (channelId) => ipcRenderer.invoke('dashboard:set-discord-voice-channel', channelId),
  setOutputMode: (outputMode) => ipcRenderer.invoke('dashboard:set-output-mode', outputMode),
  togglePinnedHud: () => ipcRenderer.invoke('window:toggle-pinned-hud'),
  startSession: (payload) => ipcRenderer.invoke('session:start', payload),
  updateSessionSettings: (payload) => ipcRenderer.invoke('session:update-settings', payload),
  updatePlaybackSettings: (payload) => ipcRenderer.invoke('playback:update-settings', payload),
  seekTrack: (positionSeconds) => ipcRenderer.invoke('playback:seek', positionSeconds),
  endSession: () => ipcRenderer.invoke('session:end'),
  skipTrack: () => ipcRenderer.invoke('hud:skip-track'),
  switchSoundscape: (soundscapeId) => ipcRenderer.invoke('session:switch-soundscape', soundscapeId),
  switchCollection: (collectionId) => ipcRenderer.invoke('session:switch-collection', collectionId),
  playSoundscapeTrack: (soundscapeId, trackIndex) => ipcRenderer.invoke('session:play-soundscape-track', soundscapeId, trackIndex),
  playTrack: (collectionId, trackIndex) => ipcRenderer.invoke('session:play-track', collectionId, trackIndex),
  approveTransition: () => ipcRenderer.invoke('hud:approve-transition'),
  dismissTransition: () => ipcRenderer.invoke('hud:dismiss-transition'),
  onStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('state:changed', listener)
    return () => ipcRenderer.removeListener('state:changed', listener)
  },
})