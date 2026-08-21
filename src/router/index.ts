import { createRouter, createWebHistory } from 'vue-router'
import { api } from '@/lib/api'
import { MAIN_NAVIGATION_VIEW_LOADERS } from '@/services/mainNavigationViews'
import { isNativeAndroidOrIosApp } from '@/services/platformAccess'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition || { top: 0, left: 0, behavior: 'auto' }
  },
  routes: [
    {
      path: '/',
      name: 'landing',
      component: () => import('@/views/LandingView.vue'),
      meta: {
        guest: true,
        webOnly: true,
        title: 'BackOnTrack — Build your way forward',
        seo: {
          title: 'BackOnTrack — Build your way forward',
          description: 'Turn tasks, intervals, flashcards, tracking, and reflection into one flexible personal system built around the way you move forward.',
        },
      },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/LegalView.vue'),
      meta: {
        title: 'Privacy policy',
        seo: {
          title: 'Privacy policy | BackOnTrack',
          description: 'Learn how BackOnTrack collects, uses, stores, shares, and protects account, app, Health Connect, and device data.',
        },
      },
    },
    {
      path: '/terms',
      name: 'terms',
      component: () => import('@/views/LegalView.vue'),
      meta: {
        title: 'Terms and conditions',
        seo: {
          title: 'Terms and conditions | BackOnTrack',
          description: 'Review the terms that govern access to and use of the BackOnTrack website, web app, and mobile apps.',
        },
      },
    },
    {
      path: '/auth',
      name: 'auth',
      component: () => import('@/views/AuthView.vue'),
      meta: {
        guest: true,
        seo: {
          title: 'Sign in or create an account | BackOnTrack',
          description: 'Sign in to BackOnTrack or create an account to build your personal system for tasks, intervals, learning, tracking, and reflection.',
          robots: 'noindex, nofollow',
        },
      },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/AuthView.vue'),
      meta: {
        guest: true,
        title: 'Forgot password',
        seo: {
          title: 'Reset your password | BackOnTrack',
          description: 'Request a secure password reset link for your BackOnTrack account.',
          robots: 'noindex, nofollow',
        },
      },
    },
    {
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/AuthView.vue'),
      meta: {
        title: 'Reset password',
        seo: {
          title: 'Choose a new password | BackOnTrack',
          description: 'Choose a new password and securely regain access to your BackOnTrack account.',
          robots: 'noindex, nofollow',
        },
      },
    },
    {
      path: '/verify-email',
      name: 'verify-email',
      component: () => import('@/views/AuthView.vue'),
      meta: {
        title: 'Confirm email',
        seo: {
          title: 'Confirm your email | BackOnTrack',
          description: 'Confirm your email address to finish setting up your BackOnTrack account.',
          robots: 'noindex, nofollow',
        },
      },
    },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { auth: true },
      children: [
        { path: 'tasks', name: 'tasks', component: MAIN_NAVIGATION_VIEW_LOADERS['/tasks'], meta: { title: 'Tasks', pageDepth: 0, pageOrder: 0 } },
        { path: 'today', redirect: '/tasks' },
        { path: 'intervals', name: 'intervals', component: MAIN_NAVIGATION_VIEW_LOADERS['/intervals'], meta: { title: 'Intervals', pageDepth: 0, pageOrder: 1 } },
        { path: 'flashcards', name: 'flashcards', component: MAIN_NAVIGATION_VIEW_LOADERS['/flashcards'], meta: { title: 'Flashcards', pageDepth: 0, pageOrder: 2 } },
        { path: 'flashcards/cards', name: 'flashcard-cards', component: () => import('@/views/FlashcardCardsView.vue'), meta: { title: 'Manage cards', pageDepth: 1, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/tags', name: 'flashcard-tags', component: () => import('@/views/FlashcardTagsView.vue'), meta: { title: 'Manage tags', pageDepth: 2, pageOrder: 2, backTo: '/flashcards/cards' } },
        { path: 'flashcards/cards/import', name: 'flashcard-import', component: () => import('@/views/FlashcardImportView.vue'), meta: { title: 'Import cards', pageDepth: 2, pageOrder: 2, backTo: '/flashcards/cards' } },
        { path: 'flashcards/cards/new', name: 'flashcard-new', component: () => import('@/views/FlashcardEditorView.vue'), meta: { title: 'New card', pageDepth: 2, pageOrder: 2, backTo: '/flashcards/cards' } },
        { path: 'flashcards/cards/:id/edit', name: 'flashcard-edit', component: () => import('@/views/FlashcardEditorView.vue'), meta: { title: 'Edit card', pageDepth: 2, pageOrder: 2, backTo: '/flashcards/cards' } },
        { path: 'flashcards/review-sets/new', name: 'flashcard-review-set-new', component: () => import('@/views/FlashcardReviewSetEditorView.vue'), meta: { title: 'New Review set', pageDepth: 1, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review-sets/:id/edit', name: 'flashcard-review-set-edit', component: () => import('@/views/FlashcardReviewSetEditorView.vue'), meta: { title: 'Edit Review set', pageDepth: 1, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review-sets/:id/share', name: 'flashcard-review-set-share', component: () => import('@/views/FlashcardReviewSetShareView.vue'), meta: { title: 'Share Review set', pageDepth: 2, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review-sets/:id/cards', name: 'flashcard-review-set-cards', component: () => import('@/views/FlashcardReviewSetCardsView.vue'), meta: { title: 'Review set cards', pageDepth: 2, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review-sets/:reviewSetId/cards/new', name: 'flashcard-review-set-card-new', component: () => import('@/views/FlashcardEditorView.vue'), meta: { title: 'New shared card', pageDepth: 3, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review-sets/:reviewSetId/cards/:id/edit', name: 'flashcard-review-set-card-edit', component: () => import('@/views/FlashcardEditorView.vue'), meta: { title: 'Edit shared card', pageDepth: 3, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review/set/:reviewSetId', name: 'flashcard-review-set-runner', component: () => import('@/views/FlashcardReviewRunnerView.vue'), meta: { title: 'Review', immersive: true, pageDepth: 2, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'flashcards/review/:sessionId', name: 'flashcard-review-runner', component: () => import('@/views/FlashcardReviewRunnerView.vue'), meta: { title: 'Review', immersive: true, pageDepth: 2, pageOrder: 2, backTo: '/flashcards' } },
        { path: 'tracking', name: 'tracking', component: MAIN_NAVIGATION_VIEW_LOADERS['/tracking'], meta: { title: 'Tracking', pageDepth: 0, pageOrder: 3 } },
        { path: 'journal', name: 'journal', component: MAIN_NAVIGATION_VIEW_LOADERS['/journal'], meta: { title: 'Journal', pageDepth: 0, pageOrder: 4 } },
        { path: 'journal/new', name: 'journal-new', component: () => import('@/views/JournalEditorView.vue'), meta: { title: 'New reflection', pageDepth: 1, pageOrder: 4, backTo: '/journal' } },
        { path: 'journal/:id/edit', name: 'journal-edit', component: () => import('@/views/JournalEditorView.vue'), meta: { title: 'Edit reflection', pageDepth: 1, pageOrder: 4, backTo: '/journal' } },
        { path: 'tracking/new', name: 'tracking-new', component: () => import('@/views/TrackingEditorView.vue'), meta: { title: 'New tracker', pageDepth: 1, pageOrder: 3, backTo: '/tracking' } },
        { path: 'tracking/:id/edit', name: 'tracking-edit', component: () => import('@/views/TrackingEditorView.vue'), meta: { title: 'Edit tracker', pageDepth: 1, pageOrder: 3, backTo: '/tracking' } },
        { path: 'tracking/insights/compare', name: 'tracking-insights', component: () => import('@/views/TrackingInsightsView.vue'), meta: { title: 'Tracking insights', pageDepth: 1, pageOrder: 3, backTo: '/tracking' } },
        { path: 'tasks/manage', redirect: '/tasks' },
        { path: 'account', name: 'account', component: () => import('@/views/AccountView.vue'), meta: { title: 'Account', pageDepth: 1, pageOrder: 2, backTo: '/tasks' } },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: 'Settings', pageDepth: 1, pageOrder: 2, backTo: '/tasks' } },
        { path: 'settings/privacy', name: 'settings-privacy', component: () => import('@/views/SettingsLegalView.vue'), meta: { title: 'Privacy policy', pageDepth: 2, pageOrder: 2, backTo: '/settings' } },
        { path: 'settings/terms', name: 'settings-terms', component: () => import('@/views/SettingsLegalView.vue'), meta: { title: 'Terms and conditions', pageDepth: 2, pageOrder: 2, backTo: '/settings' } },
        { path: 'intervals/quick', name: 'interval-quick', component: () => import('@/views/QuickIntervalView.vue'), meta: { title: 'Quick interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/new', name: 'interval-new', component: () => import('@/views/IntervalEditorView.vue'), meta: { title: 'New interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/:id/edit', name: 'interval-edit', component: () => import('@/views/IntervalEditorView.vue'), meta: { title: 'Edit interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'tasks/new', name: 'task-new', component: () => import('@/views/TaskEditorView.vue'), meta: { title: 'New task', pageDepth: 1, pageOrder: 0, backTo: '/tasks' } },
        { path: 'tasks/:id/timer', name: 'task-timer', component: () => import('@/views/TaskTimerView.vue'), meta: { title: 'Log time', immersive: true, pageDepth: 2, pageOrder: 0, backTo: '/tasks' } },
        { path: 'tasks/:id', name: 'task-edit', component: () => import('@/views/TaskEditorView.vue'), meta: { title: 'Edit task', pageDepth: 1, pageOrder: 0, backTo: '/tasks' } },
        { path: 'intervals/run/template/:templateId', name: 'interval-template-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { title: 'Interval', immersive: true, pageDepth: 2, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/run/:sessionId', name: 'interval-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { title: 'Interval', immersive: true, pageDepth: 2, pageOrder: 1, backTo: '/intervals' } },
        { path: 'plan', redirect: '/tasks' },
        { path: 'plan/intervals/new', redirect: '/intervals/new' },
        { path: 'plan/intervals/:id', redirect: to => `/intervals/${String(to.params.id)}/edit` },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const authenticated = api.authStore.hasLocalSession
  if (to.meta.webOnly && isNativeAndroidOrIosApp()) return { name: 'auth' }
  if (to.meta.auth && !authenticated) return { name: 'auth', query: { redirect: to.fullPath } }
  if (to.meta.guest && authenticated && to.query.reauth !== '1') return { name: 'tasks' }
})

export default router
