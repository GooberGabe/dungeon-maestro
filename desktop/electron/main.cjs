const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const WebSocket = require('ws')

const DEV_SERVER_URL = 'http://localhost:5173'
const SETTINGS_FILE = 'dashboard-settings.json'
const SIDECAR_PORT = 9001

let mainWindow = null
let sidecarProcess = null
let sidecarSocket = null
let reconnectTimer = null
let nextCommandId = 1
const pendingCommands = new Map()

const workspaceRoot = path.resolve(__dirname, '..', '..')
let desktopSettings = {
  botToken: '',
  configPath: path.join(workspaceRoot, 'tabletop-dj.yaml'),
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
  activeCollection: null,
  currentTrackTitle: 'No track active',
  currentTrackIndex: null,
  lastTranscript: '',
  lastError: '',
  pendingTransition: null,
}

function pythonExecutable() {
  const candidate = path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
  return fs.existsSync(candidate) ? candidate : 'python'
}

function syncConfigIntoState() {
  sessionState.connectedBot = desktopSettings.botToken.length > 0
  sessionState.discordStatus = sessionState.connectedBot
    ? 'Bot token saved. Automatic guild/channel resolution is still pending.'
    : 'Bot token not connected'
}

function userSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE)
}

function loadDesktopSettings() {
  try {
    const raw = fs.readFileSync(userSettingsPath(), 'utf8')
    const payload = JSON.parse(raw)
    desktopSettings = { ...desktopSettings, ...payload }
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
}

function getBootstrapData() {
  return {
    settings: desktopSettings,
    config: appConfig,
    state: sessionState,
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
    setTimeout(() => {
      if (pendingCommands.has(id)) {
        pendingCommands.delete(id)
        reject(new Error(`Timed out waiting for sidecar command: ${command}`))
      }
    }, 20000)
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
  emitState()
}

function handleSidecarEvent(eventName, payload) {
  if (eventName === 'status' || eventName === 'session_ended') {
    applyStatusPayload(payload)
    return
  }

  if (eventName === 'session_ready') {
    sessionState.sessionRunning = true
    sessionState.activeCollection = payload.active_collection || sessionState.activeCollection
    emitState()
    return
  }

  if (eventName === 'track_started') {
    sessionState.sessionRunning = true
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

  if (!app.isPackaged) {
    mainWindow.loadURL(DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Renderer failed to load', { errorCode, errorDescription, validatedURL })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited', details)
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.error(`Renderer console error: ${message} (${sourceId}:${line})`)
    }
  })
}

ipcMain.handle('dashboard:get-bootstrap-data', () => getBootstrapData())

ipcMain.handle('dashboard:save-bot-token', (_event, token) => {
  desktopSettings.botToken = String(token || '').trim()
  syncConfigIntoState()
  saveDesktopSettings()
  emitState()
  return getBootstrapData()
})

ipcMain.handle('session:start', async (_event, payload) => {
  await sendSidecarCommand('start_session', {
    config_path: desktopSettings.configPath,
    starting_collection: payload?.startingCollection || appConfig.settings.default_collection || appConfig.collections[0]?.collectionId,
    no_auto_play: false,
    discord_token: desktopSettings.botToken || undefined,
  })
  return getBootstrapData()
})

ipcMain.handle('session:end', async () => {
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
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
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