import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

const native = Capacitor.isNativePlatform()
const android = Capacitor.getPlatform() === 'android'
const ANDROID_SELECTION_PULSE_MS = 5
const DRAG_ACTIVATION_PULSE_MS = 20

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

function browserVibrationFallback() {
  try {
    navigator.vibrate?.(DRAG_ACTIVATION_PULSE_MS)
  } catch {
    // Vibration support varies by browser and device.
  }
}

export function dragActivationFeedback() {
  if (!native) {
    browserVibrationFallback()
    return
  }

  const feedback = android
    ? Haptics.vibrate({ duration: DRAG_ACTIVATION_PULSE_MS })
    : Haptics.impact({ style: ImpactStyle.Light })
  void feedback.catch(browserVibrationFallback)
}
