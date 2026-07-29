import { Capacitor, registerPlugin } from '@capacitor/core'
import { intervalStepCount, resolveIntervalStep } from '@/services/intervals'
import type { IntervalSession } from '@/types/domain'

interface BackgroundIntervalStep {
  name: string
  durationMs: number
}

interface BackgroundIntervalPlugin {
  start(options: {
    sessionId: string
    sessionName: string
    steps: BackgroundIntervalStep[]
    stepIndex: number
    remainingMs: number
    soundEnabled: boolean
    vibrationEnabled: boolean
  }): Promise<void>
  stop(): Promise<void>
}

const BackgroundInterval = registerPlugin<BackgroundIntervalPlugin>('BackgroundInterval')
const MAX_NATIVE_STEPS = 10_000
let nativeBackgroundIntervalActive = false

function nativeSteps(session: IntervalSession) {
  const count = intervalStepCount(session.definition)
  if (count > MAX_NATIVE_STEPS) {
    throw new Error(`Background intervals support up to ${MAX_NATIVE_STEPS.toLocaleString()} expanded steps.`)
  }

  const steps: BackgroundIntervalStep[] = []
  for (let index = 0; index < count; index += 1) {
    const resolved = resolveIntervalStep(session.definition, index)
    if (!resolved) break
    steps.push({
      name: resolved.step.name || `Interval ${index + 1}`,
      durationMs: Math.max(1, Math.round(resolved.step.durationSeconds * 1000)),
    })
  }
  return steps
}

export async function syncBackgroundInterval(session: IntervalSession) {
  if (Capacitor.getPlatform() !== 'android' || session.status !== 'running') return
  try {
    await BackgroundInterval.start({
      sessionId: session.id,
      sessionName: session.name,
      steps: nativeSteps(session),
      stepIndex: session.runtime.stepIndex,
      remainingMs: Math.max(1, Math.round(session.runtime.remainingMs)),
      soundEnabled: session.cues.soundEnabled,
      vibrationEnabled: session.cues.vibrationEnabled,
    })
    nativeBackgroundIntervalActive = true
  } catch (error) {
    nativeBackgroundIntervalActive = false
    throw error
  }
}

export async function stopBackgroundInterval() {
  if (Capacitor.getPlatform() !== 'android') return
  try {
    await BackgroundInterval.stop()
  } finally {
    nativeBackgroundIntervalActive = false
  }
}

export function nativeBackgroundIntervalOwnsCues() {
  return nativeBackgroundIntervalActive
    && typeof document !== 'undefined'
    && document.visibilityState !== 'visible'
}
