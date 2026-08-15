import { describe, expect, it } from 'vitest'
import {
  formatRunningSessionTitle,
  RUNNING_SESSION_TITLE_FRAMES,
} from '@/services/runningSessionTitle'

describe('running session document title', () => {
  it('prepends an ASCII running-dot frame and wraps the sequence', () => {
    expect(formatRunningSessionTitle('BackOnTrack — Make life programmable.', 0))
      .toBe('[.  ] BackOnTrack — Make life programmable.')
    expect(formatRunningSessionTitle('BackOnTrack', RUNNING_SESSION_TITLE_FRAMES.length))
      .toBe('[.  ] BackOnTrack')
  })

  it('uses a stable status prefix when reduced motion is requested', () => {
    expect(formatRunningSessionTitle('BackOnTrack', 3, true)).toBe('[RUN] BackOnTrack')
  })
})
