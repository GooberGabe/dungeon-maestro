function CreateCollectionModal({
  cancelCreateCollectionPrompt,
  confirmCreateCollection,
  newCollectionIdDraft,
  newCollectionPromptError,
  setNewCollectionIdDraft,
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="panel collection-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-collection-title">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Library</p>
            <h2 id="create-collection-title">Create Collection</h2>
          </div>
        </div>

        <label className="field-label" htmlFor="new-collection-id">Collection id</label>
        <input
          id="new-collection-id"
          className="select-field"
          type="text"
          value={newCollectionIdDraft}
          onChange={(event) => setNewCollectionIdDraft(event.target.value)}
          placeholder="forest-night"
          autoFocus
        />
        {newCollectionPromptError ? (
          <p className="editor-error-copy">{newCollectionPromptError}</p>
        ) : null}

        <div className="button-row compact-action-row">
          <button className="ghost-button" type="button" onClick={cancelCreateCollectionPrompt}>Cancel</button>
          <button className="primary-button" type="button" onClick={confirmCreateCollection}>Create</button>
        </div>
      </div>
    </div>
  )
}

export default CreateCollectionModal
