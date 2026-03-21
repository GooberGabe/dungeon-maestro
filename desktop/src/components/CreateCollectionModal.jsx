function CreateCollectionModal({
  cancelCreateCollectionPrompt,
  confirmCreateCollection,
  newCollectionNameDraft,
  newCollectionPromptError,
  setNewCollectionNameDraft,
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="panel collection-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-collection-title">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Soundscapes</p>
            <h2 id="create-collection-title">Create Soundscape</h2>
          </div>
        </div>

        <label className="field-label" htmlFor="new-collection-name">Soundscape name</label>
        <input
          id="new-collection-name"
          className="select-field"
          type="text"
          value={newCollectionNameDraft}
          onChange={(event) => setNewCollectionNameDraft(event.target.value)}
          placeholder="Forest Night"
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
