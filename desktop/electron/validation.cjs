const fs = require('fs')
const path = require('path')

const { desktopSettings, trackPreviewCache } = require('./state.cjs')

function normalizeOutputMode(value) {
  return value === 'discord' ? 'discord' : 'local'
}

function normalizeTextInput(value) {
  return String(value || '').trim()
}

function normalizeDiscordId(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const text = String(value).trim()
  return /^\d+$/.test(text) ? text : null
}

function normalizeTrackPreviewPayload(source, payload) {
  const normalizedSource = normalizeTextInput(source)
  if (!normalizedSource || !payload || typeof payload !== 'object') {
    return null
  }

  return {
    ok: Boolean(payload.ok),
    source: normalizedSource,
    title: normalizeTextInput(payload.title),
    webpage_url: normalizeTextInput(payload.webpage_url),
    duration_seconds: Number.isFinite(Number(payload.duration_seconds)) ? Number(payload.duration_seconds) : null,
    message: normalizeTextInput(payload.message),
    cached_at_epoch: Number.isFinite(Number(payload.cached_at_epoch)) ? Number(payload.cached_at_epoch) : Math.floor(Date.now() / 1000),
  }
}

function inferTrackSourceType(source) {
  const text = normalizeTextInput(source)
  if (!text) {
    return { type: 'empty', label: 'Missing source', valid: false, error: 'Enter a URL or search term.' }
  }

  if (!/^https?:\/\//i.test(text)) {
    return { type: 'search', label: 'Search query', valid: true, error: '' }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(text)
  } catch {
    return { type: 'invalid-url', label: 'Invalid URL', valid: false, error: 'Enter a valid http or https URL.' }
  }

  const hostname = parsedUrl.hostname.toLowerCase()
  const pathname = parsedUrl.pathname.toLowerCase()
  const isYoutube = hostname.includes('youtube.com') || hostname.includes('youtu.be')
  const hasList = parsedUrl.searchParams.has('list')
  const hasWatchTarget = parsedUrl.searchParams.has('v') || hostname.includes('youtu.be') || pathname.startsWith('/shorts/')

  if (isYoutube && hasList && hasWatchTarget) {
    return {
      type: 'ambiguous-youtube',
      label: 'Ambiguous YouTube URL',
      valid: false,
      error: 'This YouTube URL could mean a single video or an entire playlist. Use a clearer URL for now.',
    }
  }

  if (isYoutube && hasList) {
    return { type: 'playlist', label: 'Playlist URL', valid: true, error: '' }
  }

  return { type: 'url', label: 'Direct URL', valid: true, error: '' }
}

function validateCollectionEdits(collectionId, payload) {
  const normalizedId = normalizeTextInput(collectionId)
  if (!normalizedId) {
    throw new Error('Soundscape id is required for saving edits')
  }

  const name = normalizeTextInput(payload?.name)
  if (!name) {
    throw new Error('Soundscape name cannot be empty')
  }

  if (!Array.isArray(payload?.keywords)) {
    throw new Error('Soundscape keywords must be an array')
  }
  const keywords = payload.keywords.map((keyword) => normalizeTextInput(keyword)).filter(Boolean)
  const seenKeywords = new Set()
  for (const keyword of keywords) {
    const dedupeKey = keyword.toLowerCase()
    if (seenKeywords.has(dedupeKey)) {
      throw new Error(`Duplicate keyword: ${keyword}`)
    }
    seenKeywords.add(dedupeKey)
  }

  if (!Array.isArray(payload?.tracks)) {
    throw new Error('Soundscape tracks must be an array')
  }
  const tracks = payload.tracks.map((track) => normalizeTextInput(track))
  if (tracks.length === 0) {
    throw new Error('Soundscape must include at least one track source')
  }
  const seenTracks = new Set()
  for (const track of tracks) {
    const inferred = inferTrackSourceType(track)
    if (!inferred.valid) {
      throw new Error(inferred.error)
    }
    const dedupeKey = track.toLowerCase()
    if (seenTracks.has(dedupeKey)) {
      throw new Error(`Duplicate track source: ${track}`)
    }
    seenTracks.add(dedupeKey)
  }

  return { collectionId: normalizedId, name, keywords, tracks }
}

function validateSoundscapeEdits(soundscapeId, payload) {
  return validateCollectionEdits(soundscapeId, payload)
}

function validateSessionCollectionName(name) {
  const normalizedName = normalizeTextInput(name)
  if (!normalizedName) {
    throw new Error('Collection name cannot be empty')
  }
  return normalizedName
}

function pythonExecutable() {
  const candidate = path.join(require('./state.cjs').workspaceRoot, '.venv', 'Scripts', 'python.exe')
  return fs.existsSync(candidate) ? candidate : 'python'
}

module.exports = {
  normalizeOutputMode,
  normalizeTextInput,
  normalizeDiscordId,
  normalizeTrackPreviewPayload,
  inferTrackSourceType,
  validateCollectionEdits,
  validateSessionCollectionName,
  validateSoundscapeEdits,
  pythonExecutable,
}
