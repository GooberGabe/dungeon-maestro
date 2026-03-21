import { useEffect, useMemo, useState } from 'react'

import DashboardWindow from './components/DashboardWindow'
import PinnedHud from './components/PinnedHud'
import { ICONS, VIEW_MODE, getActiveSoundscapeId, getDefaultSoundscapeId, getSoundscapeId, getSoundscapeList } from './constants'
import { createNewSoundscapeDraft, createSoundscapeDraft, validateSoundscapeDraft } from './libraryEditor'

function App() {
  const [bootstrap, setBootstrap] = useState(null)
  const [botTokenDraft, setBotTokenDraft] = useState('')
  const [selectedLibrarySoundscapeId, setSelectedLibrarySoundscapeId] = useState('')
  const [librarySearchQuery, setLibrarySearchQuery] = useState('')
  const [openedCollectionId, setOpenedCollectionId] = useState('')
  const [collectionSearchQuery, setCollectionSearchQuery] = useState('')
  const [soundscapeDraft, setSoundscapeDraft] = useState(null)
  const [pendingNewSoundscapeId, setPendingNewSoundscapeId] = useState('')
  const [isCreateCollectionPromptOpen, setIsCreateCollectionPromptOpen] = useState(false)
  const [newSoundscapeNameDraft, setNewSoundscapeNameDraft] = useState('')
  const [newSoundscapePromptError, setNewSoundscapePromptError] = useState('')
  const [isUseSoundscapeDialogOpen, setIsUseSoundscapeDialogOpen] = useState(false)
  const [isAddCollectionSoundscapesDialogOpen, setIsAddCollectionSoundscapesDialogOpen] = useState(false)
  const [collectionPickerSearchQuery, setCollectionPickerSearchQuery] = useState('')
  const [collectionSoundscapeSearchQuery, setCollectionSoundscapeSearchQuery] = useState('')
  const [newSessionCollectionNameDraft, setNewSessionCollectionNameDraft] = useState('')
  const [collectionActionError, setCollectionActionError] = useState('')
  const [soundscapeUseTargetId, setSoundscapeUseTargetId] = useState('')
  const [isSoundscapeEditing, setIsSoundscapeEditing] = useState(false)
  const [soundscapeEditorError, setSoundscapeEditorError] = useState('')
  const [soundscapeSavePending, setSoundscapeSavePending] = useState(false)
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
  const [crossfadeEnabled, setCrossfadeEnabled] = useState(false)
  const [crossfadeDurationSeconds, setCrossfadeDurationSeconds] = useState(3.0)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [crossfadePauseEnabled, setCrossfadePauseEnabled] = useState(false)
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
        const activeSoundscapeId = getActiveSoundscapeId(data.state, data)
        setBootstrap(data)
        setOutputMode(data.state.outputMode || data.settings.outputMode || 'local')
        setBotTokenDraft(data.settings.botToken || '')
        setSelectedLibrarySoundscapeId(activeSoundscapeId)
        setTransitionProposalsEnabled(data.config.settings.enable_transition_proposals !== false)
        setTranscriptionProfile(data.state.transcriptionProfile || data.config.settings.transcription_profile || 'fast')
        setTransitionTimeoutSeconds(Number(data.config.settings.transition_popup_timeout || 30))
        setPlaybackVolumePercent(Number(data.state.volumePercent ?? 100))
        setPlaybackMuted(Boolean(data.state.playbackMuted))
        setPlaybackPaused(Boolean(data.state.playbackPaused))
        setCrossfadeEnabled(Boolean(data.state.crossfadeEnabled))
        setCrossfadeDurationSeconds(Number(data.state.crossfadeDurationSeconds ?? 3.0))
        setLoopEnabled(Boolean(data.state.loopEnabled))
        setCrossfadePauseEnabled(Boolean(data.state.crossfadePauseEnabled))
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
        setCrossfadeEnabled(Boolean(data.state.crossfadeEnabled))
        setCrossfadeDurationSeconds(Number(data.state.crossfadeDurationSeconds ?? 3.0))
        setLoopEnabled(Boolean(data.state.loopEnabled))
        setCrossfadePauseEnabled(Boolean(data.state.crossfadePauseEnabled))
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

  const soundscapes = getSoundscapeList(bootstrap)
  const collections = bootstrap?.config.collections || []
  const state = bootstrap?.state
  const settings = bootstrap?.settings
  const discordTargets = state?.discordTargets || []
  const effectiveSoundscapes = useMemo(() => {
    if (!pendingNewSoundscapeId || soundscapes.some((soundscape) => getSoundscapeId(soundscape) === pendingNewSoundscapeId)) {
      return soundscapes
    }

    const draft = soundscapeDraft || createNewSoundscapeDraft(pendingNewSoundscapeId)
    return [
      {
        soundscapeId: pendingNewSoundscapeId,
        collectionId: pendingNewSoundscapeId,
        name: draft.name,
        keywords: draft.keywords,
        tracks: draft.tracks.map((source) => ({ source, preview: null })),
        trackCount: draft.tracks.length,
        playbackMode: 'sequential_loop',
        isDraft: true,
      },
      ...soundscapes,
    ]
  }, [pendingNewSoundscapeId, soundscapeDraft, soundscapes])

  const selectedGuild = useMemo(
    () => discordTargets.find((guild) => guild.id === settings?.discordGuildId) || null,
    [discordTargets, settings?.discordGuildId]
  )

  const selectedVoiceChannels = selectedGuild?.voice_channels || []

  const activeSoundscape = useMemo(
    () => soundscapes.find((soundscape) => {
      const activeSoundscapeId = getActiveSoundscapeId(state, bootstrap)
      return getSoundscapeId(soundscape) === activeSoundscapeId
    }),
    [bootstrap, soundscapes, state]
  )

  const selectedLibrarySoundscape = useMemo(
    () => effectiveSoundscapes.find((soundscape) => getSoundscapeId(soundscape) === selectedLibrarySoundscapeId) || null,
    [effectiveSoundscapes, selectedLibrarySoundscapeId]
  )

  const libraryFocusSoundscape = selectedLibrarySoundscape || activeSoundscape || effectiveSoundscapes[0] || null

  const soundscapeDraftValidation = useMemo(
    () => validateSoundscapeDraft(soundscapeDraft || createSoundscapeDraft(libraryFocusSoundscape)),
    [libraryFocusSoundscape, soundscapeDraft]
  )

  const filteredSoundscapes = useMemo(() => {
    const query = librarySearchQuery.trim().toLowerCase()
    if (!query) {
      return effectiveSoundscapes
    }

    return effectiveSoundscapes.filter((soundscape) => {
      const searchableParts = [
        soundscape.name,
        ...(soundscape.keywords || []),
      ]
      return searchableParts.some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [effectiveSoundscapes, librarySearchQuery])

  const filteredCollections = useMemo(() => {
    const query = collectionSearchQuery.trim().toLowerCase()
    if (!query) {
      return collections
    }

    return collections.filter((collection) => {
      return collection.name.toLowerCase().includes(query)
    })
  }, [collectionSearchQuery, collections])

  const openedCollection = useMemo(
    () => collections.find((collection) => collection.collectionId === openedCollectionId) || null,
    [collections, openedCollectionId],
  )

  const openedCollectionSoundscapes = useMemo(() => {
    if (!openedCollection) {
      return []
    }
    const soundscapeMap = new Map(soundscapes.map((soundscape) => [getSoundscapeId(soundscape), soundscape]))
    return (openedCollection.soundscapeIds || []).map((soundscapeId) => soundscapeMap.get(soundscapeId)).filter(Boolean)
  }, [openedCollection, soundscapes])

  const useTargetSoundscape = useMemo(
    () => soundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeUseTargetId) || null,
    [soundscapeUseTargetId, soundscapes],
  )

  const filteredCollectionPickerOptions = useMemo(() => {
    const query = collectionPickerSearchQuery.trim().toLowerCase()
    if (!query) {
      return collections
    }

    return collections.filter((collection) => collection.name.toLowerCase().includes(query))
  }, [collectionPickerSearchQuery, collections])

  const addableCollectionSoundscapes = useMemo(() => {
    if (!openedCollection) {
      return []
    }

    const existingSoundscapeIds = new Set(openedCollection.soundscapeIds || [])
    const query = collectionSoundscapeSearchQuery.trim().toLowerCase()
    return soundscapes.filter((soundscape) => {
      const soundscapeId = getSoundscapeId(soundscape)
      if (!soundscapeId || existingSoundscapeIds.has(soundscapeId)) {
        return false
      }
      if (!query) {
        return true
      }
      const searchableParts = [soundscape.name, ...(soundscape.keywords || [])]
      return searchableParts.some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [collectionSoundscapeSearchQuery, openedCollection, soundscapes])

  useEffect(() => {
    if (!effectiveSoundscapes.length) {
      return
    }

    const hasSelection = effectiveSoundscapes.some((soundscape) => getSoundscapeId(soundscape) === selectedLibrarySoundscapeId)
    if (!hasSelection) {
      setSelectedLibrarySoundscapeId(getActiveSoundscapeId(state, bootstrap) || getDefaultSoundscapeId(bootstrap) || getSoundscapeId(effectiveSoundscapes[0]))
    }
  }, [bootstrap, effectiveSoundscapes, selectedLibrarySoundscapeId, state])

  useEffect(() => {
    if (!openedCollectionId) {
      return
    }
    if (!collections.some((collection) => collection.collectionId === openedCollectionId)) {
      setOpenedCollectionId('')
    }
  }, [collections, openedCollectionId])

  useEffect(() => {
    if (!soundscapes.length) {
      return
    }

    setTrackPreviewState((current) => {
      const nextState = { ...current }
      let changed = false

      effectiveSoundscapes.forEach((soundscape) => {
        ;(soundscape.tracks || []).forEach((track) => {
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
  }, [effectiveSoundscapes, soundscapes.length])

  useEffect(() => {
    if (!libraryFocusSoundscape || isSoundscapeEditing) {
      return
    }
    setSoundscapeDraft(createSoundscapeDraft(libraryFocusSoundscape))
    setSoundscapeEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
  }, [isSoundscapeEditing, libraryFocusSoundscape])

  useEffect(() => {
    const candidateSources = isSoundscapeEditing
      ? (soundscapeDraft?.tracks || [])
      : ((libraryFocusSoundscape?.tracks || []).map((track) => track.source))

    if (!candidateSources.length) {
      return undefined
    }

    const nextValidSources = []
    candidateSources.forEach((trackSource, index) => {
      const normalizedSource = String(trackSource || '').trim()
      if (!normalizedSource) {
        return
      }
      if (isSoundscapeEditing) {
        if (soundscapeDraftValidation.trackErrors[index]) {
          return
        }
        if (!soundscapeDraftValidation.trackTypes[index]?.valid) {
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
    }, isSoundscapeEditing ? 350 : 0)

    return () => window.clearTimeout(timeoutId)
  }, [isSoundscapeEditing, libraryFocusSoundscape, soundscapeDraft, soundscapeDraftValidation])

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

  const persistSoundscapeTracks = async (soundscapeId, nextTracks) => {
    const targetSoundscape = soundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeId)
    if (!targetSoundscape) {
      return
    }

    const activeSoundscapeId = getActiveSoundscapeId(state, bootstrap)
    if (state?.sessionRunning && state?.currentTrackIndex !== null && activeSoundscapeId === soundscapeId) {
      setSoundscapeEditorError('Stop playback or switch soundscapes before changing tracks in the active soundscape.')
      return
    }

    const payload = {
      soundscapeId,
      collectionId: soundscapeId,
      name: targetSoundscape.name,
      keywords: [...(targetSoundscape.keywords || [])],
      tracks: nextTracks,
    }

    const updated = await (window.dungeonMaestro.saveSoundscapeEdits
      ? window.dungeonMaestro.saveSoundscapeEdits(soundscapeId, payload)
      : window.dungeonMaestro.saveCollectionEdits(soundscapeId, payload))
    setBootstrap(updated)
  }

  const reorderSoundscapeTracks = async (soundscapeId, sourceTrackIndex, beforeTrackIndex = null) => {
    if (!soundscapeId || !Number.isInteger(sourceTrackIndex)) {
      return
    }

    const targetSoundscape = soundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeId)
    if (!targetSoundscape) {
      return
    }

    const reorderedTracks = (targetSoundscape.tracks || []).map((track) => track?.source || '')
    if (sourceTrackIndex < 0 || sourceTrackIndex >= reorderedTracks.length) {
      return
    }

    const [movedTrack] = reorderedTracks.splice(sourceTrackIndex, 1)
    let insertionIndex = reorderedTracks.length
    if (Number.isInteger(beforeTrackIndex)) {
      insertionIndex = beforeTrackIndex
      if (beforeTrackIndex > sourceTrackIndex) {
        insertionIndex -= 1
      }
      insertionIndex = Math.max(0, Math.min(reorderedTracks.length, insertionIndex))
    }
    reorderedTracks.splice(insertionIndex, 0, movedTrack)

    await persistSoundscapeTracks(soundscapeId, reorderedTracks)
  }

  const reorderCollectionSoundscapes = async (collectionId, sourceSoundscapeId, beforeSoundscapeId = null) => {
    if (!collectionId || !sourceSoundscapeId || sourceSoundscapeId === beforeSoundscapeId) {
      return
    }
    const updated = await window.dungeonMaestro.reorderCollectionSoundscapes(collectionId, sourceSoundscapeId, beforeSoundscapeId)
    setBootstrap(updated)
  }

  const deleteSessionCollection = async (collectionId) => {
    if (!collectionId || !window.dungeonMaestro.deleteSessionCollection) {
      return
    }
    const updated = await window.dungeonMaestro.deleteSessionCollection(collectionId)
    setBootstrap(updated)
  }

  const removeSoundscapeFromCollection = async (collectionId, soundscapeId) => {
    if (!collectionId || !soundscapeId || !window.dungeonMaestro.removeSoundscapeFromCollection) {
      return
    }
    const updated = await window.dungeonMaestro.removeSoundscapeFromCollection(collectionId, soundscapeId)
    setBootstrap(updated)
  }

  const moveCollectionSoundscape = async (collectionId, soundscapeId, direction) => {
    const targetCollection = collections.find((collection) => collection.collectionId === collectionId)
    const orderedIds = targetCollection?.soundscapeIds || []
    const sourceIndex = orderedIds.findIndex((id) => id === soundscapeId)
    const targetIndex = sourceIndex + direction
    if (sourceIndex === -1 || targetIndex < 0 || targetIndex >= orderedIds.length) {
      return
    }
    const beforeSoundscapeId = direction < 0
      ? orderedIds[targetIndex]
      : orderedIds[targetIndex + 1] || null
    await reorderCollectionSoundscapes(collectionId, soundscapeId, beforeSoundscapeId)
  }

  const deleteSoundscapeTrack = async (soundscapeId, trackIndex) => {
    const targetSoundscape = soundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeId)
    const currentTracks = (targetSoundscape?.tracks || []).map((track) => track?.source || '')
    if (!targetSoundscape || currentTracks.length <= 1 || trackIndex < 0 || trackIndex >= currentTracks.length) {
      return
    }
    const nextTracks = currentTracks.filter((_, index) => index !== trackIndex)
    await persistSoundscapeTracks(soundscapeId, nextTracks)
  }

  const moveSoundscapeTrack = async (soundscapeId, trackIndex, direction) => {
    const targetSoundscape = soundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeId)
    const currentTracks = (targetSoundscape?.tracks || []).map((track) => track?.source || '')
    const targetIndex = trackIndex + direction
    if (!targetSoundscape || trackIndex < 0 || targetIndex < 0 || targetIndex >= currentTracks.length) {
      return
    }
    const nextTracks = [...currentTracks]
    ;[nextTracks[trackIndex], nextTracks[targetIndex]] = [nextTracks[targetIndex], nextTracks[trackIndex]]
    await persistSoundscapeTracks(soundscapeId, nextTracks)
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

  const resumePlaybackAfterPlayAction = async (updated) => {
    if (!updated?.state?.playbackPaused) {
      return updated
    }
    setPlaybackPaused(false)
    return window.dungeonMaestro.updatePlaybackSettings({ paused: false })
  }

  const switchSoundscape = async (soundscapeId) => {
    if (!state.sessionRunning || state.startupInProgress) return
    const switched = await (window.dungeonMaestro.switchSoundscape
      ? window.dungeonMaestro.switchSoundscape(soundscapeId)
      : window.dungeonMaestro.switchCollection(soundscapeId))
    const updated = await resumePlaybackAfterPlayAction(switched)
    setBootstrap(updated)
  }

  const playSoundscapeTrackAtIndex = async (soundscapeId, trackIndex) => {
    if (!state.sessionRunning || state.startupInProgress) return
    const started = await (window.dungeonMaestro.playSoundscapeTrack
      ? window.dungeonMaestro.playSoundscapeTrack(soundscapeId, trackIndex)
      : window.dungeonMaestro.playTrack(soundscapeId, trackIndex))
    const updated = await resumePlaybackAfterPlayAction(started)
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

  const handleCrossfadeToggle = () => {
    const next = !crossfadeEnabled
    setCrossfadeEnabled(next)
    void applyPlaybackSettings({ crossfadeEnabled: next })
  }

  const handleCrossfadeDurationChange = (event) => {
    const raw = Number.parseFloat(event.target.value)
    if (!Number.isFinite(raw)) return
    const nextValue = Math.min(15, Math.max(0.5, raw))
    setCrossfadeDurationSeconds(nextValue)
    void applyPlaybackSettings({ crossfadeDurationSeconds: nextValue })
  }

  const toggleLoop = () => {
    const next = !loopEnabled
    setLoopEnabled(next)
    void applyPlaybackSettings({ loopEnabled: next })
  }

  const handleCrossfadePauseToggle = () => {
    const next = !crossfadePauseEnabled
    setCrossfadePauseEnabled(next)
    void applyPlaybackSettings({ crossfadePauseEnabled: next })
  }

  const seekTrack = async (positionSeconds) => {
    if (!state.sessionRunning || state.startupInProgress) return
    const updated = await window.dungeonMaestro.seekTrack(positionSeconds)
    setBootstrap(updated)
  }

  const selectLibrarySoundscape = (soundscapeId) => {
    if (isSoundscapeEditing && soundscapeId !== selectedLibrarySoundscapeId) {
      return
    }
    setSelectedLibrarySoundscapeId(soundscapeId)
  }

  const startSoundscapeEdit = () => {
    if (!libraryFocusSoundscape) {
      return
    }
    setSoundscapeDraft(createSoundscapeDraft(libraryFocusSoundscape))
    setSoundscapeEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
    setIsSoundscapeEditing(true)
  }

  const cancelSoundscapeEdit = () => {
    if (pendingNewSoundscapeId && getSoundscapeId(libraryFocusSoundscape) === pendingNewSoundscapeId) {
      setPendingNewSoundscapeId('')
      setSoundscapeDraft(null)
      setSelectedLibrarySoundscapeId(getSoundscapeId(activeSoundscape) || getSoundscapeId(soundscapes[0]) || '')
    } else {
      setSoundscapeDraft(createSoundscapeDraft(libraryFocusSoundscape))
    }
    setSoundscapeEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
    setIsSoundscapeEditing(false)
  }

  const startNewSoundscape = () => {
    if (isSoundscapeEditing) {
      return
    }
    setNewSoundscapeNameDraft('')
    setNewSoundscapePromptError('')
    setIsCreateCollectionPromptOpen(true)
  }

  const cancelCreateSoundscapePrompt = () => {
    setIsCreateCollectionPromptOpen(false)
    setNewSoundscapeNameDraft('')
    setNewSoundscapePromptError('')
  }

  const resetCollectionDialogs = () => {
    setCollectionPickerSearchQuery('')
    setCollectionSoundscapeSearchQuery('')
    setNewSessionCollectionNameDraft('')
    setCollectionActionError('')
  }

  const openUseSoundscapeDialog = () => {
    if (!libraryFocusSoundscape) {
      return
    }
    setSoundscapeUseTargetId(getSoundscapeId(libraryFocusSoundscape))
    resetCollectionDialogs()
    setIsUseSoundscapeDialogOpen(true)
  }

  const closeUseSoundscapeDialog = () => {
    setIsUseSoundscapeDialogOpen(false)
    setSoundscapeUseTargetId('')
    resetCollectionDialogs()
  }

  const openAddCollectionSoundscapesDialog = () => {
    if (!openedCollection) {
      return
    }
    setCollectionSoundscapeSearchQuery('')
    setCollectionActionError('')
    setIsAddCollectionSoundscapesDialogOpen(true)
  }

  const closeAddCollectionSoundscapesDialog = () => {
    setIsAddCollectionSoundscapesDialogOpen(false)
    setCollectionSoundscapeSearchQuery('')
    setCollectionActionError('')
  }

  const createSessionCollection = async (collectionName) => {
    const updated = await window.dungeonMaestro.createSessionCollection(collectionName)
    setBootstrap(updated)
    const createdCollection = (updated.config.collections || []).find(
      (collection) => collection.name.toLowerCase() === collectionName.trim().toLowerCase(),
    )
    if (!createdCollection) {
      throw new Error('Collection was created but could not be reloaded.')
    }
    return { updated, collectionId: createdCollection.collectionId }
  }

  const assignSoundscapeToCollection = async (collectionId, soundscapeId) => {
    const updated = await window.dungeonMaestro.addSoundscapeToCollection(collectionId, soundscapeId)
    setBootstrap(updated)
    setOpenedCollectionId(collectionId)
    return updated
  }

  const createCollectionAndUseSoundscape = async () => {
    if (!soundscapeUseTargetId) {
      return
    }
    setCollectionActionError('')
    try {
      const { collectionId } = await createSessionCollection(newSessionCollectionNameDraft)
      await assignSoundscapeToCollection(collectionId, soundscapeUseTargetId)
      closeUseSoundscapeDialog()
    } catch (error) {
      setCollectionActionError(error?.message || String(error))
    }
  }

  const useSoundscapeInCollection = async (collectionId) => {
    if (!soundscapeUseTargetId) {
      return
    }
    setCollectionActionError('')
    try {
      await assignSoundscapeToCollection(collectionId, soundscapeUseTargetId)
      closeUseSoundscapeDialog()
    } catch (error) {
      setCollectionActionError(error?.message || String(error))
    }
  }

  const createCollectionFromControls = async () => {
    setCollectionActionError('')
    try {
      const { collectionId } = await createSessionCollection(newSessionCollectionNameDraft)
      setOpenedCollectionId(collectionId)
      resetCollectionDialogs()
    } catch (error) {
      setCollectionActionError(error?.message || String(error))
    }
  }

  const addSoundscapeToOpenedCollection = async (soundscapeId) => {
    if (!openedCollection) {
      return
    }
    setCollectionActionError('')
    try {
      await assignSoundscapeToCollection(openedCollection.collectionId, soundscapeId)
      closeAddCollectionSoundscapesDialog()
    } catch (error) {
      setCollectionActionError(error?.message || String(error))
    }
  }

  const confirmCreateSoundscape = () => {
    const nextSoundscapeName = newSoundscapeNameDraft.trim()
    if (!nextSoundscapeName) {
      setNewSoundscapePromptError('Soundscape name cannot be empty.')
      return
    }

    if (effectiveSoundscapes.some((soundscape) => soundscape.name.toLowerCase() === nextSoundscapeName.toLowerCase())) {
      setNewSoundscapePromptError(`A soundscape named "${nextSoundscapeName}" already exists.`)
      return
    }

    const draft = createNewSoundscapeDraft(nextSoundscapeName)
    const nextSoundscapeId = getSoundscapeId(draft)
    setPendingNewSoundscapeId(nextSoundscapeId)
    setSoundscapeDraft(draft)
    setSelectedLibrarySoundscapeId(nextSoundscapeId)
    setSoundscapeEditorError('')
    setNewKeywordDraft('')
    setNewTrackDraft('')
    setIsSoundscapeEditing(true)
    setIsCreateCollectionPromptOpen(false)
    setNewSoundscapeNameDraft('')
    setNewSoundscapePromptError('')
  }

  const updateSoundscapeDraftField = (field, value) => {
    setSoundscapeDraft((currentDraft) => ({
      ...(currentDraft || createSoundscapeDraft(libraryFocusSoundscape)),
      [field]: value,
    }))
    setSoundscapeEditorError('')
  }

  const updateKeywordAtIndex = (index, value) => {
    setSoundscapeDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      const keywords = [...currentDraft.keywords]
      keywords[index] = value
      return { ...currentDraft, keywords }
    })
    setSoundscapeEditorError('')
  }

  const removeKeywordAtIndex = (index) => {
    setSoundscapeDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      return {
        ...currentDraft,
        keywords: currentDraft.keywords.filter((_, keywordIndex) => keywordIndex !== index),
      }
    })
    setSoundscapeEditorError('')
  }

  const addKeywordToDraft = () => {
    if (!soundscapeDraft) {
      return
    }
    setSoundscapeDraft({
      ...soundscapeDraft,
      keywords: [...soundscapeDraft.keywords, newKeywordDraft],
    })
    setNewKeywordDraft('')
    setSoundscapeEditorError('')
  }

  const updateTrackAtIndex = (index, value) => {
    setSoundscapeDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      const tracks = [...currentDraft.tracks]
      tracks[index] = value
      return { ...currentDraft, tracks }
    })
    setSoundscapeEditorError('')
  }

  const removeTrackAtIndex = (index) => {
    setSoundscapeDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      return {
        ...currentDraft,
        tracks: currentDraft.tracks.filter((_, trackIndex) => trackIndex !== index),
      }
    })
    setSoundscapeEditorError('')
  }

  const moveDraftTrackAtIndex = (trackIndex, direction) => {
    setSoundscapeDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft
      }
      const targetIndex = trackIndex + direction
      if (targetIndex < 0 || targetIndex >= currentDraft.tracks.length) {
        return currentDraft
      }
      const tracks = [...currentDraft.tracks]
      ;[tracks[trackIndex], tracks[targetIndex]] = [tracks[targetIndex], tracks[trackIndex]]
      return { ...currentDraft, tracks }
    })
    setSoundscapeEditorError('')
  }

  const addTrackToDraft = () => {
    if (!soundscapeDraft) {
      return
    }
    setSoundscapeDraft({
      ...soundscapeDraft,
      tracks: [...soundscapeDraft.tracks, newTrackDraft],
    })
    setNewTrackDraft('')
    setSoundscapeEditorError('')
  }

  const saveSoundscapeEdit = async () => {
    if (!soundscapeDraftValidation.isValid || !soundscapeDraftValidation.normalized) {
      setSoundscapeEditorError('Resolve the validation issues before saving this soundscape.')
      return
    }

    const activeSoundscapeId = getActiveSoundscapeId(state, bootstrap)
    const targetSoundscape = soundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeDraftValidation.normalized.soundscapeId)
    const currentTracks = (targetSoundscape?.tracks || []).map((track) => track?.source || '')
    const nextTracks = soundscapeDraftValidation.normalized.tracks || []
    const tracksChanged = currentTracks.length !== nextTracks.length || currentTracks.some((track, index) => track !== nextTracks[index])

    if (tracksChanged && state?.sessionRunning && state?.currentTrackIndex !== null && activeSoundscapeId === soundscapeDraftValidation.normalized.soundscapeId) {
      setSoundscapeEditorError('Stop playback or switch soundscapes before changing tracks in the active soundscape.')
      return
    }

    setSoundscapeSavePending(true)
    setSoundscapeEditorError('')
    try {
      const updated = await (window.dungeonMaestro.saveSoundscapeEdits
        ? window.dungeonMaestro.saveSoundscapeEdits(
          soundscapeDraftValidation.normalized.soundscapeId,
          soundscapeDraftValidation.normalized,
        )
        : window.dungeonMaestro.saveCollectionEdits(
        soundscapeDraftValidation.normalized.soundscapeId,
        soundscapeDraftValidation.normalized,
        ))
      setBootstrap(updated)
      setPendingNewSoundscapeId('')
      const updatedSoundscapes = updated.config.soundscapes || []
      const updatedSoundscape = updatedSoundscapes.find((soundscape) => getSoundscapeId(soundscape) === soundscapeDraftValidation.normalized.soundscapeId) || null
      setSoundscapeDraft(createSoundscapeDraft(updatedSoundscape))
      setSelectedLibrarySoundscapeId(soundscapeDraftValidation.normalized.soundscapeId)
      setIsSoundscapeEditing(false)
      setNewKeywordDraft('')
      setNewTrackDraft('')
    } catch (error) {
      setSoundscapeEditorError(error?.message || String(error))
    } finally {
      setSoundscapeSavePending(false)
    }
  }

  const deleteSoundscape = async (soundscapeId = getSoundscapeId(libraryFocusSoundscape)) => {
    const targetSoundscapeId = soundscapeId
    if (!targetSoundscapeId || pendingNewSoundscapeId === targetSoundscapeId) {
      return
    }

    setSoundscapeSavePending(true)
    setSoundscapeEditorError('')
    try {
      const updated = await (window.dungeonMaestro.deleteSoundscape
        ? window.dungeonMaestro.deleteSoundscape(targetSoundscapeId)
        : window.dungeonMaestro.deleteCollection(targetSoundscapeId))
      const updatedSoundscapes = updated.config.soundscapes || []
      const fallbackSoundscapeId = getDefaultSoundscapeId(updated)
      const fallbackSoundscape = updatedSoundscapes.find((soundscape) => getSoundscapeId(soundscape) === fallbackSoundscapeId) || null

      setBootstrap(updated)
      setPendingNewSoundscapeId('')
      setSelectedLibrarySoundscapeId(fallbackSoundscapeId)
      setSoundscapeDraft(fallbackSoundscape ? createSoundscapeDraft(fallbackSoundscape) : null)
      setIsSoundscapeEditing(false)
      setNewKeywordDraft('')
      setNewTrackDraft('')
    } catch (error) {
      setSoundscapeEditorError(error?.message || String(error))
    } finally {
      setSoundscapeSavePending(false)
    }
  }

  if (isHudWindow) {
    return (
      <PinnedHud
        activeSoundscape={activeSoundscape}
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
      activeSoundscape={activeSoundscape}
      approveTransition={approveTransition}
      bootstrap={bootstrap}
      botTokenDraft={botTokenDraft}
      chooseDiscordGuild={chooseDiscordGuild}
      chooseDiscordVoiceChannel={chooseDiscordVoiceChannel}
      soundscapes={effectiveSoundscapes}
      createSoundscape={startNewSoundscape}
      cancelCreateSoundscapePrompt={cancelCreateSoundscapePrompt}
      confirmCreateSoundscape={confirmCreateSoundscape}
      crossfadeDurationSeconds={crossfadeDurationSeconds}
      crossfadeEnabled={crossfadeEnabled}
      crossfadePauseEnabled={crossfadePauseEnabled}
      dismissTransition={dismissTransition}
      discordTargets={discordTargets}
      endSession={endSession}
      handleCrossfadeDurationChange={handleCrossfadeDurationChange}
      handleCrossfadePauseToggle={handleCrossfadePauseToggle}
      handleCrossfadeToggle={handleCrossfadeToggle}
      handleOutputModeChange={handleOutputModeChange}
      handlePlaybackVolumeChange={handlePlaybackVolumeChange}
      handleTransitionProposalToggle={handleTransitionProposalToggle}
      handleTransitionTimeoutChange={handleTransitionTimeoutChange}
      handleTranscriptionToggle={handleTranscriptionToggle}
      collectionActionError={collectionActionError}
      collectionPickerSearchQuery={collectionPickerSearchQuery}
      collectionSoundscapeSearchQuery={collectionSoundscapeSearchQuery}
      collectionSearchQuery={collectionSearchQuery}
      collections={collections}
      createCollectionAndUseSoundscape={createCollectionAndUseSoundscape}
      createCollectionFromControls={createCollectionFromControls}
      currentCollectionSoundscapes={openedCollectionSoundscapes}
      filteredCollectionPickerOptions={filteredCollectionPickerOptions}
      filteredCollections={filteredCollections}
      addableCollectionSoundscapes={addableCollectionSoundscapes}
      addSoundscapeToOpenedCollection={addSoundscapeToOpenedCollection}
      closeAddCollectionSoundscapesDialog={closeAddCollectionSoundscapesDialog}
      closeUseSoundscapeDialog={closeUseSoundscapeDialog}
      isSessionActive={isSessionActive}
      isSessionBusy={isSessionBusy}
      isSessionStarting={isSessionStarting}
      isAddCollectionSoundscapesDialogOpen={isAddCollectionSoundscapesDialogOpen}
      isUseSoundscapeDialogOpen={isUseSoundscapeDialogOpen}
      lastError={lastError}
      lastTranscript={lastTranscript}
      loopEnabled={loopEnabled}
      libraryFocusSoundscape={libraryFocusSoundscape}
      soundscapeDraft={soundscapeDraft}
      soundscapeDraftValidation={soundscapeDraftValidation}
      soundscapeEditorError={soundscapeEditorError}
      soundscapeSavePending={soundscapeSavePending}
      trackPreviewState={trackPreviewState}
      playbackMuted={playbackMuted}
      playbackPaused={playbackPaused}
      playbackRouteLabel={playbackRouteLabel}
      playbackStatusLabel={playbackStatusLabel}
      playbackVolumePercent={playbackVolumePercent}
      reorderSoundscapeTracks={reorderSoundscapeTracks}
      seekTrack={seekTrack}
      filteredSoundscapes={filteredSoundscapes}
      isSoundscapeEditing={isSoundscapeEditing}
      librarySearchQuery={librarySearchQuery}
      newKeywordDraft={newKeywordDraft}
      newSessionCollectionNameDraft={newSessionCollectionNameDraft}
      newSoundscapeNameDraft={newSoundscapeNameDraft}
      newSoundscapePromptError={newSoundscapePromptError}
      newTrackDraft={newTrackDraft}
      openedCollection={openedCollection}
      openedCollectionId={openedCollectionId}
      outputMode={activeOutputMode}
      refreshDiscordTargets={refreshDiscordTargets}
      deleteSessionCollection={deleteSessionCollection}
      removeSoundscapeFromCollection={removeSoundscapeFromCollection}
      moveCollectionSoundscape={moveCollectionSoundscape}
      reorderCollectionSoundscapes={reorderCollectionSoundscapes}
      saveBotToken={saveBotToken}
      saveSoundscapeEdit={saveSoundscapeEdit}
      selectedDiscordVoiceChannel={selectedDiscordVoiceChannel}
      selectedGuild={selectedGuild}
      selectedLibrarySoundscapeId={selectedLibrarySoundscapeId}
      selectLibrarySoundscape={selectLibrarySoundscape}
      selectedVoiceChannels={selectedVoiceChannels}
      sessionStatusClass={sessionStatusClass}
      sessionStatusLabel={sessionStatusLabel}
      setSoundscapeDraftField={updateSoundscapeDraftField}
      setBotTokenDraft={setBotTokenDraft}
      setNewSoundscapeNameDraft={setNewSoundscapeNameDraft}
      setNewKeywordDraft={setNewKeywordDraft}
      setNewTrackDraft={setNewTrackDraft}
      setLibrarySearchQuery={setLibrarySearchQuery}
      setCollectionPickerSearchQuery={setCollectionPickerSearchQuery}
      setCollectionSoundscapeSearchQuery={setCollectionSoundscapeSearchQuery}
      setCollectionSearchQuery={setCollectionSearchQuery}
      setOpenedCollectionId={setOpenedCollectionId}
      setNewSessionCollectionNameDraft={setNewSessionCollectionNameDraft}
      setWorkspaceTab={setWorkspaceTab}
      startSoundscapeEdit={startSoundscapeEdit}
      cancelSoundscapeEdit={cancelSoundscapeEdit}
      deleteSoundscape={deleteSoundscape}
      addKeywordToDraft={addKeywordToDraft}
      removeKeywordAtIndex={removeKeywordAtIndex}
      updateKeywordAtIndex={updateKeywordAtIndex}
      addTrackToDraft={addTrackToDraft}
      deleteSoundscapeTrack={deleteSoundscapeTrack}
      moveDraftTrackAtIndex={moveDraftTrackAtIndex}
      moveSoundscapeTrack={moveSoundscapeTrack}
      removeTrackAtIndex={removeTrackAtIndex}
      updateTrackAtIndex={updateTrackAtIndex}
      settings={settings}
      skipTrack={skipTrack}
      startSession={startSession}
      state={state}
      switchSoundscape={switchSoundscape}
      useSoundscapeInCollection={useSoundscapeInCollection}
      playSoundscapeTrackAtIndex={playSoundscapeTrackAtIndex}
      togglePinnedHud={togglePinnedHud}
      togglePlaybackMute={togglePlaybackMute}
      togglePlaybackPause={togglePlaybackPause}
      toggleLoop={toggleLoop}
      transcriptionEnabled={transcriptionEnabled}
      transcriptionProfile={transcriptionProfile}
      handleTranscriptionProfileChange={handleTranscriptionProfileChange}
      isCreateCollectionPromptOpen={isCreateCollectionPromptOpen}
      transitionProgress={transitionProgress}
      transitionProposalsEnabled={transitionProposalsEnabled}
      transitionTimeoutSeconds={transitionTimeoutSeconds}
      transportStateLabel={transportStateLabel}
      useTargetSoundscape={useTargetSoundscape}
      workspaceTab={workspaceTab}
      openAddCollectionSoundscapesDialog={openAddCollectionSoundscapesDialog}
      openUseSoundscapeDialog={openUseSoundscapeDialog}
    />
  )
}

export default App