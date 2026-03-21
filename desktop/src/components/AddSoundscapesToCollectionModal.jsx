function AddSoundscapesToCollectionModal({
  collection,
  collectionActionError,
  onAddSoundscape,
  onClose,
  onSearchChange,
  searchQuery,
  soundscapes,
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="panel collection-picker-modal" role="dialog" aria-modal="true" aria-labelledby="add-soundscapes-title">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Collections</p>
            <h2 id="add-soundscapes-title">Add Soundscapes</h2>
          </div>
        </div>

        <p className="supporting-text modal-intro-copy">
          {collection ? `Add more soundscapes to ${collection.name}.` : 'Add soundscapes to this collection.'}
        </p>

        <label className="field-label" htmlFor="collection-soundscape-search">Search soundscapes</label>
        <input
          id="collection-soundscape-search"
          className="select-field"
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search soundscapes"
        />

        <div className="modal-selection-list">
          {soundscapes.length > 0 ? soundscapes.map((soundscape) => {
            const soundscapeId = soundscape.soundscapeId || soundscape.collectionId
            return (
              <button
                key={soundscapeId}
                className="modal-selection-card"
                type="button"
                onClick={() => onAddSoundscape(soundscapeId)}
              >
                <div>
                  <strong>{soundscape.name}</strong>
                  <p className="supporting-text">{soundscape.trackCount} tracks</p>
                </div>
                <span className="status-chip">Add</span>
              </button>
            )
          }) : (
            <div className="collection-list-empty">
              <p className="supporting-text">No soundscapes available for this search.</p>
            </div>
          )}
        </div>

        {collectionActionError ? <p className="editor-error-copy">{collectionActionError}</p> : null}

        <div className="button-row compact-action-row">
          <button className="ghost-button" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

export default AddSoundscapesToCollectionModal
