import { App as NativeApp } from '@capacitor/app'
import type { Router } from 'vue-router'

interface AppUrlSource {
  getLaunchUrl(): Promise<{ url: string } | undefined>
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url: string }) => void,
  ): Promise<unknown>
}

export function flashcardSessionIdFromNotificationUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'polymind:' || parsed.hostname !== 'flashcards') return undefined
    const sessionId = parsed.searchParams.get('sessionId')?.trim()
    if (!sessionId || sessionId.length > 255 || /[\u0000-\u001f]/.test(sessionId)) return undefined
    return sessionId
  } catch {
    return undefined
  }
}

export async function installFlashcardNotificationRouting(
  router: Router,
  appUrlSource: AppUrlSource = NativeApp,
) {
  let routingToSession = ''

  async function openReview(url: string) {
    const sessionId = flashcardSessionIdFromNotificationUrl(url)
    if (!sessionId) return
    if (
      routingToSession === sessionId
      || (
        router.currentRoute.value.name === 'flashcard-review-runner'
        && router.currentRoute.value.params.sessionId === sessionId
      )
    ) return

    routingToSession = sessionId
    try {
      await router.replace({ name: 'flashcard-review-runner', params: { sessionId } })
    } finally {
      routingToSession = ''
    }
  }

  await appUrlSource.addListener('appUrlOpen', ({ url }) => {
    void openReview(url)
  })

  const launch = await appUrlSource.getLaunchUrl()
  if (launch) await openReview(launch.url)
}
