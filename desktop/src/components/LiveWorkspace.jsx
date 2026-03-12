function LiveWorkspace({
  activeCollection,
  approveTransition,
  dismissTransition,
  handlePlaybackVolumeChange,
  handleTranscriptionProfileChange,
  handleTranscriptionToggle,
  handleTransitionProposalToggle,
  handleTransitionTimeoutChange,
  isSessionActive,
  isSessionStarting,
  lastTranscript,
  playbackMuted,
  playbackPaused,
  playbackRouteLabel,
  playbackStatusLabel,
  playbackVolumePercent,
  skipTrack,
  state,
  togglePlaybackMute,
  togglePlaybackPause,
  transcriptionEnabled,
  transcriptionProfile,
  transitionProgress,
  transitionProposalsEnabled,
  transitionTimeoutSeconds,
  transportStateLabel,
}) {
  return (
    <section className="live-workspace">
      {!isSessionActive ? (
        <div className="panel live-idle-panel">
          <p className="eyebrow">Live</p>
          <h2>No session currently active.</h2>
          <p className="supporting-text">Start a session from the left rail to enable playback controls, route status, transcript updates, and transition handling.</p>
        </div>
      ) : (
        <>
          <div className="panel live-deck-panel">
            {isSessionStarting ? (
              <div className="loading-banner" role="status" aria-live="polite">
                <span className="loading-dot" />
                <div>
                  <strong>Preparing session</strong>
                  <p className="supporting-text loading-copy">The sidecar is resolving tracks, standing up the audio loop, and connecting playback routes. This can take a minute or two.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="hud-topline">
                  <div>
                    <p className="hud-label">Now playing</p>
                    <h3>{activeCollection?.name || 'No active collection'}</h3>
                  </div>
                  <span className="track-pill">
                    {state.currentTrackIndex === null ? 'Track --' : `Track ${state.currentTrackIndex + 1}`}
                  </span>
                </div>

                <p className="current-track">{state.currentTrackTitle}</p>
              </>
            )}

            <div className="live-summary-grid">
              <div className="live-summary-card emphasis-card">
                <span className="metric-label">Output route</span>
                <strong>{playbackRouteLabel}</strong>
              </div>
              <div className="live-summary-card">
                <span className="metric-label">Transcript stream</span>
                <strong>{lastTranscript}</strong>
              </div>
              <div className="live-summary-card">
                <span className="metric-label">Active collection</span>
                <strong>{activeCollection?.name || 'No collection active'}</strong>
              </div>
              <div className="live-summary-card">
                <span className="metric-label">Session state</span>
                <strong>{isSessionStarting ? 'Preparing session' : 'Live'}</strong>
              </div>
            </div>

            <div className="transport-ribbon">
              <div className="transport-group">
                <div className="transport-header-row">
                  <span className="metric-label">Transport</span>
                  <span className={`status-chip mini-chip ${playbackMuted ? 'idle' : 'online'}`}>
                    {transportStateLabel}
                  </span>
                </div>
                <div className="button-row compact-actions">
                  <button className="primary-button" onClick={skipTrack} disabled={isSessionStarting}>Skip Track</button>
                  <button className="ghost-button" onClick={togglePlaybackPause} disabled={isSessionStarting}>{playbackPaused ? 'Play' : 'Pause'}</button>
                  <button className="ghost-button" onClick={togglePlaybackMute} disabled={isSessionStarting}>{playbackMuted ? 'Unmute' : 'Mute'}</button>
                </div>
              </div>

              <div className="transport-group volume-group">
                <div className="transport-header-row">
                  <span className="metric-label">Volume</span>
                  <strong className="volume-readout">{playbackStatusLabel}</strong>
                </div>
                <input className="slider-field" type="range" min="0" max="100" value={playbackVolumePercent} onChange={handlePlaybackVolumeChange} disabled={isSessionStarting} />
                <div className="transport-footnote-row">
                  <span className="supporting-text compact-copy">Applies live to current playback.</span>
                  <span className="supporting-text compact-copy">{playbackRouteLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="live-side-column">
        <div className={`panel transition-panel ${state.pendingTransition ? 'visible' : 'muted'}`}>
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Transition gate</p>
              <h2>{state.pendingTransition ? 'Pending switch' : 'No pending transition'}</h2>
            </div>
          </div>

          {state.pendingTransition ? (
            <>
              <p className="transition-copy">
                <span className="transition-keyword">"{state.pendingTransition.keyword}"</span> detected. Move to{' '}
                <strong>{state.pendingTransition.displayName}</strong>?
              </p>
              <div className="transition-timer-block">
                <div className="transition-progress-track" aria-hidden="true">
                  <div className="transition-progress-fill" style={{ transform: `scaleX(${transitionProgress})` }} />
                </div>
              </div>
              <div className="button-row hud-actions">
                <button className="primary-button" onClick={approveTransition}>Switch Collection</button>
                <button className="ghost-button" onClick={dismissTransition}>Dismiss</button>
              </div>
            </>
          ) : (
            <p className="supporting-text">Transition prompts will appear here when a detected phrase proposes a collection switch.</p>
          )}
        </div>

        <div className="panel live-status-panel session-settings-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Session</p>
              <h2>Session Settings</h2>
            </div>
          </div>

          <div className="settings-stack">
            <label className="settings-row toggle-row">
              <span className="settings-name">Live transcription</span>
              <input type="checkbox" checked={transcriptionEnabled} onChange={handleTranscriptionToggle} />
            </label>

            <div className={`settings-row ${!transcriptionEnabled ? 'disabled' : ''}`}>
              <label className="settings-name" htmlFor="transcription-profile">Profile</label>
              <select
                id="transcription-profile"
                className="select-field compact-select-field"
                value={transcriptionProfile}
                onChange={handleTranscriptionProfileChange}
                disabled={!transcriptionEnabled}
              >
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="accurate">Accurate</option>
              </select>
            </div>

            <label className={`settings-row toggle-row ${!transcriptionEnabled ? 'disabled' : ''}`}>
              <span className="settings-name">Transition proposals</span>
              <input type="checkbox" checked={transcriptionEnabled && transitionProposalsEnabled} onChange={handleTransitionProposalToggle} disabled={!transcriptionEnabled} />
            </label>

            <div className="settings-row">
              <label className="settings-name" htmlFor="transition-timeout-seconds">Transition timeout</label>
              <div className="number-field-row compact-number-row">
                <input
                  id="transition-timeout-seconds"
                  className="number-field compact-number-field"
                  type="number"
                  min="5"
                  max="300"
                  step="5"
                  value={transitionTimeoutSeconds}
                  onChange={handleTransitionTimeoutChange}
                />
                <span className="number-suffix">s</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default LiveWorkspace
