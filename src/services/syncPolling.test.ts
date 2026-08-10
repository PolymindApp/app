import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SYNC_PULL_INTERVAL_MS,
  MAX_IDLE_SYNC_PULL_INTERVAL_MS,
  nextSyncPullDelay,
} from './syncPolling'

describe('sync polling cadence', () => {
  it('backs off repeated idle pulls up to five minutes', () => {
    let delay = ACTIVE_SYNC_PULL_INTERVAL_MS
    delay = nextSyncPullDelay(delay, false)
    expect(delay).toBe(240_000)
    delay = nextSyncPullDelay(delay, false)
    expect(delay).toBe(MAX_IDLE_SYNC_PULL_INTERVAL_MS)
    expect(nextSyncPullDelay(delay, false)).toBe(MAX_IDLE_SYNC_PULL_INTERVAL_MS)
  })

  it('returns to the active cadence after sync activity', () => {
    expect(nextSyncPullDelay(MAX_IDLE_SYNC_PULL_INTERVAL_MS, true))
      .toBe(ACTIVE_SYNC_PULL_INTERVAL_MS)
  })
})
