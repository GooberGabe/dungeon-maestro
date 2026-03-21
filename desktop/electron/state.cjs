const path = require('path')

const workspaceRoot = path.resolve(__dirname, '..', '..')

const desktopSettings = {
  botToken: '',
  configPath: path.join(workspaceRoot, 'dungeon-maestro.yaml'),
  discordGuildId: null,
  discordVoiceChannelId: null,
  outputMode: 'local',
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
  transcriptionProfile: null,
  outputMode: 'local',
  volumePercent: 100,
  playbackMuted: false,
  playbackPaused: false,
  crossfadeEnabled: false,
  crossfadeDurationSeconds: 3.0,
  loopEnabled: false,
  crossfadePauseEnabled: false,
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
