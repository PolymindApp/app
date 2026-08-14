const TRACKING_CHART_INACTIVE_TRACKERS_STORAGE_KEY = 'polymind-tracking-chart-inactive-trackers'

function normalizeTrackerIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

export function readInactiveTrackingChartTrackerIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return normalizeTrackerIds(JSON.parse(
      localStorage.getItem(TRACKING_CHART_INACTIVE_TRACKERS_STORAGE_KEY) || '[]',
    ))
  } catch {
    return []
  }
}

export function storeInactiveTrackingChartTrackerIds(value: string[]): string[] {
  const trackerIds = normalizeTrackerIds(value)
  if (typeof localStorage === 'undefined') return trackerIds
  try {
    localStorage.setItem(TRACKING_CHART_INACTIVE_TRACKERS_STORAGE_KEY, JSON.stringify(trackerIds))
  } catch {
    // Legend toggles remain usable in memory when device storage is unavailable.
  }
  return trackerIds
}
