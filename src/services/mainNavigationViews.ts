export const MAIN_NAVIGATION_VIEW_LOADERS = {
  '/tasks': () => import('@/views/TodayView.vue'),
  '/intervals': () => import('@/views/IntervalsView.vue'),
  '/flashcards': () => import('@/views/FlashcardsView.vue'),
  '/tracking': () => import('@/views/TrackingView.vue'),
  '/journal': () => import('@/views/JournalView.vue'),
} as const

export type MainNavigationPath = keyof typeof MAIN_NAVIGATION_VIEW_LOADERS

export function preloadMainNavigationView(path: string) {
  return MAIN_NAVIGATION_VIEW_LOADERS[path as MainNavigationPath]?.()
}
