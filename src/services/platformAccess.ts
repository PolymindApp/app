import { Capacitor } from '@capacitor/core'

export function isAndroidOrIosClient(
  platform = Capacitor.getPlatform(),
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
) {
  if (platform === 'android' || platform === 'ios') return true
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return true

  // Recent iPads can identify themselves as macOS in the browser.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}
