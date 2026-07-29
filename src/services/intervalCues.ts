import type { IntervalCueSettings } from '@/types/domain'
import { nativeBackgroundIntervalOwnsCues } from '@/services/backgroundInterval'

let audioContext: AudioContext | undefined
const cueUrls = {
  count: '/sounds/count.mp3',
  go: '/sounds/go.mp3',
} as const
const cueBuffers: Partial<Record<keyof typeof cueUrls, AudioBuffer>> = {}

async function loadCue(name: keyof typeof cueUrls) {
  audioContext ||= new AudioContext()
  if (audioContext.state === 'suspended') await audioContext.resume()
  if (cueBuffers[name]) return cueBuffers[name]
  const response = await fetch(cueUrls[name])
  if (!response.ok) throw new Error(`Could not load ${name} interval cue.`)
  const buffer = await audioContext.decodeAudioData(await response.arrayBuffer())
  cueBuffers[name] = buffer
  return buffer
}

async function prepareIntervalAudio() {
  await Promise.all([loadCue('count'), loadCue('go')])
}

export async function prepareIntervalCues(cues: IntervalCueSettings) {
  try {
    if (cues.soundEnabled) await prepareIntervalAudio()
  } catch {
    // Audio remains best-effort when the browser requires another user gesture.
  }
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  } catch {
    // Notification support and permission vary across mobile browsers.
  }
}

function playCue(name: keyof typeof cueUrls, cues: IntervalCueSettings) {
  if (!cues.soundEnabled || nativeBackgroundIntervalOwnsCues()) return
  void loadCue(name)
    .then((buffer) => {
      if (!audioContext) return
      const source = audioContext.createBufferSource()
      source.buffer = buffer
      source.connect(audioContext.destination)
      source.start()
    })
    .catch(() => {
      // Continue silently if audio is unavailable.
    })
}

export function playIntervalCountCue(cues: IntervalCueSettings) {
  playCue('count', cues)
}

export function playIntervalGoCue(cues: IntervalCueSettings) {
  if (nativeBackgroundIntervalOwnsCues()) return
  playCue('go', cues)
  if (cues.vibrationEnabled && 'vibrate' in navigator) navigator.vibrate([120, 60, 120])
}

export async function notifyIntervalTransition(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const options = {
    body,
    icon: '/brand/mom-mark.png',
    badge: '/brand/mom-mark.png',
    tag: 'mom-interval',
    renotify: true,
  }
  const registration = await navigator.serviceWorker?.getRegistration()
  try {
    if (registration) await registration.showNotification(title, options)
    else new Notification(title, options)
  } catch {
    // Notifications are best-effort and must never interrupt the timer.
  }
}

export async function requestIntervalWakeLock() {
  try {
    return await (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen')
  } catch {
    return undefined
  }
}
