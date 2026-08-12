import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  BackgroundFlashcardReviewState,
  FlashcardReviewSession,
  FlashcardReviewCardSides,
  FlashcardReviewSide,
  FlashcardSpeechLanguage,
  FlashcardSpeechSupport,
} from '@/types/domain'

interface NativeSpeechSupport {
  available: boolean
  languages: string[]
}

interface FlashcardSpeechPlugin {
  getLanguages(): Promise<NativeSpeechSupport>
  speak(options: {
    text: string
    language: string
    overAmplified: boolean
    backgroundIntervalSpeechKey?: string
  }): Promise<void>
  setOverAmplification(options: { enabled: boolean }): Promise<void>
  stopSpeaking(): Promise<void>
  startBackground(options: {
    sessionId: string
    sessionName: string
    cards: Array<{ front: string; back: string }>
    indefinite: boolean
    cardSides: FlashcardReviewCardSides
    side: FlashcardReviewSide
    remainingMs: number
    frontSeconds: number
    backSeconds: number
    backSpeechRepeatCount: number
    frontLanguage: string
    backLanguage: string
    elapsedMs: number
    overAmplified: boolean
  }): Promise<void>
  getBackgroundState(): Promise<{ state?: BackgroundFlashcardReviewState }>
  stopBackground(options: { clearState: boolean }): Promise<void>
}

const NativeFlashcardSpeech = registerPlugin<FlashcardSpeechPlugin>('FlashcardSpeech')
const SPEECH_OVER_AMPLIFICATION_STORAGE_KEY = 'polymind-flashcard-speech:over-amplification'
let nativeBackgroundActive = false
let activeBrowserUtterance: SpeechSynthesisUtterance | undefined
let browserVoiceLoad: Promise<SpeechSynthesisVoice[]> | undefined

function storedSpeechOverAmplificationIsEnabled() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(SPEECH_OVER_AMPLIFICATION_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function storeSpeechOverAmplification(enabled: boolean) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SPEECH_OVER_AMPLIFICATION_STORAGE_KEY, String(enabled))
  } catch {
    // Speech remains usable for the current session if device storage is unavailable.
  }
}

let speechOverAmplificationEnabled = storedSpeechOverAmplificationIsEnabled()

function isNativeAndroid() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()
}

export function nativeFlashcardBackgroundIsAvailable() {
  return isNativeAndroid()
}

export function flashcardSpeechOverAmplificationIsEnabled() {
  return speechOverAmplificationEnabled
}

export async function setFlashcardSpeechOverAmplification(enabled: boolean) {
  const previous = speechOverAmplificationEnabled
  speechOverAmplificationEnabled = enabled
  if (!isNativeAndroid()) {
    storeSpeechOverAmplification(enabled)
    return enabled
  }

  try {
    await NativeFlashcardSpeech.setOverAmplification({ enabled })
    storeSpeechOverAmplification(enabled)
    return enabled
  } catch (cause) {
    speechOverAmplificationEnabled = previous
    throw cause
  }
}

export function toggleFlashcardSpeechOverAmplification() {
  return setFlashcardSpeechOverAmplification(!speechOverAmplificationEnabled)
}

export function normalizeSpeechLanguage(value: string) {
  const candidate = value.trim().replaceAll('_', '-')
  if (!candidate) return ''
  try {
    return Intl.getCanonicalLocales(candidate)[0] || candidate
  } catch {
    return candidate
  }
}

export function speechLanguageOptions(
  values: string[],
  displayLocale = typeof navigator === 'undefined' ? 'en' : navigator.language,
): FlashcardSpeechLanguage[] {
  const tags = [...new Set(values.map(normalizeSpeechLanguage).filter(Boolean))]
  let names: Intl.DisplayNames | undefined
  try {
    names = new Intl.DisplayNames([displayLocale], { type: 'language' })
  } catch {
    // Language tags remain understandable when localized display names are unavailable.
  }
  return tags
    .map(tag => ({ tag, title: names?.of(tag) || tag }))
    .sort((left, right) => left.title.localeCompare(right.title))
}

function loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([])
  const synthesis = window.speechSynthesis
  const current = synthesis.getVoices()
  if (current.length) return Promise.resolve(current)
  if (browserVoiceLoad) return browserVoiceLoad

  browserVoiceLoad = new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synthesis.removeEventListener('voiceschanged', finish)
      window.clearTimeout(timeout)
      resolve(synthesis.getVoices())
    }
    const timeout = window.setTimeout(finish, 1000)
    synthesis.addEventListener('voiceschanged', finish, { once: true })
  }).finally(() => {
    browserVoiceLoad = undefined
  })
  return browserVoiceLoad
}

async function browserVoiceLanguages() {
  return (await loadBrowserVoices()).map(voice => voice.lang)
}

function browserVoiceForLanguage(voices: SpeechSynthesisVoice[], language: string) {
  const requested = normalizeSpeechLanguage(language)
  const exact = voices.find(voice => normalizeSpeechLanguage(voice.lang) === requested)
  if (exact) return exact
  const base = requested.split('-')[0]
  return voices.find(voice => voice.default && normalizeSpeechLanguage(voice.lang).split('-')[0] === base)
    || voices.find(voice => normalizeSpeechLanguage(voice.lang).split('-')[0] === base)
}

export async function loadFlashcardSpeechSupport(): Promise<FlashcardSpeechSupport> {
  if (isNativeAndroid()) {
    try {
      const result = await NativeFlashcardSpeech.getLanguages()
      return {
        available: result.available && result.languages.length > 0,
        languages: speechLanguageOptions(result.languages),
      }
    } catch {
      return { available: false, languages: [] }
    }
  }

  if (
    typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof window.SpeechSynthesisUtterance === 'undefined'
  ) return { available: false, languages: [] }

  const languages = speechLanguageOptions(await browserVoiceLanguages())
  return { available: languages.length > 0, languages }
}

export function defaultFlashcardSpeechLanguage(languages: FlashcardSpeechLanguage[]) {
  const preferred = normalizeSpeechLanguage(
    typeof navigator === 'undefined' ? 'en-US' : navigator.language,
  )
  return languages.find(language => language.tag === preferred)?.tag
    || languages.find(language => language.tag.split('-')[0] === preferred.split('-')[0])?.tag
    || languages[0]?.tag
    || ''
}

export async function speakFlashcardText(
  text: string,
  language: string,
  backgroundIntervalSpeechKey = '',
) {
  const content = text.trim()
  if (!content || !language) return
  if (isNativeAndroid()) {
    await NativeFlashcardSpeech.speak({
      text: content,
      language,
      overAmplified: speechOverAmplificationEnabled,
      ...(backgroundIntervalSpeechKey ? { backgroundIntervalSpeechKey } : {}),
    })
    return
  }
  if (
    typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof window.SpeechSynthesisUtterance === 'undefined'
  ) throw new Error('Speech synthesis is not available in this browser.')

  const synthesis = window.speechSynthesis
  const voice = browserVoiceForLanguage(await loadBrowserVoices(), language)
  if (!voice) throw new Error(`No browser voice is available for ${language}.`)
  await stopFlashcardSpeech()

  const utterance = new window.SpeechSynthesisUtterance(content)
  utterance.lang = voice.lang
  utterance.voice = voice
  if (speechOverAmplificationEnabled) utterance.volume = 1
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (cause?: Error) => {
      if (settled) return
      settled = true
      window.clearTimeout(startTimeout)
      if (cause) reject(cause)
      else resolve()
    }
    const clearActive = () => {
      if (activeBrowserUtterance === utterance) activeBrowserUtterance = undefined
    }
    const startTimeout = window.setTimeout(() => {
      clearActive()
      synthesis.cancel()
      settle(new Error('The browser did not start speech synthesis.'))
    }, 2000)
    utterance.onstart = () => settle()
    utterance.onend = () => {
      clearActive()
      settle()
    }
    utterance.onerror = event => {
      clearActive()
      settle(new Error(`Browser speech synthesis failed: ${event.error}.`))
    }
    activeBrowserUtterance = utterance
    try {
      synthesis.resume()
      synthesis.speak(utterance)
    } catch (cause) {
      clearActive()
      settle(cause instanceof Error ? cause : new Error('Browser speech synthesis failed.'))
    }
  })
}

export async function stopFlashcardSpeech() {
  if (isNativeAndroid()) {
    await NativeFlashcardSpeech.stopSpeaking().catch(() => undefined)
    return
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const synthesis = window.speechSynthesis
    if (activeBrowserUtterance || synthesis.speaking || synthesis.pending || synthesis.paused) {
      synthesis.cancel()
    }
    activeBrowserUtterance = undefined
  }
}

export async function syncBackgroundFlashcardReview(
  session: FlashcardReviewSession,
  side: FlashcardReviewSide,
  remainingMs: number,
  elapsedMs: number,
) {
  if (
    !isNativeAndroid()
    || session.mode !== 'passive'
    || !session.speechEnabled
    || !session.frontLanguage
    || !session.backLanguage
    || session.status !== 'running'
  ) return false

  try {
    await NativeFlashcardSpeech.startBackground({
      sessionId: session.id,
      sessionName: session.name,
      cards: session.queue.map(card => ({ front: card.front, back: card.back })),
      indefinite: session.indefinite,
      cardSides: session.cardSides,
      side,
      remainingMs: Math.max(1, Math.round(remainingMs)),
      frontSeconds: session.frontSeconds,
      backSeconds: session.backSeconds,
      backSpeechRepeatCount: session.backSpeechRepeatCount,
      frontLanguage: session.frontLanguage,
      backLanguage: session.backLanguage,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      overAmplified: speechOverAmplificationEnabled,
    })
    nativeBackgroundActive = true
    return true
  } catch {
    nativeBackgroundActive = false
    return false
  }
}

export async function backgroundFlashcardReviewState() {
  if (!isNativeAndroid()) return undefined
  try {
    const result = await NativeFlashcardSpeech.getBackgroundState()
    if (!result.state?.sessionId) return undefined
    nativeBackgroundActive = result.state.running
    return result.state
  } catch {
    return undefined
  }
}

export async function stopBackgroundFlashcardReview(clearState = true) {
  if (!isNativeAndroid()) return
  try {
    await NativeFlashcardSpeech.stopBackground({ clearState })
  } finally {
    nativeBackgroundActive = false
  }
}

export function nativeBackgroundFlashcardReviewIsActive() {
  return nativeBackgroundActive
}
