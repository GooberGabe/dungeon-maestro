const { BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const { desktopSettings, sessionState, appConfig } = require('./state.cjs')
const { saveDesktopSettings } = require('./config.cjs')

const DEV_SERVER_URL = 'http://localhost:5173'
const HUD_WIDTH = 352
const HUD_COMPACT_HEIGHT = 154
const HUD_CORNER_RADIUS = 22

let mainWindow = null
let hudWindow = null

function resolveAppIconPath() {
  const iconFile = process.platform === 'win32' ? 'logo.ico' : 'logo.png'
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', iconFile),
    path.resolve(process.resourcesPath || '', 'assets', iconFile),
    path.resolve(process.resourcesPath || '', 'app.asar', 'assets', iconFile),
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

function getMainWindow() {
  return mainWindow
}

function getHudWindow() {
  return hudWindow
}

function rendererUrl(view) {
  return `${DEV_SERVER_URL}?view=${view}`
}

function rendererFileOptions(view) {
  return { query: { view } }
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
  const { app } = require('electron')
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
  desktopSettings.hudBounds = { x: bounds.x, y: bounds.y }
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
  applyHudWindowShape(hudWindow)
}

function buildRoundedRectShape(width, height, radius) {
  const safeRadius = Math.max(0, Math.min(Math.floor(radius), Math.floor(width / 2), Math.floor(height / 2)))
  const rects = []

  for (let y = 0; y < height; y += 1) {
    let inset = 0
    if (safeRadius > 0) {
      if (y < safeRadius) {
        const dy = safeRadius - y - 0.5
        inset = Math.ceil(safeRadius - Math.sqrt((safeRadius * safeRadius) - (dy * dy)))
      } else if (y >= (height - safeRadius)) {
        const dy = y - (height - safeRadius) + 0.5
        inset = Math.ceil(safeRadius - Math.sqrt((safeRadius * safeRadius) - (dy * dy)))
      }
    }

    const lineWidth = Math.max(0, width - (inset * 2))
    if (lineWidth > 0) {
      rects.push({ x: inset, y, width: lineWidth, height: 1 })
    }
  }

  return rects
}

function applyHudWindowShape(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }
  if (typeof targetWindow.setShape !== 'function') {
    return
  }
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return
  }

  const [width, height] = targetWindow.getSize()
  const shape = buildRoundedRectShape(width, height, HUD_CORNER_RADIUS)
  if (shape.length > 0) {
    targetWindow.setShape(shape)
  }
}

function createHudWindow() {
  if (hudWindow && !hudWindow.isDestroyed()) {
    return hudWindow
  }

  const savedBounds = desktopSettings.hudBounds || {}
  const appIcon = resolveAppIconPath()
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
    roundedCorners: true,
    backgroundColor: '#00000000',
    icon: appIcon,
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
  applyHudWindowShape(hudWindow)

  hudWindow.on('moved', saveHudBounds)
  hudWindow.on('close', () => {
    saveHudBounds()
  })
  hudWindow.on('closed', () => {
    hudWindow = null
  })

  return hudWindow
}

function createMainWindow() {
  const appIcon = resolveAppIconPath()
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#091a2a',
    icon: appIcon,
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

function emitState(getBootstrapData) {
  const data = getBootstrapData()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:changed', data)
  }
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.webContents.send('state:changed', data)
  }
}

function collectionName(collectionId) {
  return appConfig.collections.find((collection) => collection.collectionId === collectionId || collection.soundscapeId === collectionId)?.name || collectionId
}

function soundscapeName(soundscapeId) {
  return collectionName(soundscapeId)
}

module.exports = {
  getMainWindow,
  getHudWindow,
  createMainWindow,
  createHudWindow,
  showDashboardWindow,
  showHudWindow,
  togglePinnedHud,
  syncHudWindowSize,
  emitState,
  collectionName,
  soundscapeName,
}
