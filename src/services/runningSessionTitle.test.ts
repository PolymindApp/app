import { describe, expect, it } from 'vitest'
import {
  formatRunningSessionTitle,
  RUNNING_SESSION_TITLE_FRAMES,
} from '@/services/runningSessionTitle'

describe('running session document title', () => {
  it('prepends an ASCII running-dot frame and wraps the sequence', () => {
    expect(formatRunningSessionTitle('Mom — Management of Me', 0))
      .toBe('[.  ] Mom — Management of Me')
    expect(formatRunningSessionTitle('Mom', RUNNING_SESSION_TITLE_FRAMES.length))
      .toBe('[.  ] Mom')
  })

  it('uses a stable status prefix when reduced motion is requested', () => {
    expect(formatRunningSessionTitle('Mom', 3, true)).toBe('[RUN] Mom')
  })
})
