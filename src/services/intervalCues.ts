import type { IntervalCueSettings } from '@/types/domain'

let audioContext: AudioContext | undefined

async function prepareIntervalAudio() {
  audioContext ||= new AudioContext()
  if (audioContext.state === 'suspended') await audioContext.resume()
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

export function playIntervalCue(cues: IntervalCueSettings) {
  try {
    if (cues.soundEnabled) {
      audioContext ||= new AudioContext()
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      const frequencies = { beep: 880, bell: 660, soft: 440 }
      oscillator.frequency.value = frequencies[cues.sound]
      oscillator.type = cues.sound === 'soft' ? 'sine' : 'triangle'
      gain.gain.setValueAtTime(.0001, audioContext.currentTime)
      gain.gain.exponentialRampToValueAtTime(.22, audioContext.currentTime + .02)
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + (cues.sound === 'bell' ? .8 : .32))
      oscillator.connect(gain).connect(audioContext.destination)
      oscillator.start()
      oscillator.stop(audioContext.currentTime + (cues.sound === 'bell' ? .85 : .36))
    }
  } catch {
    // Continue silently if audio is unavailable.
  }
  if (cues.vibrationEnabled && 'vibrate' in navigator) navigator.vibrate([120, 60, 120])
}

export async function previewIntervalCue(cues: IntervalCueSettings) {
  try {
    await prepareIntervalAudio()
    playIntervalCue({ ...cues, soundEnabled: true, vibrationEnabled: false })
  } catch {
    // Sound previews remain best-effort when audio is unavailable.
  }
}

export async function notifyIntervalTransition(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  const options = {
    body,
    icon: '/brand/rep-mark.png',
    badge: '/brand/rep-mark.png',
    tag: 'rep-interval',
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
