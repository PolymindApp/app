import { Capacitor, registerPlugin } from '@capacitor/core'
import type {
  BackgroundFlashcardReviewState,
  FlashcardReviewSession,
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
  speak(options: { text: string; language: string }): Promise<void>
  stopSpeaking(): Promise<void>
  startBackground(options: {
    sessionId: string
    sessionName: string
    cards: Array<{ front: string; back: string }>
    side: FlashcardReviewSide
    remainingMs: number
    frontSeconds: number
    backSeconds: number
    frontLanguage: string
    backLanguage: string
    elapsedMs: number
  }): Promise<void>
  getBackgroundState(): Promise<{ state?: BackgroundFlashcardReviewState }>
  stopBackground(options: { clearState: boolean }): Promise<void>
}

const NativeFlashcardSpeech = registerPlugin<FlashcardSpeechPlugin>('FlashcardSpeech')
let nativeBackgroundActive = false

function isNativeAndroid() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()
}

export function nativeFlashcardBackgroundIsAvailable() {
  return isNativeAndroid()
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

function browserVoiceLanguages(): Promise<string[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([])
  const synthesis = window.speechSynthesis
  const current = synthesis.getVoices()
  if (current.length) return Promise.resolve(current.map(voice => voice.lang))

  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      synthesis.removeEventListener('voiceschanged', finish)
      window.clearTimeout(timeout)
      const voices = synthesis.getVoices().map(voice => voice.lang)
      resolve(voices.length ? voices : [navigator.language])
    }
    const timeout = window.setTimeout(finish, 1000)
    synthesis.addEventListener('voiceschanged', finish, { once: true })
  })
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
    || typeof SpeechSynthesisUtterance === 'undefined'
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

export async function speakFlashcardText(text: string, language: string) {
  const content = text.trim()
  if (!content || !language) return
  await stopFlashcardSpeech()
  if (isNativeAndroid()) {
    await NativeFlashcardSpeech.speak({ text: content, language })
    return
  }
  if (
    typeof window === 'undefined'
    || !('speechSynthesis' in window)
    || typeof SpeechSynthesisUtterance === 'undefined'
  ) return
  const utterance = new SpeechSynthesisUtterance(content)
  utterance.lang = language
  window.speechSynthesis.speak(utterance)
}

export async function stopFlashcardSpeech() {
  if (isNativeAndroid()) {
    await NativeFlashcardSpeech.stopSpeaking().catch(() => undefined)
    return
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
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
      side,
      remainingMs: Math.max(1, Math.round(remainingMs)),
      frontSeconds: session.frontSeconds,
      backSeconds: session.backSeconds,
      frontLanguage: session.frontLanguage,
      backLanguage: session.backLanguage,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
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
