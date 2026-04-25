const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..', '..')

const desktopSettings = {
  botToken: '',
  configPath: path.join(workspaceRoot, 'dungeon-maestro.yaml'),
  discordGuildId: null,
  discordVoiceChannelId: null,
  outputMode: 'local',
  volumePercent: 100,
  playbackMuted: false,
  crossfadeEnabled: false,
  crossfadeDurationSeconds: 3.0,
  loopTrackByDefault: false,
  loopEnabled: false,
  crossfadePauseEnabled: false,
  transcriptionEnabled: false,
  transcriptionProfile: 'fast',
  transitionProposalsEnabled: false,
  transitionTimeoutSeconds: 30,
  hudBounds: null,
  trackPreviewCache: {},
}

const sessionState = {
  sidecarConnected: false,
  sidecarStatus: 'Starting sidecar...',
  connectedBot: false,
  discordStatus: 'Bot token not connected',
  sessionRunning: false,
  startupInProgress: false,
  activeSoundscape: null,
  activeCollection: null,
  currentTrackTitle: 'No track active',
  currentTrackIndex: null,
  currentTrackDurationSeconds: null,
  currentTrackStartedAt: null,
  currentTrackPositionSeconds: 0,
  lastTranscript: '',
  lastError: '',
  pendingTransition: null,
  transcriptionEnabled: false,
  transcriptionProfile: null,
  transitionProposalsEnabled: false,
  transitionTimeoutSeconds: 30,
  outputMode: 'local',
  volumePercent: 100,
  playbackMuted: false,
  playbackPaused: false,
  crossfadeEnabled: false,
  crossfadeDurationSeconds: 3.0,
  loopTrackByDefault: false,
  loopEnabled: false,
  crossfadePauseEnabled: false,
  resolvedTrackStatusBySoundscape: {},
  resolveBackgroundTier: 'idle',
  resolveBackgroundTargetSoundscape: null,
  resolveBackgroundQueueLength: 0,
  resolveBackgroundUnresolvedSoundscapeCount: 0,
  discordTargets: [],
  discordBotUser: null,
  discordDiscoveryInFlight: false,
}

const appConfig = {
  settings: {},
  soundscapes: [],
  collections: [],
}

const trackPreviewCache = new Map()
const trackPreviewInFlight = new Map()

module.exports = {
  workspaceRoot,
  desktopSettings,
  sessionState,
  appConfig,
  trackPreviewCache,
  trackPreviewInFlight,
}
