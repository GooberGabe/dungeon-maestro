const { dialog } = require('electron')

function registerIpcHandlers({
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
}) {
  const {
    saveCollectionConfig,
    deleteCollectionConfig,
    createSessionCollection,
    addSoundscapeToSessionCollection,
    removeSoundscapeFromSessionCollection,
    deleteSessionCollection,
    reorderCollectionSoundscapes,
  } = configEditors

  function assertSupportedSessionStartOptions(payload) {
    const requestedTranscriptionEnabled = payload?.transcriptionEnabled === true
    const requestedTransitionProposalsEnabled = payload?.transitionProposalsEnabled === true
    if (!requestedTranscriptionEnabled && !requestedTransitionProposalsEnabled) {
      return
    }

    const message = 'Transcription and transition proposals are disabled in this beta release.'
    sessionState.lastError = message
    emitState()
    throw new Error(message)
  }

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

  ipcMain.handle('dashboard:export-soundscapes', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Soundscapes',
      defaultPath: 'dungeon-maestro-export.yaml',
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
    })
    if (canceled || !filePath) {
      return { cancelled: true }
    }
    return configEditors.exportSoundscapesToFile(filePath)
  })

  ipcMain.handle('dashboard:import-soundscapes', async (_event, { mode } = {}) => {
    if (sessionState.sessionRunning || sessionState.startupInProgress) {
      throw new Error('Stop the current session before importing soundscapes.')
    }
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import Soundscapes',
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths || !filePaths[0]) {
      return { cancelled: true }
    }
    const normalizedMode = mode === 'replace' ? 'replace' : 'merge'
    return configEditors.importSoundscapesFromFile(filePaths[0], normalizedMode)
  })

  ipcMain.handle('dashboard:save-bot-token', async (_event, token) => {
    const normalizedToken = String(token || '').trim()
    if (normalizedToken) {
      desktopSettings.botToken = await writeBotTokenCredential(normalizedToken)
    } else {
      await deleteBotTokenCredential()
      desktopSettings.botToken = ''
    }
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

    assertSupportedSessionStartOptions(payload)

    const transcriptionEnabled = false
    const transitionProposalsEnabled = false
    const requestedTransitionTimeoutSeconds = Number.parseInt(payload?.transitionTimeoutSeconds, 10)
    const transitionTimeoutSeconds = Number.isFinite(requestedTransitionTimeoutSeconds)
      ? requestedTransitionTimeoutSeconds
      : desktopSettings.transitionTimeoutSeconds
    const transcriptionProfile = typeof payload?.transcriptionProfile === 'string'
      ? payload.transcriptionProfile
      : desktopSettings.transcriptionProfile
    const outputMode = normalizeOutputMode(payload?.outputMode || desktopSettings.outputMode)

    persistSessionPreferences({
      transcriptionEnabled,
      transcriptionProfile,
      transitionProposalsEnabled,
      transitionTimeoutSeconds,
    })

    if (outputMode === 'discord' && (!desktopSettings.botToken || !desktopSettings.discordVoiceChannelId)) {
      throw new Error('Discord output requires a saved bot token and selected voice channel')
    }

    const requestedVolumePercent = Number.parseInt(payload?.volumePercent, 10)
    const effectiveVolumePercent = Number.isFinite(requestedVolumePercent) ? requestedVolumePercent : sessionState.volumePercent
    const effectivePlaybackMuted = typeof payload?.muted === 'boolean' ? payload.muted : sessionState.playbackMuted
    const requestedCrossfadeEnabled = payload?.crossfadeEnabled
    const effectiveCrossfadeEnabled = typeof requestedCrossfadeEnabled === 'boolean' ? requestedCrossfadeEnabled : sessionState.crossfadeEnabled
    const requestedCrossfadeDurationSeconds = Number.parseFloat(payload?.crossfadeDurationSeconds)
    const effectiveCrossfadeDurationSeconds = Number.isFinite(requestedCrossfadeDurationSeconds)
      ? requestedCrossfadeDurationSeconds
      : sessionState.crossfadeDurationSeconds
    const requestedLoopEnabled = payload?.loopEnabled
    const effectiveLoopEnabled = typeof requestedLoopEnabled === 'boolean'
      ? requestedLoopEnabled
      : (desktopSettings.loopTrackByDefault ? true : sessionState.loopEnabled)
    const requestedLoopTrackByDefault = payload?.loopTrackByDefault
    const effectiveLoopTrackByDefault = typeof requestedLoopTrackByDefault === 'boolean'
      ? requestedLoopTrackByDefault
      : desktopSettings.loopTrackByDefault
    const requestedCrossfadePauseEnabled = payload?.crossfadePauseEnabled
    const effectiveCrossfadePauseEnabled = typeof requestedCrossfadePauseEnabled === 'boolean'
      ? requestedCrossfadePauseEnabled
      : sessionState.crossfadePauseEnabled

    persistPlaybackPreferences({
      volumePercent: effectiveVolumePercent,
      playbackMuted: effectivePlaybackMuted,
      crossfadeEnabled: effectiveCrossfadeEnabled,
      crossfadeDurationSeconds: effectiveCrossfadeDurationSeconds,
      loopTrackByDefault: effectiveLoopTrackByDefault,
      loopEnabled: effectiveLoopEnabled,
      crossfadePauseEnabled: effectiveCrossfadePauseEnabled,
    })

    await sendSidecarCommand('start_session', {
      config_path: desktopSettings.configPath,
      starting_soundscape: payload?.startingSoundscape ?? payload?.startingCollection ?? undefined,
      starting_collection: payload?.startingCollection ?? undefined,
      no_transcription: !transcriptionEnabled,
      transcription_profile: transcriptionProfile,
      enable_transition_proposals: transitionProposalsEnabled,
      transition_popup_timeout: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
      volume_percent: sessionState.volumePercent,
      muted: sessionState.playbackMuted,
      paused: typeof payload?.paused === 'boolean' ? payload.paused : false,
      crossfade_enabled: sessionState.crossfadeEnabled,
      crossfade_duration_seconds: sessionState.crossfadeDurationSeconds,
      loop_enabled: sessionState.loopEnabled,
      crossfade_pause_enabled: sessionState.crossfadePauseEnabled,
      output_mode: outputMode,
      no_auto_play: outputMode !== 'local',
      prioritized_soundscape_ids: Array.isArray(payload?.prioritizedSoundscapeIds)
        ? payload.prioritizedSoundscapeIds
        : undefined,
      discord_token: outputMode === 'discord' ? (desktopSettings.botToken || undefined) : undefined,
      discord_guild_id: outputMode === 'discord' ? (desktopSettings.discordGuildId || undefined) : undefined,
      discord_voice_channel_id: outputMode === 'discord' ? (desktopSettings.discordVoiceChannelId || undefined) : undefined,
    })
    return getBootstrapData()
  })

  ipcMain.handle('playback:update-settings', async (_event, payload) => {
    const volumePercent = Number.parseInt(payload?.volumePercent, 10)
    const muted = payload?.muted
    const paused = payload?.paused
    const crossfadeEnabled = payload?.crossfadeEnabled
    const crossfadeDurationSeconds = Number.parseFloat(payload?.crossfadeDurationSeconds)
    const loopTrackByDefault = payload?.loopTrackByDefault
    const loopEnabled = payload?.loopEnabled
    const crossfadePauseEnabled = payload?.crossfadePauseEnabled

    persistPlaybackPreferences({
      volumePercent: Number.isFinite(volumePercent) ? volumePercent : undefined,
      playbackMuted: typeof muted === 'boolean' ? muted : undefined,
      crossfadeEnabled: typeof crossfadeEnabled === 'boolean' ? crossfadeEnabled : undefined,
      crossfadeDurationSeconds: Number.isFinite(crossfadeDurationSeconds) ? crossfadeDurationSeconds : undefined,
      loopTrackByDefault: typeof loopTrackByDefault === 'boolean' ? loopTrackByDefault : undefined,
      loopEnabled: typeof loopEnabled === 'boolean' ? loopEnabled : undefined,
      crossfadePauseEnabled: typeof crossfadePauseEnabled === 'boolean' ? crossfadePauseEnabled : undefined,
    })

    if (!sessionState.sessionRunning || sessionState.startupInProgress) {
      return getBootstrapData()
    }

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
    const transcriptionEnabled = payload?.transcriptionEnabled
    const transcriptionProfile = typeof payload?.transcriptionProfile === 'string' ? payload.transcriptionProfile : undefined
    const transitionProposalsEnabled = payload?.transitionProposalsEnabled
    const transitionTimeoutSeconds = Number.parseInt(payload?.transitionTimeoutSeconds, 10)

    persistSessionPreferences({
      transcriptionEnabled: typeof transcriptionEnabled === 'boolean' ? transcriptionEnabled : undefined,
      transcriptionProfile,
      transitionProposalsEnabled: typeof transitionProposalsEnabled === 'boolean' ? transitionProposalsEnabled : undefined,
      transitionTimeoutSeconds: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
    })

    if (!sessionState.sessionRunning || sessionState.startupInProgress) {
      return getBootstrapData()
    }

    await sendSidecarCommand('update_session_settings', {
      transcription_enabled: typeof transcriptionEnabled === 'boolean' ? transcriptionEnabled : undefined,
      transcription_profile: transcriptionProfile,
      enable_transition_proposals: typeof transitionProposalsEnabled === 'boolean' ? transitionProposalsEnabled : undefined,
      transition_popup_timeout: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
    })
    return getBootstrapData()
  })

  ipcMain.handle('session:update-resolve-priorities', async (_event, prioritizedSoundscapeIds) => {
    if (!sessionState.sessionRunning || sessionState.startupInProgress) {
      return getBootstrapData()
    }

    await sendSidecarCommand('update_resolve_priorities', {
      prioritized_soundscape_ids: Array.isArray(prioritizedSoundscapeIds)
        ? prioritizedSoundscapeIds
        : [],
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
}

module.exports = {
  registerIpcHandlers,
}
