import type { IntervalCueSettings } from '@/types/domain'
import { nativeBackgroundIntervalOwnsCues } from '@/services/backgroundInterval'
export { requestScreenWakeLock as requestIntervalWakeLock } from '@/services/screenWakeLock'

let audioContext: AudioContext | undefined
const cueUrls = {
  count: '/sounds/count.mp3',
  go: '/sounds/go.mp3',
  complete: '/sounds/complete.mp3',
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
  await Promise.all([loadCue('count'), loadCue('go'), loadCue('complete')])
}

async function prepareIntervalAudio() {
  await preloadIntervalCueAudio()
  if (audioContext?.state === 'suspended') await audioContext.resume()
}

async function prepareAudioCue(name: CueName) {
  const buffer = await loadCue(name)
  if (audioContext?.state === 'suspended') await audioContext.resume()
  return buffer
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
  playAudioCue(name)
}

function playAudioCue(name: CueName) {
  void prepareAudioCue(name)
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

function playIntervalSignalCue(name: 'go' | 'complete', cues: IntervalCueSettings) {
  if (nativeBackgroundIntervalOwnsCues()) return
  playCue(name, cues)
  if (cues.vibrationEnabled && 'vibrate' in navigator) navigator.vibrate([120, 60, 120])
}

export function playIntervalGoCue(cues: IntervalCueSettings) {
  playIntervalSignalCue('go', cues)
}

export function playIntervalCompleteCue(cues: IntervalCueSettings) {
  playIntervalSignalCue('complete', cues)
}

export function playReviewCompleteCue() {
  playAudioCue('complete')
}

export async function prepareTaskCompleteCue() {
  try {
    await prepareAudioCue('complete')
  } catch {
    // Task completion audio remains best-effort when playback is unavailable.
  }
}

export function playTaskCompleteCue() {
  playAudioCue('complete')
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
