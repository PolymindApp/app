import type { IntervalCueSettings } from '@/types/domain'
import { nativeBackgroundIntervalOwnsCues } from '@/services/backgroundInterval'

let audioContext: AudioContext | undefined
const cueUrls = {
  count: '/sounds/count.mp3',
  go: '/sounds/go.mp3',
} as const
type CueName = keyof typeof cueUrls

const cueData: Partial<Record<CueName, ArrayBuffer>> = {}
const cueDataLoads: Partial<Record<CueName, Promise<ArrayBuffer>>> = {}
const cueBuffers: Partial<Record<CueName, AudioBuffer>> = {}
const cueBufferLoads: Partial<Record<CueName, Promise<AudioBuffer>>> = {}

function fetchCue(name: CueName) {
  if (cueData[name]) return Promise.resolve(cueData[name])
  if (cueDataLoads[name]) return cueDataLoads[name]

  const load = fetch(cueUrls[name])
    .then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${name} interval cue.`)
      const data = await response.arrayBuffer()
      cueData[name] = data
      return data
    })
    .catch((error) => {
      delete cueDataLoads[name]
      throw error
    })
  cueDataLoads[name] = load
  return load
}

function loadCue(name: CueName) {
  if (cueBuffers[name]) return cueBuffers[name]
  if (cueBufferLoads[name]) return cueBufferLoads[name]

  const load = fetchCue(name)
    .then((data) => {
      audioContext ||= new AudioContext()
      return audioContext.decodeAudioData(data.slice(0))
    })
    .then((buffer) => {
      cueBuffers[name] = buffer
      return buffer
    })
    .catch((error) => {
      delete cueBufferLoads[name]
      throw error
    })
  cueBufferLoads[name] = load
  return load
}

export async function preloadIntervalCueAudio() {
  await Promise.all([loadCue('count'), loadCue('go')])
}

async function prepareIntervalAudio() {
  await preloadIntervalCueAudio()
  if (audioContext?.state === 'suspended') await audioContext.resume()
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

function playCue(name: CueName, cues: IntervalCueSettings) {
  if (!cues.soundEnabled || nativeBackgroundIntervalOwnsCues()) return
  void Promise.all([loadCue(name), prepareIntervalAudio()])
    .then(([buffer]) => {
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
