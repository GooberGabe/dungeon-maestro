export const VIEW_MODE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('view') === 'hud'
  ? 'hud'
  : 'dashboard'

export const ICONS = {
  flip: '/flip.svg',
  next: '/next-button.svg',
  play: '/play-button.svg',
  pause: '/pause-button.svg',
  speaker: '/speaker.svg',
  mute: '/mute.svg',
  logo: '/logo-min-gold.svg',
}