import { useState } from 'react'

import { getSoundscapeId } from '../constants'

const TRACK_DROP_ZONE_END = '__TRACK_END__'

function LibraryWorkspace({
  addKeywordToDraft,
  addTrackToDraft,
  cancelSoundscapeEdit,
  soundscapeDraft,
  soundscapeDraftValidation,
  soundscapeEditorError,
  soundscapeSavePending,
  createSoundscape,
  deleteSoundscape,
  deleteSoundscapeTrack,
  filteredSoundscapes,
  formatDuration,
  isSoundscapeEditing,
  isSessionActive,
  isSessionStarting,
  libraryFocusSoundscape,
  librarySearchQuery,
  moveDraftTrackAtIndex,
  moveSoundscapeTrack,
  newKeywordDraft,
  newTrackDraft,
  openContextMenu,
  playbackPaused,
  reorderSoundscapeTracks,
  removeKeywordAtIndex,
  removeTrackAtIndex,
  saveSoundscapeEdit,
  selectedLibrarySoundscapeId,
  selectLibrarySoundscape,
  setSoundscapeDraftField,
  setLibrarySearchQuery,
  setNewKeywordDraft,
  setNewTrackDraft,
  startSoundscapeEdit,
  state,
  switchSoundscape,
  playSoundscapeTrackAtIndex,
  togglePlaybackPause,
  trackPreviewState,
  updateKeywordAtIndex,
  updateTrackAtIndex,
  openUseSoundscapeDialog,
}) {
  const [draggedTrackIndex, setDraggedTrackIndex] = useState(null)
  const [dragOverTrackZone, setDragOverTrackZone] = useState('')
  const activeSoundscapeId = state.activeSoundscape || state.activeCollection || ''
  const focusedSoundscapeId = getSoundscapeId(libraryFocusSoundscape)
  const canReorderTracks = Boolean(focusedSoundscapeId) && !isSoundscapeEditing

  const handleTrackDragStart = (event, trackIndex) => {
    if (!canReorderTracks) {
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(trackIndex))
    setDraggedTrackIndex(trackIndex)
    setDragOverTrackZone('')
  }

  const handleTrackDropZoneDragOver = (event, zoneId) => {
    if (draggedTrackIndex === null) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverTrackZone !== zoneId) {
      setDragOverTrackZone(zoneId)
    }
  }

  const resetTrackDragState = () => {
    setDraggedTrackIndex(null)
    setDragOverTrackZone('')
  }

  const handleTrackDrop = async (event, beforeTrackIndex) => {
    const droppedTrackIndex = Number.parseInt(event.dataTransfer.getData('text/plain'), 10)
    const sourceTrackIndex = Number.isInteger(droppedTrackIndex) ? droppedTrackIndex : draggedTrackIndex
    if (!focusedSoundscapeId || !Number.isInteger(sourceTrackIndex)) {
      resetTrackDragState()
      return
    }
    event.preventDefault()
    try {
      await reorderSoundscapeTracks(
        focusedSoundscapeId,
        sourceTrackIndex,
        beforeTrackIndex === TRACK_DROP_ZONE_END ? null : beforeTrackIndex,
      )
    } finally {
      resetTrackDragState()
    }
  }

  const handleTrackDropZoneDragEnter = (zoneId) => {
    if (draggedTrackIndex === null) {
      return
    }
    setDragOverTrackZone(zoneId)
  }

  const resolveTrackDropZoneFromCard = (event, currentTrackIndex, nextTrackIndex) => {
    const cardRect = event.currentTarget.getBoundingClientRect()
    const pointerIsInUpperHalf = event.clientY <= cardRect.top + (cardRect.height / 2)
    return pointerIsInUpperHalf ? currentTrackIndex : nextTrackIndex
  }

  const handleTrackCardDragOver = (event, currentTrackIndex, nextTrackIndex) => {
    if (draggedTrackIndex === null) {
      return
    }
    const zoneId = resolveTrackDropZoneFromCard(event, currentTrackIndex, nextTrackIndex)
    handleTrackDropZoneDragOver(event, zoneId)
  }

  const handleTrackCardDrop = async (event, currentTrackIndex, nextTrackIndex) => {
    const zoneId = resolveTrackDropZoneFromCard(event, currentTrackIndex, nextTrackIndex)
    await handleTrackDrop(event, zoneId)
  }

  const openSoundscapeContextMenu = (event, soundscape) => {
    const soundscapeId = getSoundscapeId(soundscape)
    if (!soundscapeId || soundscape.isDraft) {
      return
    }
    openContextMenu(event, [
      {
        id: `delete-soundscape-${soundscapeId}`,
        label: 'Delete Soundscape',
        danger: true,
        onSelect: () => deleteSoundscape(soundscapeId),
      },
    ])
  }

  const openTrackContextMenu = (event, index, trackCount) => {
    if (!focusedSoundscapeId) {
      return
    }
    const deleteDisabled = trackCount <= 1
    openContextMenu(event, [
      {
        id: `delete-track-${focusedSoundscapeId}-${index}`,
        label: 'Delete Track',
        danger: true,
        disabled: deleteDisabled,
        onSelect: () => (isSoundscapeEditing ? removeTrackAtIndex(index) : deleteSoundscapeTrack(focusedSoundscapeId, index)),
      },
      {
        id: `move-track-up-${focusedSoundscapeId}-${index}`,
        label: 'Move Up',
        disabled: index === 0,
        onSelect: () => (isSoundscapeEditing ? moveDraftTrackAtIndex(index, -1) : moveSoundscapeTrack(focusedSoundscapeId, index, -1)),
      },
      {
        id: `move-track-down-${focusedSoundscapeId}-${index}`,
        label: 'Move Down',
        disabled: index === trackCount - 1,
        onSelect: () => (isSoundscapeEditing ? moveDraftTrackAtIndex(index, 1) : moveSoundscapeTrack(focusedSoundscapeId, index, 1)),
      },
    ])
  }

  return (
    <section className="library-workspace">
      <div className="panel library-browser-panel">
        <div className="library-panel-header">
          <div>
            <p className="eyebrow">Soundscapes</p>
            <h2>Library</h2>
          </div>
          <button className="editor-icon-button library-create-button" type="button" onClick={createSoundscape} disabled={isSoundscapeEditing} aria-label="Create soundscape" title="Create soundscape">
            +
          </button>
        </div>
        <div className="library-search-block">
          <label className="field-label" htmlFor="library-search">Search soundscapes</label>
          <div className="search-field-wrapper">
            <input
              id="library-search"
              className="select-field library-search-field"
              type="text"
              value={librarySearchQuery}
              onChange={(event) => setLibrarySearchQuery(event.target.value)}
              placeholder="Search names or keywords"
            />
            {librarySearchQuery ? (
              <button
                className="search-clear-button"
                type="button"
                onClick={() => setLibrarySearchQuery('')}
                aria-label="Clear search"
              >
                X
              </button>
            ) : null}
          </div>
        </div>
        <div className="collection-list workspace-collection-list">
          {filteredSoundscapes.map((soundscape) => (
            (() => {
              const soundscapeId = getSoundscapeId(soundscape)
              const isSelected = focusedSoundscapeId === soundscapeId
              const isActive = activeSoundscapeId === soundscapeId && state.currentTrackIndex !== null
              return (
            <button
              key={soundscapeId}
              type="button"
              className={`collection-card collection-button ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''}`}
              onClick={() => selectLibrarySoundscape(soundscapeId)}
              onContextMenu={(event) => openSoundscapeContextMenu(event, soundscape)}
              disabled={isSoundscapeEditing && selectedLibrarySoundscapeId !== soundscapeId}
            >
                <div className="collection-title-row">
                  <h3>{soundscape.name}</h3>
                  <span>{soundscape.trackCount} tracks</span>
                </div>
                <p className="keyword-line">{soundscape.keywords.join(' • ')}</p>
            </button>
              )
            })()
          ))}
          {filteredSoundscapes.length === 0 ? (
            <div className="collection-list-empty">
              <p className="supporting-text">No soundscapes match that search yet.</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel collection-editor-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Soundscape Detail</p>
            <h2>{libraryFocusSoundscape?.name || 'No soundscape selected'}</h2>
          </div>
          {libraryFocusSoundscape ? (
            <div className="detail-header-actions">
              {isSoundscapeEditing ? (
                <div className="button-row detail-action-row compact-action-row">
                  <button className="ghost-button" type="button" onClick={cancelSoundscapeEdit} disabled={soundscapeSavePending}>Cancel</button>
                  <button className="primary-button" type="button" onClick={saveSoundscapeEdit} disabled={soundscapeSavePending || !soundscapeDraftValidation.isValid}>Save</button>
                </div>
              ) : (() => {
                const isThisSoundscapePlaying = activeSoundscapeId === focusedSoundscapeId && state.currentTrackIndex !== null
                const showPause = isThisSoundscapePlaying && !playbackPaused
                const showResume = isThisSoundscapePlaying && playbackPaused
                const buttonDisabled = !isSessionActive || isSessionStarting
                const buttonTitle = !isSessionActive ? 'Session is not active.' : isSessionStarting ? 'Session is preparing…' : showPause ? 'Pause playback' : showResume ? 'Resume playback' : 'Play this soundscape'
                const handleClick = showPause || showResume ? togglePlaybackPause : () => switchSoundscape(focusedSoundscapeId)
                return (
                  <div className="button-row detail-action-row compact-action-row">
                    <button className="ghost-button" type="button" onClick={startSoundscapeEdit}>Edit</button>
                    <button className="ghost-button" type="button" onClick={openUseSoundscapeDialog}>Use</button>
                    <button
                      className="detail-play-button"
                      type="button"
                      onClick={handleClick}
                      disabled={buttonDisabled}
                      title={buttonTitle}
                    >
                      <img
                        src={buttonDisabled ? '/play-button-grayed-out.svg' : showPause ? '/pause-button.svg' : '/play-button.svg'}
                        alt={showPause ? 'Pause' : 'Play'}
                        style={{ width: 'var(--icon-lg)', height: 'var(--icon-lg)' }}
                      />
                    </button>
                  </div>
                )
              })()}
            </div>
          ) : null}
        </div>

        {libraryFocusSoundscape ? (
          <>
            <div className="detail-grid collection-summary-grid">
              <div>
                <span className="metric-label">Soundscape Name</span>
                {isSoundscapeEditing ? (
                  <input
                    id="collection-name"
                    className="select-field compact-detail-field"
                    type="text"
                    value={soundscapeDraft?.name || ''}
                    onChange={(event) => setSoundscapeDraftField('name', event.target.value)}
                    placeholder="Ambient Exploration"
                  />
                ) : (
                  <strong>{libraryFocusSoundscape.name}</strong>
                )}
              </div>
              <div>
                <span className="metric-label">Settings</span>
                <span className="supporting-text">No settings configured.</span>
              </div>
            </div>

            {soundscapeDraftValidation.fieldErrors.name ? (
              <p className="editor-error-copy">{soundscapeDraftValidation.fieldErrors.name}</p>
            ) : null}

            <div className="collection-detail-block editor-section-block keyword-section-block">
              <span className="metric-label">Keywords</span>
              {isSoundscapeEditing ? (
                <>
                  <div className="keyword-editor-grid">
                    {(soundscapeDraft?.keywords || []).map((keyword, index) => (
                      <div key={`${focusedSoundscapeId}-keyword-${index}`} className="keyword-chip editable-chip">
                        <input
                          className="chip-input"
                          type="text"
                          value={keyword}
                          onChange={(event) => updateKeywordAtIndex(index, event.target.value)}
                          aria-label={`Keyword ${index + 1}`}
                        />
                        <button
                          className="chip-remove-button"
                          type="button"
                          onClick={() => removeKeywordAtIndex(index)}
                          aria-label={`Remove keyword ${keyword || index + 1}`}
                        >
                          X
                        </button>
                        {soundscapeDraftValidation.keywordErrors[index] ? (
                          <span className="chip-error-copy">{soundscapeDraftValidation.keywordErrors[index]}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {soundscapeDraftValidation.fieldErrors.keywords ? (
                    <p className="editor-error-copy">{soundscapeDraftValidation.fieldErrors.keywords}</p>
                  ) : null}
                  <div className="editor-add-row">
                    <input
                      className="select-field"
                      type="text"
                      value={newKeywordDraft}
                      onChange={(event) => setNewKeywordDraft(event.target.value)}
                      placeholder="Add a keyword or phrase"
                    />
                    <button className="editor-icon-button" type="button" onClick={addKeywordToDraft} disabled={!newKeywordDraft.trim()} aria-label="Add keyword" title="Add keyword">
                      +
                    </button>
                  </div>
                </>
              ) : (
                <div className="keyword-chip-row">
                  {libraryFocusSoundscape.keywords.map((keyword) => (
                    <span key={keyword} className="keyword-chip">{keyword}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="collection-detail-block editor-section-block subdued-panel">
              <div className="editor-section-header">
                <div>
                  <span className="metric-label">Tracks</span>
                  {isSoundscapeEditing ? (
                    <p className="supporting-text detail-intro-copy">Enter a direct URL or a vibe term. The editor will infer how the source should behave.</p>
                  ) : null}
                </div>
                <strong className="track-total-copy">{isSoundscapeEditing ? (soundscapeDraft?.tracks || []).length : libraryFocusSoundscape.trackCount} total</strong>
              </div>

              <div className={`track-list ${draggedTrackIndex !== null ? 'dragging-active' : ''}`}>
                {!isSoundscapeEditing && (libraryFocusSoundscape?.tracks || []).length > 0 ? (
                  <div
                    className={`soundscape-drop-zone ${dragOverTrackZone === 0 ? 'active' : ''}`}
                    onDragEnter={() => handleTrackDropZoneDragEnter(0)}
                    onDragOver={(event) => handleTrackDropZoneDragOver(event, 0)}
                    onDrop={(event) => void handleTrackDrop(event, 0)}
                  />
                ) : null}
                {(isSoundscapeEditing ? (soundscapeDraft?.tracks || []) : (libraryFocusSoundscape.tracks || [])).map((trackEntry, index, trackEntries) => {
                  const trackSource = isSoundscapeEditing ? trackEntry : trackEntry.source
                  const bootstrapPreview = !isSoundscapeEditing ? trackEntry.preview : null
                  const trackPlayable = isSessionActive && !isSoundscapeEditing
                  const isNowPlaying = trackPlayable && activeSoundscapeId === focusedSoundscapeId && state.currentTrackIndex === index
                  const nextTrackIndex = (index + 1) < (libraryFocusSoundscape?.tracks || []).length ? index + 1 : TRACK_DROP_ZONE_END
                  const showPause = isNowPlaying && !playbackPaused
                  const showResume = isNowPlaying && playbackPaused
                  const buttonDisabled = !trackPlayable || isSessionStarting
                  const buttonTitle = !trackPlayable
                    ? 'Session is not active.'
                    : isSessionStarting
                      ? 'Session is preparing...'
                      : showPause
                        ? 'Pause playback'
                        : showResume
                          ? 'Resume playback'
                          : 'Play this track'
                  const handlePlayClick = showPause || showResume ? togglePlaybackPause : () => playSoundscapeTrackAtIndex(focusedSoundscapeId, index)
                  return (
                  <div
                    key={`${focusedSoundscapeId}-track-${index}`}
                    className="track-card-stack"
                    draggable={canReorderTracks}
                    onDragStart={(event) => handleTrackDragStart(event, index)}
                    onDragEnd={resetTrackDragState}
                    onDragOver={!isSoundscapeEditing ? (event) => handleTrackCardDragOver(event, index, nextTrackIndex) : undefined}
                    onDrop={!isSoundscapeEditing ? (event) => void handleTrackCardDrop(event, index, nextTrackIndex) : undefined}
                    onContextMenu={(event) => openTrackContextMenu(event, index, trackEntries.length)}
                  >
                    <div className={`track-card-shell${isNowPlaying ? ' active' : ''}${draggedTrackIndex === index ? ' dragging' : ''}${isSoundscapeEditing ? ' editing' : ''}`}>
                    <div className="track-editor-main track-card-copy">
                      {(() => {
                        const normalizedTrackSource = trackSource.trim()
                        const preview = normalizedTrackSource ? (trackPreviewState[normalizedTrackSource] || (bootstrapPreview ? {
                          status: 'ready',
                          source: normalizedTrackSource,
                          ok: Boolean(bootstrapPreview.ok),
                          title: bootstrapPreview.title || '',
                          webpageUrl: bootstrapPreview.webpage_url || '',
                          durationSeconds: bootstrapPreview.duration_seconds ?? null,
                          message: bootstrapPreview.message || '',
                        } : null)) : null

                        if (isSoundscapeEditing) {
                          return (
                            <>
                              <div className="track-input-shell">
                                <input
                                  className={`select-field track-source-field ${soundscapeDraftValidation.trackErrors[index] ? 'invalid' : ''}`}
                                  type="text"
                                  value={trackSource}
                                  onChange={(event) => updateTrackAtIndex(index, event.target.value)}
                                  placeholder="Paste a URL or enter a search term"
                                  aria-label={`Track source ${index + 1}`}
                                />
                                  <span className={`status-chip track-type-chip track-type-chip-inline ${soundscapeDraftValidation.trackTypes[index]?.valid === false ? 'idle' : ''}`}>
                                  {soundscapeDraftValidation.trackTypes[index]?.label || 'Track source'}
                                </span>
                              </div>
                                {trackSource.trim() && !soundscapeDraftValidation.trackErrors[index] ? (
                                (() => {
                                  if (!preview || preview.status === 'pending') {
                                    return <p className="track-preview-copy pending">Checking preview...</p>
                                  }
                                  if (!preview.ok) {
                                    return <p className="track-preview-copy caution">Preview unavailable right now. Saving is still allowed.</p>
                                  }
                                  return (
                                    <div className="track-preview-row">
                                      <p className="track-preview-copy success">{preview.title || 'Resolved preview'}</p>
                                      {preview.durationSeconds ? <span className="track-preview-duration">{formatDuration(preview.durationSeconds)}</span> : null}
                                    </div>
                                  )
                                })()
                              ) : null}
                              {soundscapeDraftValidation.trackErrors[index] ? (
                                <p className="editor-error-copy">{soundscapeDraftValidation.trackErrors[index]}</p>
                              ) : null}
                            </>
                          )
                        }

                        return (
                          <>
                            <p className="track-source-copy">
                              {preview?.ok && preview.title ? preview.title : trackSource}
                            </p>
                            <div className="track-meta-row view-mode-meta-row">
                              {preview?.status === 'pending' ? (
                                <span className="track-preview-copy pending">Resolving title...</span>
                              ) : null}
                              {preview?.ok && preview.durationSeconds ? (
                                <span className="track-preview-duration">{formatDuration(preview.durationSeconds)}</span>
                              ) : null}
                              {preview?.status === 'ready' && !preview.ok ? (
                                <span className="track-preview-copy caution">Preview unavailable</span>
                              ) : null}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                    {isSoundscapeEditing ? (
                      <button className="track-remove-button" type="button" onClick={() => removeTrackAtIndex(index)} aria-label={`Remove track ${index + 1}`} title="Remove track">
                        X
                      </button>
                    ) : (
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
                    )}
                    </div>
                    {!isSoundscapeEditing ? (
                      <div
                        className={`soundscape-drop-zone ${dragOverTrackZone === nextTrackIndex ? 'active' : ''}`}
                        onDragEnter={() => handleTrackDropZoneDragEnter(nextTrackIndex)}
                        onDragOver={(event) => handleTrackDropZoneDragOver(event, nextTrackIndex)}
                        onDrop={(event) => void handleTrackDrop(event, nextTrackIndex)}
                      />
                    ) : null}
                  </div>
                )})}
              </div>

              {soundscapeDraftValidation.fieldErrors.tracks ? (
                <p className="editor-error-copy">{soundscapeDraftValidation.fieldErrors.tracks}</p>
              ) : null}

              {isSoundscapeEditing ? (
                <div className="editor-add-row">
                  <input
                    className="select-field"
                    type="text"
                    value={newTrackDraft}
                    onChange={(event) => setNewTrackDraft(event.target.value)}
                    placeholder="https://youtube.com/... or 'fantasy tavern ambience'"
                  />
                  <button className="editor-icon-button" type="button" onClick={addTrackToDraft} disabled={!newTrackDraft.trim()} aria-label="Add track" title="Add track">
                    +
                  </button>
                </div>
              ) : null}
            </div>

            {isSoundscapeEditing ? (
              <p className="supporting-text detail-footnote-copy">Saving updates the library config immediately. If a live session is already running, restart it to pick up the new soundscape definition.</p>
            ) : null}

            {isSoundscapeEditing && !libraryFocusSoundscape.isDraft ? (
              <div className="collection-delete-row">
                <button className="danger-button wide-danger-button" type="button" onClick={deleteSoundscape} disabled={soundscapeSavePending}>
                  Delete Soundscape
                </button>
              </div>
            ) : null}

            {soundscapeEditorError ? (
              <div className="collection-detail-block editor-error-block">
                <p className="editor-error-copy">{soundscapeEditorError}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="supporting-text">Choose a soundscape from the library browser to inspect its metadata.</p>
        )}
      </div>
    </section>
  )
}

export default LibraryWorkspace
