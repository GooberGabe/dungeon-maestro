const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const { getCollectionsMap, getSoundscapesMap, isLegacySoundscapeMap } = require('./config.cjs')
const { normalizeTextInput, validateSessionCollectionName } = require('./validation.cjs')

function createConfigEditors({
  desktopSettings,
  sessionState,
  getBootstrapData,
  emitState,
  syncStateAliases,
  loadAppConfig,
}) {
  function loadParsedConfig() {
    const configPath = path.resolve(desktopSettings.configPath)
    const raw = fs.readFileSync(configPath, 'utf8')
    return {
      configPath,
      parsed: yaml.load(raw) || {},
    }
  }

  function normalizeConfigDocument(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    if (!parsed.soundscapes && isLegacySoundscapeMap(parsed.collections)) {
      parsed.soundscapes = parsed.collections
      delete parsed.collections
    }

    if (!parsed.soundscapes || typeof parsed.soundscapes !== 'object' || Array.isArray(parsed.soundscapes)) {
      parsed.soundscapes = {}
    }
    if (!parsed.collections || typeof parsed.collections !== 'object' || Array.isArray(parsed.collections) || isLegacySoundscapeMap(parsed.collections)) {
      parsed.collections = {}
    }
    if (!parsed.settings || typeof parsed.settings !== 'object') {
      parsed.settings = {}
    }
    if (!parsed.settings.default_soundscape) {
      parsed.settings.default_soundscape = parsed.settings.default_collection || ''
    }
    delete parsed.settings.default_collection
    return parsed
  }

  function saveParsedConfig(configPath, parsed) {
    fs.writeFileSync(configPath, yaml.dump(parsed, { lineWidth: 120, noRefs: true }), 'utf8')
    loadAppConfig(configPath)
    syncStateAliases()
    emitState()
    return getBootstrapData()
  }

  function withNormalizedConfigDocument(mutator) {
    const { configPath, parsed } = loadParsedConfig()
    normalizeConfigDocument(parsed)
    mutator(parsed)
    return saveParsedConfig(configPath, parsed)
  }

  function saveCollectionConfig(collectionId, payload, validateEdits) {
    const normalized = validateEdits(collectionId, payload)
    return withNormalizedConfigDocument((parsed) => {
      const soundscapesMap = getSoundscapesMap(parsed)
      const currentCollection = soundscapesMap[normalized.collectionId]

      soundscapesMap[normalized.collectionId] = {
        ...(currentCollection && typeof currentCollection === 'object' ? currentCollection : {}),
        name: normalized.name,
        keywords: normalized.keywords,
        tracks: normalized.tracks.map((source) => ({ source })),
        playback: {
          ...(currentCollection?.playback && typeof currentCollection.playback === 'object' ? currentCollection.playback : {}),
          mode: currentCollection?.playback?.mode || 'sequential_loop',
          shuffle: normalized.shuffle,
          startup_mode: normalized.startupMode,
        },
      }

      parsed.soundscapes = soundscapesMap
      if (!parsed.settings.default_soundscape) {
        parsed.settings.default_soundscape = normalized.collectionId
      }
    })
  }

  function deleteCollectionConfig(collectionId) {
    const normalizedCollectionId = normalizeTextInput(collectionId)
    if (!normalizedCollectionId) {
      throw new Error('Soundscape id is required for deletion')
    }

    if ((sessionState.sessionRunning || sessionState.startupInProgress)
      && (sessionState.activeSoundscape || sessionState.activeCollection) === normalizedCollectionId) {
      throw new Error('Stop the current session before deleting the active soundscape.')
    }

    return withNormalizedConfigDocument((parsed) => {
      const soundscapesMap = getSoundscapesMap(parsed)
      if (!soundscapesMap[normalizedCollectionId]) {
        throw new Error(`Soundscape "${normalizedCollectionId}" was not found.`)
      }

      delete soundscapesMap[normalizedCollectionId]
      parsed.soundscapes = soundscapesMap

      const remainingCollectionIds = Object.keys(soundscapesMap)
      if (parsed.settings.default_soundscape === normalizedCollectionId) {
        parsed.settings.default_soundscape = remainingCollectionIds[0] || ''
      }
      if ((sessionState.activeSoundscape || sessionState.activeCollection) === normalizedCollectionId) {
        sessionState.activeSoundscape = parsed.settings.default_soundscape || remainingCollectionIds[0] || null
        sessionState.activeCollection = sessionState.activeSoundscape
        sessionState.currentTrackTitle = 'No track active'
        sessionState.currentTrackIndex = null
      }

      Object.values(getCollectionsMap(parsed)).forEach((collection) => {
        if (!collection || typeof collection !== 'object' || !Array.isArray(collection.soundscapes)) {
          return
        }
        collection.soundscapes = collection.soundscapes
          .map((soundscapeId) => normalizeTextInput(soundscapeId))
          .filter((soundscapeId) => soundscapeId && soundscapeId !== normalizedCollectionId)
      })
    })
  }

  function createSessionCollection(name) {
    const normalizedName = validateSessionCollectionName(name)
    return withNormalizedConfigDocument((parsed) => {
      const collectionsMap = getCollectionsMap(parsed)
      const existingNames = new Set(Object.values(collectionsMap).map((collection) => normalizeTextInput(collection?.name).toLowerCase()).filter(Boolean))
      if (existingNames.has(normalizedName.toLowerCase())) {
        throw new Error(`A collection named "${normalizedName}" already exists.`)
      }

      let collectionId = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
      if (!collectionId) {
        collectionId = `collection-${Date.now()}`
      }
      let suffix = 2
      while (collectionsMap[collectionId]) {
        collectionId = `${collectionId}-${suffix}`
        suffix += 1
      }

      collectionsMap[collectionId] = {
        name: normalizedName,
        soundscapes: [],
      }
      parsed.collections = collectionsMap
    })
  }

  function addSoundscapeToSessionCollection(collectionId, soundscapeId) {
    const normalizedCollectionId = normalizeTextInput(collectionId)
    const normalizedSoundscapeId = normalizeTextInput(soundscapeId)
    if (!normalizedCollectionId || !normalizedSoundscapeId) {
      throw new Error('Collection id and soundscape id are required.')
    }

    return withNormalizedConfigDocument((parsed) => {
      const collectionsMap = getCollectionsMap(parsed)
      const soundscapesMap = getSoundscapesMap(parsed)
      const collection = collectionsMap[normalizedCollectionId]

      if (!collection) {
        throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
      }
      if (!soundscapesMap[normalizedSoundscapeId]) {
        throw new Error(`Soundscape "${normalizedSoundscapeId}" was not found.`)
      }

      const nextSoundscapes = Array.isArray(collection.soundscapes) ? collection.soundscapes.map((id) => normalizeTextInput(id)).filter(Boolean) : []
      if (!nextSoundscapes.includes(normalizedSoundscapeId)) {
        nextSoundscapes.push(normalizedSoundscapeId)
      }

      collectionsMap[normalizedCollectionId] = {
        ...collection,
        name: validateSessionCollectionName(collection.name || normalizedCollectionId),
        soundscapes: nextSoundscapes,
      }
      parsed.collections = collectionsMap
    })
  }

  function removeSoundscapeFromSessionCollection(collectionId, soundscapeId) {
    const normalizedCollectionId = normalizeTextInput(collectionId)
    const normalizedSoundscapeId = normalizeTextInput(soundscapeId)
    if (!normalizedCollectionId || !normalizedSoundscapeId) {
      throw new Error('Collection id and soundscape id are required.')
    }

    return withNormalizedConfigDocument((parsed) => {
      const collectionsMap = getCollectionsMap(parsed)
      const collection = collectionsMap[normalizedCollectionId]

      if (!collection) {
        throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
      }

      collectionsMap[normalizedCollectionId] = {
        ...collection,
        name: validateSessionCollectionName(collection.name || normalizedCollectionId),
        soundscapes: Array.isArray(collection.soundscapes)
          ? collection.soundscapes
            .map((id) => normalizeTextInput(id))
            .filter((id) => id && id !== normalizedSoundscapeId)
          : [],
      }
      parsed.collections = collectionsMap
    })
  }

  function deleteSessionCollection(collectionId) {
    const normalizedCollectionId = normalizeTextInput(collectionId)
    if (!normalizedCollectionId) {
      throw new Error('Collection id is required.')
    }

    return withNormalizedConfigDocument((parsed) => {
      const collectionsMap = getCollectionsMap(parsed)
      if (!collectionsMap[normalizedCollectionId]) {
        throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
      }

      delete collectionsMap[normalizedCollectionId]
      parsed.collections = collectionsMap
    })
  }

  function exportSoundscapesToFile(filePath) {
    const { parsed } = loadParsedConfig()
    normalizeConfigDocument(parsed)
    const soundscapesMap = getSoundscapesMap(parsed)
    const exportDoc = { soundscapes: soundscapesMap }
    fs.writeFileSync(filePath, yaml.dump(exportDoc, { lineWidth: 120, noRefs: true }), 'utf8')
    return { exported: Object.keys(soundscapesMap).length }
  }

  function importSoundscapesFromFile(filePath, mode) {
    const raw = fs.readFileSync(filePath, 'utf8')
    let importedDoc
    try {
      importedDoc = yaml.load(raw) || {}
    } catch {
      throw new Error('The selected file is not valid YAML.')
    }

    if (!importedDoc.soundscapes || typeof importedDoc.soundscapes !== 'object' || Array.isArray(importedDoc.soundscapes)) {
      throw new Error('The selected file does not contain a valid soundscapes block.')
    }

    const importedSoundscapesMap = importedDoc.soundscapes
    const importedIds = Object.keys(importedSoundscapesMap).filter(Boolean)
    if (importedIds.length === 0) {
      throw new Error('The selected file contains no soundscapes to import.')
    }

    let importedCount = 0
    let skippedCount = 0

    const bootstrap = withNormalizedConfigDocument((parsed) => {
      const soundscapesMap = getSoundscapesMap(parsed)

      if (mode === 'replace') {
        for (const key of Object.keys(soundscapesMap)) {
          delete soundscapesMap[key]
        }
        for (const id of importedIds) {
          soundscapesMap[id] = importedSoundscapesMap[id]
          importedCount++
        }
        parsed.soundscapes = soundscapesMap
        parsed.settings.default_soundscape = importedIds[0] || ''
      } else {
        for (const id of importedIds) {
          if (soundscapesMap[id]) {
            skippedCount++
          } else {
            soundscapesMap[id] = importedSoundscapesMap[id]
            importedCount++
          }
        }
        parsed.soundscapes = soundscapesMap
        if (!parsed.settings.default_soundscape && importedCount > 0) {
          parsed.settings.default_soundscape = importedIds[0] || ''
        }
      }
    })

    return { bootstrap, importedCount, skippedCount }
  }

  function reorderCollectionSoundscapes(collectionId, sourceSoundscapeId, beforeSoundscapeId) {
    const normalizedCollectionId = normalizeTextInput(collectionId)
    const normalizedSourceId = normalizeTextInput(sourceSoundscapeId)
    const normalizedBeforeId = beforeSoundscapeId == null ? '' : normalizeTextInput(beforeSoundscapeId)
    if (!normalizedCollectionId || !normalizedSourceId) {
      throw new Error('Collection id and source soundscape id are required.')
    }
    if (normalizedSourceId === normalizedBeforeId) {
      return getBootstrapData()
    }

    return withNormalizedConfigDocument((parsed) => {
      const collectionsMap = getCollectionsMap(parsed)
      const collection = collectionsMap[normalizedCollectionId]
      if (!collection) {
        throw new Error(`Collection "${normalizedCollectionId}" was not found.`)
      }

      const orderedSoundscapeIds = Array.isArray(collection.soundscapes)
        ? collection.soundscapes.map((soundscapeId) => normalizeTextInput(soundscapeId)).filter(Boolean)
        : []
      const sourceIndex = orderedSoundscapeIds.findIndex((soundscapeId) => soundscapeId === normalizedSourceId)
      if (sourceIndex === -1) {
        throw new Error('Unable to reorder collection soundscapes because the source soundscape was not found.')
      }

      orderedSoundscapeIds.splice(sourceIndex, 1)
      let insertionIndex = orderedSoundscapeIds.length
      if (normalizedBeforeId) {
        insertionIndex = orderedSoundscapeIds.findIndex((soundscapeId) => soundscapeId === normalizedBeforeId)
        if (insertionIndex === -1) {
          throw new Error('Unable to reorder collection soundscapes because the target position was not found.')
        }
      }
      orderedSoundscapeIds.splice(insertionIndex, 0, normalizedSourceId)

      collectionsMap[normalizedCollectionId] = {
        ...collection,
        soundscapes: orderedSoundscapeIds,
      }
      parsed.collections = collectionsMap
    })
  }

  return {
    saveCollectionConfig,
    deleteCollectionConfig,
    createSessionCollection,
    addSoundscapeToSessionCollection,
    removeSoundscapeFromSessionCollection,
    deleteSessionCollection,
    reorderCollectionSoundscapes,
    exportSoundscapesToFile,
    importSoundscapesFromFile,
  }
}

module.exports = {
  createConfigEditors,
}
