import { Capacitor } from '@capacitor/core'
import { Haptics } from '@capacitor/haptics'

const native = Capacitor.isNativePlatform()
const android = Capacitor.getPlatform() === 'android'
const ANDROID_SELECTION_PULSE_MS = 5

function bestEffort(feedback: () => Promise<void>) {
  if (!native) return
  void feedback().catch(() => {
    // Haptics are optional and should never interrupt an interaction.
  })
}

export function startSelectionFeedback() {
  if (android) return
  bestEffort(() => Haptics.selectionStart())
}

export function changeSelectionFeedback() {
  bestEffort(() => android
    ? Haptics.vibrate({ duration: ANDROID_SELECTION_PULSE_MS })
    : Haptics.selectionChanged())
}

export function endSelectionFeedback() {
  if (android) return
  bestEffort(() => Haptics.selectionEnd())
}
