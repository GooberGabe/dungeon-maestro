import { useRef, useCallback, useState } from 'react'

import { formatPlaybackTime, usePlaybackPosition } from '../playbackProgress'

const DROP_ZONE_END = '__END__'

function SeekBar({ duration, loopEnabled, paused, pausedPositionSeconds, startedAtEpoch, trackKey, onSeek }) {
  const barRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef(false)
  const { positionSeconds, progress, setPlaybackPosition } = usePlaybackPosition({
    durationSeconds: duration,
    paused,
    pausedPositionSeconds,
    startedAtEpoch,
    trackKey,
    loopEnabled,
  })

  const seekToRatio = useCallback((clientX) => {
    const bar = barRef.current
    if (!bar || !duration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const target = ratio * duration
    return setPlaybackPosition(target)
  }, [duration, setPlaybackPosition])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    dragRef.current = true
    setDragging(true)
    const target = seekToRatio(e.clientX)
    barRef.current?.setPointerCapture(e.pointerId)
    if (target !== undefined) onSeek(target)
  }, [seekToRatio, onSeek])

  const handlePointerMove = useCallback((e) => {
    if (!dragRef.current) return
    seekToRatio(e.clientX)
  }, [seekToRatio])

  const handlePointerUp = useCallback((e) => {
    if (!dragRef.current) return
    dragRef.current = false
    setDragging(false)
    const target = seekToRatio(e.clientX)
    if (target !== undefined) onSeek(target)
  }, [seekToRatio, onSeek])

  return (
    <div className="seek-bar-wrapper">
      <span className="seek-time">{formatPlaybackTime(positionSeconds)}</span>
      <div
        className={`seek-bar ${dragging ? 'dragging' : ''}`}
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="seek-bar-track">
          <div className="seek-bar-fill" style={{ transform: `scaleX(${progress})` }} />
          <div className="seek-bar-thumb" style={{ left: `${progress * 100}%` }} />
        </div>
      </div>
      <span className="seek-time">{formatPlaybackTime(duration || 0)}</span>
    </div>
  )
}

function LiveWorkspace({
  activeSoundscape,
  collectionActionError,
  collectionSearchQuery,
  currentCollectionSoundscapes,
  crossfadeDurationSeconds,
  crossfadeEnabled,
  handleCrossfadeDurationChange,
  crossfadePauseEnabled,
  handleCrossfadePauseToggle,
  handleCrossfadeToggle,
  handlePlaybackVolumeChange,
  handleTranscriptionProfileChange,
  handleTranscriptionToggle,
  handleTransitionProposalToggle,
  handleTransitionTimeoutChange,
  isSessionActive,
  isSessionStarting,
  lastTranscript,
  loopEnabled,
  filteredCollections,
  newCollectionNameDraft,
  onCreateCollection,
  onDeleteCollection,
  onMoveCollectionSoundscape,
  onOpenAddSoundscapes,
  onPlayCollectionSoundscape,
  onReorderCollectionSoundscapes,
  onRemoveSoundscapeFromCollection,
  openedCollection,
  openedCollectionId,
  openContextMenu,
  playbackPaused,
  playbackRouteLabel,
  playbackStatusLabel,
  playbackVolumePercent,
  seekTrack,
  setCollectionSearchQuery,
  setNewCollectionNameDraft,
  setOpenedCollectionId,
  state,
  togglePlaybackPause,
  toggleLoop,
  transcriptionEnabled,
  transcriptionProfile,
  transitionProposalsEnabled,
  transitionTimeoutSeconds,
}) {
  const [draggedSoundscapeId, setDraggedSoundscapeId] = useState('')
  const [dragOverZoneId, setDragOverZoneId] = useState('')
  const trackKey = `${state.currentTrackIndex}-${state.currentTrackStartedAt}`
  const activeSoundscapeId = activeSoundscape?.soundscapeId || activeSoundscape?.collectionId || ''

  const handleCollectionDragStart = (event, soundscapeId) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', soundscapeId)
    setDraggedSoundscapeId(soundscapeId)
    setDragOverZoneId('')
  }

  const handleCollectionDropZoneDragOver = (event, zoneId) => {
    if (!draggedSoundscapeId) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverZoneId !== zoneId) {
      setDragOverZoneId(zoneId)
    }
  }

  const resetCollectionDragState = () => {
    setDraggedSoundscapeId('')
    setDragOverZoneId('')
  }

  const handleCollectionDrop = async (event, beforeSoundscapeId) => {
    const droppedSoundscapeId = event.dataTransfer.getData('text/plain') || draggedSoundscapeId
    if (!openedCollection?.collectionId || !droppedSoundscapeId) {
      resetCollectionDragState()
      return
    }
    event.preventDefault()
    try {
      await onReorderCollectionSoundscapes(
        openedCollection.collectionId,
        droppedSoundscapeId,
        beforeSoundscapeId === DROP_ZONE_END ? null : beforeSoundscapeId,
      )
    } finally {
      resetCollectionDragState()
    }
  }

  const handleCollectionDropZoneDragEnter = (zoneId) => {
    if (!draggedSoundscapeId) {
      return
    }
    setDragOverZoneId(zoneId)
  }

  const resolveCollectionDropZoneFromCard = (event, currentSoundscapeId, nextSoundscapeId) => {
    const cardRect = event.currentTarget.getBoundingClientRect()
    const pointerIsInUpperHalf = event.clientY <= cardRect.top + (cardRect.height / 2)
    return pointerIsInUpperHalf ? currentSoundscapeId : nextSoundscapeId
  }

  const handleCollectionCardDragOver = (event, currentSoundscapeId, nextSoundscapeId) => {
    if (!draggedSoundscapeId) {
      return
    }
    const zoneId = resolveCollectionDropZoneFromCard(event, currentSoundscapeId, nextSoundscapeId)
    handleCollectionDropZoneDragOver(event, zoneId)
  }

  const handleCollectionCardDrop = async (event, currentSoundscapeId, nextSoundscapeId) => {
    const zoneId = resolveCollectionDropZoneFromCard(event, currentSoundscapeId, nextSoundscapeId)
    await handleCollectionDrop(event, zoneId)
  }

  const openCollectionListContextMenu = (event, collection) => {
    openContextMenu(event, [
      {
        id: `delete-collection-${collection.collectionId}`,
        label: 'Delete Collection',
        danger: true,
        onSelect: () => onDeleteCollection(collection.collectionId),
      },
    ])
  }

  const openCollectionSoundscapeContextMenu = (event, soundscape, index) => {
    if (!openedCollection?.collectionId) {
      return
    }
    const soundscapeId = soundscape.soundscapeId || soundscape.collectionId
    openContextMenu(event, [
      {
        id: `remove-soundscape-${soundscapeId}`,
        label: 'Remove Soundscape',
        danger: true,
        onSelect: () => onRemoveSoundscapeFromCollection(openedCollection.collectionId, soundscapeId),
      },
      {
        id: `move-soundscape-up-${soundscapeId}`,
        label: 'Move Up',
        disabled: index === 0,
        onSelect: () => onMoveCollectionSoundscape(openedCollection.collectionId, soundscapeId, -1),
      },
      {
        id: `move-soundscape-down-${soundscapeId}`,
        label: 'Move Down',
        disabled: index === currentCollectionSoundscapes.length - 1,
        onSelect: () => onMoveCollectionSoundscape(openedCollection.collectionId, soundscapeId, 1),
      },
    ])
  }

  return (
    <section className="live-workspace">
      <div className="live-main-column">
        {!isSessionActive ? (
          <div className="panel live-idle-panel">
            <p className="eyebrow">Live</p>
            <h2>No session currently active.</h2>
            <p className="supporting-text">Start a session from the left rail to enable playback controls, route status, transcript updates, and transition handling.</p>
          </div>
        ) : (
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
                    <h3>{state.currentTrackIndex !== null ? (activeSoundscape?.name || 'No active soundscape') : 'Waiting to play'}</h3>
                  </div>
                </div>

                <p className="current-track">{state.currentTrackTitle}</p>

                {state.currentTrackIndex !== null && (
                  <div className="deck-controls">
                    <SeekBar
                      duration={state.currentTrackDurationSeconds}
                      loopEnabled={loopEnabled}
                      paused={playbackPaused}
                      pausedPositionSeconds={state.currentTrackPositionSeconds}
                      startedAtEpoch={state.currentTrackStartedAt}
                      trackKey={trackKey}
                      onSeek={seekTrack}
                    />
                    <button
                      className={`loop-toggle ${loopEnabled ? 'active' : ''}`}
                      type="button"
                      onClick={toggleLoop}
                      title={loopEnabled ? 'Disable loop' : 'Loop current track'}
                    >
                      <svg className="loop-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="17 1 21 5 17 9" />
                        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" />
                        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="panel collection-browser-panel">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Collections</p>
              <h2>{openedCollection ? openedCollection.name : 'Session Collections'}</h2>
            </div>
            {openedCollection ? (
              <div className="collection-panel-actions">
                <button className="ghost-button" type="button" onClick={() => setOpenedCollectionId('')}>
                  Back
                </button>
                <button className="primary-button" type="button" onClick={onOpenAddSoundscapes}>
                  Add Soundscapes
                </button>
              </div>
            ) : null}
          </div>

          {openedCollection ? (
            <>
              {currentCollectionSoundscapes.length > 0 ? (
                <div className={`collection-soundscape-list ${draggedSoundscapeId ? 'dragging-active' : ''}`}>
                  <div
                    className={`soundscape-drop-zone ${dragOverZoneId === (currentCollectionSoundscapes[0]?.soundscapeId || currentCollectionSoundscapes[0]?.collectionId || '') ? 'active' : ''}`}
                    onDragEnter={() => handleCollectionDropZoneDragEnter(currentCollectionSoundscapes[0]?.soundscapeId || currentCollectionSoundscapes[0]?.collectionId || '')}
                    onDragOver={(event) => handleCollectionDropZoneDragOver(event, currentCollectionSoundscapes[0]?.soundscapeId || currentCollectionSoundscapes[0]?.collectionId || '')}
                    onDrop={(event) => void handleCollectionDrop(event, currentCollectionSoundscapes[0]?.soundscapeId || currentCollectionSoundscapes[0]?.collectionId || '')}
                  />
                  {currentCollectionSoundscapes.map((soundscape, index) => {
                    const soundscapeId = soundscape.soundscapeId || soundscape.collectionId
                    const nextSoundscapeId = currentCollectionSoundscapes[index + 1]?.soundscapeId || currentCollectionSoundscapes[index + 1]?.collectionId || DROP_ZONE_END
                    const isActive = soundscapeId === activeSoundscapeId
                    const isDragged = draggedSoundscapeId === soundscapeId
                    const showPause = isActive && state.currentTrackIndex !== null && !playbackPaused
                    const showResume = isActive && state.currentTrackIndex !== null && playbackPaused
                    const buttonDisabled = !isSessionActive || isSessionStarting
                    const buttonTitle = !isSessionActive
                      ? 'Session is not active.'
                      : isSessionStarting
                        ? 'Session is preparing...'
                        : showPause
                          ? 'Pause playback'
                          : showResume
                            ? 'Resume playback'
                            : 'Play this soundscape'
                    const handlePlayClick = showPause || showResume ? togglePlaybackPause : () => onPlayCollectionSoundscape(soundscapeId)
                    return (
                      <div
                        key={soundscapeId}
                        className="soundscape-card-stack"
                        draggable
                        onDragStart={(event) => handleCollectionDragStart(event, soundscapeId)}
                        onDragEnd={resetCollectionDragState}
                        onDragOver={(event) => handleCollectionCardDragOver(event, soundscapeId, nextSoundscapeId)}
                        onDrop={(event) => void handleCollectionCardDrop(event, soundscapeId, nextSoundscapeId)}
                      >
                        <div
                          className={`collection-soundscape-card ${isActive ? 'active' : ''} ${isDragged ? 'dragging' : ''}`}
                          role="group"
                          aria-label={soundscape.name}
                          onContextMenu={(event) => openCollectionSoundscapeContextMenu(event, soundscape, index)}
                        >
                          <div className="collection-soundscape-card-copy">
                            <strong>{soundscape.name}</strong>
                            <p className="supporting-text">{soundscape.trackCount} tracks</p>
                          </div>
                          <button
                            className="detail-play-button collection-play-button"
                            type="button"
                            onClick={handlePlayClick}
                            disabled={buttonDisabled}
                            draggable={false}
                            title={buttonTitle}
                          >
                            <img
                              src={buttonDisabled ? '/play-button-grayed-out.svg' : showPause ? '/pause-button.svg' : '/play-button.svg'}
                              alt={showPause ? 'Pause' : showResume ? 'Resume' : 'Play'}
                              draggable={false}
                              style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)' }}
                            />
                          </button>
                        </div>
                        <div
                          className={`soundscape-drop-zone ${dragOverZoneId === nextSoundscapeId ? 'active' : ''}`}
                          onDragEnter={() => handleCollectionDropZoneDragEnter(nextSoundscapeId)}
                          onDragOver={(event) => handleCollectionDropZoneDragOver(event, nextSoundscapeId)}
                          onDrop={(event) => void handleCollectionDrop(event, nextSoundscapeId)}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="collection-list-empty">
                  <p className="supporting-text">This collection does not have any soundscapes yet.</p>
                  <button className="ghost-button" type="button" onClick={onOpenAddSoundscapes}>
                    Add the first soundscape
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <label className="field-label" htmlFor="controls-collection-search">Browse collections</label>
              <input
                id="controls-collection-search"
                className="select-field"
                type="search"
                value={collectionSearchQuery}
                onChange={(event) => setCollectionSearchQuery(event.target.value)}
                placeholder="Search collections"
              />

              {filteredCollections.length > 0 ? (
                <div className="collection-soundscape-list compact-collection-list">
                  {filteredCollections.map((collection) => (
                    <div
                      key={collection.collectionId}
                      className={`collection-soundscape-card ${collection.collectionId === openedCollectionId ? 'active' : ''}`}
                      role="group"
                      aria-label={collection.name}
                      onContextMenu={(event) => openCollectionListContextMenu(event, collection)}
                    >
                      <div className="collection-soundscape-card-copy">
                        <strong>{collection.name}</strong>
                        <p className="supporting-text">{collection.soundscapeCount || (collection.soundscapeIds || []).length} soundscapes</p>
                      </div>
                      <button
                        className="detail-play-button collection-play-button"
                        type="button"
                        onClick={() => setOpenedCollectionId(collection.collectionId)}
                        title="Open collection"
                      >
                        <img
                          src="/play-button.svg"
                          alt="Open"
                          style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)' }}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="collection-list-empty collection-create-empty">
                  <p className="supporting-text">No collections yet. Create one to start organizing soundscapes for a session.</p>
                  <div className="collection-create-row">
                    <input
                      className="select-field"
                      type="text"
                      value={newCollectionNameDraft}
                      onChange={(event) => setNewCollectionNameDraft(event.target.value)}
                      placeholder="Click here to add your first Collection!"
                    />
                    <button className="primary-button" type="button" onClick={onCreateCollection}>
                      Create
                    </button>
                  </div>
                </div>
              )}

              {filteredCollections.length > 0 ? (
                <div className="collection-create-inline">
                  <label className="field-label" htmlFor="controls-new-collection">New collection</label>
                  <div className="collection-create-row">
                    <input
                      id="controls-new-collection"
                      className="select-field"
                      type="text"
                      value={newCollectionNameDraft}
                      onChange={(event) => setNewCollectionNameDraft(event.target.value)}
                      placeholder="Friday Night Session"
                    />
                    <button className="ghost-button" type="button" onClick={onCreateCollection}>
                      Create
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}

          {collectionActionError ? <p className="editor-error-copy">{collectionActionError}</p> : null}
        </div>
      </div>

      <div className="live-side-column">
        <div className="panel live-status-panel session-settings-panel">
          <div className="settings-section">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Audio</h3>
              <strong className="volume-readout">{playbackStatusLabel}</strong>
            </div>

            <div className="settings-stack">
              <div className="settings-row">
                <label className="settings-name" htmlFor="playback-volume">Volume</label>
                <input className="slider-field compact-slider" id="playback-volume" type="range" min="0" max="100" value={playbackVolumePercent} onChange={handlePlaybackVolumeChange} disabled={isSessionStarting} />
              </div>

              <label className="settings-row toggle-row">
                <span className="settings-name">Crossfade</span>
                <input type="checkbox" checked={crossfadeEnabled} onChange={handleCrossfadeToggle} />
              </label>

              <div className={`settings-row ${!crossfadeEnabled ? 'disabled' : ''}`}>
                <label className="settings-name" htmlFor="crossfade-duration">Duration</label>
                <div className="number-field-row compact-number-row">
                  <input
                    id="crossfade-duration"
                    className="number-field compact-number-field"
                    type="number"
                    min="0.5"
                    max="15"
                    step="0.5"
                    value={crossfadeDurationSeconds}
                    onChange={handleCrossfadeDurationChange}
                    disabled={!crossfadeEnabled}
                  />
                  <span className="number-suffix">s</span>
                </div>
              </div>

              <label className={`settings-row toggle-row ${!crossfadeEnabled ? 'disabled' : ''}`}>
                <span className="settings-name">Fade on pause</span>
                <input type="checkbox" checked={crossfadeEnabled && crossfadePauseEnabled} onChange={handleCrossfadePauseToggle} disabled={!crossfadeEnabled} />
              </label>
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Transcription</h3>
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
                <label className="settings-name" htmlFor="transition-timeout-seconds">Transition proposal timeout</label>
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
      </div>
    </section>
  )
}

export default LiveWorkspace
