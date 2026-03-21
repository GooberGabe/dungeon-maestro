function PinnedHud({
  activeSoundscape,
  approveTransition,
  dismissTransition,
  icons,
  isSessionActive,
  isSessionStarting,
  outputMode,
  playbackMuted,
  playbackPaused,
  playbackVolumePercent,
  skipTrack,
  state,
  togglePinnedHud,
  togglePlaybackMute,
  togglePlaybackPause,
  transitionProgress,
  onPlaybackVolumeChange,
}) {
  return (
    <div className="hud-shell">
      <section className={`hud-card ${state.pendingTransition ? 'overlay-active' : ''}`}>
        <div className="hud-core-layer">
          <div className="hud-drag-row">
            <div className="hud-brand-block">
              <img className="hud-brand-mark" src={icons.logo} alt="" />
              <div className="hud-track-copy">
                <strong className="hud-collection-name">{state.currentTrackIndex !== null ? (activeSoundscape?.name || 'No active soundscape') : 'Waiting to play'}</strong>
                <span className="hud-track-name">{state.currentTrackTitle}</span>
              </div>
            </div>
            <button className="hud-swap-button hud-no-drag" type="button" onClick={togglePinnedHud} title="Open dashboard">
              <img src={icons.flip} alt="Open dashboard" />
            </button>
          </div>

          <div className="hud-transport-row hud-no-drag">
            <div className="hud-icon-buttons">
              <button className="hud-icon-button" type="button" onClick={skipTrack} disabled={!isSessionActive || isSessionStarting} title="Skip track">
                <img src={icons.next} alt="Skip" />
              </button>
              <button className="hud-icon-button" type="button" onClick={togglePlaybackPause} disabled={!isSessionActive || isSessionStarting} title={playbackPaused ? 'Resume playback' : 'Pause playback'}>
                <img src={playbackPaused ? icons.play : icons.pause} alt={playbackPaused ? 'Play' : 'Pause'} />
              </button>
              <button className="hud-icon-button" type="button" onClick={togglePlaybackMute} disabled={!isSessionActive || isSessionStarting} title={playbackMuted ? 'Unmute playback' : 'Mute playback'}>
                <img src={playbackMuted ? icons.mute : icons.speaker} alt={playbackMuted ? 'Mute' : 'Speaker'} />
              </button>
            </div>

            <div className="hud-volume-block">
              <div className="hud-volume-topline">
                <span>{playbackPaused ? 'Paused' : playbackMuted ? 'Muted' : `${playbackVolumePercent}%`}</span>
                <span>{outputMode === 'discord' ? 'Discord' : 'Local'}</span>
              </div>
              <input className="hud-slider" type="range" min="0" max="100" value={playbackVolumePercent} onChange={onPlaybackVolumeChange} disabled={!isSessionActive || isSessionStarting} />
            </div>
          </div>
        </div>

        {state.pendingTransition ? (
          <div className="hud-transition-overlay hud-no-drag">
            <div className="hud-transition-callout">
              <div className="hud-transition-heading">
                <span className="hud-transition-keyword">&quot;{state.pendingTransition.keyword}&quot;</span>
                <strong>{state.pendingTransition.displayName}</strong>
              </div>
              <div className="transition-progress-track hud-progress-track" aria-hidden="true">
                <div className="transition-progress-fill" style={{ transform: `scaleX(${transitionProgress})` }} />
              </div>
              <div className="hud-transition-actions">
                <button className="primary-button hud-pill-button" type="button" onClick={approveTransition}>Switch</button>
                <button className="ghost-button hud-pill-button" type="button" onClick={dismissTransition}>Dismiss</button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

export default PinnedHud