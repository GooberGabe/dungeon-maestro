import { useEffect, useMemo, useState } from 'react'

import DashboardWindow from './components/DashboardWindow'
import PinnedHud from './components/PinnedHud'
import { ICONS, VIEW_MODE } from './constants'

function App() {
  const [bootstrap, setBootstrap] = useState(null)
  const [botTokenDraft, setBotTokenDraft] = useState('')
  const [startingCollection, setStartingCollection] = useState('')
  const [selectedLibraryCollectionId, setSelectedLibraryCollectionId] = useState('')
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
    () => collections.find((collection) => collection.collectionId === selectedLibraryCollectionId) || null,
    [collections, selectedLibraryCollectionId]
  )

  useEffect(() => {
    if (!collections.length) {
      return
    }

    const hasSelection = collections.some((collection) => collection.collectionId === selectedLibraryCollectionId)
    if (!hasSelection) {
      setSelectedLibraryCollectionId(state?.activeCollection || startingCollection || collections[0].collectionId)
    }
  }, [collections, selectedLibraryCollectionId, startingCollection, state?.activeCollection])

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

  const libraryFocusCollection = selectedLibraryCollection || activeCollection || collections[0] || null
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
      collections={collections}
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
      playbackMuted={playbackMuted}
      playbackPaused={playbackPaused}
      playbackRouteLabel={playbackRouteLabel}
      playbackStatusLabel={playbackStatusLabel}
      playbackVolumePercent={playbackVolumePercent}
      outputMode={activeOutputMode}
      refreshDiscordTargets={refreshDiscordTargets}
      saveBotToken={saveBotToken}
      selectedDiscordVoiceChannel={selectedDiscordVoiceChannel}
      selectedGuild={selectedGuild}
      selectedLibraryCollectionId={selectedLibraryCollectionId}
      selectedVoiceChannels={selectedVoiceChannels}
      sessionStatusClass={sessionStatusClass}
      sessionStatusLabel={sessionStatusLabel}
      setBotTokenDraft={setBotTokenDraft}
      setSelectedLibraryCollectionId={setSelectedLibraryCollectionId}
      setStartingCollection={setStartingCollection}
      setWorkspaceTab={setWorkspaceTab}
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
      transitionProgress={transitionProgress}
      transitionProposalsEnabled={transitionProposalsEnabled}
      transitionTimeoutSeconds={transitionTimeoutSeconds}
      transportStateLabel={transportStateLabel}
      workspaceTab={workspaceTab}
    />
  )
}

export default App