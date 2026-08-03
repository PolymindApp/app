import { createIntervalCueHandoff } from './intervalCueHandoff'

describe('interval cue foreground handoff', () => {
  it('suppresses only the first foreground reconciliation after the native timer handled the background', () => {
    const handoff = createIntervalCueHandoff('visible', () => true)

    handoff.recordVisibility('hidden')

    expect(handoff.consumeForegroundSuppression('visible')).toBe(true)
    expect(handoff.consumeForegroundSuppression('visible')).toBe(false)
  })

  it('does not consume the handoff while the app remains hidden', () => {
    const handoff = createIntervalCueHandoff('hidden', () => true)

    expect(handoff.consumeForegroundSuppression('hidden')).toBe(false)
    expect(handoff.consumeForegroundSuppression('visible')).toBe(true)
  })

  it('keeps foreground cues enabled when the native timer was unavailable', () => {
    const handoff = createIntervalCueHandoff('hidden', () => false)

    expect(handoff.consumeForegroundSuppression('visible')).toBe(false)
  })
})
