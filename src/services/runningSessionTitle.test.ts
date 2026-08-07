import { describe, expect, it } from 'vitest'
import {
  formatRunningSessionTitle,
  RUNNING_SESSION_TITLE_FRAMES,
} from '@/services/runningSessionTitle'

describe('running session document title', () => {
  it('prepends an ASCII running-dot frame and wraps the sequence', () => {
    expect(formatRunningSessionTitle('Polymind — Many systems. One mind.', 0))
      .toBe('[.  ] Polymind — Many systems. One mind.')
    expect(formatRunningSessionTitle('Polymind', RUNNING_SESSION_TITLE_FRAMES.length))
      .toBe('[.  ] Polymind')
  })

  it('uses a stable status prefix when reduced motion is requested', () => {
    expect(formatRunningSessionTitle('Polymind', 3, true)).toBe('[RUN] Polymind')
  })
})
