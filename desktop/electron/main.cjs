const { app, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

// --- Extracted modules ---
const { desktopSettings, sessionState, appConfig } = require('./state.cjs')
const { normalizeOutputMode, normalizeTextInput, normalizeDiscordId, validateCollectionEdits } = require('./validation.cjs')
const { loadDesktopSettings, saveDesktopSettings, loadAppConfig } = require('./config.cjs')
const { syncConfigIntoState, ensureDiscordSelection, resolveDiscordTargets, buildDiscordStatus } = require('./discord.cjs')
const { startSidecarProcess, sendSidecarCommand, resolvePendingCommand, cleanup: cleanupSidecar } = require('./sidecar.cjs')
const { previewTrackSource } = require('./preview.cjs')
const { createMainWindow, togglePinnedHud, syncHudWindowSize, emitState: emitStateToWindows, showDashboardWindow } = require('./windows.cjs')

// --- Helpers ---

function getBootstrapData() {
  return {
    settings: desktopSettings,
    config: appConfig,
    state: sessionState,
  }
}

function emitState() {
  emitStateToWindows(getBootstrapData)
}

function applyStatusPayload(payload) {
  Object.assign(sessionState, payload)
  syncHudWindowSize()
  emitState()
}

function handleSidecarEvent(eventName, payload) {
  if (eventName === 'status' || eventName === 'session_ended') {
    applyStatusPayload(payload)
    return
  }

  if (eventName === 'session_ready') {
    sessionState.sessionRunning = true
    sessionState.startupInProgress = true
    sessionState.activeCollection = payload.active_collection || sessionState.activeCollection
    emitState()
    return
  }

  if (eventName === 'discord_connected') {
    sessionState.discordStatus = buildDiscordStatus().replace('Ready for', 'Discord playback connected to')
    emitState()
    return
  }

  if (eventName === 'track_started') {
    sessionState.sessionRunning = true
    sessionState.startupInProgress = false
    sessionState.activeCollection = payload.collection || sessionState.activeCollection
    sessionState.currentTrackTitle = payload.title || sessionState.currentTrackTitle
    sessionState.currentTrackIndex = payload.track_index ?? sessionState.currentTrackIndex
    emitState()
    return
  }

  if (eventName === 'transcript') {
    sessionState.lastTranscript = payload.text || ''
    emitState()
    return
  }

  if (eventName === 'keyword_match') {
    sessionState.activeCollection = payload.collection || sessionState.activeCollection
    emitState()
    return
  }

  if (eventName === 'transition_pending') {
    sessionState.pendingTransition = {
      keyword: payload.keyword,
      targetCollection: payload.target_collection,
      displayName: payload.display_name,
      expiresAtEpoch: payload.expires_at_epoch ?? null,
    }
    syncHudWindowSize()
    emitState()
    return
  }

  if (eventName === 'transition_dismissed' || eventName === 'transition_approved') {
    sessionState.pendingTransition = null
    syncHudWindowSize()
    emitState()
    return
  }

  if (eventName === 'error') {
    sessionState.lastError = payload.message || 'Unknown sidecar error'
    emitState()
    return
  }
}

function handleSidecarMessage(message) {
  if (message.type === 'command_result') {
    const pending = resolvePendingCommand(message.id)
    if (!pending) {
      return
    }
    if (message.ok) {
      applyStatusPayload(message.result)
      pending.resolve(message.result)
    } else {
      sessionState.lastError = message.error || 'Unknown sidecar error'
      emitState()
      pending.reject(new Error(message.error || 'Unknown sidecar error'))
    }
    return
  }

  if (message.type === 'event') {
    handleSidecarEvent(message.event, message.payload || {})
  }
}

// --- IPC Handlers ---

ipcMain.handle('dashboard:get-bootstrap-data', () => getBootstrapData())

ipcMain.handle('dashboard:preview-track-source', (_event, source) => previewTrackSource(source))

ipcMain.handle('dashboard:save-collection-edits', (_event, collectionId, payload) => {
  const normalized = validateCollectionEdits(collectionId, payload)
  const configPath = path.resolve(desktopSettings.configPath)
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw) || {}
  const collectionsMap = parsed.collections || {}
  const currentCollection = collectionsMap[normalized.collectionId]

  collectionsMap[normalized.collectionId] = {
    ...(currentCollection && typeof currentCollection === 'object' ? currentCollection : {}),
    name: normalized.name,
    keywords: normalized.keywords,
    tracks: normalized.tracks.map((source) => ({ source })),
    playback: {
      ...(currentCollection?.playback && typeof currentCollection.playback === 'object' ? currentCollection.playback : {}),
      mode: currentCollection?.playback?.mode || 'sequential_loop',
    },
  }

  parsed.collections = collectionsMap
  fs.writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), 'utf8')
  loadAppConfig(configPath)
  emitState()
  return getBootstrapData()
})

ipcMain.handle('dashboard:delete-collection', (_event, collectionId) => {
  const normalizedCollectionId = normalizeTextInput(collectionId)
  if (!normalizedCollectionId) {
    throw new Error('Collection id is required for deletion')
  }

  if ((sessionState.sessionRunning || sessionState.startupInProgress) && sessionState.activeCollection === normalizedCollectionId) {
    throw new Error('Stop the current session before deleting the active collection.')
  }

  const configPath = path.resolve(desktopSettings.configPath)
  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw) || {}
  const collectionsMap = parsed.collections || {}

  if (!collectionsMap[normalizedCollectionId]) {
    throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
  }

  delete collectionsMap[normalizedCollectionId]
  parsed.collections = collectionsMap

  const remainingCollectionIds = Object.keys(collectionsMap)
  if (!parsed.settings || typeof parsed.settings !== 'object') {
    parsed.settings = {}
  }
  if (parsed.settings.default_collection === normalizedCollectionId) {
    parsed.settings.default_collection = remainingCollectionIds[0] || ''
  }
  if (sessionState.activeCollection === normalizedCollectionId) {
    sessionState.activeCollection = parsed.settings.default_collection || remainingCollectionIds[0] || null
    sessionState.currentTrackTitle = 'No track active'
    sessionState.currentTrackIndex = null
  }

  fs.writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), 'utf8')
  loadAppConfig(configPath)
  emitState()
  return getBootstrapData()
})

ipcMain.handle('dashboard:save-bot-token', (_event, token) => {
  desktopSettings.botToken = String(token || '').trim()
  desktopSettings.discordGuildId = null
  desktopSettings.discordVoiceChannelId = null
  saveDesktopSettings()
  return resolveDiscordTargets(emitState, getBootstrapData)
})

ipcMain.handle('dashboard:refresh-discord-targets', () => resolveDiscordTargets(emitState, getBootstrapData))

ipcMain.handle('dashboard:set-discord-guild', (_event, guildId) => {
  desktopSettings.discordGuildId = normalizeDiscordId(guildId)
  desktopSettings.discordVoiceChannelId = null
  ensureDiscordSelection()
  saveDesktopSettings()
  syncConfigIntoState()
  emitState()
  return getBootstrapData()
})

ipcMain.handle('dashboard:set-discord-voice-channel', (_event, channelId) => {
  desktopSettings.discordVoiceChannelId = normalizeDiscordId(channelId)
  ensureDiscordSelection()
  saveDesktopSettings()
  syncConfigIntoState()
  emitState()
  return getBootstrapData()
})

ipcMain.handle('dashboard:set-output-mode', async (_event, outputMode) => {
  const previousMode = desktopSettings.outputMode
  desktopSettings.outputMode = normalizeOutputMode(outputMode)
  saveDesktopSettings()
  syncConfigIntoState()
  if (sessionState.sessionRunning && !sessionState.startupInProgress) {
    try {
      await sendSidecarCommand('update_output_mode', { output_mode: desktopSettings.outputMode })
    } catch (error) {
      desktopSettings.outputMode = previousMode
      saveDesktopSettings()
      syncConfigIntoState()
      emitState()
      throw error
    }
  }
  emitState()
  return getBootstrapData()
})

ipcMain.handle('window:toggle-pinned-hud', () => {
  togglePinnedHud()
  return getBootstrapData()
})

ipcMain.handle('session:start', async (_event, payload) => {
  if (sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }

  const transcriptionEnabled = payload?.transcriptionEnabled !== false
  const transitionProposalsEnabled = transcriptionEnabled && payload?.transitionProposalsEnabled !== false
  const transitionTimeoutSeconds = Number.parseInt(payload?.transitionTimeoutSeconds, 10)
  const transcriptionProfile = typeof payload?.transcriptionProfile === 'string' ? payload.transcriptionProfile : undefined
  const outputMode = normalizeOutputMode(payload?.outputMode || desktopSettings.outputMode)

  if (outputMode === 'discord' && (!desktopSettings.botToken || !desktopSettings.discordVoiceChannelId)) {
    throw new Error('Discord output requires a saved bot token and selected voice channel')
  }

  await sendSidecarCommand('start_session', {
    config_path: desktopSettings.configPath,
    starting_collection: payload?.startingCollection ?? undefined,
    no_transcription: !transcriptionEnabled,
    transcription_profile: transcriptionProfile,
    enable_transition_proposals: transitionProposalsEnabled,
    transition_popup_timeout: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
    volume_percent: Number.isFinite(Number.parseInt(payload?.volumePercent, 10)) ? Number.parseInt(payload?.volumePercent, 10) : sessionState.volumePercent,
    muted: typeof payload?.muted === 'boolean' ? payload.muted : sessionState.playbackMuted,
    paused: typeof payload?.paused === 'boolean' ? payload.paused : false,
    output_mode: outputMode,
    no_auto_play: outputMode !== 'local',
    discord_token: outputMode === 'discord' ? (desktopSettings.botToken || undefined) : undefined,
    discord_guild_id: outputMode === 'discord' ? (desktopSettings.discordGuildId || undefined) : undefined,
    discord_voice_channel_id: outputMode === 'discord' ? (desktopSettings.discordVoiceChannelId || undefined) : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('playback:update-settings', async (_event, payload) => {
  if (!sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }

  const volumePercent = Number.parseInt(payload?.volumePercent, 10)
  const muted = payload?.muted
  const paused = payload?.paused

  await sendSidecarCommand('update_playback_settings', {
    volume_percent: Number.isFinite(volumePercent) ? volumePercent : undefined,
    muted: typeof muted === 'boolean' ? muted : undefined,
    paused: typeof paused === 'boolean' ? paused : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('session:update-settings', async (_event, payload) => {
  if (!sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }

  const transcriptionEnabled = payload?.transcriptionEnabled
  const transcriptionProfile = typeof payload?.transcriptionProfile === 'string' ? payload.transcriptionProfile : undefined
  const transitionProposalsEnabled = payload?.transitionProposalsEnabled
  const transitionTimeoutSeconds = Number.parseInt(payload?.transitionTimeoutSeconds, 10)

  await sendSidecarCommand('update_session_settings', {
    transcription_enabled: typeof transcriptionEnabled === 'boolean' ? transcriptionEnabled : undefined,
    transcription_profile: transcriptionProfile,
    enable_transition_proposals: typeof transitionProposalsEnabled === 'boolean' ? transitionProposalsEnabled : undefined,
    transition_popup_timeout: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('session:end', async () => {
  if (!sessionState.sessionRunning && !sessionState.startupInProgress) {
    return getBootstrapData()
  }
  await sendSidecarCommand('end_session', {})
  return getBootstrapData()
})

ipcMain.handle('hud:skip-track', async () => {
  await sendSidecarCommand('skip_track', {})
  return getBootstrapData()
})

ipcMain.handle('hud:approve-transition', async () => {
  await sendSidecarCommand('approve_transition', {})
  return getBootstrapData()
})

ipcMain.handle('hud:dismiss-transition', async () => {
  await sendSidecarCommand('dismiss_transition', {})
  return getBootstrapData()
})

// --- App Lifecycle ---

app.whenReady().then(() => {
  loadDesktopSettings()
  syncConfigIntoState()
  loadAppConfig(desktopSettings.configPath)
  startSidecarProcess(emitState, handleSidecarMessage)
  void resolveDiscordTargets(emitState, getBootstrapData).catch((error) => {
    sessionState.lastError = error.message
    emitState()
  })
  createMainWindow()

  app.on('activate', () => {
    const { getMainWindow, getHudWindow } = require('./windows.cjs')
    const mw = getMainWindow()
    const hw = getHudWindow()
    if (!mw && !hw) {
      createMainWindow()
      return
    }
    if ((!mw || mw.isDestroyed() || !mw.isVisible()) && (!hw || !hw.isVisible())) {
      showDashboardWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanupSidecar()
})
