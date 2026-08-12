const nativeSpeech = vi.hoisted(() => ({
  getLanguages: vi.fn().mockResolvedValue({ available: true, languages: ['en-CA'] }),
  getBackgroundState: vi.fn().mockResolvedValue({}),
  setOverAmplification: vi.fn().mockResolvedValue(undefined),
  speak: vi.fn().mockResolvedValue(undefined),
  startBackground: vi.fn().mockResolvedValue(undefined),
  stopBackground: vi.fn().mockResolvedValue(undefined),
  stopSpeaking: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
  },
  registerPlugin: () => nativeSpeech,
}))

import { speakFlashcardText } from '@/services/flashcardSpeech'

describe('native flashcard speech', () => {
  beforeEach(() => {
    nativeSpeech.speak.mockClear()
    nativeSpeech.stopSpeaking.mockClear()
  })

  it('starts speech with one atomic native request', async () => {
    await speakFlashcardText('House', 'en-CA')

    expect(nativeSpeech.stopSpeaking).not.toHaveBeenCalled()
    expect(nativeSpeech.speak).toHaveBeenCalledOnce()
    expect(nativeSpeech.speak).toHaveBeenCalledWith({
      text: 'House',
      language: 'en-CA',
      overAmplified: false,
    })
  })

  it('forwards the interval phase key for the native background handoff', async () => {
    await speakFlashcardText('Maison', 'fr-CA', '3:back:0')

    expect(nativeSpeech.speak).toHaveBeenCalledWith({
      text: 'Maison',
      language: 'fr-CA',
      overAmplified: false,
      backgroundIntervalSpeechKey: '3:back:0',
    })
  })
})
