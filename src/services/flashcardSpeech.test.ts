import {
  defaultFlashcardSpeechLanguage,
  normalizeSpeechLanguage,
  speechLanguageOptions,
} from '@/services/flashcardSpeech'

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
})
