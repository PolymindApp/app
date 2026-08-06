import { Capacitor, registerPlugin } from '@capacitor/core'

interface NativeScreenWakeLockPlugin {
  acquire(options: { token: string }): Promise<void>
  release(options: { token: string }): Promise<void>
}

export interface ScreenWakeLock {
  release: () => Promise<void>
}

const NativeScreenWakeLock = registerPlugin<NativeScreenWakeLockPlugin>('ScreenWakeLock')
let wakeLockSequence = 0

function nativeAndroidIsAvailable() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()
}

async function requestBrowserWakeLock(): Promise<ScreenWakeLock | undefined> {
  try {
    return await (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<ScreenWakeLock> }
    }).wakeLock?.request('screen')
  } catch {
    return undefined
  }
}

export async function requestScreenWakeLock(): Promise<ScreenWakeLock | undefined> {
  if (!nativeAndroidIsAvailable()) return requestBrowserWakeLock()

  const token = `screen-${Date.now()}-${++wakeLockSequence}`
  try {
    await NativeScreenWakeLock.acquire({ token })
    let released = false
    return {
      release: async () => {
        if (released) return
        released = true
        try {
          await NativeScreenWakeLock.release({ token })
        } catch {
          // Releasing a screen flag is best-effort while the Activity is shutting down.
        }
      },
    }
  } catch {
    return requestBrowserWakeLock()
  }
}
