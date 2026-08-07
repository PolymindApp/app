import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  intervalStepCount,
  intervalStepDurationSeconds,
  resolveIntervalStep,
} from '@/services/intervals'
import type { IntervalSession } from '@/types/domain'

interface BackgroundIntervalStep {
  name: string
  durationMs: number
  requiresConfirmation: boolean
}

interface BackgroundIntervalPlugin {
  start(options: {
    sessionId: string
    sessionName: string
    steps: BackgroundIntervalStep[]
    stepIndex: number
    remainingMs: number
    elapsedMs: number
    soundEnabled: boolean
    vibrationEnabled: boolean
    flashcardReview?: {
      name: string
      cards: Array<{ front: string; back: string }>
      frontSeconds: number
      backSeconds: number
      backSpeechRepeatCount: number
      speechEnabled: boolean
      frontLanguage: string
      backLanguage: string
    }
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
      durationMs: Math.max(1, Math.round(intervalStepDurationSeconds(resolved.step) * 1000)),
      requiresConfirmation: resolved.step.kind === 'confirmation',
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
      elapsedMs: Math.max(0, Math.round(
        session.runtime.accumulatedMs
        + (session.runtime.stepStartedAt
          ? Math.max(0, Date.now() - new Date(session.runtime.stepStartedAt).getTime())
          : 0),
      )),
      soundEnabled: session.cues.soundEnabled,
      vibrationEnabled: session.cues.vibrationEnabled,
      ...(session.flashcardReview?.speechEnabled
        ? {
            flashcardReview: {
              name: session.flashcardReview.name,
              cards: session.flashcardReview.cards.map(card => ({
                front: card.front,
                back: card.back,
              })),
              frontSeconds: session.flashcardReview.frontSeconds,
              backSeconds: session.flashcardReview.backSeconds,
              backSpeechRepeatCount: session.flashcardReview.backSpeechRepeatCount,
              speechEnabled: true,
              frontLanguage: session.flashcardReview.frontLanguage,
              backLanguage: session.flashcardReview.backLanguage,
            },
          }
        : {}),
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

export function nativeBackgroundIntervalIsActive() {
  return nativeBackgroundIntervalActive
}
