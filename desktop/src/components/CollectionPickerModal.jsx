function CollectionPickerModal({
  collectionActionError,
  collections,
  confirmCreateCollection,
  newCollectionNameDraft,
  onClose,
  onSearchChange,
  onUseCollection,
  searchQuery,
  setNewCollectionNameDraft,
  soundscape,
  title,
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="panel collection-picker-modal" role="dialog" aria-modal="true" aria-labelledby="collection-picker-title">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Collections</p>
            <h2 id="collection-picker-title">{title}</h2>
          </div>
        </div>

        <p className="supporting-text modal-intro-copy">
          {soundscape ? `Add ${soundscape.name} to a collection for session organization.` : 'Choose a collection.'}
        </p>

        <label className="field-label" htmlFor="collection-picker-search">Search collections</label>
        <input
          id="collection-picker-search"
          className="select-field"
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search collections"
        />

        <div className="modal-selection-list">
          {collections.length > 0 ? collections.map((collection) => (
            <button
              key={collection.collectionId}
              className="modal-selection-card"
              type="button"
              onClick={() => onUseCollection(collection.collectionId)}
            >
              <div>
                <strong>{collection.name}</strong>
                <p className="supporting-text">{collection.soundscapeCount || (collection.soundscapeIds || []).length} soundscapes</p>
              </div>
              <span className="status-chip">Use</span>
            </button>
          )) : (
            <div className="collection-list-empty">
              <p className="supporting-text">No collections match that search yet.</p>
            </div>
          )}
        </div>

        <div className="modal-create-block">
          <label className="field-label" htmlFor="new-session-collection-name">New collection</label>
          <div className="editor-add-row modal-create-row">
            <input
              id="new-session-collection-name"
              className="select-field"
              type="text"
              value={newCollectionNameDraft}
              onChange={(event) => setNewCollectionNameDraft(event.target.value)}
              placeholder="Friday Night Session"
            />
            <button className="primary-button" type="button" onClick={confirmCreateCollection}>
              Create
            </button>
          </div>
        </div>

        {collectionActionError ? <p className="editor-error-copy">{collectionActionError}</p> : null}

        <div className="button-row compact-action-row">
          <button className="ghost-button" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

export default CollectionPickerModal
