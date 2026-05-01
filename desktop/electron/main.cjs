const { app, ipcMain } = require('electron')
const path = require('path')

// --- Extracted modules ---
const { desktopSettings, sessionState, appConfig } = require('./state.cjs')
const { normalizeOutputMode, normalizeDiscordId, validateCollectionEdits, validateSoundscapeEdits } = require('./validation.cjs')
const { loadDesktopSettings, saveDesktopSettings, loadAppConfig } = require('./config.cjs')
const { syncConfigIntoState, ensureDiscordSelection, resolveDiscordTargets, buildDiscordStatus } = require('./discord.cjs')
const { startSidecarProcess, sendSidecarCommand, resolvePendingCommand, cleanup: cleanupSidecar } = require('./sidecar.cjs')
const { previewTrackSource } = require('./preview.cjs')
const { createMainWindow, togglePinnedHud, syncHudWindowSize, emitState: emitStateToWindows, showDashboardWindow } = require('./windows.cjs')
const { readBotTokenCredential, writeBotTokenCredential, deleteBotTokenCredential } = require('./credentials.cjs')
const { createConfigEditors } = require('./config-edits.cjs')
const { createSidecarEventHandler } = require('./sidecar-events.cjs')
const { registerIpcHandlers } = require('./ipc-handlers.cjs')
const { createComplianceLogger } = require('./compliance-log.cjs')

// --- Helpers ---

function getBootstrapData() {
  const { botToken, ...safeSettings } = desktopSettings
  return {
    settings: {
      ...safeSettings,
      botToken: '',
      hasSavedBotToken: Boolean(botToken),
    },
    config: appConfig,
    state: sessionState,
  }
}

function emitState() {
  emitStateToWindows(getBootstrapData)
}

async function hydrateBotTokenFromCredentialStore(legacyBotToken = '') {
  const normalizedLegacyToken = String(legacyBotToken || '').trim()
  const storedToken = await readBotTokenCredential()
  if (storedToken) {
    desktopSettings.botToken = storedToken
    if (normalizedLegacyToken) {
      saveDesktopSettings()
    }
    return
  }

  if (!normalizedLegacyToken) {
    desktopSettings.botToken = ''
    return
  }

  desktopSettings.botToken = await writeBotTokenCredential(normalizedLegacyToken)
  saveDesktopSettings()
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

function syncPlaybackPreferencesIntoState() {
  sessionState.volumePercent = desktopSettings.volumePercent
  sessionState.playbackMuted = desktopSettings.playbackMuted
  sessionState.crossfadeEnabled = desktopSettings.crossfadeEnabled
  sessionState.crossfadeDurationSeconds = desktopSettings.crossfadeDurationSeconds
  sessionState.loopTrackByDefault = desktopSettings.loopTrackByDefault
  sessionState.loopEnabled = desktopSettings.loopEnabled
  sessionState.crossfadePauseEnabled = desktopSettings.crossfadePauseEnabled
}

function syncSessionPreferencesIntoState() {
  sessionState.transcriptionEnabled = desktopSettings.transcriptionEnabled
  sessionState.transcriptionProfile = desktopSettings.transcriptionProfile
  sessionState.transitionProposalsEnabled = desktopSettings.transitionProposalsEnabled
  sessionState.transitionTimeoutSeconds = desktopSettings.transitionTimeoutSeconds
}

function persistPlaybackPreferences(nextPreferences) {
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'volumePercent')) {
    const parsed = Number.parseInt(nextPreferences.volumePercent, 10)
    if (Number.isFinite(parsed)) {
      desktopSettings.volumePercent = Math.max(0, Math.min(100, parsed))
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'playbackMuted') && typeof nextPreferences.playbackMuted === 'boolean') {
    desktopSettings.playbackMuted = nextPreferences.playbackMuted
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'crossfadeEnabled') && typeof nextPreferences.crossfadeEnabled === 'boolean') {
    desktopSettings.crossfadeEnabled = nextPreferences.crossfadeEnabled
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'crossfadeDurationSeconds')) {
    const parsed = Number.parseFloat(nextPreferences.crossfadeDurationSeconds)
    if (Number.isFinite(parsed)) {
      desktopSettings.crossfadeDurationSeconds = Math.max(0.5, Math.min(15, parsed))
    }
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'loopTrackByDefault') && typeof nextPreferences.loopTrackByDefault === 'boolean') {
    desktopSettings.loopTrackByDefault = nextPreferences.loopTrackByDefault
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'loopEnabled') && typeof nextPreferences.loopEnabled === 'boolean') {
    desktopSettings.loopEnabled = nextPreferences.loopEnabled
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'crossfadePauseEnabled') && typeof nextPreferences.crossfadePauseEnabled === 'boolean') {
    desktopSettings.crossfadePauseEnabled = nextPreferences.crossfadePauseEnabled
  }
  saveDesktopSettings()
  syncPlaybackPreferencesIntoState()
}

function persistSessionPreferences(nextPreferences) {
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'transcriptionEnabled') && typeof nextPreferences.transcriptionEnabled === 'boolean') {
    desktopSettings.transcriptionEnabled = nextPreferences.transcriptionEnabled
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'transcriptionProfile') && typeof nextPreferences.transcriptionProfile === 'string') {
    desktopSettings.transcriptionProfile = nextPreferences.transcriptionProfile
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'transitionProposalsEnabled') && typeof nextPreferences.transitionProposalsEnabled === 'boolean') {
    desktopSettings.transitionProposalsEnabled = nextPreferences.transitionProposalsEnabled
  }
  if (Object.prototype.hasOwnProperty.call(nextPreferences, 'transitionTimeoutSeconds')) {
    const parsed = Number.parseInt(nextPreferences.transitionTimeoutSeconds, 10)
    if (Number.isFinite(parsed)) {
      desktopSettings.transitionTimeoutSeconds = Math.max(5, Math.min(300, parsed))
    }
  }
  saveDesktopSettings()
  syncSessionPreferencesIntoState()
}

function applyStatusPayload(payload) {
  Object.assign(sessionState, payload)
  if (!sessionState.sessionRunning && !sessionState.startupInProgress) {
    // Keep persisted desktop preferences authoritative while idle.
    syncPlaybackPreferencesIntoState()
    syncSessionPreferencesIntoState()
  }
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

syncStateAliases()

let complianceLogger = null

const complianceLoggerSink = {
  write(payload) {
    if (!complianceLogger) {
      return
    }
    complianceLogger.write(payload)
  },
}

const configEditors = createConfigEditors({
  desktopSettings,
  sessionState,
  getBootstrapData,
  emitState,
  syncStateAliases,
  loadAppConfig,
})

const handleSidecarEvent = createSidecarEventHandler({
  sessionState,
  desktopSettings,
  saveDesktopSettings,
  sendSidecarCommand,
  buildDiscordStatus,
  syncStateAliases,
  syncHudWindowSize,
  emitState,
  applyStatusPayload,
  complianceLogger: complianceLoggerSink,
})

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

registerIpcHandlers({
  ipcMain,
  desktopSettings,
  sessionState,
  normalizeOutputMode,
  normalizeDiscordId,
  validateCollectionEdits,
  validateSoundscapeEdits,
  ensureDiscordSelection,
  resolveDiscordTargets,
  sendSidecarCommand,
  previewTrackSource,
  togglePinnedHud,
  getBootstrapData,
  emitState,
  syncConfigIntoState,
  saveDesktopSettings,
  writeBotTokenCredential,
  deleteBotTokenCredential,
  persistSessionPreferences,
  persistPlaybackPreferences,
  getCurrentTrackPositionSeconds,
  configEditors,
})

// --- App Lifecycle ---

app.whenReady().then(async () => {
  complianceLogger = createComplianceLogger({
    logDirectory: path.join(app.getPath('userData'), 'logs'),
  })
  const { legacyBotToken } = loadDesktopSettings()
  await hydrateBotTokenFromCredentialStore(legacyBotToken)
  syncPlaybackPreferencesIntoState()
  syncSessionPreferencesIntoState()
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
  try {
    if (sessionState.sessionRunning || sessionState.startupInProgress) {
      void sendSidecarCommand('end_session', {}).catch(() => {})
    }
  } catch {
    // Ignore sidecar errors on shutdown.
  }
  cleanupSidecar()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (complianceLogger) {
    complianceLogger.close()
    complianceLogger = null
  }
  cleanupSidecar()
})
