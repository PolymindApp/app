export const ACTIVE_SYNC_PULL_INTERVAL_MS = 120_000
export const MAX_IDLE_SYNC_PULL_INTERVAL_MS = 300_000

export function nextSyncPullDelay(currentDelay: number, hadActivity: boolean) {
  if (hadActivity) return ACTIVE_SYNC_PULL_INTERVAL_MS
  return Math.min(
    MAX_IDLE_SYNC_PULL_INTERVAL_MS,
    Math.max(ACTIVE_SYNC_PULL_INTERVAL_MS, currentDelay * 2),
  )
}
