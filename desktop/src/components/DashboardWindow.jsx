import { useEffect, useState } from 'react'
import AddSoundscapesToCollectionModal from './AddSoundscapesToCollectionModal'
import CollectionPickerModal from './CollectionPickerModal'
import ControlRail from './ControlRail'
import ContextMenu from './ContextMenu'
import CreateCollectionModal from './CreateCollectionModal'
import FeedWorkspace from './FeedWorkspace'
import LibraryWorkspace from './LibraryWorkspace'
import LiveWorkspace from './LiveWorkspace'
import PlaybackController from './PlaybackController'

function useNarrowViewport(breakpoint = 1100) {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= breakpoint)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const handler = (e) => setNarrow(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [breakpoint])
  return narrow
}

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
  activeSoundscape,
  bootstrap,
  botTokenDraft,
  cancelSoundscapeEdit,
  chooseDiscordGuild,
  chooseDiscordVoiceChannel,
  collectionActionError,
  collectionPickerSearchQuery,
  collectionSoundscapeSearchQuery,
  collectionSearchQuery,
  collections,
  createCollectionAndUseSoundscape,
  createCollectionFromControls,
  currentCollectionSoundscapes,
  deleteSessionCollection,
  deleteSoundscape,
  deleteSoundscapeTrack,
  filteredCollectionPickerOptions,
  filteredCollections,
  addableCollectionSoundscapes,
  addSoundscapeToOpenedCollection,
  moveCollectionSoundscape,
  moveDraftTrackAtIndex,
  moveSoundscapeTrack,
  removeSoundscapeFromCollection,
  soundscapeDraft,
  soundscapeDraftValidation,
  soundscapeEditorError,
  soundscapeSavePending,
  soundscapes,
  createSoundscape,
  closeAddCollectionSoundscapesDialog,
  cancelCreateSoundscapePrompt,
  closeUseSoundscapeDialog,
  confirmCreateSoundscape,
  crossfadeDurationSeconds,
  crossfadeEnabled,
  crossfadePauseEnabled,
  approveTransition,
  dismissTransition,
  discordTargets,
  handleCrossfadeDurationChange,
  handleCrossfadePauseToggle,
  handleCrossfadeToggle,
  handleOutputModeChange,
  handlePlaybackVolumeChange,
  handleTranscriptionProfileChange,
  handleTransitionProposalToggle,
  handleTransitionTimeoutChange,
  handleTranscriptionToggle,
  isSessionActive,
  isSessionBusy,
  isSessionStarting,
  isSoundscapeEditing,
  lastError,
  lastTranscript,
  loopEnabled,
  filteredSoundscapes,
  librarySearchQuery,
  libraryFocusSoundscape,
  isCreateCollectionPromptOpen,
  isAddCollectionSoundscapesDialogOpen,
  isUseSoundscapeDialogOpen,
  newKeywordDraft,
  newSessionCollectionNameDraft,
  newSoundscapeNameDraft,
  newSoundscapePromptError,
  newTrackDraft,
  openedCollection,
  openedCollectionId,
  outputMode,
  playbackMuted,
  playbackPaused,
  playbackRouteLabel,
  playbackStatusLabel,
  playbackVolumePercent,
  reorderSoundscapeTracks,
  refreshDiscordTargets,
  reorderCollectionSoundscapes,
  removeKeywordAtIndex,
  removeTrackAtIndex,
  saveBotToken,
  saveSoundscapeEdit,
  selectedDiscordVoiceChannel,
  selectedGuild,
  selectedLibrarySoundscapeId,
  selectLibrarySoundscape,
  selectedVoiceChannels,
  sessionStatusClass,
  sessionStatusLabel,
  setSoundscapeDraftField,
  settings,
  setBotTokenDraft,
  setNewSoundscapeNameDraft,
  setNewKeywordDraft,
  setNewTrackDraft,
  setLibrarySearchQuery,
  setCollectionPickerSearchQuery,
  setCollectionSoundscapeSearchQuery,
  setCollectionSearchQuery,
  setOpenedCollectionId,
  setNewSessionCollectionNameDraft,
  setWorkspaceTab,
  skipTrack,
  seekTrack,
  startSoundscapeEdit,
  startSession,
  state,
  switchSoundscape,
  useSoundscapeInCollection,
  playSoundscapeTrackAtIndex,
  togglePinnedHud,
  togglePlaybackMute,
  togglePlaybackPause,
  toggleLoop,
  trackPreviewState,
  transcriptionEnabled,
  transcriptionProfile,
  transitionProgress,
  transitionProposalsEnabled,
  transitionTimeoutSeconds,
  useTargetSoundscape,
  updateKeywordAtIndex,
  updateTrackAtIndex,
  workspaceTab,
  endSession,
  openAddCollectionSoundscapesDialog,
  openUseSoundscapeDialog,
}) {
  const narrow = useNarrowViewport()
  const [contextMenu, setContextMenu] = useState(null)

  useEffect(() => {
    if (!narrow && workspaceTab === 'session') {
      setWorkspaceTab('live')
    }
  }, [narrow, workspaceTab, setWorkspaceTab])

  useEffect(() => {
    if (!contextMenu) {
      return undefined
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenu])

  const closeContextMenu = () => setContextMenu(null)

  const openContextMenu = (event, items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items,
    })
  }

  const controlRailProps = {
    botTokenDraft,
    chooseDiscordGuild,
    chooseDiscordVoiceChannel,
    soundscapes,
    discordTargets,
    endSession,
    handleOutputModeChange,
    isSessionBusy,
    isSessionStarting,
    outputMode,
    refreshDiscordTargets,
    saveBotToken,
    selectedGuild,
    selectedVoiceChannels,
    sessionStatusClass,
    sessionStatusLabel,
    setBotTokenDraft,
    settings,
    startSession,
    state,
  }

  const tabs = [
    { id: 'live', label: 'Controls' },
    { id: 'soundscapes', label: 'Soundscapes' },
    { id: 'feed', label: 'Feed' },
  ]

  if (narrow) {
    tabs.unshift({ id: 'session', label: 'Session' })
  }

  return (
    <div className={`app-shell ${narrow ? 'narrow' : ''}`}>
      {!narrow && <ControlRail {...controlRailProps} />}

      <main className="workspace-column">
        <div className="workspace-tabs">
          <div className="tab-row" role="tablist" aria-label="Workspace sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={workspaceTab === tab.id}
                className={`tab-button ${workspaceTab === tab.id ? 'active' : ''}`}
                onClick={() => setWorkspaceTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}

            <PlaybackController
              approveTransition={approveTransition}
              dismissTransition={dismissTransition}
              loopEnabled={loopEnabled}
              playbackMuted={playbackMuted}
              playbackPaused={playbackPaused}
              skipTrack={skipTrack}
              state={state}
              togglePlaybackMute={togglePlaybackMute}
              togglePlaybackPause={togglePlaybackPause}
              transitionProgress={transitionProgress}
            />
          </div>
        </div>

        {workspaceTab === 'session' && narrow ? (
          <div className="controls-workspace">
            <ControlRail {...controlRailProps} />
          </div>
        ) : workspaceTab === 'soundscapes' ? (
          <LibraryWorkspace
            addKeywordToDraft={addKeywordToDraft}
            addTrackToDraft={addTrackToDraft}
            cancelSoundscapeEdit={cancelSoundscapeEdit}
            soundscapeDraft={soundscapeDraft}
            soundscapeDraftValidation={soundscapeDraftValidation}
            soundscapeEditorError={soundscapeEditorError}
            soundscapeSavePending={soundscapeSavePending}
            createSoundscape={createSoundscape}
            deleteSoundscape={deleteSoundscape}
            deleteSoundscapeTrack={deleteSoundscapeTrack}
            filteredSoundscapes={filteredSoundscapes}
            formatDuration={formatDuration}
            isSoundscapeEditing={isSoundscapeEditing}
            isSessionActive={isSessionActive}
            isSessionStarting={isSessionStarting}
            libraryFocusSoundscape={libraryFocusSoundscape}
            librarySearchQuery={librarySearchQuery}
            moveDraftTrackAtIndex={moveDraftTrackAtIndex}
            moveSoundscapeTrack={moveSoundscapeTrack}
            newKeywordDraft={newKeywordDraft}
            newTrackDraft={newTrackDraft}
            openContextMenu={openContextMenu}
            playbackPaused={playbackPaused}
            reorderSoundscapeTracks={reorderSoundscapeTracks}
            removeKeywordAtIndex={removeKeywordAtIndex}
            removeTrackAtIndex={removeTrackAtIndex}
            saveSoundscapeEdit={saveSoundscapeEdit}
            selectedLibrarySoundscapeId={selectedLibrarySoundscapeId}
            selectLibrarySoundscape={selectLibrarySoundscape}
            setSoundscapeDraftField={setSoundscapeDraftField}
            setLibrarySearchQuery={setLibrarySearchQuery}
            setNewKeywordDraft={setNewKeywordDraft}
            setNewTrackDraft={setNewTrackDraft}
            startSoundscapeEdit={startSoundscapeEdit}
            state={state}
            switchSoundscape={switchSoundscape}
            playSoundscapeTrackAtIndex={playSoundscapeTrackAtIndex}
            togglePlaybackPause={togglePlaybackPause}
            trackPreviewState={trackPreviewState}
            openUseSoundscapeDialog={openUseSoundscapeDialog}
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
            activeSoundscape={activeSoundscape}
            crossfadeDurationSeconds={crossfadeDurationSeconds}
            crossfadeEnabled={crossfadeEnabled}
            handleCrossfadeDurationChange={handleCrossfadeDurationChange}
            handleCrossfadeToggle={handleCrossfadeToggle}
            handleCrossfadePauseToggle={handleCrossfadePauseToggle}
            crossfadePauseEnabled={crossfadePauseEnabled}
            handlePlaybackVolumeChange={handlePlaybackVolumeChange}
            handleTranscriptionProfileChange={handleTranscriptionProfileChange}
            handleTranscriptionToggle={handleTranscriptionToggle}
            handleTransitionProposalToggle={handleTransitionProposalToggle}
            handleTransitionTimeoutChange={handleTransitionTimeoutChange}
            isSessionActive={isSessionActive}
            isSessionStarting={isSessionStarting}
            lastTranscript={lastTranscript}
            loopEnabled={loopEnabled}
            playbackPaused={playbackPaused}
            playbackRouteLabel={playbackRouteLabel}
            playbackStatusLabel={playbackStatusLabel}
            playbackVolumePercent={playbackVolumePercent}
            seekTrack={seekTrack}
            collectionSearchQuery={collectionSearchQuery}
            currentCollectionSoundscapes={currentCollectionSoundscapes}
            filteredCollections={filteredCollections}
            onDeleteCollection={deleteSessionCollection}
            onCreateCollection={createCollectionFromControls}
            onMoveCollectionSoundscape={moveCollectionSoundscape}
            onOpenAddSoundscapes={openAddCollectionSoundscapesDialog}
            onPlayCollectionSoundscape={switchSoundscape}
            onReorderCollectionSoundscapes={reorderCollectionSoundscapes}
            onRemoveSoundscapeFromCollection={removeSoundscapeFromCollection}
            openedCollection={openedCollection}
            openedCollectionId={openedCollectionId}
            openContextMenu={openContextMenu}
            setCollectionSearchQuery={setCollectionSearchQuery}
            setOpenedCollectionId={setOpenedCollectionId}
            setNewCollectionNameDraft={setNewSessionCollectionNameDraft}
            newCollectionNameDraft={newSessionCollectionNameDraft}
            collectionActionError={collectionActionError}
            state={state}
            togglePlaybackPause={togglePlaybackPause}
            toggleLoop={toggleLoop}
            transcriptionEnabled={transcriptionEnabled}
            transcriptionProfile={transcriptionProfile}
            transitionProposalsEnabled={transitionProposalsEnabled}
            transitionTimeoutSeconds={transitionTimeoutSeconds}
          />
        )}
      </main>

      <button className={`dashboard-fab ${isSoundscapeEditing ? 'hidden' : ''}`} type="button" onClick={togglePinnedHud} title="Collapse into pinned HUD" aria-hidden={isSoundscapeEditing} tabIndex={isSoundscapeEditing ? -1 : 0}>
        <img src="/flip.svg" alt="Collapse into pinned HUD" />
      </button>

      {isCreateCollectionPromptOpen ? (
        <CreateCollectionModal
          cancelCreateCollectionPrompt={cancelCreateSoundscapePrompt}
          confirmCreateCollection={confirmCreateSoundscape}
          newCollectionNameDraft={newSoundscapeNameDraft}
          newCollectionPromptError={newSoundscapePromptError}
          setNewCollectionNameDraft={setNewSoundscapeNameDraft}
        />
      ) : null}

      {isUseSoundscapeDialogOpen ? (
        <CollectionPickerModal
          collectionActionError={collectionActionError}
          collections={filteredCollectionPickerOptions}
          confirmCreateCollection={createCollectionAndUseSoundscape}
          newCollectionNameDraft={newSessionCollectionNameDraft}
          onClose={closeUseSoundscapeDialog}
          onSearchChange={setCollectionPickerSearchQuery}
          onUseCollection={useSoundscapeInCollection}
          searchQuery={collectionPickerSearchQuery}
          setNewCollectionNameDraft={setNewSessionCollectionNameDraft}
          soundscape={useTargetSoundscape}
          title="Use In Collection"
        />
      ) : null}

      {isAddCollectionSoundscapesDialogOpen ? (
        <AddSoundscapesToCollectionModal
          collection={openedCollection}
          collectionActionError={collectionActionError}
          onAddSoundscape={addSoundscapeToOpenedCollection}
          onClose={closeAddCollectionSoundscapesDialog}
          onSearchChange={setCollectionSoundscapeSearchQuery}
          searchQuery={collectionSoundscapeSearchQuery}
          soundscapes={addableCollectionSoundscapes}
        />
      ) : null}

      <ContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </div>
  )
}

export default DashboardWindow
