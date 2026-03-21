export const VIEW_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'hud'
  ? 'hud'
  : 'dashboard'

export const ICONS = {
  flip: '/flip.svg',
  next: '/next-button.svg',
  play: '/play-button.svg',
  playDisabled: '/play-button-grayed-out.svg',
  pause: '/pause-button.svg',
  speaker: '/speaker.svg',
  mute: '/mute.svg',
  logo: '/logo-min-gold.svg',
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