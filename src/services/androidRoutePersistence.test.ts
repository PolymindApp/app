import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import {
  ANDROID_ROUTE_STORAGE_KEY,
  readAndroidRoute,
  rememberAndroidRoute,
} from './androidRoutePersistence'

function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/auth', name: 'auth', component: {}, meta: { guest: true } },
      { path: '/tasks', name: 'tasks', component: {}, meta: { auth: true } },
      { path: '/intervals/:id/edit', name: 'interval-edit', component: {}, meta: { auth: true } },
    ],
  })
}

describe('Android route persistence', () => {
  it('preserves an authenticated full path with query and hash context', () => {
    const router = testRouter()
    const setItem = vi.fn()
    const route = router.resolve('/intervals/abc/edit?panel=sequence#step-2')

    rememberAndroidRoute(route, { setItem })

    expect(setItem).toHaveBeenCalledWith(
      ANDROID_ROUTE_STORAGE_KEY,
      JSON.stringify({ fullPath: '/intervals/abc/edit?panel=sequence#step-2' }),
    )
  })

  it('restores only known authenticated internal routes', () => {
    const router = testRouter()
    const storage = (fullPath: string) => ({
      getItem: () => JSON.stringify({ fullPath }),
    })

    expect(readAndroidRoute(router, storage('/intervals/abc/edit?panel=sequence')))
      .toBe('/intervals/abc/edit?panel=sequence')
    expect(readAndroidRoute(router, storage('/auth'))).toBeUndefined()
    expect(readAndroidRoute(router, storage('//outside.example/path'))).toBeUndefined()
    expect(readAndroidRoute(router, storage('/missing'))).toBeUndefined()
  })
})

