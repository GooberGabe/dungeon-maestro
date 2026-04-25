function FeedWorkspace({ bootstrap, lastError, settings, state }) {
  const now = new Date()
  const timestamp = now.toLocaleTimeString()
  const activeSoundscapeId = state.activeSoundscape || state.activeCollection || 'none'
  const pendingTransitionTarget = state.pendingTransition?.targetSoundscape
    || state.pendingTransition?.targetCollection
    || 'none'
  const pendingTransitionExpiresAtEpoch = state.pendingTransition?.expiresAtEpoch
  const pendingTransitionRemainingSeconds = Number.isFinite(pendingTransitionExpiresAtEpoch)
    ? Math.max(0, Math.ceil(pendingTransitionExpiresAtEpoch - (Date.now() / 1000)))
    : 0
  const playbackPositionSeconds = Number.isFinite(state.currentTrackPositionSeconds)
    ? Math.max(0, state.currentTrackPositionSeconds)
    : null
  const resolveTier = state.resolveBackgroundTier || 'idle'
  const resolveTargetSoundscape = state.resolveBackgroundTargetSoundscape || 'none'
  const resolveQueueLength = Number.isFinite(state.resolveBackgroundQueueLength)
    ? state.resolveBackgroundQueueLength
    : 0
  const resolveUnresolvedSoundscapeCount = Number.isFinite(state.resolveBackgroundUnresolvedSoundscapeCount)
    ? state.resolveBackgroundUnresolvedSoundscapeCount
    : 0

  const debugLines = [
    `[${timestamp}] app.config_path=${settings.configPath || 'n/a'}`,
    `[${timestamp}] sidecar.connected=${state.sidecarConnected ? 'true' : 'false'} sidecar.status="${state.sidecarStatus || 'n/a'}"`,
    `[${timestamp}] session.running=${state.sessionRunning ? 'true' : 'false'} session.startup_in_progress=${state.startupInProgress ? 'true' : 'false'}`,
    `[${timestamp}] session.active_soundscape=${activeSoundscapeId}`,
    `[${timestamp}] playback.output_mode=${state.outputMode || 'local'} playback.route="${state.discordStatus || 'n/a'}"`,
    `[${timestamp}] playback.track_index=${state.currentTrackIndex ?? 'none'} playback.track_title="${state.currentTrackTitle || 'n/a'}"`,
    `[${timestamp}] playback.paused=${state.playbackPaused ? 'true' : 'false'} playback.muted=${state.playbackMuted ? 'true' : 'false'} playback.position_seconds=${playbackPositionSeconds === null ? 'n/a' : playbackPositionSeconds.toFixed(2)}`,
    `[${timestamp}] playback.crossfade_enabled=${state.crossfadeEnabled ? 'true' : 'false'} playback.crossfade_duration_seconds=${state.crossfadeDurationSeconds ?? 'n/a'} playback.loop_enabled=${state.loopEnabled ? 'true' : 'false'}`,
    `[${timestamp}] resolve.tier=${resolveTier} resolve.target_soundscape=${resolveTargetSoundscape} resolve.queue_length=${resolveQueueLength} resolve.unresolved_soundscapes=${resolveUnresolvedSoundscapeCount}`,
    `[${timestamp}] transition.pending=${state.pendingTransition ? 'true' : 'false'} transition.target=${pendingTransitionTarget} transition.remaining_seconds=${pendingTransitionRemainingSeconds}`,
  ]

  if (lastError && lastError !== 'No active errors.') {
    debugLines.unshift(`[${timestamp}] error.last="${lastError}"`)
  }

  return (
    <section className="feed-workspace">
      <div className="panel feed-primary-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Feed</p>
            <h2>Session Debugging</h2>
          </div>
        </div>

        <div className="session-grid output-grid">
          <div>
            <span className="metric-label">Config</span>
            <strong>{settings.configPath}</strong>
          </div>
          <div>
            <span className="metric-label">Active soundscape</span>
            <strong>{activeSoundscapeId}</strong>
          </div>
          <div>
            <span className="metric-label">Bot route</span>
            <strong>{state.discordStatus}</strong>
          </div>
          <div>
            <span className="metric-label">Sidecar</span>
            <strong>{state.sidecarStatus}</strong>
          </div>
          <div>
            <span className="metric-label">Resolver priority</span>
            <strong>{resolveTier}</strong>
          </div>
          <div>
            <span className="metric-label">Resolver target</span>
            <strong>{resolveTargetSoundscape}</strong>
          </div>
          <div className="wide-metric">
            <span className="metric-label">Transition diagnostics</span>
            <strong>
              {state.pendingTransition
                ? `Pending target ${pendingTransitionTarget} (${pendingTransitionRemainingSeconds}s remaining)`
                : 'No pending transition'}
            </strong>
          </div>
          <div className="wide-metric debug-log-metric">
            <span className="metric-label">Debug log snapshot</span>
            <div className="debug-log-panel" role="log" aria-live="polite">
              {debugLines.map((line) => (
                <p key={line} className="debug-log-line">{line}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default FeedWorkspace
