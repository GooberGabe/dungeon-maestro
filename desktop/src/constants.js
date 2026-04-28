export const VIEW_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'hud'
  ? 'hud'
  : 'dashboard'

export const assetPath = (name) => `${import.meta.env.BASE_URL}${name}`

export const ICONS = {
  flip: assetPath('flip.svg'),
  next: assetPath('next-button.svg'),
  play: assetPath('play-button.svg'),
  playDisabled: assetPath('play-button-grayed-out.svg'),
  pause: assetPath('pause-button.svg'),
  speaker: assetPath('speaker.svg'),
  mute: assetPath('mute.svg'),
  logo: assetPath('logo-min-gold.svg'),
}

export function getSoundscapeId(soundscape) {
  return soundscape?.soundscapeId || soundscape?.collectionId || ''
}

export function getSoundscapeList(bootstrap) {
  return bootstrap?.config?.soundscapes || []
}

export function getDefaultSoundscapeId(bootstrap) {
  return bootstrap?.config?.settings?.defaultSoundscape
    || bootstrap?.config?.settings?.default_soundscape
    || bootstrap?.config?.settings?.default_collection
    || getSoundscapeId(getSoundscapeList(bootstrap)[0])
    || ''
}

export function getActiveSoundscapeId(state, bootstrap) {
  return state?.activeSoundscape || state?.activeCollection || getDefaultSoundscapeId(bootstrap)
}