const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const TOKEN_KEY_PATTERN = /(token|secret|password|authorization)/i

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function shortHash(value) {
  if (value === null || value === undefined) {
    return null
  }
  const text = String(value).trim()
  if (!text) {
    return null
  }
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}

function sanitizeValue(key, value) {
  if (TOKEN_KEY_PATTERN.test(String(key))) {
    return '[redacted]'
  }

  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => sanitizeValue(key, item))
  }

  if (typeof value === 'object') {
    return sanitizePayload(value)
  }

  if (typeof value === 'string') {
    return value.slice(0, 200)
  }

  return value
}

function sanitizePayload(payload) {
  const safe = {}
  const source = payload && typeof payload === 'object' ? payload : {}

  for (const [key, value] of Object.entries(source)) {
    if (key.endsWith('_id')) {
      safe[`${key}_hash`] = shortHash(value)
      continue
    }
    safe[key] = sanitizeValue(key, value)
  }

  return safe
}

function createComplianceLogger({ logDirectory, maxBytes = 1_000_000, maxFiles = 7 } = {}) {
  if (!logDirectory) {
    throw new Error('logDirectory is required')
  }

  ensureDirectory(logDirectory)
  const activeLogPath = path.join(logDirectory, 'discord-compliance.log.jsonl')

  function rotateIfNeeded() {
    let size = 0
    try {
      size = fs.statSync(activeLogPath).size
    } catch {
      size = 0
    }

    if (size < maxBytes) {
      return
    }

    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = `${activeLogPath}.${index}`
      const target = `${activeLogPath}.${index + 1}`
      if (fs.existsSync(source)) {
        fs.renameSync(source, target)
      }
    }

    if (fs.existsSync(activeLogPath)) {
      fs.renameSync(activeLogPath, `${activeLogPath}.1`)
    }

    const extraPath = `${activeLogPath}.${maxFiles + 1}`
    if (fs.existsSync(extraPath)) {
      fs.rmSync(extraPath, { force: true })
    }
  }

  function write(eventPayload) {
    const source = eventPayload && typeof eventPayload === 'object' ? eventPayload : {}
    const record = {
      timestamp: new Date().toISOString(),
      name: typeof source.name === 'string' ? source.name : 'unknown',
      payload: sanitizePayload(source.payload),
    }

    rotateIfNeeded()
    fs.appendFileSync(activeLogPath, `${JSON.stringify(record)}\n`, 'utf8')
  }

  function close() {
    return
  }

  return {
    write,
    close,
  }
}

module.exports = {
  createComplianceLogger,
  sanitizePayload,
}
