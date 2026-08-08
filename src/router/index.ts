import { createRouter, createWebHistory } from 'vue-router'
import { api } from '@/lib/api'
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
      meta: { webOnly: true, title: 'Polymind — Make life programmable.' },
    },
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { guest: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { auth: true },
      children: [
        { path: 'tasks', name: 'tasks', component: () => import('@/views/TodayView.vue'), meta: { title: 'Tasks', pageDepth: 0, pageOrder: 0 } },
        { path: 'today', redirect: '/tasks' },
        { path: 'intervals', name: 'intervals', component: () => import('@/views/IntervalsView.vue'), meta: { title: 'Intervals', pageDepth: 0, pageOrder: 1 } },
        { path: 'flashcards', name: 'flashcards', component: () => import('@/views/FlashcardsView.vue'), meta: { title: 'Flashcards', pageDepth: 0, pageOrder: 2 } },
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
        { path: 'tracking', name: 'tracking', component: () => import('@/views/TrackingView.vue'), meta: { title: 'Tracking', pageDepth: 0, pageOrder: 3 } },
        { path: 'journal', name: 'journal', component: () => import('@/views/JournalView.vue'), meta: { title: 'Journal', pageDepth: 0, pageOrder: 4 } },
        { path: 'journal/new', name: 'journal-new', component: () => import('@/views/JournalEditorView.vue'), meta: { title: 'New reflection', pageDepth: 1, pageOrder: 4, backTo: '/journal' } },
        { path: 'journal/:id/edit', name: 'journal-edit', component: () => import('@/views/JournalEditorView.vue'), meta: { title: 'Edit reflection', pageDepth: 1, pageOrder: 4, backTo: '/journal' } },
        { path: 'tracking/new', name: 'tracking-new', component: () => import('@/views/TrackingEditorView.vue'), meta: { title: 'New tracker', pageDepth: 1, pageOrder: 3, backTo: '/tracking' } },
        { path: 'tracking/:id/edit', name: 'tracking-edit', component: () => import('@/views/TrackingEditorView.vue'), meta: { title: 'Edit tracker', pageDepth: 1, pageOrder: 3, backTo: '/tracking' } },
        { path: 'tracking/insights/compare', name: 'tracking-insights', component: () => import('@/views/TrackingInsightsView.vue'), meta: { title: 'Tracking insights', pageDepth: 1, pageOrder: 3, backTo: '/tracking' } },
        { path: 'tasks/manage', name: 'task-manage', component: () => import('@/views/ManageTasksView.vue'), meta: { title: 'Manage tasks', pageDepth: 1, pageOrder: 0, backTo: '/tasks' } },
        { path: 'account', name: 'account', component: () => import('@/views/AccountView.vue'), meta: { title: 'Account', pageDepth: 1, pageOrder: 2, backTo: '/tasks' } },
        { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { title: 'Settings', pageDepth: 1, pageOrder: 2, backTo: '/tasks' } },
        { path: 'intervals/quick', name: 'interval-quick', component: () => import('@/views/QuickIntervalView.vue'), meta: { title: 'Quick interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/new', name: 'interval-new', component: () => import('@/views/IntervalEditorView.vue'), meta: { title: 'New interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/:id/edit', name: 'interval-edit', component: () => import('@/views/IntervalEditorView.vue'), meta: { title: 'Edit interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'tasks/new', name: 'task-new', component: () => import('@/views/TaskEditorView.vue'), meta: { title: 'New task', pageDepth: 2, pageOrder: 0, backTo: '/tasks/manage' } },
        { path: 'tasks/:id/timer', name: 'task-timer', component: () => import('@/views/TaskTimerView.vue'), meta: { title: 'Log time', immersive: true, pageDepth: 2, pageOrder: 0, backTo: '/tasks' } },
        { path: 'tasks/:id', name: 'task-edit', component: () => import('@/views/TaskEditorView.vue'), meta: { title: 'Edit task', pageDepth: 2, pageOrder: 0, backTo: '/tasks/manage' } },
        { path: 'intervals/run/template/:templateId', name: 'interval-template-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { title: 'Interval', immersive: true, pageDepth: 2, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/run/:sessionId', name: 'interval-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { title: 'Interval', immersive: true, pageDepth: 2, pageOrder: 1, backTo: '/intervals' } },
        { path: 'plan', redirect: '/tasks/manage' },
        { path: 'plan/intervals/new', redirect: '/intervals/new' },
        { path: 'plan/intervals/:id', redirect: to => `/intervals/${String(to.params.id)}/edit` },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach((to) => {
  const authenticated = api.authStore.isValid
  if (to.meta.webOnly && isNativeAndroidOrIosApp()) return { name: 'auth' }
  if (to.meta.auth && !authenticated) return { name: 'auth', query: { redirect: to.fullPath } }
  if (to.meta.guest && authenticated) return { name: 'tasks' }
})

export default router
