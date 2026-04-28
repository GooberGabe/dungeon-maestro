import { describe, expect, it } from 'vitest'

import { inferTrackSource, validateSoundscapeDraft } from './libraryEditor'

describe('inferTrackSource', () => {
  it('identifies search queries as valid sources', () => {
    const result = inferTrackSource('ambient tavern music')
    expect(result.valid).toBe(true)
    expect(result.type).toBe('search')
  })

  it('rejects ambiguous youtube playlist+video URLs', () => {
    const result = inferTrackSource('https://www.youtube.com/watch?v=abc123&list=PL123')
    expect(result.valid).toBe(false)
    expect(result.type).toBe('ambiguous-youtube')
  })
})

describe('validateSoundscapeDraft', () => {
  it('flags duplicate keywords and tracks', () => {
    const validation = validateSoundscapeDraft({
      soundscapeId: 'combat',
      collectionId: 'combat',
      name: 'Combat',
      keywords: ['fight', 'Fight'],
      tracks: ['https://example.com/a', 'https://example.com/a'],
      shuffle: false,
      startupMode: 'no_preload',
    })

    expect(validation.isValid).toBe(false)
    expect(validation.keywordErrors[0]).toBe('Duplicate keyword.')
    expect(validation.keywordErrors[1]).toBe('Duplicate keyword.')
    expect(validation.trackErrors[0]).toBe('Duplicate track source.')
    expect(validation.trackErrors[1]).toBe('Duplicate track source.')
  })
})
