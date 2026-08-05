import { describe, expect, it, vi } from 'vitest'
import {
  flashcardSessionIdFromNotificationUrl,
  installFlashcardNotificationRouting,
} from '@/services/flashcardNotificationRouting'

describe('flashcard notification routing', () => {
  it('accepts only flashcard notification URLs with a session ID', () => {
    expect(flashcardSessionIdFromNotificationUrl('mom://flashcards?sessionId=review-1')).toBe('review-1')
    expect(flashcardSessionIdFromNotificationUrl('mom://interval?sessionId=review-1')).toBeUndefined()
    expect(flashcardSessionIdFromNotificationUrl('mom://flashcards')).toBeUndefined()
    expect(flashcardSessionIdFromNotificationUrl('not a URL')).toBeUndefined()
  })

  it('opens a review from both cold-launch and notification tap URLs', async () => {
    let listener: ((event: { url: string }) => void) | undefined
    const replace = vi.fn(async () => undefined)
    const router = {
      currentRoute: { value: { name: 'flashcards', params: {} } },
      replace,
    }
    const app = {
      getLaunchUrl: vi.fn(async () => ({ url: 'mom://flashcards?sessionId=cold-review' })),
      addListener: vi.fn(async (_event: 'appUrlOpen', callback: (event: { url: string }) => void) => {
        listener = callback
      }),
    }

    await installFlashcardNotificationRouting(router as never, app)
    expect(replace).toHaveBeenCalledWith({
      name: 'flashcard-review-runner',
      params: { sessionId: 'cold-review' },
    })

    listener?.({ url: 'mom://flashcards?sessionId=active-review' })
    await vi.waitFor(() => expect(replace).toHaveBeenLastCalledWith({
      name: 'flashcard-review-runner',
      params: { sessionId: 'active-review' },
    }))
  })
})
