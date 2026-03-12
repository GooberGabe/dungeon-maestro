function LibraryWorkspace({
  addKeywordToDraft,
  addTrackToDraft,
  cancelCollectionEdit,
  collectionDraft,
  collectionDraftValidation,
  collectionEditorError,
  collectionSavePending,
  createCollection,
  deleteCollection,
  filteredCollections,
  formatDuration,
  isCollectionEditing,
  libraryFocusCollection,
  librarySearchQuery,
  newKeywordDraft,
  newTrackDraft,
  removeKeywordAtIndex,
  removeTrackAtIndex,
  saveCollectionEdit,
  selectedLibraryCollectionId,
  selectLibraryCollection,
  setCollectionDraftField,
  setLibrarySearchQuery,
  setNewKeywordDraft,
  setNewTrackDraft,
  startCollectionEdit,
  state,
  trackPreviewState,
  updateKeywordAtIndex,
  updateTrackAtIndex,
}) {
  return (
    <section className="library-workspace">
      <div className="panel library-browser-panel">
        <div className="library-panel-header">
          <div>
            <p className="eyebrow">Library</p>
            <h2>Collections</h2>
          </div>
          <button className="editor-icon-button library-create-button" type="button" onClick={createCollection} disabled={isCollectionEditing} aria-label="Create collection" title="Create collection">
            +
          </button>
        </div>
        <div className="library-search-block">
          <label className="field-label" htmlFor="library-search">Search collections</label>
          <input
            id="library-search"
            className="select-field library-search-field"
            type="search"
            value={librarySearchQuery}
            onChange={(event) => setLibrarySearchQuery(event.target.value)}
            placeholder="Search names, ids, or keywords"
          />
        </div>
        <div className="collection-list workspace-collection-list">
          {filteredCollections.map((collection) => (
            <button
              key={collection.collectionId}
              type="button"
              className={`collection-card collection-button ${libraryFocusCollection?.collectionId === collection.collectionId ? 'selected' : ''} ${state.activeCollection === collection.collectionId ? 'active' : ''}`}
              onClick={() => selectLibraryCollection(collection.collectionId)}
              disabled={isCollectionEditing && selectedLibraryCollectionId !== collection.collectionId}
            >
              <div className="collection-title-row">
                <h3>{collection.name}</h3>
                <span>{collection.trackCount} tracks</span>
              </div>
              <p className="keyword-line">{collection.keywords.join(' • ')}</p>
            </button>
          ))}
          {filteredCollections.length === 0 ? (
            <div className="collection-list-empty">
              <p className="supporting-text">No collections match that search yet.</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel collection-editor-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Collection Detail</p>
            <h2>{libraryFocusCollection?.name || 'No collection selected'}</h2>
          </div>
          {libraryFocusCollection ? (
            <div className="detail-header-actions">
              {state.activeCollection === libraryFocusCollection.collectionId ? (
                <span className="status-chip online">Active Now</span>
              ) : null}
              {isCollectionEditing ? (
                <div className="button-row detail-action-row compact-action-row">
                  <button className="ghost-button" type="button" onClick={cancelCollectionEdit} disabled={collectionSavePending}>Cancel</button>
                  <button className="primary-button" type="button" onClick={saveCollectionEdit} disabled={collectionSavePending || !collectionDraftValidation.isValid}>Save</button>
                </div>
              ) : (
                <button className="ghost-button" type="button" onClick={startCollectionEdit}>Edit</button>
              )}
            </div>
          ) : null}
        </div>

        {libraryFocusCollection ? (
          <>
            <div className="detail-grid collection-summary-grid">
              <div>
                <span className="metric-label">Collection ID</span>
                <strong>{libraryFocusCollection.collectionId}</strong>
              </div>
              <div>
                <span className="metric-label">Collection Name</span>
                {isCollectionEditing ? (
                  <input
                    id="collection-name"
                    className="select-field compact-detail-field"
                    type="text"
                    value={collectionDraft?.name || ''}
                    onChange={(event) => setCollectionDraftField('name', event.target.value)}
                    placeholder="Ambient Exploration"
                  />
                ) : (
                  <strong>{libraryFocusCollection.name}</strong>
                )}
              </div>
            </div>

            {collectionDraftValidation.fieldErrors.name ? (
              <p className="editor-error-copy">{collectionDraftValidation.fieldErrors.name}</p>
            ) : null}

            <div className="collection-detail-block editor-section-block keyword-section-block">
              <span className="metric-label">Keywords</span>
              {isCollectionEditing ? (
                <>
                  <div className="keyword-editor-grid">
                    {(collectionDraft?.keywords || []).map((keyword, index) => (
                      <div key={`${libraryFocusCollection.collectionId}-keyword-${index}`} className="keyword-chip editable-chip">
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
                        {collectionDraftValidation.keywordErrors[index] ? (
                          <span className="chip-error-copy">{collectionDraftValidation.keywordErrors[index]}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {collectionDraftValidation.fieldErrors.keywords ? (
                    <p className="editor-error-copy">{collectionDraftValidation.fieldErrors.keywords}</p>
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
                  {libraryFocusCollection.keywords.map((keyword) => (
                    <span key={keyword} className="keyword-chip">{keyword}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="collection-detail-block editor-section-block subdued-panel">
              <div className="editor-section-header">
                <div>
                  <span className="metric-label">Tracks</span>
                  <p className="supporting-text detail-intro-copy">Enter a direct URL or a vibe term. The editor will infer how the source should behave.</p>
                </div>
                <strong className="track-total-copy">{isCollectionEditing ? (collectionDraft?.tracks || []).length : libraryFocusCollection.trackCount} total</strong>
              </div>

              <div className="track-list">
                {(isCollectionEditing ? (collectionDraft?.tracks || []) : (libraryFocusCollection.tracks || [])).map((trackEntry, index) => {
                  const trackSource = isCollectionEditing ? trackEntry : trackEntry.source
                  const bootstrapPreview = !isCollectionEditing ? trackEntry.preview : null
                  return (
                  <div key={`${libraryFocusCollection.collectionId}-track-${index}`} className="track-editor-row">
                    <div className="track-editor-main">
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

                        if (isCollectionEditing) {
                          return (
                            <>
                              <div className="track-input-shell">
                                <input
                                  className={`select-field track-source-field ${collectionDraftValidation.trackErrors[index] ? 'invalid' : ''}`}
                                  type="text"
                                  value={trackSource}
                                  onChange={(event) => updateTrackAtIndex(index, event.target.value)}
                                  placeholder="Paste a URL or enter a search term"
                                  aria-label={`Track source ${index + 1}`}
                                />
                                <span className={`status-chip track-type-chip track-type-chip-inline ${collectionDraftValidation.trackTypes[index]?.valid === false ? 'idle' : ''}`}>
                                  {collectionDraftValidation.trackTypes[index]?.label || 'Track source'}
                                </span>
                              </div>
                              {trackSource.trim() && !collectionDraftValidation.trackErrors[index] ? (
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
                              {collectionDraftValidation.trackErrors[index] ? (
                                <p className="editor-error-copy">{collectionDraftValidation.trackErrors[index]}</p>
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
                    {isCollectionEditing ? (
                      <button className="track-remove-button" type="button" onClick={() => removeTrackAtIndex(index)} aria-label={`Remove track ${index + 1}`} title="Remove track">
                        X
                      </button>
                    ) : null}
                  </div>
                )})}
              </div>

              {collectionDraftValidation.fieldErrors.tracks ? (
                <p className="editor-error-copy">{collectionDraftValidation.fieldErrors.tracks}</p>
              ) : null}

              {isCollectionEditing ? (
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

            {isCollectionEditing ? (
              <p className="supporting-text detail-footnote-copy">Saving updates the library config immediately. If a live session is already running, restart it to pick up the new collection definition.</p>
            ) : null}

            {isCollectionEditing && !libraryFocusCollection.isDraft ? (
              <div className="collection-delete-row">
                <button className="danger-button wide-danger-button" type="button" onClick={deleteCollection} disabled={collectionSavePending}>
                  Delete Collection
                </button>
              </div>
            ) : null}

            {collectionEditorError ? (
              <div className="collection-detail-block editor-error-block">
                <p className="editor-error-copy">{collectionEditorError}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="supporting-text">Choose a collection from the library browser to inspect its metadata.</p>
        )}
      </div>
    </section>
  )
}

export default LibraryWorkspace
