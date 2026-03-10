const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const WebSocket = require('ws')

const DEV_SERVER_URL = 'http://localhost:5173'
const SETTINGS_FILE = 'dashboard-settings.json'
const SIDECAR_PORT = 9001
const HUD_WIDTH = 352
const HUD_COMPACT_HEIGHT = 154

let mainWindow = null
let hudWindow = null
let sidecarProcess = null
let sidecarSocket = null
let reconnectTimer = null
let nextCommandId = 1
const pendingCommands = new Map()

const workspaceRoot = path.resolve(__dirname, '..', '..')
let desktopSettings = {
  botToken: '',
  configPath: path.join(workspaceRoot, 'tabletop-dj.yaml'),
  discordGuildId: null,
  discordVoiceChannelId: null,
  outputMode: 'local',
  hudBounds: null,
}

let appConfig = {
  settings: {},
  collections: [],
}

let sessionState = {
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

function pythonExecutable() {
  const candidate = path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
  return fs.existsSync(candidate) ? candidate : 'python'
}

function syncConfigIntoState() {
  sessionState.connectedBot = desktopSettings.botToken.length > 0
  sessionState.outputMode = desktopSettings.outputMode
  sessionState.discordStatus = buildDiscordStatus()
}

function normalizeOutputMode(value) {
  return value === 'discord' ? 'discord' : 'local'
}

function normalizeDiscordId(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

function getSelectedGuild() {
  return sessionState.discordTargets.find((guild) => guild.id === desktopSettings.discordGuildId) || null
}

function getSelectedVoiceChannel() {
  const guild = getSelectedGuild()
  if (!guild) {
    return null
  }
  return guild.voice_channels.find((channel) => channel.id === desktopSettings.discordVoiceChannelId) || null
}

function ensureDiscordSelection() {
  const guilds = sessionState.discordTargets
  if (!guilds.length) {
    desktopSettings.discordGuildId = null
    desktopSettings.discordVoiceChannelId = null
    return
  }

  let guild = getSelectedGuild()
  if (!guild) {
    guild = guilds.find((item) => item.voice_channels.length > 0) || guilds[0]
    desktopSettings.discordGuildId = guild?.id ?? null
  }

  const voiceChannels = guild?.voice_channels || []
  const selectedChannel = voiceChannels.find((channel) => channel.id === desktopSettings.discordVoiceChannelId) || null
  desktopSettings.discordVoiceChannelId = selectedChannel?.id ?? voiceChannels[0]?.id ?? null
}

function buildDiscordStatus() {
  if (!desktopSettings.botToken) {
    return 'Bot token not connected'
  }

  if (sessionState.discordDiscoveryInFlight) {
    return 'Resolving Discord guilds and voice channels...'
  }

  if (!sessionState.discordTargets.length) {
    return 'Bot token saved. No Discord servers resolved yet.'
  }

  const selectedGuild = getSelectedGuild()
  const selectedChannel = getSelectedVoiceChannel()
  if (!selectedGuild) {
    return 'Select a Discord server for voice playback.'
  }
  if (!selectedChannel) {
    return `Select a voice channel in ${selectedGuild.name}.`
  }

  return `Ready for ${selectedGuild.name} / ${selectedChannel.name}`
}

function applyDiscordTargets(discovery) {
  sessionState.discordTargets = Array.isArray(discovery?.guilds) ? discovery.guilds : []
  sessionState.discordBotUser = discovery?.bot_user || null
  ensureDiscordSelection()
  saveDesktopSettings()
  syncConfigIntoState()
}

function resolveDiscordTargets() {
  if (!desktopSettings.botToken) {
    sessionState.discordTargets = []
    sessionState.discordBotUser = null
    desktopSettings.discordGuildId = null
    desktopSettings.discordVoiceChannelId = null
    syncConfigIntoState()
    emitState()
    return Promise.resolve(getBootstrapData())
  }

  sessionState.discordDiscoveryInFlight = true
  syncConfigIntoState()
  emitState()

  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonExecutable(),
      ['-m', 'dungeon_maestro_sidecar.discord_discovery'],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          DUNGEON_MAESTRO_DISCORD_TOKEN: desktopSettings.botToken,
          PYTHONUNBUFFERED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      sessionState.discordDiscoveryInFlight = false
      sessionState.lastError = error.message
      syncConfigIntoState()
      emitState()
      reject(error)
    })

    child.on('close', (code) => {
      sessionState.discordDiscoveryInFlight = false
      if (code !== 0) {
        const message = stderr.trim() || `Discord discovery failed with exit code ${code}`
        sessionState.discordTargets = []
        sessionState.discordBotUser = null
        sessionState.lastError = message
        syncConfigIntoState()
        emitState()
        reject(new Error(message))
        return
      }

      try {
        applyDiscordTargets(JSON.parse(stdout))
        emitState()
        resolve(getBootstrapData())
      } catch (error) {
        sessionState.discordTargets = []
        sessionState.discordBotUser = null
        sessionState.lastError = error.message
        syncConfigIntoState()
        emitState()
        reject(error)
      }
    })
  })
}

function userSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function loadDesktopSettings() {
  try {
    const raw = fs.readFileSync(userSettingsPath(), 'utf8')
    const payload = JSON.parse(raw)
    desktopSettings = { ...desktopSettings, ...payload }
    desktopSettings.discordGuildId = normalizeDiscordId(desktopSettings.discordGuildId)
    desktopSettings.discordVoiceChannelId = normalizeDiscordId(desktopSettings.discordVoiceChannelId)
    desktopSettings.outputMode = normalizeOutputMode(desktopSettings.outputMode)
  } catch {
    // Keep defaults on first run.
  }
}

function saveDesktopSettings() {
  fs.mkdirSync(path.dirname(userSettingsPath()), { recursive: true })
  fs.writeFileSync(userSettingsPath(), JSON.stringify(desktopSettings, null, 2), 'utf8')
}

function loadAppConfig(configPath) {
  const resolvedPath = path.resolve(configPath)
  const raw = fs.readFileSync(resolvedPath, 'utf8')
  const parsed = yaml.load(raw) || {}
  const collectionsMap = parsed.collections || {}
  const collections = Object.entries(collectionsMap).map(([collectionId, value]) => ({
    collectionId,
    name: value.name,
    keywords: value.keywords || [],
    trackCount: Array.isArray(value.tracks) ? value.tracks.length : 0,
  }))

  appConfig = {
    settings: parsed.settings || {},
    collections,
  }

  if (!sessionState.activeCollection && collections.length > 0) {
    sessionState.activeCollection = parsed.settings?.default_collection || collections[0].collectionId
  }
}

function collectionName(collectionId) {
  return appConfig.collections.find((collection) => collection.collectionId === collectionId)?.name || collectionId
}

function trackLabelForCollection(collectionId) {
  const collection = appConfig.collections.find((item) => item.collectionId === collectionId)
  if (!collection) {
    return 'Unknown track'
  }
  const nextTrack = ((sessionState.currentTrackIndex ?? -1) + 1) % Math.max(collection.trackCount || 1, 1)
  return `${collection.name} Track ${nextTrack + 1}`
}

function emitState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:changed', getBootstrapData())
  }
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.webContents.send('state:changed', getBootstrapData())
  }
}

function getBootstrapData() {
  return {
    settings: desktopSettings,
    config: appConfig,
    state: sessionState,
  }
}

function rendererUrl(view) {
  return `${DEV_SERVER_URL}?view=${view}`
}

function rendererFileOptions(view) {
  return {
    query: {
      view,
    },
  }
}

function attachWindowDiagnostics(targetWindow, label) {
  targetWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`${label} renderer failed to load`, { errorCode, errorDescription, validatedURL })
  })

  targetWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`${label} renderer process exited`, details)
  })

  targetWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`${label} renderer console error: ${message} (${sourceId}:${line})`)
    }
  })
}

function loadRendererWindow(targetWindow, view) {
  if (!app.isPackaged) {
    targetWindow.loadURL(rendererUrl(view))
  } else {
    targetWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), rendererFileOptions(view))
  }
}

function saveHudBounds() {
  if (!hudWindow || hudWindow.isDestroyed()) {
    return
  }
  const bounds = hudWindow.getBounds()
  desktopSettings.hudBounds = {
    x: bounds.x,
    y: bounds.y,
  }
  saveDesktopSettings()
}

function syncHudWindowSize() {
  if (!hudWindow || hudWindow.isDestroyed()) {
    return
  }
  const targetHeight = HUD_COMPACT_HEIGHT
  const [currentWidth, currentHeight] = hudWindow.getSize()
  if (currentWidth !== HUD_WIDTH || currentHeight !== targetHeight) {
    hudWindow.setSize(HUD_WIDTH, targetHeight, true)
  }
}

function createHudWindow() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    return hudWindow
  }

  const savedBounds = desktopSettings.hudBounds || {}
  hudWindow = new BrowserWindow({
    width: HUD_WIDTH,
    height: HUD_COMPACT_HEIGHT,
    x: Number.isFinite(savedBounds.x) ? savedBounds.x : undefined,
    y: Number.isFinite(savedBounds.y) ? savedBounds.y : undefined,
    minWidth: HUD_WIDTH,
    maxWidth: HUD_WIDTH,
    minHeight: HUD_COMPACT_HEIGHT,
    maxHeight: HUD_COMPACT_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadRendererWindow(hudWindow, 'hud')
  attachWindowDiagnostics(hudWindow, 'HUD')
  syncHudWindowSize()

  hudWindow.on('moved', saveHudBounds)
  hudWindow.on('close', () => {
    saveHudBounds()
  })
  hudWindow.on('closed', () => {
    hudWindow = null
  })

  return hudWindow
}

function showDashboardWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
  }
  if (hudWindow && !hudWindow.isDestroyed()) {
    saveHudBounds()
    hudWindow.hide()
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function showHudWindow() {
  const targetWindow = createHudWindow()
  syncHudWindowSize()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }
  targetWindow.show()
  targetWindow.focus()
}

function togglePinnedHud() {
  if (hudWindow && !hudWindow.isDestroyed() && hudWindow.isVisible()) {
    showDashboardWindow()
  } else {
    showHudWindow()
  }
}

function startSidecarProcess() {
  if (sidecarProcess) {
    return
  }

  sidecarProcess = spawn(
    pythonExecutable(),
    ['-m', 'dungeon_maestro_sidecar.sidecar_server', '--port', String(SIDECAR_PORT)],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  sidecarProcess.stdout.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) {
      console.log(`[sidecar] ${message}`)
    }
  })

  sidecarProcess.stderr.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) {
      console.error(`[sidecar] ${message}`)
    }
  })

  sidecarProcess.on('exit', (code) => {
    sidecarProcess = null
    sessionState.sidecarConnected = false
    sessionState.sidecarStatus = `Sidecar stopped (${code ?? 'unknown'})`
    emitState()
    scheduleSidecarReconnect()
  })

  connectToSidecar()
}

function scheduleSidecarReconnect() {
  if (reconnectTimer) {
    return
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!sidecarProcess) {
      startSidecarProcess()
    } else if (!sidecarSocket || sidecarSocket.readyState !== WebSocket.OPEN) {
      connectToSidecar()
    }
  }, 1000)
}

function connectToSidecar() {
  if (sidecarSocket && sidecarSocket.readyState === WebSocket.OPEN) {
    return
  }

  sessionState.sidecarStatus = 'Connecting to sidecar...'
  emitState()

  sidecarSocket = new WebSocket(`ws://127.0.0.1:${SIDECAR_PORT}`)
  sidecarSocket.on('open', () => {
    sessionState.sidecarConnected = true
    sessionState.sidecarStatus = 'Sidecar connected'
    emitState()
    sendSidecarCommand('get_status', {}).catch((error) => {
      sessionState.lastError = String(error)
      emitState()
    })
  })

  sidecarSocket.on('message', (buffer) => {
    try {
      const message = JSON.parse(buffer.toString())
      handleSidecarMessage(message)
    } catch (error) {
      console.error('Failed to parse sidecar message', error)
    }
  })

  sidecarSocket.on('close', () => {
    sidecarSocket = null
    sessionState.sidecarConnected = false
    sessionState.sidecarStatus = 'Sidecar disconnected'
    emitState()
    scheduleSidecarReconnect()
  })

  sidecarSocket.on('error', (error) => {
    sessionState.sidecarConnected = false
    sessionState.sidecarStatus = `Sidecar connection error: ${error.message}`
    emitState()
  })
}

function sendSidecarCommand(command, payload) {
  if (!sidecarSocket || sidecarSocket.readyState !== WebSocket.OPEN) {
    throw new Error('Sidecar is not connected')
  }

  const id = nextCommandId++
  const message = { id, command, payload }
  sidecarSocket.send(JSON.stringify(message))

  return new Promise((resolve, reject) => {
    pendingCommands.set(id, { resolve, reject })
    const timeoutMs = command === 'start_session' ? 5000 : 20000
    setTimeout(() => {
      if (pendingCommands.has(id)) {
        pendingCommands.delete(id)
        reject(new Error(`Timed out waiting for sidecar command: ${command}`))
      }
    }, timeoutMs)
  })
}

function handleSidecarMessage(message) {
  if (message.type === 'command_result') {
    const pending = pendingCommands.get(message.id)
    if (!pending) {
      return
    }
    pendingCommands.delete(message.id)
    if (message.ok) {
      applyStatusPayload(message.result)
      pending.resolve(message.result)
    } else {
      sessionState.lastError = message.error || 'Unknown sidecar error'
      emitState()
      pending.reject(new Error(message.error || 'Unknown sidecar error'))
    }
    return
  }

  if (message.type === 'event') {
    handleSidecarEvent(message.event, message.payload || {})
  }
}

function applyStatusPayload(payload) {
  sessionState = {
    ...sessionState,
    ...payload,
  }
  syncHudWindowSize()
  emitState()
}

function handleSidecarEvent(eventName, payload) {
  if (eventName === 'status' || eventName === 'session_ended') {
    applyStatusPayload(payload)
    return
  }

  if (eventName === 'session_ready') {
    sessionState.sessionRunning = true
    sessionState.startupInProgress = true
    sessionState.activeCollection = payload.active_collection || sessionState.activeCollection
    emitState()
    return
  }

  if (eventName === 'discord_connected') {
    sessionState.discordStatus = buildDiscordStatus().replace('Ready for', 'Discord playback connected to')
    emitState()
    return
  }

  if (eventName === 'track_started') {
    sessionState.sessionRunning = true
    sessionState.startupInProgress = false
    sessionState.activeCollection = payload.collection || sessionState.activeCollection
    sessionState.currentTrackTitle = payload.title || sessionState.currentTrackTitle
    sessionState.currentTrackIndex = payload.track_index ?? sessionState.currentTrackIndex
    emitState()
    return
  }

  if (eventName === 'transcript') {
    sessionState.lastTranscript = payload.text || ''
    emitState()
    return
  }

  if (eventName === 'keyword_match') {
    sessionState.activeCollection = payload.collection || sessionState.activeCollection
    emitState()
    return
  }

  if (eventName === 'transition_pending') {
    sessionState.pendingTransition = {
      keyword: payload.keyword,
      targetCollection: payload.target_collection,
      displayName: payload.display_name,
      expiresAtEpoch: payload.expires_at_epoch ?? null,
    }
    syncHudWindowSize()
    emitState()
    return
  }

  if (eventName === 'transition_dismissed' || eventName === 'transition_approved') {
    sessionState.pendingTransition = null
    syncHudWindowSize()
    emitState()
    return
  }

  if (eventName === 'error') {
    sessionState.lastError = payload.message || 'Unknown sidecar error'
    emitState()
    return
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#091a2a',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  loadRendererWindow(mainWindow, 'dashboard')
  attachWindowDiagnostics(mainWindow, 'Dashboard')
  mainWindow.on('close', () => {
    if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.close()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('dashboard:get-bootstrap-data', () => getBootstrapData())

ipcMain.handle('dashboard:save-bot-token', (_event, token) => {
  desktopSettings.botToken = String(token || '').trim()
  desktopSettings.discordGuildId = null
  desktopSettings.discordVoiceChannelId = null
  saveDesktopSettings()
  return resolveDiscordTargets()
})

ipcMain.handle('dashboard:refresh-discord-targets', () => resolveDiscordTargets())

ipcMain.handle('dashboard:set-discord-guild', (_event, guildId) => {
  desktopSettings.discordGuildId = normalizeDiscordId(guildId)
  desktopSettings.discordVoiceChannelId = null
  ensureDiscordSelection()
  saveDesktopSettings()
  syncConfigIntoState()
  emitState()
  return getBootstrapData()
})

ipcMain.handle('dashboard:set-discord-voice-channel', (_event, channelId) => {
  desktopSettings.discordVoiceChannelId = normalizeDiscordId(channelId)
  ensureDiscordSelection()
  saveDesktopSettings()
  syncConfigIntoState()
  emitState()
  return getBootstrapData()
})

ipcMain.handle('dashboard:set-output-mode', async (_event, outputMode) => {
  const previousMode = desktopSettings.outputMode
  desktopSettings.outputMode = normalizeOutputMode(outputMode)
  saveDesktopSettings()
  syncConfigIntoState()
  if (sessionState.sessionRunning && !sessionState.startupInProgress) {
    try {
      await sendSidecarCommand('update_output_mode', { output_mode: desktopSettings.outputMode })
    } catch (error) {
      desktopSettings.outputMode = previousMode
      saveDesktopSettings()
      syncConfigIntoState()
      emitState()
      throw error
    }
  }
  emitState()
  return getBootstrapData()
})

ipcMain.handle('window:toggle-pinned-hud', () => {
  togglePinnedHud()
  return getBootstrapData()
})

ipcMain.handle('session:start', async (_event, payload) => {
  if (sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }

  const transcriptionEnabled = payload?.transcriptionEnabled !== false
  const transitionProposalsEnabled = transcriptionEnabled && payload?.transitionProposalsEnabled !== false
  const transitionTimeoutSeconds = Number.parseInt(payload?.transitionTimeoutSeconds, 10)
  const transcriptionProfile = typeof payload?.transcriptionProfile === 'string' ? payload.transcriptionProfile : undefined
  const outputMode = normalizeOutputMode(payload?.outputMode || desktopSettings.outputMode)

  if (outputMode === 'discord' && (!desktopSettings.botToken || !desktopSettings.discordVoiceChannelId)) {
    throw new Error('Discord output requires a saved bot token and selected voice channel')
  }

  await sendSidecarCommand('start_session', {
    config_path: desktopSettings.configPath,
    starting_collection: payload?.startingCollection ?? undefined,
    no_transcription: !transcriptionEnabled,
    transcription_profile: transcriptionProfile,
    enable_transition_proposals: transitionProposalsEnabled,
    transition_popup_timeout: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
    volume_percent: Number.isFinite(Number.parseInt(payload?.volumePercent, 10)) ? Number.parseInt(payload?.volumePercent, 10) : sessionState.volumePercent,
    muted: typeof payload?.muted === 'boolean' ? payload.muted : sessionState.playbackMuted,
    paused: typeof payload?.paused === 'boolean' ? payload.paused : false,
    output_mode: outputMode,
    no_auto_play: outputMode !== 'local',
    discord_token: outputMode === 'discord' ? (desktopSettings.botToken || undefined) : undefined,
    discord_guild_id: outputMode === 'discord' ? (desktopSettings.discordGuildId || undefined) : undefined,
    discord_voice_channel_id: outputMode === 'discord' ? (desktopSettings.discordVoiceChannelId || undefined) : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('playback:update-settings', async (_event, payload) => {
  if (!sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }

  const volumePercent = Number.parseInt(payload?.volumePercent, 10)
  const muted = payload?.muted
  const paused = payload?.paused

  await sendSidecarCommand('update_playback_settings', {
    volume_percent: Number.isFinite(volumePercent) ? volumePercent : undefined,
    muted: typeof muted === 'boolean' ? muted : undefined,
    paused: typeof paused === 'boolean' ? paused : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('session:update-settings', async (_event, payload) => {
  if (!sessionState.sessionRunning || sessionState.startupInProgress) {
    return getBootstrapData()
  }

  const transcriptionEnabled = payload?.transcriptionEnabled
  const transcriptionProfile = typeof payload?.transcriptionProfile === 'string' ? payload.transcriptionProfile : undefined
  const transitionProposalsEnabled = payload?.transitionProposalsEnabled
  const transitionTimeoutSeconds = Number.parseInt(payload?.transitionTimeoutSeconds, 10)

  await sendSidecarCommand('update_session_settings', {
    transcription_enabled: typeof transcriptionEnabled === 'boolean' ? transcriptionEnabled : undefined,
    transcription_profile: transcriptionProfile,
    enable_transition_proposals: typeof transitionProposalsEnabled === 'boolean' ? transitionProposalsEnabled : undefined,
    transition_popup_timeout: Number.isFinite(transitionTimeoutSeconds) ? transitionTimeoutSeconds : undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('session:end', async () => {
  if (!sessionState.sessionRunning && !sessionState.startupInProgress) {
    return getBootstrapData()
  }
  await sendSidecarCommand('end_session', {})
  return getBootstrapData()
})

ipcMain.handle('hud:skip-track', async () => {
  await sendSidecarCommand('skip_track', {})
  return getBootstrapData()
})

ipcMain.handle('hud:approve-transition', async () => {
  await sendSidecarCommand('approve_transition', {})
  return getBootstrapData()
})

ipcMain.handle('hud:dismiss-transition', async () => {
  await sendSidecarCommand('dismiss_transition', {})
  return getBootstrapData()
})

app.whenReady().then(() => {
  loadDesktopSettings()
  syncConfigIntoState()
  loadAppConfig(desktopSettings.configPath)
  startSidecarProcess()
  void resolveDiscordTargets().catch((error) => {
    sessionState.lastError = error.message
    emitState()
  })
  createMainWindow()

  app.on('activate', () => {
    if (!mainWindow && !hudWindow) {
      createMainWindow()
      return
    }
    if ((!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) && (!hudWindow || !hudWindow.isVisible())) {
      showDashboardWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (sidecarSocket) {
    sidecarSocket.close()
    sidecarSocket = null
  }
  if (sidecarProcess) {
    sidecarProcess.kill()
    sidecarProcess = null
  }
})