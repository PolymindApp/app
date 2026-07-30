import { createRouter, createWebHistory } from 'vue-router'
import { api } from '@/lib/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { guest: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { auth: true },
      children: [
        { path: '', redirect: '/today' },
        { path: 'today', name: 'today', component: () => import('@/views/TodayView.vue'), meta: { title: 'Today', pageDepth: 0, pageOrder: 0 } },
        { path: 'intervals', name: 'intervals', component: () => import('@/views/IntervalsView.vue'), meta: { title: 'Intervals', pageDepth: 0, pageOrder: 1 } },
        { path: 'plan', name: 'plan', component: () => import('@/views/PlanView.vue'), meta: { title: 'Plan', pageDepth: 0, pageOrder: 2 } },
        { path: 'intervals/quick', name: 'interval-quick', component: () => import('@/views/QuickIntervalView.vue'), meta: { title: 'Quick interval', pageDepth: 1, pageOrder: 1, backTo: '/intervals' } },
        { path: 'plan/intervals/new', name: 'interval-new', component: () => import('@/views/IntervalEditorView.vue'), meta: { title: 'New interval', pageDepth: 1, pageOrder: 2, backTo: '/plan' } },
        { path: 'plan/intervals/:id', name: 'interval-edit', component: () => import('@/views/IntervalEditorView.vue'), meta: { title: 'Edit interval', pageDepth: 1, pageOrder: 2, backTo: '/plan' } },
        { path: 'tasks/new', name: 'task-new', component: () => import('@/views/TaskEditorView.vue'), meta: { title: 'New task', pageDepth: 1, pageOrder: 2, backTo: '/plan' } },
        { path: 'tasks/:id', name: 'task-edit', component: () => import('@/views/TaskEditorView.vue'), meta: { title: 'Edit task', pageDepth: 1, pageOrder: 2, backTo: '/plan' } },
        { path: 'intervals/run/template/:templateId', name: 'interval-template-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { title: 'Interval', immersive: true, pageDepth: 2, pageOrder: 1, backTo: '/intervals' } },
        { path: 'intervals/run/:sessionId', name: 'interval-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { title: 'Interval', immersive: true, pageDepth: 2, pageOrder: 1, backTo: '/intervals' } },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const authenticated = api.authStore.isValid
  if (to.meta.auth && !authenticated) return { name: 'auth', query: { redirect: to.fullPath } }
  if (to.meta.guest && authenticated) return { name: 'today' }
})

export default router
