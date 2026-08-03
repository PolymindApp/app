import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'
import {
  installIntervalNotificationRouting,
  intervalSessionIdFromNotificationUrl,
} from './intervalNotificationRouting'

describe('interval notification routing', () => {
  it('accepts only interval notification URLs with a session ID', () => {
    expect(intervalSessionIdFromNotificationUrl('mom://interval?sessionId=session-1')).toBe('session-1')
    expect(intervalSessionIdFromNotificationUrl('mom://interval')).toBeUndefined()
    expect(intervalSessionIdFromNotificationUrl('mom://tracking?sessionId=session-1')).toBeUndefined()
    expect(intervalSessionIdFromNotificationUrl('/intervals/run/session-1')).toBeUndefined()
  })

  it('opens the running interval from both cold-launch and notification tap URLs', async () => {
    const currentRoute = ref({ name: 'tasks', params: {} })
    const replace = vi.fn(async (target: { name: string; params: { sessionId: string } }) => {
      currentRoute.value = target
    })
    let urlListener: ((event: { url: string }) => void) | undefined
    const appUrlSource = {
      getLaunchUrl: vi.fn(async () => ({ url: 'mom://interval?sessionId=cold-session' })),
      addListener: vi.fn(async (_eventName: 'appUrlOpen', listener: (event: { url: string }) => void) => {
        urlListener = listener
      }),
    }

    await installIntervalNotificationRouting({ currentRoute, replace } as unknown as Router, appUrlSource)

    expect(replace).toHaveBeenLastCalledWith({
      name: 'interval-runner',
      params: { sessionId: 'cold-session' },
    })

    currentRoute.value = { name: 'tracking', params: {} }
    urlListener?.({ url: 'mom://interval?sessionId=running-session' })
    await vi.waitFor(() => expect(replace).toHaveBeenLastCalledWith({
      name: 'interval-runner',
      params: { sessionId: 'running-session' },
    }))
  })
})
