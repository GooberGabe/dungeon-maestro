import { useRef, useEffect, useState } from 'react'
import { ICONS } from '../constants'
import { usePlaybackPosition } from '../playbackProgress'

function TrackMarquee({ text }) {
  const outerRef = useRef(null)
  const innerRef = useRef(null)
  const [shouldScroll, setShouldScroll] = useState(false)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const check = () => setShouldScroll(inner.scrollWidth > outer.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(outer)
    return () => ro.disconnect()
  }, [text])

  return (
    <div className="pc-track-marquee" ref={outerRef}>
      <span className={`pc-track-text ${shouldScroll ? 'scrolling' : ''}`} ref={innerRef}>
        {text}
      </span>
    </div>
  )
}

function PlaybackController({
  approveTransition,
  dismissTransition,
  loopEnabled,
  playbackMuted,
  playbackPaused,
  skipTrack,
  state,
  togglePlaybackMute,
  togglePlaybackPause,
  transitionProgress,
}) {
  const isPlaying = state.currentTrackIndex !== null
  const trackDuration = state.currentTrackDurationSeconds
  const trackKey = `${state.currentTrackIndex}-${state.currentTrackStartedAt}`
  const { progress } = usePlaybackPosition({
    durationSeconds: trackDuration,
    paused: playbackPaused,
    pausedPositionSeconds: state.currentTrackPositionSeconds,
    startedAtEpoch: state.currentTrackStartedAt,
    trackKey,
    loopEnabled,
  })

  return (
    <div className={`playback-controller ${isPlaying ? 'visible' : ''}`}>
      {state.pendingTransition ? (
        <div className="pc-transition">
          <span className="pc-transition-keyword">&quot;{state.pendingTransition.keyword}&quot;</span>
          <span className="pc-transition-arrow">&rarr;</span>
          <strong className="pc-transition-target">{state.pendingTransition.displayName}</strong>
          <div className="pc-transition-progress">
            <div className="pc-transition-fill" style={{ transform: `scaleX(${transitionProgress})` }} />
          </div>
          <button className="pc-action" type="button" onClick={approveTransition} title="Switch soundscape">Switch</button>
          <button className="pc-action pc-dismiss" type="button" onClick={dismissTransition} title="Dismiss">&times;</button>
        </div>
      ) : null}

      <TrackMarquee text={state.currentTrackTitle || ''} />

      <div className="pc-buttons">
        <button className="pc-icon-button" type="button" onClick={skipTrack} title="Skip track">
          <img src={ICONS.next} alt="Skip" />
        </button>
        <button className="pc-icon-button" type="button" onClick={togglePlaybackPause} title={playbackPaused ? 'Resume playback' : 'Pause playback'}>
          <img src={playbackPaused ? ICONS.play : ICONS.pause} alt={playbackPaused ? 'Play' : 'Pause'} />
        </button>
        <button className="pc-icon-button" type="button" onClick={togglePlaybackMute} title={playbackMuted ? 'Unmute' : 'Mute'}>
          <img src={playbackMuted ? ICONS.mute : ICONS.speaker} alt={playbackMuted ? 'Unmute' : 'Speaker'} />
        </button>
      </div>

      {trackDuration > 0 ? (
        <div
          key={trackKey}
          className="pc-progress"
        >
          <div className="pc-progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
      ) : null}
    </div>
  )
}

export default PlaybackController
