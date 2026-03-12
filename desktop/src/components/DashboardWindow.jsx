import ControlRail from './ControlRail'
import CreateCollectionModal from './CreateCollectionModal'
import FeedWorkspace from './FeedWorkspace'
import LibraryWorkspace from './LibraryWorkspace'
import LiveWorkspace from './LiveWorkspace'

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds)) {
    return ''
  }
  const roundedSeconds = Math.max(0, Math.round(durationSeconds))
  const minutes = Math.floor(roundedSeconds / 60)
  const seconds = roundedSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function DashboardWindow({
  addKeywordToDraft,
  addTrackToDraft,
  activeCollection,
  bootstrap,
  botTokenDraft,
  cancelCollectionEdit,
  chooseDiscordGuild,
  chooseDiscordVoiceChannel,
  collectionDraft,
  collectionDraftValidation,
  collectionEditorError,
  collectionSavePending,
  collections,
  createCollection,
  cancelCreateCollectionPrompt,
  confirmCreateCollection,
  deleteCollection,
  approveTransition,
  dismissTransition,
  discordTargets,
  handleOutputModeChange,
  handlePlaybackVolumeChange,
  handleTranscriptionProfileChange,
  handleTransitionProposalToggle,
  handleTransitionTimeoutChange,
  handleTranscriptionToggle,
  isSessionActive,
  isSessionBusy,
  isSessionStarting,
  isCollectionEditing,
  lastError,
  lastTranscript,
  filteredCollections,
  librarySearchQuery,
  libraryFocusCollection,
  isCreateCollectionPromptOpen,
  newKeywordDraft,
  newCollectionIdDraft,
  newCollectionPromptError,
  newTrackDraft,
  outputMode,
  playbackMuted,
  playbackPaused,
  playbackRouteLabel,
  playbackStatusLabel,
  playbackVolumePercent,
  refreshDiscordTargets,
  removeKeywordAtIndex,
  removeTrackAtIndex,
  saveBotToken,
  saveCollectionEdit,
  selectedDiscordVoiceChannel,
  selectedGuild,
  selectedLibraryCollectionId,
  selectLibraryCollection,
  selectedVoiceChannels,
  sessionStatusClass,
  sessionStatusLabel,
  setCollectionDraftField,
  settings,
  setBotTokenDraft,
  setNewCollectionIdDraft,
  setNewKeywordDraft,
  setNewTrackDraft,
  setLibrarySearchQuery,
  setStartingCollection,
  setWorkspaceTab,
  skipTrack,
  startCollectionEdit,
  startSession,
  startingCollection,
  state,
  togglePinnedHud,
  togglePlaybackMute,
  togglePlaybackPause,
  trackPreviewState,
  transcriptionEnabled,
  transcriptionProfile,
  transitionProgress,
  transitionProposalsEnabled,
  transitionTimeoutSeconds,
  transportStateLabel,
  updateKeywordAtIndex,
  updateTrackAtIndex,
  workspaceTab,
  endSession,
}) {
  return (
    <div className="app-shell">
      <ControlRail
        botTokenDraft={botTokenDraft}
        chooseDiscordGuild={chooseDiscordGuild}
        chooseDiscordVoiceChannel={chooseDiscordVoiceChannel}
        collections={collections}
        discordTargets={discordTargets}
        endSession={endSession}
        handleOutputModeChange={handleOutputModeChange}
        isSessionBusy={isSessionBusy}
        isSessionStarting={isSessionStarting}
        outputMode={outputMode}
        refreshDiscordTargets={refreshDiscordTargets}
        saveBotToken={saveBotToken}
        selectedGuild={selectedGuild}
        selectedVoiceChannels={selectedVoiceChannels}
        sessionStatusClass={sessionStatusClass}
        sessionStatusLabel={sessionStatusLabel}
        setBotTokenDraft={setBotTokenDraft}
        setStartingCollection={setStartingCollection}
        settings={settings}
        startingCollection={startingCollection}
        startSession={startSession}
        state={state}
      />

      <main className="workspace-column">
        <div className="workspace-tabs">
          <div className="tab-row" role="tablist" aria-label="Workspace sections">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'live'}
              className={`tab-button ${workspaceTab === 'live' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('live')}
            >
              Live
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'library'}
              className={`tab-button ${workspaceTab === 'library' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('library')}
            >
              Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'feed'}
              className={`tab-button ${workspaceTab === 'feed' ? 'active' : ''}`}
              onClick={() => setWorkspaceTab('feed')}
            >
              Feed
            </button>
          </div>
        </div>

        {workspaceTab === 'library' ? (
          <LibraryWorkspace
            addKeywordToDraft={addKeywordToDraft}
            addTrackToDraft={addTrackToDraft}
            cancelCollectionEdit={cancelCollectionEdit}
            collectionDraft={collectionDraft}
            collectionDraftValidation={collectionDraftValidation}
            collectionEditorError={collectionEditorError}
            collectionSavePending={collectionSavePending}
            createCollection={createCollection}
            deleteCollection={deleteCollection}
            filteredCollections={filteredCollections}
            formatDuration={formatDuration}
            isCollectionEditing={isCollectionEditing}
            libraryFocusCollection={libraryFocusCollection}
            librarySearchQuery={librarySearchQuery}
            newKeywordDraft={newKeywordDraft}
            newTrackDraft={newTrackDraft}
            removeKeywordAtIndex={removeKeywordAtIndex}
            removeTrackAtIndex={removeTrackAtIndex}
            saveCollectionEdit={saveCollectionEdit}
            selectedLibraryCollectionId={selectedLibraryCollectionId}
            selectLibraryCollection={selectLibraryCollection}
            setCollectionDraftField={setCollectionDraftField}
            setLibrarySearchQuery={setLibrarySearchQuery}
            setNewKeywordDraft={setNewKeywordDraft}
            setNewTrackDraft={setNewTrackDraft}
            startCollectionEdit={startCollectionEdit}
            state={state}
            trackPreviewState={trackPreviewState}
            updateKeywordAtIndex={updateKeywordAtIndex}
            updateTrackAtIndex={updateTrackAtIndex}
          />
        ) : workspaceTab === 'feed' ? (
          <FeedWorkspace
            bootstrap={bootstrap}
            lastError={lastError}
            lastTranscript={lastTranscript}
            settings={settings}
            state={state}
          />
        ) : (
          <LiveWorkspace
            activeCollection={activeCollection}
            approveTransition={approveTransition}
            dismissTransition={dismissTransition}
            handlePlaybackVolumeChange={handlePlaybackVolumeChange}
            handleTranscriptionProfileChange={handleTranscriptionProfileChange}
            handleTranscriptionToggle={handleTranscriptionToggle}
            handleTransitionProposalToggle={handleTransitionProposalToggle}
            handleTransitionTimeoutChange={handleTransitionTimeoutChange}
            isSessionActive={isSessionActive}
            isSessionStarting={isSessionStarting}
            lastTranscript={lastTranscript}
            playbackMuted={playbackMuted}
            playbackPaused={playbackPaused}
            playbackRouteLabel={playbackRouteLabel}
            playbackStatusLabel={playbackStatusLabel}
            playbackVolumePercent={playbackVolumePercent}
            skipTrack={skipTrack}
            state={state}
            togglePlaybackMute={togglePlaybackMute}
            togglePlaybackPause={togglePlaybackPause}
            transcriptionEnabled={transcriptionEnabled}
            transcriptionProfile={transcriptionProfile}
            transitionProgress={transitionProgress}
            transitionProposalsEnabled={transitionProposalsEnabled}
            transitionTimeoutSeconds={transitionTimeoutSeconds}
            transportStateLabel={transportStateLabel}
          />
        )}
      </main>

      <button className={`dashboard-fab ${isCollectionEditing ? 'hidden' : ''}`} type="button" onClick={togglePinnedHud} title="Collapse into pinned HUD" aria-hidden={isCollectionEditing} tabIndex={isCollectionEditing ? -1 : 0}>
        <img src="/flip.svg" alt="Collapse into pinned HUD" />
      </button>

      {isCreateCollectionPromptOpen ? (
        <CreateCollectionModal
          cancelCreateCollectionPrompt={cancelCreateCollectionPrompt}
          confirmCreateCollection={confirmCreateCollection}
          newCollectionIdDraft={newCollectionIdDraft}
          newCollectionPromptError={newCollectionPromptError}
          setNewCollectionIdDraft={setNewCollectionIdDraft}
        />
      ) : null}
    </div>
  )
}

export default DashboardWindow
