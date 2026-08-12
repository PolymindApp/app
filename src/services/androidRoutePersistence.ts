import type { RouteLocationNormalized, Router } from 'vue-router'

export const ANDROID_ROUTE_STORAGE_KEY = 'polymind-android-route-v1'

interface SavedAndroidRoute {
  fullPath: string
}

function isInternalPath(path: unknown): path is string {
  return typeof path === 'string'
    && path.startsWith('/')
    && !path.startsWith('//')
    && !/[\u0000-\u001f]/.test(path)
}

export function readAndroidRoute(
  router: Router,
  storage: Pick<Storage, 'getItem'> = localStorage,
) {
  try {
    const saved = JSON.parse(storage.getItem(ANDROID_ROUTE_STORAGE_KEY) || '') as SavedAndroidRoute
    if (!isInternalPath(saved.fullPath)) return undefined
    const resolved = router.resolve(saved.fullPath)
    if (!resolved.matched.length || !resolved.meta.auth || resolved.meta.guest) return undefined
    return resolved.fullPath
  } catch {
    return undefined
  }
}

export function rememberAndroidRoute(
  route: RouteLocationNormalized,
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  if (!route.matched.length || !route.meta.auth || route.meta.guest) return
  storage.setItem(
    ANDROID_ROUTE_STORAGE_KEY,
    JSON.stringify({ fullPath: route.fullPath } satisfies SavedAndroidRoute),
  )
}

