import {
  defaultIntervalTypeSounds,
  INTERVAL_STEP_TYPES,
  intervalTypeSound,
  normalizeIntervalTypeSounds,
} from '@/services/intervalTypes'

describe('interval type sounds', () => {
  it('uses the requested defaults for every interval type', () => {
    const sounds = defaultIntervalTypeSounds()

    expect(Object.keys(sounds)).toEqual(INTERVAL_STEP_TYPES.map(type => type.value))
    expect(sounds).toEqual({
      train: 'go',
      work: 'cash',
      rest: 'copper-bell',
      prepare: 'chime',
      meditation: 'gong',
      confirmation: 'confirm',
      custom: 'notification',
    })
  })

  it('normalizes missing and invalid assignments without discarding valid sounds', () => {
    const sounds = normalizeIntervalTypeSounds({ work: 'count', rest: 'bell', meditation: 'none' })

    expect(sounds.work).toBe('count')
    expect(sounds.rest).toBe('copper-bell')
    expect(sounds.meditation).toBe('none')
    expect(sounds.confirmation).toBe('confirm')
  })

  it('resolves missing assignments to each interval type default', () => {
    const sounds = { ...defaultIntervalTypeSounds(), rest: 'complete' as const }

    expect(intervalTypeSound(sounds, 'rest')).toBe('complete')
    expect(intervalTypeSound(sounds, '')).toBe('go')
    expect(intervalTypeSound(undefined, 'work')).toBe('cash')
  })
})
