import {
  defaultFlashcardSpeechLanguage,
  flashcardSpeechOverAmplificationIsEnabled,
  loadFlashcardSpeechSupport,
  normalizeSpeechLanguage,
  setFlashcardSpeechOverAmplification,
  speakFlashcardText,
  speechLanguageOptions,
  stopFlashcardSpeech,
  toggleFlashcardSpeechOverAmplification,
} from '@/services/flashcardSpeech'

afterEach(async () => {
  await setFlashcardSpeechOverAmplification(false)
  vi.unstubAllGlobals()
})

describe('flashcard speech helpers', () => {
  it('normalizes and deduplicates device language tags', () => {
    expect(normalizeSpeechLanguage(' en_us ')).toBe('en-US')
    expect(speechLanguageOptions(['fr-CA', 'en_US', 'en-US'], 'en').map(item => item.tag))
      .toEqual(['en-US', 'fr-CA'])
  })

  it('prefers the device language and then its base language', () => {
    const languages = speechLanguageOptions(['fr-FR', 'en-US'], 'en')
    const original = navigator.language
    Object.defineProperty(navigator, 'language', { value: 'fr-CA', configurable: true })
    expect(defaultFlashcardSpeechLanguage(languages)).toBe('fr-FR')
    Object.defineProperty(navigator, 'language', { value: original, configurable: true })
  })

  it('toggles over-amplification without speaking', async () => {
    expect(flashcardSpeechOverAmplificationIsEnabled()).toBe(false)

    await expect(toggleFlashcardSpeechOverAmplification()).resolves.toBe(true)
    expect(flashcardSpeechOverAmplificationIsEnabled()).toBe(true)
    expect(localStorage.getItem('polymind-flashcard-speech:over-amplification')).toBe('true')

    await expect(toggleFlashcardSpeechOverAmplification()).resolves.toBe(false)
    expect(flashcardSpeechOverAmplificationIsEnabled()).toBe(false)
    expect(localStorage.getItem('polymind-flashcard-speech:over-amplification')).toBe('false')
  })

  it('restores over-amplification from device storage after reloading', async () => {
    localStorage.setItem('polymind-flashcard-speech:over-amplification', 'true')
    vi.resetModules()

    const reloadedSpeech = await import('@/services/flashcardSpeech')

    expect(reloadedSpeech.flashcardSpeechOverAmplificationIsEnabled()).toBe(true)
    await reloadedSpeech.setFlashcardSpeechOverAmplification(false)
  })

  it('uses and retains a matching browser voice while speaking', async () => {
    const voice = {
      default: true,
      lang: 'en-US',
      localService: true,
      name: 'English',
      voiceURI: 'english',
    } as SpeechSynthesisVoice
    const synthesis = {
      cancel: vi.fn(),
      getVoices: vi.fn(() => [voice]),
      pause: vi.fn(),
      paused: false,
      pending: false,
      resume: vi.fn(),
      speak: vi.fn((utterance: SpeechSynthesisUtterance) => utterance.onstart?.({} as SpeechSynthesisEvent)),
      speaking: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as SpeechSynthesis
    class FakeUtterance {
      lang = ''
      voice: SpeechSynthesisVoice | null = null
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(readonly text: string) {}
    }
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

    await setFlashcardSpeechOverAmplification(true)
    await speakFlashcardText('Front of card', 'en_US')

    expect(synthesis.resume).toHaveBeenCalledOnce()
    expect(synthesis.speak).toHaveBeenCalledOnce()
    const utterance = vi.mocked(synthesis.speak).mock.calls[0][0]
    expect(utterance).toMatchObject({ text: 'Front of card', lang: 'en-US', voice, volume: 1 })
    expect(synthesis.cancel).not.toHaveBeenCalled()

    await stopFlashcardSpeech()
    expect(synthesis.cancel).toHaveBeenCalledOnce()
  })

  it('reports browser support from voices that are actually available', async () => {
    const synthesis = {
      getVoices: vi.fn(() => [{ lang: 'fr-CA' } as SpeechSynthesisVoice]),
    } as unknown as SpeechSynthesis
    vi.stubGlobal('speechSynthesis', synthesis)
    vi.stubGlobal('SpeechSynthesisUtterance', class {})

    await expect(loadFlashcardSpeechSupport()).resolves.toMatchObject({
      available: true,
      languages: [{ tag: 'fr-CA' }],
    })
  })
})
