const { app, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

// --- Extracted modules ---
const { desktopSettings, sessionState, appConfig } = require('./state.cjs')
const { normalizeOutputMode, normalizeTextInput, normalizeDiscordId, validateCollectionEdits, validateSessionCollectionName, validateSoundscapeEdits } = require('./validation.cjs')
const { getCollectionsMap, getSoundscapesMap, isLegacySoundscapeMap, loadDesktopSettings, saveDesktopSettings, loadAppConfig } = require('./config.cjs')
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

function syncStateAliases() {
  sessionState.activeSoundscape = sessionState.activeSoundscape || sessionState.activeCollection || null
  sessionState.activeCollection = sessionState.activeCollection || sessionState.activeSoundscape || null
  if (sessionState.pendingTransition && !sessionState.pendingTransition.targetSoundscape) {
    sessionState.pendingTransition.targetSoundscape = sessionState.pendingTransition.targetCollection || null
  }
  appConfig.soundscapes = Array.isArray(appConfig.soundscapes) ? appConfig.soundscapes : []
  appConfig.collections = Array.isArray(appConfig.collections) ? appConfig.collections : []
  if (appConfig.settings && !Object.prototype.hasOwnProperty.call(appConfig.settings, 'defaultSoundscape')) {
    appConfig.settings.defaultSoundscape = appConfig.settings.default_soundscape || appConfig.settings.default_collection || null
  }
}

function applyStatusPayload(payload) {
  Object.assign(sessionState, payload)
  if (!sessionState.sessionRunning || sessionState.currentTrackIndex == null) {
    sessionState.currentTrackPositionSeconds = 0
  }
  syncStateAliases()
  syncHudWindowSize()
  emitState()
}

function clampPlaybackPosition(positionSeconds, durationSeconds, loopEnabled) {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) {
    return 0
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return positionSeconds
  }
  if (loopEnabled) {
    return positionSeconds % durationSeconds
  }
  return Math.min(positionSeconds, durationSeconds)
}

function getCurrentTrackPositionSeconds(nowEpoch = Date.now() / 1000) {
  if (sessionState.currentTrackIndex == null) {
    return 0
  }

  if (sessionState.playbackPaused && Number.isFinite(sessionState.currentTrackPositionSeconds)) {
    return clampPlaybackPosition(
      sessionState.currentTrackPositionSeconds,
      sessionState.currentTrackDurationSeconds,
      sessionState.loopEnabled,
    )
  }

  if (!Number.isFinite(sessionState.currentTrackStartedAt)) {
    return clampPlaybackPosition(
      sessionState.currentTrackPositionSeconds,
      sessionState.currentTrackDurationSeconds,
      sessionState.loopEnabled,
    )
  }

  return clampPlaybackPosition(
    nowEpoch - sessionState.currentTrackStartedAt,
    sessionState.currentTrackDurationSeconds,
    sessionState.loopEnabled,
  )
}

function loadParsedConfig() {
  const configPath = path.resolve(desktopSettings.configPath)
  const raw = fs.readFileSync(configPath, 'utf8')
  return {
    configPath,
    parsed: yaml.load(raw) || {},
  }
}

function normalizeConfigDocument(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return {}
  }

  if (!parsed.soundscapes && isLegacySoundscapeMap(parsed.collections)) {
    parsed.soundscapes = parsed.collections
    delete parsed.collections
  }

  if (!parsed.soundscapes || typeof parsed.soundscapes !== 'object' || Array.isArray(parsed.soundscapes)) {
    parsed.soundscapes = {}
  }
  if (!parsed.collections || typeof parsed.collections !== 'object' || Array.isArray(parsed.collections) || isLegacySoundscapeMap(parsed.collections)) {
    parsed.collections = {}
  }
  if (!parsed.settings || typeof parsed.settings !== 'object') {
    parsed.settings = {}
  }
  if (!parsed.settings.default_soundscape) {
    parsed.settings.default_soundscape = parsed.settings.default_collection || ''
  }
  delete parsed.settings.default_collection
  return parsed
}

function saveParsedConfig(configPath, parsed) {
  fs.writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), 'utf8')
  loadAppConfig(configPath)
  syncStateAliases()
  emitState()
  return getBootstrapData()
}

function saveCollectionConfig(collectionId, payload, validateEdits) {
  const normalized = validateEdits(collectionId, payload)
  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const soundscapesMap = getSoundscapesMap(parsed)
  const currentCollection = soundscapesMap[normalized.collectionId]

  soundscapesMap[normalized.collectionId] = {
    ...(currentCollection && typeof currentCollection === 'object' ? currentCollection : {}),
    name: normalized.name,
    keywords: normalized.keywords,
    tracks: normalized.tracks.map((source) => ({ source })),
    playback: {
      ...(currentCollection?.playback && typeof currentCollection.playback === 'object' ? currentCollection.playback : {}),
      mode: currentCollection?.playback?.mode || 'sequential_loop',
    },
  }

  parsed.soundscapes = soundscapesMap
  if (!parsed.settings.default_soundscape) {
    parsed.settings.default_soundscape = normalized.collectionId
  }
  return saveParsedConfig(configPath, parsed)
}

function deleteCollectionConfig(collectionId) {
  const normalizedCollectionId = normalizeTextInput(collectionId)
  if (!normalizedCollectionId) {
    throw new Error('Soundscape id is required for deletion')
  }

  if ((sessionState.sessionRunning || sessionState.startupInProgress)
    && (sessionState.activeSoundscape || sessionState.activeCollection) === normalizedCollectionId) {
    throw new Error('Stop the current session before deleting the active soundscape.')
  }

  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const soundscapesMap = getSoundscapesMap(parsed)

  if (!soundscapesMap[normalizedCollectionId]) {
    throw new Error(`Soundscape "${normalizedCollectionId}" was not found.`)
  }

  delete soundscapesMap[normalizedCollectionId]
  parsed.soundscapes = soundscapesMap

  const remainingCollectionIds = Object.keys(soundscapesMap)
  if (parsed.settings.default_soundscape === normalizedCollectionId) {
    parsed.settings.default_soundscape = remainingCollectionIds[0] || ''
  }
  if ((sessionState.activeSoundscape || sessionState.activeCollection) === normalizedCollectionId) {
    sessionState.activeSoundscape = parsed.settings.default_soundscape || remainingCollectionIds[0] || null
    sessionState.activeCollection = sessionState.activeSoundscape
    sessionState.currentTrackTitle = 'No track active'
    sessionState.currentTrackIndex = null
  }

  Object.values(getCollectionsMap(parsed)).forEach((collection) => {
    if (!collection || typeof collection !== 'object' || !Array.isArray(collection.soundscapes)) {
      return
    }
    collection.soundscapes = collection.soundscapes
      .map((soundscapeId) => normalizeTextInput(soundscapeId))
      .filter((soundscapeId) => soundscapeId && soundscapeId !== normalizedCollectionId)
  })

  return saveParsedConfig(configPath, parsed)
}

function createSessionCollection(name) {
  const normalizedName = validateSessionCollectionName(name)
  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const collectionsMap = getCollectionsMap(parsed)
  const existingNames = new Set(Object.values(collectionsMap).map((collection) => normalizeTextInput(collection?.name).toLowerCase()).filter(Boolean))
  if (existingNames.has(normalizedName.toLowerCase())) {
    throw new Error(`A collection named "${normalizedName}" already exists.`)
  }

  let collectionId = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  if (!collectionId) {
    collectionId = `collection-${Date.now()}`
  }
  let suffix = 2
  while (collectionsMap[collectionId]) {
    collectionId = `${collectionId}-${suffix}`
    suffix += 1
  }

  collectionsMap[collectionId] = {
    name: normalizedName,
    soundscapes: [],
  }
  parsed.collections = collectionsMap
  return saveParsedConfig(configPath, parsed)
}

function addSoundscapeToSessionCollection(collectionId, soundscapeId) {
  const normalizedCollectionId = normalizeTextInput(collectionId)
  const normalizedSoundscapeId = normalizeTextInput(soundscapeId)
  if (!normalizedCollectionId || !normalizedSoundscapeId) {
    throw new Error('Collection id and soundscape id are required.')
  }

  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const collectionsMap = getCollectionsMap(parsed)
  const soundscapesMap = getSoundscapesMap(parsed)
  const collection = collectionsMap[normalizedCollectionId]

  if (!collection) {
    throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
  }
  if (!soundscapesMap[normalizedSoundscapeId]) {
    throw new Error(`Soundscape "${normalizedSoundscapeId}" was not found.`)
  }

  const nextSoundscapes = Array.isArray(collection.soundscapes) ? collection.soundscapes.map((id) => normalizeTextInput(id)).filter(Boolean) : []
  if (!nextSoundscapes.includes(normalizedSoundscapeId)) {
    nextSoundscapes.push(normalizedSoundscapeId)
  }

  collectionsMap[normalizedCollectionId] = {
    ...collection,
    name: validateSessionCollectionName(collection.name || normalizedCollectionId),
    soundscapes: nextSoundscapes,
  }
  parsed.collections = collectionsMap
  return saveParsedConfig(configPath, parsed)
}

function removeSoundscapeFromSessionCollection(collectionId, soundscapeId) {
  const normalizedCollectionId = normalizeTextInput(collectionId)
  const normalizedSoundscapeId = normalizeTextInput(soundscapeId)
  if (!normalizedCollectionId || !normalizedSoundscapeId) {
    throw new Error('Collection id and soundscape id are required.')
  }

  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const collectionsMap = getCollectionsMap(parsed)
  const collection = collectionsMap[normalizedCollectionId]

  if (!collection) {
    throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
  }

  collectionsMap[normalizedCollectionId] = {
    ...collection,
    name: validateSessionCollectionName(collection.name || normalizedCollectionId),
    soundscapes: Array.isArray(collection.soundscapes)
      ? collection.soundscapes
        .map((id) => normalizeTextInput(id))
        .filter((id) => id && id !== normalizedSoundscapeId)
      : [],
  }
  parsed.collections = collectionsMap
  return saveParsedConfig(configPath, parsed)
}

function deleteSessionCollection(collectionId) {
  const normalizedCollectionId = normalizeTextInput(collectionId)
  if (!normalizedCollectionId) {
    throw new Error('Collection id is required.')
  }

  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const collectionsMap = getCollectionsMap(parsed)
  if (!collectionsMap[normalizedCollectionId]) {
    throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
  }

  delete collectionsMap[normalizedCollectionId]
  parsed.collections = collectionsMap
  return saveParsedConfig(configPath, parsed)
}

function reorderCollectionSoundscapes(collectionId, sourceSoundscapeId, beforeSoundscapeId) {
  const normalizedCollectionId = normalizeTextInput(collectionId)
  const normalizedSourceId = normalizeTextInput(sourceSoundscapeId)
  const normalizedBeforeId = beforeSoundscapeId == null ? '' : normalizeTextInput(beforeSoundscapeId)
  if (!normalizedCollectionId || !normalizedSourceId) {
    throw new Error('Collection id and source soundscape id are required.')
  }
  if (normalizedSourceId === normalizedBeforeId) {
    return getBootstrapData()
  }

  const { configPath, parsed } = loadParsedConfig()
  normalizeConfigDocument(parsed)
  const collectionsMap = getCollectionsMap(parsed)
  const collection = collectionsMap[normalizedCollectionId]
  if (!collection) {
    throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
  }

  const orderedSoundscapeIds = Array.isArray(collection.soundscapes)
    ? collection.soundscapes.map((soundscapeId) => normalizeTextInput(soundscapeId)).filter(Boolean)
    : []
  const sourceIndex = orderedSoundscapeIds.findIndex((soundscapeId) => soundscapeId === normalizedSourceId)
  if (sourceIndex === -1) {
    throw new Error('Unable to reorder collection soundscapes because the source soundscape was not found.')
  }

  orderedSoundscapeIds.splice(sourceIndex, 1)
  let insertionIndex = orderedSoundscapeIds.length
  if (normalizedBeforeId) {
    insertionIndex = orderedSoundscapeIds.findIndex((soundscapeId) => soundscapeId === normalizedBeforeId)
    if (insertionIndex === -1) {
      throw new Error('Unable to reorder collection soundscapes because the target position was not found.')
    }
  }
  orderedSoundscapeIds.splice(insertionIndex, 0, normalizedSourceId)

  collectionsMap[normalizedCollectionId] = {
    ...collection,
    soundscapes: orderedSoundscapeIds,
  }
  parsed.collections = collectionsMap
  return saveParsedConfig(configPath, parsed)
}

function handleSidecarEvent(eventName, payload) {
  if (eventName === 'status' || eventName === 'session_ended') {
    applyStatusPayload(payload)
    return
  }

  if (eventName === 'session_ready') {
    sessionState.sessionRunning = true
    sessionState.startupInProgress = true
    sessionState.activeSoundscape = payload.active_soundscape || payload.active_collection || sessionState.activeSoundscape
    sessionState.activeCollection = payload.active_collection || payload.active_soundscape || sessionState.activeCollection
    syncStateAliases()
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
    sessionState.activeSoundscape = payload.soundscape || payload.collection || sessionState.activeSoundscape
    sessionState.activeCollection = payload.collection || payload.soundscape || sessionState.activeCollection
    sessionState.currentTrackTitle = payload.title || sessionState.currentTrackTitle
    sessionState.currentTrackIndex = payload.track_index ?? sessionState.currentTrackIndex
    sessionState.currentTrackDurationSeconds = payload.duration_seconds ?? null
    sessionState.currentTrackStartedAt = Date.now() / 1000
    sessionState.currentTrackPositionSeconds = 0
    syncStateAliases()
    emitState()
    return
  }

  if (eventName === 'track_seeked') {
    const pos = payload.position_seconds ?? 0
    sessionState.currentTrackStartedAt = (Date.now() / 1000) - pos
    sessionState.currentTrackPositionSeconds = pos
    emitState()
    return
  }

  if (eventName === 'transcript') {
    sessionState.lastTranscript = payload.text || ''
    emitState()
    return
  }

  if (eventName === 'keyword_match') {
    sessionState.activeSoundscape = payload.soundscape || payload.collection || sessionState.activeSoundscape
    sessionState.activeCollection = payload.collection || payload.soundscape || sessionState.activeCollection
    syncStateAliases()
    emitState()
    return
  }

  if (eventName === 'transition_pending') {
    sessionState.pendingTransition = {
      keyword: payload.keyword,
      targetSoundscape: payload.target_soundscape || payload.target_collection,
      targetCollection: payload.target_collection,
      displayName: payload.display_name,
      expiresAtEpoch: payload.expires_at_epoch ?? null,
    }
    syncStateAliases()
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

syncStateAliases()

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

ipcMain.handle('dashboard:create-session-collection', (_event, name) => createSessionCollection(name))

ipcMain.handle('dashboard:add-soundscape-to-collection', (_event, collectionId, soundscapeId) => {
  return addSoundscapeToSessionCollection(collectionId, soundscapeId)
})

ipcMain.handle('dashboard:remove-soundscape-from-collection', (_event, collectionId, soundscapeId) => {
  return removeSoundscapeFromSessionCollection(collectionId, soundscapeId)
})

ipcMain.handle('dashboard:delete-session-collection', (_event, collectionId) => {
  return deleteSessionCollection(collectionId)
})

ipcMain.handle('dashboard:reorder-collection-soundscapes', (_event, collectionId, sourceSoundscapeId, beforeSoundscapeId) => {
  return reorderCollectionSoundscapes(collectionId, sourceSoundscapeId, beforeSoundscapeId)
})

ipcMain.handle('dashboard:save-soundscape-edits', (_event, soundscapeId, payload) => {
  return saveCollectionConfig(soundscapeId, payload, validateSoundscapeEdits)
})

ipcMain.handle('dashboard:save-collection-edits', (_event, collectionId, payload) => {
  return saveCollectionConfig(collectionId, payload, validateCollectionEdits)
})

ipcMain.handle('dashboard:delete-soundscape', (_event, soundscapeId) => deleteCollectionConfig(soundscapeId))

ipcMain.handle('dashboard:delete-collection', (_event, collectionId) => {
  return deleteCollectionConfig(collectionId)
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
    starting_soundscape: payload?.startingSoundscape ?? payload?.startingCollection ?? undefined,
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
  const crossfadeEnabled = payload?.crossfadeEnabled
  const crossfadeDurationSeconds = Number.parseFloat(payload?.crossfadeDurationSeconds)
  const loopEnabled = payload?.loopEnabled
  const crossfadePauseEnabled = payload?.crossfadePauseEnabled

  if (typeof paused === 'boolean' && sessionState.currentTrackIndex !== null) {
    if (paused) {
      sessionState.currentTrackPositionSeconds = getCurrentTrackPositionSeconds()
    } else {
      const resumePositionSeconds = getCurrentTrackPositionSeconds()
      sessionState.currentTrackStartedAt = (Date.now() / 1000) - resumePositionSeconds
      sessionState.currentTrackPositionSeconds = resumePositionSeconds
    }
    sessionState.playbackPaused = paused
    emitState()
  }

  await sendSidecarCommand('update_playback_settings', {
    volume_percent: Number.isFinite(volumePercent) ? volumePercent : undefined,
    muted: typeof muted === 'boolean' ? muted : undefined,
    paused: typeof paused === 'boolean' ? paused : undefined,
    crossfade_enabled: typeof crossfadeEnabled === 'boolean' ? crossfadeEnabled : undefined,
    crossfade_duration_seconds: Number.isFinite(crossfadeDurationSeconds) ? crossfadeDurationSeconds : undefined,
    loop_enabled: typeof loopEnabled === 'boolean' ? loopEnabled : undefined,
    crossfade_pause_enabled: typeof crossfadePauseEnabled === 'boolean' ? crossfadePauseEnabled : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('playback:seek', async (_event, positionSeconds) => {
  if (!sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }
  const pos = Number.parseFloat(positionSeconds)
  if (!Number.isFinite(pos) || pos < 0) {
    return getBootstrapData()
  }
  await sendSidecarCommand('seek_track', { position_seconds: pos })
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

ipcMain.handle('session:switch-collection', async (_event, collectionId) => {
  await sendSidecarCommand('switch_collection', { collection_id: collectionId })
  return getBootstrapData()
})

ipcMain.handle('session:switch-soundscape', async (_event, soundscapeId) => {
  await sendSidecarCommand('switch_soundscape', { soundscape_id: soundscapeId })
  return getBootstrapData()
})

ipcMain.handle('session:play-track', async (_event, collectionId, trackIndex) => {
  await sendSidecarCommand('play_track', { collection_id: collectionId, track_index: trackIndex })
  return getBootstrapData()
})

ipcMain.handle('session:play-soundscape-track', async (_event, soundscapeId, trackIndex) => {
  await sendSidecarCommand('play_soundscape_track', { soundscape_id: soundscapeId, track_index: trackIndex })
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
  syncStateAliases()
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
