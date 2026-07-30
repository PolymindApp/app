<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IntervalPlanList from '@/components/IntervalPlanList.vue'
import { nextScheduledDates } from '@/services/schedule'
import { useTaskStore } from '@/stores/tasks'
import type { Task, TaskType } from '@/types/domain'

const store = useTaskStore()
const route = useRoute()
const router = useRouter()
const { tasks, steps, loading } = storeToRefs(store)
const filter = ref<'active' | 'paused'>('active')
const pendingStatusTask = ref<Task>()
const statusDialog = ref(false)
const updatingStatus = ref(false)
const tabDirection = ref<'forward' | 'back'>('forward')
const statusDirection = ref<'forward' | 'back'>('forward')
const planTab = computed({
  get: () => route.query.tab === 'intervals' ? 'intervals' : 'tasks',
  set: (tab: string) => router.replace({ query: { ...route.query, tab: tab === 'intervals' ? 'intervals' : undefined } }),
})

watch(planTab, (tab, previousTab) => {
  tabDirection.value = tab === 'intervals' && previousTab === 'tasks' ? 'forward' : 'back'
})

watch(filter, (status, previousStatus) => {
  statusDirection.value = status === 'paused' && previousStatus === 'active' ? 'forward' : 'back'
})

const visibleTasks = computed(() => tasks.value.filter((task) =>
  task.active === (filter.value === 'active'),
))

const typeInfo: Record<TaskType, { label: string; icon: string; color: string }> = {
  check: { label: 'Check-off', icon: 'mdi-check-bold', color: '#8FB8FF' },
  duration: { label: 'Duration', icon: 'mdi-timer-outline', color: '#D4A5FF' },
  daily_total: { label: 'Daily total', icon: 'mdi-chart-donut', color: '#FFB86B' },
  program: { label: 'Program', icon: 'mdi-repeat-variant', color: '#C7F464' },
}

onMounted(() => { if (!tasks.value.length) store.load().catch(() => undefined) })

function scheduleLabel(task: Task) {
  if (task.type === 'program') return `${task.cycleLength}-day ${task.programRepeat ? 'repeating' : 'one-off'} cycle`
  if (task.recurrenceType === 'daily') return 'Every day'
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = task.weekdays.map((day) => dayNames[day]).join(', ')
  return task.recurrenceType === 'interval_weeks' ? `${days} · every ${task.intervalWeeks} weeks` : days
}

function nextLabel(task: Task) {
  const next = nextScheduledDates(task, 1)[0]
  return next ? format(next, 'EEE, MMM d') : 'No upcoming dates'
}

function requestStatusChange(task: Task) {
  pendingStatusTask.value = task
  statusDialog.value = true
}

async function confirmStatusChange() {
  if (!pendingStatusTask.value) return
  updatingStatus.value = true
  try {
    await store.toggleTaskActive(pendingStatusTask.value)
    statusDialog.value = false
    pendingStatusTask.value = undefined
  } finally {
    updatingStatus.value = false
  }
}
</script>

<template>
  <main class="app-page plan-page">
    <div class="plan-controls mb-6">
      <v-btn-toggle v-model="planTab" mandatory color="primary" class="plan-tabs">
        <v-btn value="tasks" prepend-icon="mdi-calendar-check-outline">Tasks</v-btn>
        <v-btn value="intervals" prepend-icon="mdi-timer-outline">Intervals</v-btn>
      </v-btn-toggle>
      <v-btn
        icon="mdi-plus"
        color="secondary"
        :aria-label="planTab === 'tasks' ? 'Create duration routine' : 'Create interval template'"
        @click="planTab === 'tasks' ? router.push('/tasks/new') : router.push('/plan/intervals/new')"
      />
    </div>

    <div class="plan-tab-viewport">
      <transition :name="`plan-slide-${tabDirection}`">
        <div :key="planTab" class="plan-tab-content">
    <template v-if="planTab === 'tasks'">
    <div class="d-flex align-center justify-space-between mb-4">
      <v-tabs v-model="filter" color="secondary" density="comfortable" class="plan-status-tabs">
        <v-tab value="active">Active</v-tab>
        <v-tab value="paused">Paused</v-tab>
      </v-tabs>
      <span class="text-caption muted">{{ visibleTasks.length }} total</span>
    </div>

    <div class="plan-status-stage">
      <transition :name="`plan-slide-${statusDirection}`">
        <div :key="filter" class="plan-status-content">
    <div v-if="visibleTasks.length" class="plan-list">
      <v-card
        v-for="task in visibleTasks"
        :key="task.id"
        class="plan-card surface-card pa-4"
        @click="router.push(`/tasks/${task.id}`)"
      >
        <div class="d-flex align-start ga-3">
          <div class="type-icon" :style="{ background: task.color || typeInfo[task.type].color }">
            <v-icon :icon="typeInfo[task.type].icon" size="21" />
          </div>
          <div class="flex-grow-1 min-width-0">
            <div class="d-flex align-center ga-2">
              <h2 class="text-body-1 font-weight-black text-truncate">{{ task.name }}</h2>
              <v-icon v-if="task.mandatory" icon="mdi-shield-check" color="primary" size="15" />
            </div>
            <p class="text-caption muted mt-1">{{ typeInfo[task.type].label }} · {{ scheduleLabel(task) }}</p>
            <div v-if="task.type === 'program'" class="step-preview mt-3">
              <span v-for="step in steps.filter(item => item.active && item.task === task.id).slice(0, 4)" :key="step.id">
                {{ step.name }}
              </span>
            </div>
            <p v-else-if="task.targetValue" class="target-copy mt-3">
              Target: <strong>{{ task.targetValue }} {{ task.customUnit || task.unit }}</strong>
              <span v-if="task.goalPeriod === 'week'"> / week</span>
            </p>
          </div>
          <v-btn
            :icon="task.active ? 'mdi-pause' : 'mdi-play'"
            :color="task.active ? undefined : 'secondary'"
            variant="tonal"
            size="small"
            :aria-label="task.active ? `Pause ${task.name}` : `Activate ${task.name}`"
            @touchstart.stop
            @click.stop="requestStatusChange(task)"
          />
        </div>
        <v-divider class="my-3" />
        <div class="text-caption">
          <span class="muted"><v-icon icon="mdi-calendar-blank-outline" size="15" class="mr-1" />Next: {{ nextLabel(task) }}</span>
        </div>
      </v-card>
    </div>

    <v-card v-else-if="!loading" class="surface-card pa-8 text-center">
      <v-icon :icon="filter === 'active' ? 'mdi-clipboard-plus-outline' : 'mdi-pause-circle-outline'" size="42" class="mb-3" />
      <h2 class="text-h6 font-weight-black">
        {{ filter === 'active' ? 'Build your first routine' : 'Nothing paused' }}
      </h2>
      <p class="text-body-2 muted mt-2 mb-5">
        {{ filter === 'active' ? 'Choose a task style and make it yours.' : 'Paused tasks will wait here without losing history.' }}
      </p>
      <v-btn
        v-if="filter === 'active'"
        color="secondary"
        @click="router.push('/tasks/new')"
      >
        Create task
      </v-btn>
    </v-card>
        </div>
      </transition>
    </div>
    </template>

    <IntervalPlanList v-else />
        </div>
      </transition>
    </div>

    <ConfirmDialog
      v-model="statusDialog"
      :title="pendingStatusTask?.active ? 'Pause this task?' : 'Activate this task?'"
      :message="pendingStatusTask?.active
        ? `${pendingStatusTask?.name || 'This task'} will stop appearing in your schedule until you activate it again. Its history will be preserved.`
        : `${pendingStatusTask?.name || 'This task'} will return to its schedule based on its recurrence settings.`"
      :confirm-text="pendingStatusTask?.active ? 'Pause task' : 'Activate task'"
      :confirm-color="pendingStatusTask?.active ? 'warning' : 'secondary'"
      :icon="pendingStatusTask?.active ? 'mdi-pause' : 'mdi-play'"
      :loading="updatingStatus"
      @confirm="confirmStatusChange"
    />
  </main>
</template>

<style scoped>
.plan-controls { display: flex; align-items: center; gap: 1rem; }
.plan-controls > .v-btn { flex: 0 0 auto; }
.plan-tabs { display: grid; min-width: 0; flex: 1 1 auto; grid-template-columns: 1fr 1fr; gap: 1rem; }
.plan-tabs :deep(.v-btn) { width: 100%; }
.plan-tab-viewport,
.plan-status-stage { display: grid; width: 100%; min-width: 0; overflow-x: clip; }
.plan-tab-content,
.plan-status-content { width: 100%; min-width: 0; grid-area: 1 / 1; }
.plan-slide-forward-enter-active,
.plan-slide-forward-leave-active,
.plan-slide-back-enter-active,
.plan-slide-back-leave-active {
  transition:
    opacity 240ms ease,
    transform 240ms cubic-bezier(.22, 1, .36, 1);
}
.plan-slide-forward-leave-active,
.plan-slide-back-leave-active { pointer-events: none; }
.plan-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(1.5rem);
}
.plan-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(-1rem);
}
.plan-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-1.5rem);
}
.plan-slide-back-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}
.plan-status-tabs { width: auto; }
.type-icon { display: grid; width: 39px; height: 39px; flex: 0 0 auto; place-items: center; border-radius: 13px; color: #191c19; }
.plan-list { display: grid; gap: .75rem; }
.plan-card { cursor: pointer; transition: transform .18s ease, box-shadow .18s ease; }
.plan-card:hover { transform: translateY(-2px); box-shadow: 0 16px 34px rgba(0,0,0,.32) !important; }
.step-preview { display: flex; gap: .35rem; overflow: hidden; }
.step-preview span { padding: 4px 8px; border-radius: 999px; background: rgb(var(--v-theme-surface-variant)); font-size: .62rem; white-space: nowrap; }
.target-copy { color: rgb(var(--v-theme-on-surface) / .6); font-size: .73rem; }
@media (min-width: 700px) {
  .plan-list { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
</style>
