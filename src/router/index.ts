import { createRouter, createWebHistory } from 'vue-router'
import { api } from '@/lib/api'

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition || { top: 0, left: 0, behavior: 'auto' }
  },
  routes: [
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue'), meta: { guest: true } },
    {
      path: '/',
      component: () => import('@/layouts/AppShell.vue'),
      meta: { auth: true },
      children: [
        { path: '', redirect: '/tasks' },
        { path: 'tasks', name: 'tasks', component: () => import('@/views/TodayView.vue'), meta: { title: 'Tasks', pageDepth: 0, pageOrder: 0 } },
        { path: 'today', redirect: '/tasks' },
        { path: 'intervals', name: 'intervals', component: () => import('@/views/IntervalsView.vue'), meta: { title: 'Intervals', pageDepth: 0, pageOrder: 1 } },
        { path: 'tasks/manage', name: 'task-manage', component: () => import('@/views/ManageTasksView.vue'), meta: { title: 'Manage tasks', pageDepth: 1, pageOrder: 0, backTo: '/tasks' } },
        { path: 'account', name: 'account', component: () => import('@/views/AccountView.vue'), meta: { title: 'Account', pageDepth: 1, pageOrder: 2, backTo: '/tasks' } },
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
  ],
})

router.beforeEach((to) => {
  const authenticated = api.authStore.isValid
  if (to.meta.auth && !authenticated) return { name: 'auth', query: { redirect: to.fullPath } }
  if (to.meta.guest && authenticated) return { name: 'tasks' }
})

export default router
