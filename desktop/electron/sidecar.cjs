const { spawn } = require('child_process')
const WebSocket = require('ws')

const { sessionState, workspaceRoot } = require('./state.cjs')
const { pythonExecutable } = require('./validation.cjs')

const SIDECAR_PORT = 9001

let sidecarProcess = null
let sidecarSocket = null
let reconnectTimer = null
let nextCommandId = 1
const pendingCommands = new Map()

function startSidecarProcess(emitState, handleSidecarMessage) {
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
    scheduleSidecarReconnect(emitState, handleSidecarMessage)
  })

  connectToSidecar(emitState, handleSidecarMessage)
}

function scheduleSidecarReconnect(emitState, handleSidecarMessage) {
  if (reconnectTimer) {
    return
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!sidecarProcess) {
      startSidecarProcess(emitState, handleSidecarMessage)
    } else if (!sidecarSocket || sidecarSocket.readyState !== WebSocket.OPEN) {
      connectToSidecar(emitState, handleSidecarMessage)
    }
  }, 1000)
}

function connectToSidecar(emitState, handleSidecarMessage) {
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
    scheduleSidecarReconnect(emitState, handleSidecarMessage)
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

function resolvePendingCommand(id) {
  const pending = pendingCommands.get(id)
  if (pending) {
    pendingCommands.delete(id)
  }
  return pending || null
}

function cleanup() {
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
}

module.exports = {
  startSidecarProcess,
  sendSidecarCommand,
  resolvePendingCommand,
  cleanup,
}
