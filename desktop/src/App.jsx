import { useEffect, useMemo, useState } from 'react'

import DashboardWindow from './components/DashboardWindow'
import PinnedHud from './components/PinnedHud'
import { ICONS, VIEW_MODE } from './constants'
import { createCollectionDraft, createNewCollectionDraft, validateCollectionDraft } from './libraryEditor'

function App() {
  const [bootstrap, setBootstrap] = useState(null)
  const [botTokenDraft, setBotTokenDraft] = useState('')
  const [startingCollection, setStartingCollection] = useState('')
  const [selectedLibraryCollectionId, setSelectedLibraryCollectionId] = useState('')
  const [librarySearchQuery, setLibrarySearchQuery] = useState('')
  const [collectionDraft, setCollectionDraft] = useState(null)
  const [pendingNewCollectionId, setPendingNewCollectionId] = useState('')
  const [isCreateCollectionPromptOpen, setIsCreateCollectionPromptOpen] = useState(false)
  const [newCollectionIdDraft, setNewCollectionIdDraft] = useState('')
  const [newCollectionPromptError, setNewCollectionPromptError] = useState('')
  const [isCollectionEditing, setIsCollectionEditing] = useState(false)
  const [collectionEditorError, setCollectionEditorError] = useState('')
  const [collectionSavePending, setCollectionSavePending] = useState(false)
  const [trackPreviewState, setTrackPreviewState] = useState({})
  const [newKeywordDraft, setNewKeywordDraft] = useState('')
  const [newTrackDraft, setNewTrackDraft] = useState('')
  const [workspaceTab, setWorkspaceTab] = useState('live')
  const [nowEpoch, setNowEpoch] = useState(() => Date.now() / 1000)
  const [sessionActionPending, setSessionActionPending] = useState(false)
  const [bootstrapError, setBootstrapError] = useState('')
  const [outputMode, setOutputMode] = useState('local')
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(true)
  const [transcriptionProfile, setTranscriptionProfile] = useState('fast')
  const [transitionProposalsEnabled, setTransitionProposalsEnabled] = useState(true)
  const [transitionTimeoutSeconds, setTransitionTimeoutSeconds] = useState(30)
  const [playbackVolumePercent, setPlaybackVolumePercent] = useState(100)
  const [playbackMuted, setPlaybackMuted] = useState(false)
  const [playbackPaused, setPlaybackPaused] = useState(false)
  const isHudWindow = VIEW_MODE === 'hud'

  useEffect(() => {
    document.body.classList.toggle('hud-mode', isHudWindow)
    document.title = isHudWindow ? 'DungeonMaestro HUD' : 'DungeonMaestro Dashboard'
    return () => {
      document.body.classList.remove('hud-mode')
    }
  }, [isHudWindow])

  useEffect(() => {
    if (!window.dungeonMaestro) {
      setBootstrapError('Electron preload bridge is unavailable. The dashboard cannot talk to the main process yet.')
      return undefined
    }

    let unsubscribe = null

    window.dungeonMaestro.getBootstrapData()
      .then((data) => {
        setBootstrap(data)
        setOutputMode(data.state.outputMode || data.settings.outputMode || 'local')
        setBotTokenDraft(data.settings.botToken || '')
        setStartingCollection(data.config.settings.default_collection || data.config.collections[0]?.collectionId || '')
        setSelectedLibraryCollectionId(data.config.settings.default_collection || data.state.activeCollection || data.config.collections[0]?.collectionId || '')
        setTransitionProposalsEnabled(data.config.settings.enable_transition_proposals !== false)
        setTranscriptionProfile(data.state.transcriptionProfile || data.config.settings.transcription_profile || 'fast')
        setTransitionTimeoutSeconds(Number(data.config.settings.transition_popup_timeout || 30))
        setPlaybackVolumePercent(Number(data.state.volumePercent ?? 100))
        setPlaybackMuted(Boolean(data.state.playbackMuted))
        setPlaybackPaused(Boolean(data.state.playbackPaused))
      })
      .catch((error) => {
        setBootstrapError(error?.message || String(error))
      })

    try {
      unsubscribe = window.dungeonMaestro.onStateChanged((data) => {
        setBootstrap(data)
        setOutputMode(data.state.outputMode || data.settings.outputMode || 'local')
        setTranscriptionProfile(data.state.transcriptionProfile || data.config.settings.transcription_profile || 'fast')
        setPlaybackVolumePercent(Number(data.state.volumePercent ?? 100))
        setPlaybackMuted(Boolean(data.state.playbackMuted))
        setPlaybackPaused(Boolean(data.state.playbackPaused))
      })
    } catch (error) {
      setBootstrapError(error?.message || String(error))
    }

    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [])

  const collections = bootstrap?.config.collections || []
  const state = bootstrap?.state
  const settings = bootstrap?.settings
  const discordTargets = state?.discordTargets || []
  const effectiveCollections = useMemo(() => {
    if (!pendingNewCollectionId || collections.some((collection) => collection.collectionId === pendingNewCollectionId)) {
      return collections
    }

    const draft = collectionDraft || createNewCollectionDraft(pendingNewCollectionId)
    return [
      {
        collectionId: pendingNewCollectionId,
        name: draft.name,
        keywords: draft.keywords,
        tracks: draft.tracks.map((source) => ({ source, preview: null })),
        trackCount: draft.tracks.length,
        playbackMode: 'sequential_loop',
        isDraft: true,
      },
      ...collections,
    ]
  }, [collectionDraft, collections, pendingNewCollectionId])

  const selectedGuild = useMemo(
    () => discordTargets.find((guild) => guild.id === settings?.discordGuildId) || null,
    [discordTargets, settings?.discordGuildId]
  )

  const selectedVoiceChannels = selectedGuild?.voice_channels || []

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.collectionId === state?.activeCollection),
    [collections, state?.activeCollection]
  )

  const selectedLibraryCollection = useMemo(
    () => effectiveCollections.find((collection) => collection.collectionId === selectedLibraryCollectionId) || null,
    [effectiveCollections, selectedLibraryCollectionId]
  )

  const libraryFocusCollection = selectedLibraryCollection || activeCollection || effectiveCollections[0] || null

  const collectionDraftValidation = useMemo(
    () => validateCollectionDraft(collectionDraft || createCollectionDraft(libraryFocusCollection)),
    [collectionDraft, libraryFocusCollection]
  )

  const filteredCollections = useMemo(() => {
    const query = librarySearchQuery.trim().toLowerCase()
    if (!query) {
      return effectiveCollections
    }

    return effectiveCollections.filter((collection) => {
      const searchableParts = [
        collection.name,
        collection.collectionId,
        ...(collection.keywords || []),
      ]
      return searchableParts.some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [effectiveCollections, librarySearchQuery])

  useEffect(() => {
    if (!effectiveCollections.length) {
      return
    }

    const hasSelection = effectiveCollections.some((collection) => collection.collectionId === selectedLibraryCollectionId)
    if (!hasSelection) {
      setSelectedLibraryCollectionId(state?.activeCollection || startingCollection || effectiveCollections[0].collectionId)
    }
  }, [effectiveCollections, selectedLibraryCollectionId, startingCollection, state?.activeCollection])

  useEffect(() => {
    if (!collections.length) {
      return
    }

    setTrackPreviewState((current) => {
      const nextState = { ...current }
      let changed = false

      effectiveCollections.forEach((collection) => {
        ;(collection.tracks || []).forEach((track) => {
          const source = String(track?.source || '').trim()
          if (!source || !track?.preview) {
            return
          }
          if (nextState[source]?.status === 'ready') {
            return
          }
          nextState[source] = {
            status: 'ready',
            source,
            ok: Boolean(track.preview.ok),
            title: track.preview.title || '',
            webpageUrl: track.preview.webpage_url || '',
            durationSeconds: track.preview.duration_seconds ?? null,
            message: track.preview.message || '',
          }
          changed = true
        })
      })

      return changed ? nextState : current
    })
  }, [effectiveCollections])

  useEffect(() => {
    if (!libraryFocusCollection || isCollectionEditing) {
      return
    }
    setCollectionDraft(createCollectionDraft(libraryFocusCollection))
    setCollectionEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
  }, [libraryFocusCollection, isCollectionEditing])

  useEffect(() => {
    const candidateSources = isCollectionEditing
      ? (collectionDraft?.tracks || [])
      : ((libraryFocusCollection?.tracks || []).map((track) => track.source))

    if (!candidateSources.length) {
      return undefined
    }

    const nextValidSources = []
    candidateSources.forEach((trackSource, index) => {
      const normalizedSource = String(trackSource || '').trim()
      if (!normalizedSource) {
        return
      }
      if (isCollectionEditing) {
        if (collectionDraftValidation.trackErrors[index]) {
          return
        }
        if (!collectionDraftValidation.trackTypes[index]?.valid) {
          return
        }
      }
      nextValidSources.push(normalizedSource)
    })

    if (!nextValidSources.length) {
      return undefined
    }

    const uniqueSources = [...new Set(nextValidSources)]
    const timeoutId = window.setTimeout(() => {
      uniqueSources.forEach((source) => {
        setTrackPreviewState((current) => {
          if (current[source]?.status === 'ready' || current[source]?.status === 'pending') {
            return current
          }
          return {
            ...current,
            [source]: {
              status: 'pending',
              source,
            },
          }
        })

        void window.dungeonMaestro.previewTrackSource(source).then((preview) => {
          setTrackPreviewState((current) => {
            const currentPreview = current[source]
            if (!currentPreview || currentPreview.source !== source) {
              return current
            }
            return {
              ...current,
              [source]: {
                status: 'ready',
                source,
                ok: Boolean(preview?.ok),
                title: preview?.title || '',
                webpageUrl: preview?.webpage_url || '',
                durationSeconds: preview?.duration_seconds ?? null,
                message: preview?.message || '',
              },
            }
          })
        })
      })
    }, isCollectionEditing ? 350 : 0)

    return () => window.clearTimeout(timeoutId)
  }, [collectionDraft, collectionDraftValidation, isCollectionEditing, libraryFocusCollection])

  useEffect(() => {
    if (!state?.pendingTransition?.expiresAtEpoch) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setNowEpoch(Date.now() / 1000)
    }, 250)

    return () => window.clearInterval(intervalId)
  }, [state?.pendingTransition?.expiresAtEpoch])

  if (bootstrapError) {
    return (
      <div className="loading-shell error-shell">
        <div className="error-panel">
          <p className="eyebrow">Dashboard Error</p>
          <h1>Renderer bootstrap failed.</h1>
          <p className="supporting-text">{bootstrapError}</p>
        </div>
      </div>
    )
  }

  if (!bootstrap) {
    return <div className="loading-shell">Forging dashboard...</div>
  }

  const saveBotToken = async () => {
    const updated = await window.dungeonMaestro.saveBotToken(botTokenDraft)
    setBootstrap(updated)
  }

  const refreshDiscordTargets = async () => {
    const updated = await window.dungeonMaestro.refreshDiscordTargets()
    setBootstrap(updated)
  }

  const chooseDiscordGuild = async (guildId) => {
    const updated = await window.dungeonMaestro.setDiscordGuild(guildId)
    setBootstrap(updated)
  }

  const chooseDiscordVoiceChannel = async (channelId) => {
    const updated = await window.dungeonMaestro.setDiscordVoiceChannel(channelId)
    setBootstrap(updated)
  }

  const togglePinnedHud = async () => {
    await window.dungeonMaestro.togglePinnedHud()
  }

  const applyLiveSessionSettings = async (nextSettings) => {
    if (!state.sessionRunning || state.startupInProgress) {
      return
    }
    const updated = await window.dungeonMaestro.updateSessionSettings(nextSettings)
    setBootstrap(updated)
  }

  const startSession = async () => {
    if (state.sessionRunning || state.startupInProgress || sessionActionPending) {
      return
    }
    setSessionActionPending(true)
    try {
      const updated = await window.dungeonMaestro.startSession({
        startingCollection: startingCollection || null,
        outputMode,
        transcriptionEnabled,
        transcriptionProfile,
        transitionProposalsEnabled: transcriptionEnabled && transitionProposalsEnabled,
        transitionTimeoutSeconds,
        volumePercent: playbackVolumePercent,
        muted: playbackMuted,
        paused: false,
      })
      setBootstrap(updated)
    } finally {
      setSessionActionPending(false)
    }
  }

  const endSession = async () => {
    if ((!state.sessionRunning && !state.startupInProgress) || sessionActionPending) {
      return
    }
    setSessionActionPending(true)
    try {
      const updated = await window.dungeonMaestro.endSession()
      setBootstrap(updated)
    } finally {
      setSessionActionPending(false)
    }
  }

  const skipTrack = async () => {
    const updated = await window.dungeonMaestro.skipTrack()
    setBootstrap(updated)
  }

  const approveTransition = async () => {
    const updated = await window.dungeonMaestro.approveTransition()
    setBootstrap(updated)
  }

  const dismissTransition = async () => {
    const updated = await window.dungeonMaestro.dismissTransition()
    setBootstrap(updated)
  }

  const applyPlaybackSettings = async (nextSettings) => {
    if (!state.sessionRunning || state.startupInProgress) {
      return
    }
    const updated = await window.dungeonMaestro.updatePlaybackSettings(nextSettings)
    setBootstrap(updated)
  }

  const selectedDiscordVoiceChannel = selectedVoiceChannels.find((channel) => channel.id === settings.discordVoiceChannelId) || null
  const lastTranscript = state.lastTranscript || 'No transcript captured yet.'
  const lastError = state.lastError || 'No active errors.'
  const activeOutputMode = state.outputMode || outputMode || settings.outputMode || 'local'
  const isSessionStarting = state.startupInProgress
  const isSessionBusy = sessionActionPending || state.startupInProgress
  const isSessionActive = state.sessionRunning || state.startupInProgress
  const playbackStatusLabel = playbackMuted ? 'Muted' : `${playbackVolumePercent}%`
  const playbackRouteLabel = activeOutputMode === 'discord'
    ? (selectedGuild && selectedDiscordVoiceChannel ? `${selectedGuild.name} / ${selectedDiscordVoiceChannel.name}` : 'Discord output')
    : 'Local speakers'
  const transportStateLabel = playbackPaused ? 'Paused' : playbackMuted ? 'Muted' : playbackRouteLabel
  const sessionStatusLabel = isSessionStarting ? 'Preparing' : state.sessionRunning ? 'Connected' : 'Idle'
  const sessionStatusClass = isSessionStarting ? 'preparing' : state.sessionRunning ? 'online' : 'idle'
  const pendingExpiresAtEpoch = state.pendingTransition?.expiresAtEpoch ?? null
  const transitionRemainingSeconds = pendingExpiresAtEpoch ? Math.max(0, pendingExpiresAtEpoch - nowEpoch) : 0
  const transitionProgress = pendingExpiresAtEpoch
    ? Math.max(0, Math.min(1, transitionRemainingSeconds / Math.max(transitionTimeoutSeconds, 1)))
    : 0

  const handleTranscriptionToggle = (event) => {
    const enabled = event.target.checked
    setTranscriptionEnabled(enabled)
    if (!enabled) {
      setTransitionProposalsEnabled(false)
    }
    void applyLiveSessionSettings({
      transcriptionEnabled: enabled,
      transcriptionProfile,
      transitionProposalsEnabled: enabled ? transitionProposalsEnabled : false,
      transitionTimeoutSeconds,
    })
  }

  const handleTranscriptionProfileChange = (event) => {
    const nextProfile = event.target.value
    setTranscriptionProfile(nextProfile)
    void applyLiveSessionSettings({
      transcriptionProfile: nextProfile,
    })
  }

  const handleOutputModeChange = async (event) => {
    const nextMode = event.target.value === 'discord' ? 'discord' : 'local'
    setOutputMode(nextMode)
    const updated = await window.dungeonMaestro.setOutputMode(nextMode)
    setBootstrap(updated)
  }

  const handleTransitionProposalToggle = (event) => {
    const enabled = event.target.checked
    setTransitionProposalsEnabled(enabled)
    void applyLiveSessionSettings({
      transitionProposalsEnabled: enabled,
      transitionTimeoutSeconds,
    })
  }

  const handleTransitionTimeoutChange = (event) => {
    const rawValue = Number.parseInt(event.target.value, 10)
    if (Number.isFinite(rawValue)) {
      const nextValue = Math.min(300, Math.max(5, rawValue))
      setTransitionTimeoutSeconds(nextValue)
      void applyLiveSessionSettings({
        transitionTimeoutSeconds: nextValue,
      })
    }
  }

  const handlePlaybackVolumeChange = (event) => {
    const nextValue = Math.min(100, Math.max(0, Number.parseInt(event.target.value, 10) || 0))
    setPlaybackVolumePercent(nextValue)
    void applyPlaybackSettings({ volumePercent: nextValue })
  }

  const togglePlaybackMute = async () => {
    const nextMuted = !playbackMuted
    setPlaybackMuted(nextMuted)
    const updated = await window.dungeonMaestro.updatePlaybackSettings({ muted: nextMuted })
    setBootstrap(updated)
  }

  const togglePlaybackPause = async () => {
    const nextPaused = !playbackPaused
    setPlaybackPaused(nextPaused)
    const updated = await window.dungeonMaestro.updatePlaybackSettings({ paused: nextPaused })
    setBootstrap(updated)
  }

  const selectLibraryCollection = (collectionId) => {
    if (isCollectionEditing && collectionId !== selectedLibraryCollectionId) {
      return
    }
    setSelectedLibraryCollectionId(collectionId)
  }

  const startCollectionEdit = () => {
    if (!libraryFocusCollection) {
      return
    }
    setCollectionDraft(createCollectionDraft(libraryFocusCollection))
    setCollectionEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
    setIsCollectionEditing(true)
  }

  const cancelCollectionEdit = () => {
    if (pendingNewCollectionId && libraryFocusCollection?.collectionId === pendingNewCollectionId) {
      setPendingNewCollectionId('')
      setCollectionDraft(null)
      setSelectedLibraryCollectionId(activeCollection?.collectionId || collections[0]?.collectionId || '')
    } else {
      setCollectionDraft(createCollectionDraft(libraryFocusCollection))
    }
    setCollectionEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
    setIsCollectionEditing(false)
  }

  const startNewCollection = () => {
    if (isCollectionEditing) {
      return
    }
    setNewCollectionIdDraft('')
    setNewCollectionPromptError('')
    setIsCreateCollectionPromptOpen(true)
  }

  const cancelCreateCollectionPrompt = () => {
    setIsCreateCollectionPromptOpen(false)
    setNewCollectionIdDraft('')
    setNewCollectionPromptError('')
  }

  const confirmCreateCollection = () => {
    const nextCollectionId = newCollectionIdDraft.trim()
    if (!nextCollectionId) {
      setNewCollectionPromptError('Collection id cannot be empty.')
      return
    }

    if (effectiveCollections.some((collection) => collection.collectionId.toLowerCase() === nextCollectionId.toLowerCase())) {
      setNewCollectionPromptError(`Collection id "${nextCollectionId}" is already taken.`)
      return
    }

    const draft = createNewCollectionDraft(nextCollectionId)
    setPendingNewCollectionId(nextCollectionId)
    setCollectionDraft(draft)
    setSelectedLibraryCollectionId(nextCollectionId)
    setCollectionEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
    setIsCollectionEditing(true)
    setIsCreateCollectionPromptOpen(false)
    setNewCollectionIdDraft('')
    setNewCollectionPromptError('')
  }

  const updateCollectionDraftField = (field, value) => {
    setCollectionDraft((currentDraft) => ({
      ...(currentDraft || createCollectionDraft(libraryFocusCollection)),
      [field]: value,
    }))
    setCollectionEditorError('')
  }

  const updateKeywordAtIndex = (index, value) => {
    setCollectionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      const keywords = [...currentDraft.keywords]
      keywords[index] = value
      return { ...currentDraft, keywords }
    })
    setCollectionEditorError('')
  }

  const removeKeywordAtIndex = (index) => {
    setCollectionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      return {
        ...currentDraft,
        keywords: currentDraft.keywords.filter((_, keywordIndex) => keywordIndex !== index),
      }
    })
    setCollectionEditorError('')
  }

  const addKeywordToDraft = () => {
    if (!collectionDraft) {
      return
    }
    setCollectionDraft({
      ...collectionDraft,
      keywords: [...collectionDraft.keywords, newKeywordDraft],
    })
    setNewKeywordDraft('')
    setCollectionEditorError('')
  }

  const updateTrackAtIndex = (index, value) => {
    setCollectionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      const tracks = [...currentDraft.tracks]
      tracks[index] = value
      return { ...currentDraft, tracks }
    })
    setCollectionEditorError('')
  }

  const removeTrackAtIndex = (index) => {
    setCollectionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      return {
        ...currentDraft,
        tracks: currentDraft.tracks.filter((_, trackIndex) => trackIndex !== index),
      }
    })
    setCollectionEditorError('')
  }

  const addTrackToDraft = () => {
    if (!collectionDraft) {
      return
    }
    setCollectionDraft({
      ...collectionDraft,
      tracks: [...collectionDraft.tracks, newTrackDraft],
    })
    setNewTrackDraft('')
    setCollectionEditorError('')
  }

  const saveCollectionEdit = async () => {
    if (!collectionDraftValidation.isValid || !collectionDraftValidation.normalized) {
      setCollectionEditorError('Resolve the validation issues before saving this collection.')
      return
    }

    setCollectionSavePending(true)
    setCollectionEditorError('')
    try {
      const updated = await window.dungeonMaestro.saveCollectionEdits(
        collectionDraftValidation.normalized.collectionId,
        collectionDraftValidation.normalized,
      )
      setBootstrap(updated)
      setPendingNewCollectionId('')
      const updatedCollection = updated.config.collections.find((collection) => collection.collectionId === collectionDraftValidation.normalized.collectionId) || null
      setCollectionDraft(createCollectionDraft(updatedCollection))
      setSelectedLibraryCollectionId(collectionDraftValidation.normalized.collectionId)
      setIsCollectionEditing(false)
      setNewKeywordDraft('')
      setNewTrackDraft('')
    } catch (error) {
      setCollectionEditorError(error?.message || String(error))
    } finally {
      setCollectionSavePending(false)
    }
  }

  const deleteCollection = async () => {
    const targetCollectionId = libraryFocusCollection?.collectionId || ''
    if (!targetCollectionId || pendingNewCollectionId === targetCollectionId) {
      return
    }

    setCollectionSavePending(true)
    setCollectionEditorError('')
    try {
      const updated = await window.dungeonMaestro.deleteCollection(targetCollectionId)
      const fallbackCollectionId = updated.config.settings.default_collection || updated.config.collections[0]?.collectionId || ''
      const fallbackCollection = updated.config.collections.find((collection) => collection.collectionId === fallbackCollectionId) || null
      const nextStartingCollection = updated.config.collections.some((collection) => collection.collectionId === startingCollection)
        ? startingCollection
        : fallbackCollectionId

      setBootstrap(updated)
      setStartingCollection(nextStartingCollection)
      setPendingNewCollectionId('')
      setSelectedLibraryCollectionId(fallbackCollectionId)
      setCollectionDraft(fallbackCollection ? createCollectionDraft(fallbackCollection) : null)
      setIsCollectionEditing(false)
      setNewKeywordDraft('')
      setNewTrackDraft('')
    } catch (error) {
      setCollectionEditorError(error?.message || String(error))
    } finally {
      setCollectionSavePending(false)
    }
  }

  if (isHudWindow) {
    return (
      <PinnedHud
        activeCollection={activeCollection}
        approveTransition={approveTransition}
        dismissTransition={dismissTransition}
        icons={ICONS}
        isSessionActive={isSessionActive}
        isSessionStarting={isSessionStarting}
        outputMode={activeOutputMode}
        playbackMuted={playbackMuted}
        playbackPaused={playbackPaused}
        playbackVolumePercent={playbackVolumePercent}
        skipTrack={skipTrack}
        state={state}
        togglePinnedHud={togglePinnedHud}
        togglePlaybackMute={togglePlaybackMute}
        togglePlaybackPause={togglePlaybackPause}
        transitionProgress={transitionProgress}
        onPlaybackVolumeChange={handlePlaybackVolumeChange}
      />
    )
  }

  return (
    <DashboardWindow
      activeCollection={activeCollection}
      approveTransition={approveTransition}
      bootstrap={bootstrap}
      botTokenDraft={botTokenDraft}
      chooseDiscordGuild={chooseDiscordGuild}
      chooseDiscordVoiceChannel={chooseDiscordVoiceChannel}
      collections={effectiveCollections}
      createCollection={startNewCollection}
      cancelCreateCollectionPrompt={cancelCreateCollectionPrompt}
      confirmCreateCollection={confirmCreateCollection}
      dismissTransition={dismissTransition}
      discordTargets={discordTargets}
      endSession={endSession}
      handleOutputModeChange={handleOutputModeChange}
      handlePlaybackVolumeChange={handlePlaybackVolumeChange}
      handleTransitionProposalToggle={handleTransitionProposalToggle}
      handleTransitionTimeoutChange={handleTransitionTimeoutChange}
      handleTranscriptionToggle={handleTranscriptionToggle}
      isSessionActive={isSessionActive}
      isSessionBusy={isSessionBusy}
      isSessionStarting={isSessionStarting}
      lastError={lastError}
      lastTranscript={lastTranscript}
      libraryFocusCollection={libraryFocusCollection}
      collectionDraft={collectionDraft}
      collectionDraftValidation={collectionDraftValidation}
      collectionEditorError={collectionEditorError}
      collectionSavePending={collectionSavePending}
      trackPreviewState={trackPreviewState}
      playbackMuted={playbackMuted}
      playbackPaused={playbackPaused}
      playbackRouteLabel={playbackRouteLabel}
      playbackStatusLabel={playbackStatusLabel}
      playbackVolumePercent={playbackVolumePercent}
      filteredCollections={filteredCollections}
      isCollectionEditing={isCollectionEditing}
      librarySearchQuery={librarySearchQuery}
      newKeywordDraft={newKeywordDraft}
      newCollectionIdDraft={newCollectionIdDraft}
      newCollectionPromptError={newCollectionPromptError}
      newTrackDraft={newTrackDraft}
      outputMode={activeOutputMode}
      refreshDiscordTargets={refreshDiscordTargets}
      saveBotToken={saveBotToken}
      saveCollectionEdit={saveCollectionEdit}
      selectedDiscordVoiceChannel={selectedDiscordVoiceChannel}
      selectedGuild={selectedGuild}
      selectedLibraryCollectionId={selectedLibraryCollectionId}
      selectLibraryCollection={selectLibraryCollection}
      selectedVoiceChannels={selectedVoiceChannels}
      sessionStatusClass={sessionStatusClass}
      sessionStatusLabel={sessionStatusLabel}
      setCollectionDraftField={updateCollectionDraftField}
      setBotTokenDraft={setBotTokenDraft}
      setNewCollectionIdDraft={setNewCollectionIdDraft}
      setNewKeywordDraft={setNewKeywordDraft}
      setNewTrackDraft={setNewTrackDraft}
      setLibrarySearchQuery={setLibrarySearchQuery}
      setStartingCollection={setStartingCollection}
      setWorkspaceTab={setWorkspaceTab}
      startCollectionEdit={startCollectionEdit}
      cancelCollectionEdit={cancelCollectionEdit}
      deleteCollection={deleteCollection}
      addKeywordToDraft={addKeywordToDraft}
      removeKeywordAtIndex={removeKeywordAtIndex}
      updateKeywordAtIndex={updateKeywordAtIndex}
      addTrackToDraft={addTrackToDraft}
      removeTrackAtIndex={removeTrackAtIndex}
      updateTrackAtIndex={updateTrackAtIndex}
      settings={settings}
      skipTrack={skipTrack}
      startSession={startSession}
      startingCollection={startingCollection}
      state={state}
      togglePinnedHud={togglePinnedHud}
      togglePlaybackMute={togglePlaybackMute}
      togglePlaybackPause={togglePlaybackPause}
      transcriptionEnabled={transcriptionEnabled}
      transcriptionProfile={transcriptionProfile}
      handleTranscriptionProfileChange={handleTranscriptionProfileChange}
      isCreateCollectionPromptOpen={isCreateCollectionPromptOpen}
      transitionProgress={transitionProgress}
      transitionProposalsEnabled={transitionProposalsEnabled}
      transitionTimeoutSeconds={transitionTimeoutSeconds}
      transportStateLabel={transportStateLabel}
      workspaceTab={workspaceTab}
    />
  )
}

export default App