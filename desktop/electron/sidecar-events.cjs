function createSidecarEventHandler({
  sessionState,
  desktopSettings,
  saveDesktopSettings,
  sendSidecarCommand,
  buildDiscordStatus,
  syncStateAliases,
  syncHudWindowSize,
  emitState,
  applyStatusPayload,
  complianceLogger,
}) {
  function applyActiveSoundscapeAliases(payload, soundscapeKeys, collectionKeys) {
    const nextSoundscape = soundscapeKeys
      .map((key) => payload[key])
      .find((value) => Boolean(value))
    const nextCollection = collectionKeys
      .map((key) => payload[key])
      .find((value) => Boolean(value))

    sessionState.activeSoundscape = nextSoundscape || sessionState.activeSoundscape
    sessionState.activeCollection = nextCollection || sessionState.activeCollection
  }

  function resolveNumeric(value, fallback) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function normalizeResolveStatusPayload(payload) {
    return {
      resolvedTrackStatusBySoundscape: payload.resolvedTrackStatusBySoundscape
        || payload.resolved_track_status_by_soundscape
        || {},
      resolveBackgroundTier: payload.resolveBackgroundTier
        || payload.resolve_background_tier
        || sessionState.resolveBackgroundTier
        || 'idle',
      resolveBackgroundTargetSoundscape: payload.resolveBackgroundTargetSoundscape
        ?? payload.resolve_background_target_soundscape
        ?? sessionState.resolveBackgroundTargetSoundscape
        ?? null,
      resolveBackgroundQueueLength: resolveNumeric(
        payload.resolveBackgroundQueueLength,
        resolveNumeric(payload.resolve_background_queue_length, sessionState.resolveBackgroundQueueLength || 0),
      ),
      resolveBackgroundUnresolvedSoundscapeCount: resolveNumeric(
        payload.resolveBackgroundUnresolvedSoundscapeCount,
        resolveNumeric(payload.resolve_background_unresolved_soundscape_count, sessionState.resolveBackgroundUnresolvedSoundscapeCount || 0),
      ),
    }
  }

  return function handleSidecarEvent(eventName, payload) {
    if (eventName === 'status' || eventName === 'session_ended') {
      applyStatusPayload(payload)
      return
    }

    if (eventName === 'session_ready') {
      sessionState.sessionRunning = true
      sessionState.startupInProgress = true
      applyActiveSoundscapeAliases(payload, ['active_soundscape', 'active_collection'], ['active_collection', 'active_soundscape'])
      syncStateAliases()
      emitState()
      return
    }

    if (eventName === 'discord_connected') {
      sessionState.discordStatus = buildDiscordStatus().replace('Ready for', 'Discord playback connected to')
      emitState()
      return
    }

    if (eventName === 'compliance_event') {
      if (complianceLogger && typeof complianceLogger.write === 'function') {
        try {
          complianceLogger.write(payload)
        } catch {
          // Ignore logging errors so compliance logging never impacts runtime behavior.
        }
      }
      return
    }

    if (eventName === 'track_started') {
      sessionState.sessionRunning = true
      sessionState.startupInProgress = false
      applyActiveSoundscapeAliases(payload, ['soundscape', 'collection'], ['collection', 'soundscape'])
      sessionState.currentTrackTitle = payload.title || sessionState.currentTrackTitle
      sessionState.currentTrackIndex = payload.track_index ?? sessionState.currentTrackIndex
      sessionState.currentTrackDurationSeconds = payload.duration_seconds ?? null
      sessionState.currentTrackStartedAt = Date.now() / 1000
      sessionState.currentTrackPositionSeconds = 0
      if (desktopSettings.loopTrackByDefault && !sessionState.loopEnabled) {
        sessionState.loopEnabled = true
        desktopSettings.loopEnabled = true
        saveDesktopSettings()
        void sendSidecarCommand('update_playback_settings', { loop_enabled: true }).catch((error) => {
          sessionState.lastError = error.message
          emitState()
        })
      }
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

    if (eventName === 'resolve_status_updated') {
      Object.assign(sessionState, normalizeResolveStatusPayload(payload))
      emitState()
      return
    }

    if (eventName === 'transcript') {
      sessionState.lastTranscript = payload.text || ''
      emitState()
      return
    }

    if (eventName === 'keyword_match') {
      applyActiveSoundscapeAliases(payload, ['soundscape', 'collection'], ['collection', 'soundscape'])
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
    }
  }
}

module.exports = {
  createSidecarEventHandler,
}
