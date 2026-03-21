const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const { desktopSettings, sessionState, appConfig, trackPreviewCache } = require('./state.cjs')
const { normalizeOutputMode, normalizeTextInput, normalizeDiscordId, normalizeTrackPreviewPayload } = require('./validation.cjs')

function isLegacySoundscapeMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const entries = Object.values(value)
  return entries.length > 0 && entries.every((entry) => entry && typeof entry === 'object' && Array.isArray(entry.tracks))
}

function getSoundscapesMap(parsed) {
  if (parsed.soundscapes && typeof parsed.soundscapes === 'object' && !Array.isArray(parsed.soundscapes)) {
    return parsed.soundscapes
  }
  if (isLegacySoundscapeMap(parsed.collections)) {
    return parsed.collections
  }
  return {}
}

function getCollectionsMap(parsed) {
  if (!parsed.collections || typeof parsed.collections !== 'object' || Array.isArray(parsed.collections)) {
    return {}
  }
  return isLegacySoundscapeMap(parsed.collections) ? {} : parsed.collections
}

function parseCollections(collectionsMap, soundscapes) {
  const soundscapeIds = new Set(soundscapes.map((soundscape) => soundscape.soundscapeId || soundscape.collectionId))
  return Object.entries(collectionsMap).map(([rawId, value]) => {
    const soundscapeIdsForCollection = Array.isArray(value?.soundscapes)
      ? value.soundscapes.map((soundscapeId) => normalizeTextInput(soundscapeId)).filter((soundscapeId) => soundscapeIds.has(soundscapeId))
      : []

    return {
      collectionId: String(rawId),
      name: normalizeTextInput(value?.name) || String(rawId),
      soundscapeIds: [...new Set(soundscapeIdsForCollection)],
      soundscapeCount: [...new Set(soundscapeIdsForCollection)].length,
    }
  })
}

function userSettingsPath() {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'dashboard-settings.json')
}

function loadDesktopSettings() {
  try {
    const raw = fs.readFileSync(userSettingsPath(), 'utf8')
    const payload = JSON.parse(raw)
    Object.assign(desktopSettings, payload)
    if (desktopSettings.configPath && desktopSettings.configPath.includes('tabletop-dj')) {
      desktopSettings.configPath = desktopSettings.configPath.replace('tabletop-dj', 'dungeon-maestro')
    }
    desktopSettings.discordGuildId = normalizeDiscordId(desktopSettings.discordGuildId)
    desktopSettings.discordVoiceChannelId = normalizeDiscordId(desktopSettings.discordVoiceChannelId)
    desktopSettings.outputMode = normalizeOutputMode(desktopSettings.outputMode)
    const rawTrackPreviewCache = desktopSettings.trackPreviewCache && typeof desktopSettings.trackPreviewCache === 'object'
      ? desktopSettings.trackPreviewCache
      : {}
    desktopSettings.trackPreviewCache = {}
    Object.entries(rawTrackPreviewCache).forEach(([source, preview]) => {
      const normalizedPreview = normalizeTrackPreviewPayload(source, preview)
      if (!normalizedPreview) {
        return
      }
      desktopSettings.trackPreviewCache[normalizedPreview.source] = normalizedPreview
      trackPreviewCache.set(normalizedPreview.source, normalizedPreview)
    })
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
  const soundscapesMap = getSoundscapesMap(parsed)
  const soundscapes = Object.entries(soundscapesMap).map(([rawId, value]) => ({
    soundscapeId: String(rawId),
    collectionId: String(rawId),
    name: value.name,
    keywords: value.keywords || [],
    tracks: Array.isArray(value.tracks) ? value.tracks.map((track) => {
      const source = normalizeTextInput(track?.source)
      return {
        source,
        preview: source ? (trackPreviewCache.get(source) || null) : null,
      }
    }) : [],
    trackCount: Array.isArray(value.tracks) ? value.tracks.length : 0,
    playbackMode: value.playback?.mode || 'sequential_loop',
  }))
  const collections = parseCollections(getCollectionsMap(parsed), soundscapes)

  appConfig.settings = {
    ...(parsed.settings || {}),
    defaultSoundscape: parsed.settings?.default_soundscape || parsed.settings?.default_collection || null,
  }
  appConfig.soundscapes = soundscapes
  appConfig.collections = collections

  const rawDefaultCollection = parsed.settings?.default_soundscape || parsed.settings?.default_collection
  const fallbackCollectionId = rawDefaultCollection ? String(rawDefaultCollection) : (soundscapes[0]?.collectionId || null)
  const activeCollectionId = sessionState.activeSoundscape || sessionState.activeCollection
  const hasActiveCollection = soundscapes.some((collection) => collection.collectionId === activeCollectionId)
  if (!hasActiveCollection) {
    sessionState.activeSoundscape = fallbackCollectionId
    sessionState.activeCollection = fallbackCollectionId
  }
}

module.exports = {
  getSoundscapesMap,
  getCollectionsMap,
  isLegacySoundscapeMap,
  loadDesktopSettings,
  saveDesktopSettings,
  loadAppConfig,
}
