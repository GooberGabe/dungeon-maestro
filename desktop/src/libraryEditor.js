function normalizeText(value) {
  return String(value || '').trim()
}

function soundscapeIdOf(soundscape) {
  return soundscape?.soundscapeId || soundscape?.collectionId || ''
}

function defaultKeywordFromSoundscapeId(soundscapeId) {
  return normalizeText(soundscapeId)
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function createSoundscapeDraft(soundscape) {
  if (!soundscape) {
    return null
  }

  return {
    soundscapeId: soundscapeIdOf(soundscape),
    collectionId: soundscapeIdOf(soundscape),
    name: soundscape.name || '',
    keywords: Array.isArray(soundscape.keywords) ? [...soundscape.keywords] : [],
    tracks: Array.isArray(soundscape.tracks) ? soundscape.tracks.map((track) => track?.source || '') : [],
  }
}

export function createCollectionDraft(collection) {
  return createSoundscapeDraft(collection)
}

function generateSoundscapeId() {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return String(array[0])
}

function generateCollectionId() {
  return generateSoundscapeId()
}

export function createNewSoundscapeDraft(soundscapeName) {
  const normalizedName = normalizeText(soundscapeName)

  return {
    soundscapeId: generateSoundscapeId(),
    collectionId: generateCollectionId(),
    name: normalizedName,
    keywords: [],
    tracks: [],
  }
}

export function createNewCollectionDraft(collectionName) {
  return createNewSoundscapeDraft(collectionName)
}

export function inferTrackSource(source) {
  const text = normalizeText(source)
  if (!text) {
    return { type: 'empty', label: 'Missing source', valid: false, message: 'Enter a URL or search term.' }
  }

  if (!/^https?:\/\//i.test(text)) {
    return { type: 'search', label: 'Search query', valid: true, message: 'Will resolve with the top YouTube search result.' }
  }

  let parsedUrl
  try {
    parsedUrl = new URL(text)
  } catch {
    return { type: 'invalid-url', label: 'Invalid URL', valid: false, message: 'Enter a valid http or https URL.' }
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
      message: 'This URL could mean a single video or a playlist. Use a clearer URL for now.',
    }
  }

  if (isYoutube && hasList) {
    return { type: 'playlist', label: 'Playlist URL', valid: true, message: 'Playlist items will expand lazily during playback.' }
  }

  return { type: 'url', label: 'Direct URL', valid: true, message: 'This source will resolve directly at playback time.' }
}

export function validateSoundscapeDraft(draft) {
  if (!draft) {
    return {
      isValid: false,
      normalized: null,
      fieldErrors: {},
      keywordErrors: [],
      trackErrors: [],
      trackTypes: [],
    }
  }

  const fieldErrors = {}
  const keywordErrors = draft.keywords.map(() => '')
  const trackErrors = draft.tracks.map(() => '')
  const trackTypes = draft.tracks.map((track) => inferTrackSource(track))

  const normalizedName = normalizeText(draft.name)
  if (!normalizedName) {
    fieldErrors.name = 'Soundscape name cannot be empty.'
  }

  const normalizedKeywords = draft.keywords.map((keyword) => normalizeText(keyword))

  const seenKeywords = new Map()
  normalizedKeywords.forEach((keyword, index) => {
    if (!keyword) {
      keywordErrors[index] = 'Keyword cannot be blank.'
      return
    }
    const dedupeKey = keyword.toLowerCase()
    if (seenKeywords.has(dedupeKey)) {
      keywordErrors[index] = 'Duplicate keyword.'
      const firstIndex = seenKeywords.get(dedupeKey)
      if (!keywordErrors[firstIndex]) {
        keywordErrors[firstIndex] = 'Duplicate keyword.'
      }
      return
    }
    seenKeywords.set(dedupeKey, index)
  })

  const normalizedTracks = draft.tracks.map((track) => normalizeText(track))
  if (normalizedTracks.length === 0) {
    fieldErrors.tracks = 'Add at least one track source.'
  }

  const seenTracks = new Map()
  normalizedTracks.forEach((track, index) => {
    const inferred = trackTypes[index]
    if (!inferred.valid) {
      trackErrors[index] = inferred.message
      return
    }
    const dedupeKey = track.toLowerCase()
    if (seenTracks.has(dedupeKey)) {
      trackErrors[index] = 'Duplicate track source.'
      const firstIndex = seenTracks.get(dedupeKey)
      if (!trackErrors[firstIndex]) {
        trackErrors[firstIndex] = 'Duplicate track source.'
      }
      return
    }
    seenTracks.set(dedupeKey, index)
  })

  const hasKeywordErrors = keywordErrors.some(Boolean)
  const hasTrackErrors = trackErrors.some(Boolean)
  const hasFieldErrors = Object.keys(fieldErrors).length > 0

  return {
    isValid: !hasFieldErrors && !hasKeywordErrors && !hasTrackErrors,
    normalized: {
      soundscapeId: draft.soundscapeId || draft.collectionId,
      collectionId: draft.collectionId,
      name: normalizedName,
      keywords: normalizedKeywords,
      tracks: normalizedTracks,
    },
    fieldErrors,
    keywordErrors,
    trackErrors,
    trackTypes,
  }
}

export function validateCollectionDraft(draft) {
  return validateSoundscapeDraft(draft)
}