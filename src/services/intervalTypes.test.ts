import {
  defaultIntervalTypeSounds,
  INTERVAL_STEP_TYPES,
  intervalTypeSound,
  normalizeIntervalTypeSounds,
} from '@/services/intervalTypes'

describe('interval type sounds', () => {
  it('defaults every interval type to the existing Go cue', () => {
    const sounds = defaultIntervalTypeSounds()

    expect(Object.keys(sounds)).toEqual(INTERVAL_STEP_TYPES.map(type => type.value))
    expect(Object.values(sounds).every(sound => sound === 'go')).toBe(true)
  })

  it('normalizes missing and invalid assignments without discarding valid sounds', () => {
    const sounds = normalizeIntervalTypeSounds({ work: 'count', rest: 'bell', meditation: 'none' })

    expect(sounds.work).toBe('count')
    expect(sounds.rest).toBe('go')
    expect(sounds.meditation).toBe('none')
    expect(sounds.confirmation).toBe('go')
  })

  it('resolves empty and missing interval types to the Go cue', () => {
    const sounds = { ...defaultIntervalTypeSounds(), rest: 'complete' as const }

    expect(intervalTypeSound(sounds, 'rest')).toBe('complete')
    expect(intervalTypeSound(sounds, '')).toBe('go')
    expect(intervalTypeSound(undefined, 'work')).toBe('go')
  })
})
