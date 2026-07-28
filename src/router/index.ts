import { createRouter, createWebHistory } from 'vue-router'
import { pb } from '@/lib/pocketbase'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { guest: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { auth: true },
      children: [
        { path: '', redirect: '/today' },
        { path: 'today', name: 'today', component: () => import('@/views/TodayView.vue') },
        { path: 'plan', name: 'plan', component: () => import('@/views/PlanView.vue') },
        { path: 'plan/intervals/new', name: 'interval-new', component: () => import('@/views/IntervalEditorView.vue') },
        { path: 'plan/intervals/:id', name: 'interval-edit', component: () => import('@/views/IntervalEditorView.vue') },
        { path: 'intervals', name: 'intervals', component: () => import('@/views/IntervalsView.vue') },
        { path: 'intervals/quick', name: 'interval-quick', component: () => import('@/views/QuickIntervalView.vue') },
        { path: 'intervals/run/:sessionId', name: 'interval-runner', component: () => import('@/views/IntervalRunnerView.vue'), meta: { immersive: true } },
        { path: 'tasks/new', name: 'task-new', component: () => import('@/views/TaskEditorView.vue') },
        { path: 'tasks/:id', name: 'task-edit', component: () => import('@/views/TaskEditorView.vue') },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const authenticated = pb.authStore.isValid
  if (to.meta.auth && !authenticated) return { name: 'auth', query: { redirect: to.fullPath } }
  if (to.meta.guest && authenticated) return { name: 'today' }
})

export default router
