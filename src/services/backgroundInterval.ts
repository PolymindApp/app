import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  flashcardSpeechOverAmplificationIsEnabled,
  resolveFlashcardAudioPlaybackUrl,
} from '@/services/flashcardSpeech'
import { intervalTypeSound } from '@/services/intervalTypes'
import {
  intervalFlashcardReviewElapsedMs,
  intervalStepCount,
  intervalStepDurationSeconds,
  intervalStepPlaysFlashcardReview,
  reconcileIntervalRuntime,
  resolveIntervalStep,
} from '@/services/intervals'
import type { IntervalCueSound, IntervalSession } from '@/types/domain'

interface BackgroundIntervalStep {
  name: string
  durationMs: number
  requiresConfirmation: boolean
  flashcardReviewEnabled: boolean
  cueSound: IntervalCueSound
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
      cards: Array<{
        front: string
        back: string
        frontAudio: string
        backAudio: string
      }>
      cardSides: 'both' | 'front' | 'back'
      frontSeconds: number
      backSeconds: number
      backSpeechRepeatCount: number
      speechEnabled: boolean
      frontLanguage: string
      backLanguage: string
      overAmplified: boolean
    }
  }): Promise<void>
  playCue(options: { name: NativeIntervalCueName, signal?: boolean }): Promise<void>
  stop(): Promise<void>
}

export type NativeIntervalCueName = Exclude<IntervalCueSound, 'none'> | 'eject'
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
      flashcardReviewEnabled: intervalStepPlaysFlashcardReview(resolved.step),
      cueSound: intervalTypeSound(session.cues.typeSounds, resolved.step.kind),
    })
  }
  return steps
}

export async function syncBackgroundInterval(session: IntervalSession) {
  if (Capacitor.getPlatform() !== 'android' || session.status !== 'running') return
  try {
    const runtime = reconcileIntervalRuntime(session.definition, session.runtime).runtime
    const playbackOffsetMs = session.flashcardReview?.playbackOffsetMs
    const nativeFlashcardReviewElapsedMs = (
      runtime.flashcardReviewAccumulatedMs
        ?? intervalFlashcardReviewElapsedMs(
          session.definition,
          runtime.stepIndex,
          runtime.remainingMs,
        )
    ) + (Number.isFinite(playbackOffsetMs)
      ? playbackOffsetMs!
      : 0)
    await BackgroundInterval.start({
      sessionId: session.id,
      sessionName: session.name,
      steps: nativeSteps(session),
      stepIndex: runtime.stepIndex,
      remainingMs: Math.max(1, Math.round(runtime.remainingMs)),
      elapsedMs: Math.max(0, Math.round(nativeFlashcardReviewElapsedMs)),
      soundEnabled: session.cues.soundEnabled,
      vibrationEnabled: session.cues.vibrationEnabled,
      ...(session.flashcardReview?.speechEnabled
        ? {
            flashcardReview: {
              name: session.flashcardReview.name,
              cards: session.flashcardReview.cards.map(card => ({
                front: card.front,
                back: card.back,
                frontAudio: resolveFlashcardAudioPlaybackUrl(card.frontAudio || ''),
                backAudio: resolveFlashcardAudioPlaybackUrl(card.backAudio || ''),
              })),
              cardSides: session.flashcardReview.cardSides,
              frontSeconds: session.flashcardReview.frontSeconds,
              backSeconds: session.flashcardReview.backSeconds,
              backSpeechRepeatCount: session.flashcardReview.backSpeechRepeatCount,
              speechEnabled: !session.flashcardReview.speechPaused,
              frontLanguage: session.flashcardReview.frontLanguage,
              backLanguage: session.flashcardReview.backLanguage,
              overAmplified: flashcardSpeechOverAmplificationIsEnabled(),
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

export async function playNativeIntervalCue(name: NativeIntervalCueName, signal = false) {
  if (Capacitor.getPlatform() !== 'android') return false
  await BackgroundInterval.playCue({ name, ...(signal ? { signal: true } : {}) })
  return true
}

export function nativeBackgroundIntervalOwnsCues() {
  return nativeBackgroundIntervalActive
    && typeof document !== 'undefined'
    && document.visibilityState !== 'visible'
}

export function nativeBackgroundIntervalIsActive() {
  return nativeBackgroundIntervalActive
}
