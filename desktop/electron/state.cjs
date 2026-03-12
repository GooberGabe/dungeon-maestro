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
  activeCollection: null,
  currentTrackTitle: 'No track active',
  currentTrackIndex: null,
  lastTranscript: '',
  lastError: '',
  pendingTransition: null,
  transcriptionProfile: null,
  outputMode: 'local',
  volumePercent: 100,
  playbackMuted: false,
  playbackPaused: false,
  discordTargets: [],
  discordBotUser: null,
  discordDiscoveryInFlight: false,
}

const appConfig = {
  settings: {},
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
