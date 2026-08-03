import { nativeBackgroundIntervalIsActive } from '@/services/backgroundInterval'

export function createIntervalCueHandoff(
  initialVisibility: DocumentVisibilityState,
  nativeTimerIsActive = nativeBackgroundIntervalIsActive,
) {
  let returningFromBackground = initialVisibility !== 'visible'

  return {
    recordVisibility(visibility: DocumentVisibilityState) {
      if (visibility !== 'visible') returningFromBackground = true
    },
    consumeForegroundSuppression(visibility: DocumentVisibilityState) {
      if (visibility !== 'visible' || !returningFromBackground) return false
      returningFromBackground = false
      return nativeTimerIsActive()
    },
  }
}
