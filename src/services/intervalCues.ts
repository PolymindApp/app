import {
  defaultIntervalTypeSounds,
  intervalTypeSound,
  normalizeIntervalTypeSounds,
} from '@/services/intervalTypes'
import type {
  IntervalCueSettings,
  IntervalCueSound,
  IntervalStepKind,
} from '@/types/domain'
import {
  nativeBackgroundIntervalOwnsCues,
  playNativeIntervalCue,
} from '@/services/backgroundInterval'
export { requestScreenWakeLock as requestIntervalWakeLock } from '@/services/screenWakeLock'

let audioContext: AudioContext | undefined
type PlayableIntervalCueSound = Exclude<IntervalCueSound, 'none'>
type AppCueSound = PlayableIntervalCueSound | 'eject'
const cueUrls = {
  cash: '/sounds/cash.mp3',
  celestial: '/sounds/celestial.mp3',
  chime: '/sounds/chime.mp3',
  'cine-boom': '/sounds/cine-boom.mp3',
  'cine-hit': '/sounds/cine-hit.mp3',
  confirm: '/sounds/confirm.mp3',
  gong: '/sounds/gong.mp3',
  harp: '/sounds/harp.mp3',
  magic: '/sounds/magic.mp3',
  notification: '/sounds/notification.mp3',
  count: '/sounds/count.mp3',
  go: '/sounds/go.mp3',
  complete: '/sounds/complete.mp3',
  'copper-bell': '/sounds/copper-bell.mp3',
  eject: '/sounds/eject.mp3',
} as const satisfies Record<AppCueSound, string>
type CueName = AppCueSound

const cueData: Partial<Record<CueName, ArrayBuffer>> = {}
const cueDataLoads: Partial<Record<CueName, Promise<ArrayBuffer>>> = {}
const cueBuffers: Partial<Record<CueName, AudioBuffer>> = {}
const cueBufferLoads: Partial<Record<CueName, Promise<AudioBuffer>>> = {}
let activeCountSource: AudioBufferSourceNode | undefined
let activeSignalSource: AudioBufferSourceNode | undefined
let signalGeneration = 0
let latestSignalRequest = 0

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

export async function preloadIntervalCueAudio(
  sounds: readonly IntervalCueSound[] = Object.values(defaultIntervalTypeSounds()),
) {
  const names = new Set<CueName>(['count', 'complete'])
  for (const sound of sounds) {
    if (sound !== 'none') names.add(sound)
  }
  await Promise.all([...names].map(loadCue))
}

async function prepareIntervalAudio(cues: IntervalCueSettings) {
  await preloadIntervalCueAudio(Object.values(normalizeIntervalTypeSounds(cues.typeSounds)))
  if (audioContext?.state === 'suspended') await audioContext.resume()
}

async function prepareAudioCue(name: CueName) {
  const buffer = await loadCue(name)
  if (audioContext?.state === 'suspended') await audioContext.resume()
  return buffer
}

export async function prepareIntervalCues(cues: IntervalCueSettings) {
  try {
    if (cues.soundEnabled) await prepareIntervalAudio(cues)
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

function playCue(name: CueName, cues: IntervalCueSettings, forceSignal = false) {
  if (!cues.soundEnabled || nativeBackgroundIntervalOwnsCues()) return
  const nativePlayback = playNativeIntervalCue(name, forceSignal)
  void nativePlayback
    .then((playedNatively) => {
      if (!playedNatively) playAudioCue(name, forceSignal)
    })
    .catch(() => {
      // Fall back to Web Audio if the Android bridge cannot accept the cue.
      playAudioCue(name, forceSignal)
    })
}

function playAudioCue(name: CueName, forceSignal = false) {
  const isSignal = forceSignal || name !== 'count'
  if (isSignal) signalGeneration += 1
  const requestedGeneration = signalGeneration
  const signalRequest = isSignal ? ++latestSignalRequest : latestSignalRequest

  void prepareAudioCue(name)
    .then((buffer) => {
      if (!audioContext) return
      if (!isSignal && requestedGeneration !== signalGeneration) return
      if (isSignal && signalRequest !== latestSignalRequest) return
      if (!isSignal && activeSignalSource) return

      const stopSource = (source: AudioBufferSourceNode | undefined) => {
        try {
          source?.stop()
        } catch {
          // The source may already have ended naturally.
        }
      }
      stopSource(activeCountSource)
      activeCountSource = undefined
      if (isSignal) {
        stopSource(activeSignalSource)
        activeSignalSource = undefined
      }

      const source = audioContext.createBufferSource()
      source.buffer = buffer
      source.connect(audioContext.destination)
      if (isSignal) activeSignalSource = source
      else activeCountSource = source
      source.onended = () => {
        if (activeCountSource === source) activeCountSource = undefined
        if (activeSignalSource === source) activeSignalSource = undefined
      }
      source.start()
    })
    .catch(() => {
      // Continue silently if audio is unavailable.
    })
}

export function playIntervalCountCue(cues: IntervalCueSettings) {
  playCue('count', cues)
}

function playIntervalSignalCue(name: IntervalCueSound, cues: IntervalCueSettings) {
  if (nativeBackgroundIntervalOwnsCues()) return
  if (name !== 'none') playCue(name, cues, true)
  if (cues.vibrationEnabled && 'vibrate' in navigator) navigator.vibrate([120, 60, 120])
}

export function playIntervalGoCue(
  cues: IntervalCueSettings,
  kind?: IntervalStepKind | '',
) {
  playIntervalSignalCue(intervalTypeSound(cues.typeSounds, kind), cues)
}

export function playIntervalCompleteCue(cues: IntervalCueSettings) {
  playIntervalSignalCue('complete', cues)
}

export async function previewIntervalCueSound(sound: IntervalCueSound) {
  if (sound === 'none') return
  await prepareAudioCue(sound)
  playCue(sound, { soundEnabled: true, vibrationEnabled: false }, true)
}

export function playReviewCompleteCue() {
  playAudioCue('complete')
}

export async function prepareFlashcardEjectCue() {
  try {
    await prepareAudioCue('eject')
  } catch {
    // Eject audio remains best-effort when playback is unavailable.
  }
}

export function playFlashcardEjectCue() {
  playCue('eject', { soundEnabled: true, vibrationEnabled: false }, true)
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
    icon: '/brand/polymind-mark.png',
    badge: '/brand/polymind-mark.png',
    tag: 'polymind-interval',
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
