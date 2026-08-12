import { BackgroundRunner } from '@capacitor/background-runner'
import { Capacitor, registerPlugin } from '@capacitor/core'

interface BackgroundSyncStagePlugin {
  set(options: { value: string }): Promise<void>
  clear(): Promise<void>
}

const NativeBackgroundSyncStage = registerPlugin<BackgroundSyncStagePlugin>('BackgroundSyncStage')
const RUNNER_LABEL = 'app.polymind.sync'
let lastStagedValue: string | undefined

function usesAndroidStageBridge() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function writeBackgroundSyncStage(details: Record<string, unknown>) {
  if (!Capacitor.isNativePlatform()) return
  if (Array.isArray(details.operations) && details.operations.length === 0) {
    await removeBackgroundSyncStage()
    return
  }
  const value = JSON.stringify(details)
  if (value === lastStagedValue) return

  if (usesAndroidStageBridge()) {
    await NativeBackgroundSyncStage.set({ value })
  } else {
    await BackgroundRunner.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'stageSync',
      details,
    })
  }
  lastStagedValue = value
}

export async function removeBackgroundSyncStage() {
  if (!Capacitor.isNativePlatform()) return

  if (usesAndroidStageBridge()) {
    await NativeBackgroundSyncStage.clear()
  } else {
    await BackgroundRunner.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'clearSync',
      details: {},
    })
  }
  lastStagedValue = undefined
}
