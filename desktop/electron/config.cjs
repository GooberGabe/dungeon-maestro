const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const { desktopSettings, sessionState, appConfig, trackPreviewCache } = require('./state.cjs')
const { normalizeOutputMode, normalizeTextInput, normalizeDiscordId, normalizeTrackPreviewPayload } = require('./validation.cjs')

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
  const collectionsMap = parsed.collections || {}
  const collections = Object.entries(collectionsMap).map(([collectionId, value]) => ({
    collectionId,
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

  appConfig.settings = parsed.settings || {}
  appConfig.collections = collections

  const fallbackCollectionId = parsed.settings?.default_collection || collections[0]?.collectionId || null
  const hasActiveCollection = collections.some((collection) => collection.collectionId === sessionState.activeCollection)
  if (!hasActiveCollection) {
    sessionState.activeCollection = fallbackCollectionId
  }
}

module.exports = {
  loadDesktopSettings,
  saveDesktopSettings,
  loadAppConfig,
}
