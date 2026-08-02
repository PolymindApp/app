<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format, subDays } from 'date-fns'
import { storeToRefs } from 'pinia'
import { goalState, isTaskScheduled, stepsForDate, toDateKey } from '@/services/schedule'
import { useTaskStore } from '@/stores/tasks'
import type { TaskProgress } from '@/types/domain'

const store = useTaskStore()
const { tasks, steps, entries, occurrences } = storeToRefs(store)
const selected = ref(new Date())

const days = computed(() => Array.from({ length: 14 }, (_, index) => subDays(new Date(), index)))

function progressFor(date: Date): TaskProgress[] {
  const result: TaskProgress[] = []
  for (const task of tasks.value) {
    if (!isTaskScheduled(task, date)) continue
    if (task.type !== 'program') result.push(store.makeProgress(task, date))
    else for (const step of stepsForDate(task, steps.value, date)) result.push(store.makeProgress(task, date, step))
  }
  const key = toDateKey(date)
  for (const occurrence of occurrences.value.filter((item) => item.scheduledDate === key)) {
    if (result.some((item) => item.task.id === occurrence.task && (item.programStep?.id || '') === (occurrence.programStep || ''))) continue
    const task = tasks.value.find((item) => item.id === occurrence.task)
    const step = steps.value.find((item) => item.id === occurrence.programStep)
    if (task) result.push(store.makeProgress(task, date, step))
  }
  return result
}

function rateFor(date: Date) {
  const list = progressFor(date)
  return list.length ? Math.round((list.filter((item) => item.complete).length / list.length) * 100) : 0
}

const selectedItems = computed(() => progressFor(selected.value))
const selectedRate = computed(() => rateFor(selected.value))
const selectedEntries = computed(() => entries.value.filter((entry) => entry.entryDate === toDateKey(selected.value)))
const completedDays = computed(() => days.value.filter((day) => rateFor(day) === 100 && progressFor(day).length).length)
const totalLogged = computed(() => entries.value.filter((entry) => entry.kind === 'duration').reduce((sum, entry) => sum + entry.value, 0))

onMounted(() => { if (!tasks.value.length) store.load().catch(() => undefined) })

function statusIcon(item: TaskProgress) {
  const isQuantitative = item.programStep
    ? item.programStep.completionType === 'quantity'
    : item.task.type === 'duration' || item.task.type === 'daily_total' || item.task.type === 'step_counter'
  if (isQuantitative) {
    const target = item.programStep?.targetValue || item.task.targetValue || 0
    const operator = item.programStep?.targetOperator || item.task.targetOperator || 'gte'
    const state = goalState(item.value, target, operator)
    if (state === 'exceeded') return { icon: 'mdi-alert-outline', color: 'warning', state }
    if (state === 'not_enough') return { icon: 'mdi-trending-down', color: 'error', state }
  }
  if (item.complete) return { icon: 'mdi-check-bold', color: 'success' }
  if (item.status === 'missed') return { icon: 'mdi-close', color: 'error' }
  if (item.status === 'carried' || item.status === 'rescheduled') return { icon: 'mdi-arrow-right', color: 'warning' }
  return { icon: 'mdi-minus', color: 'surface-variant' }
}

function valueColor(item: TaskProgress) {
  const status = statusIcon(item)
  if (status.color === 'warning') return 'text-warning'
  if (status.color === 'error') return 'text-error'
  return ''
}
</script>

<template>
  <main class="app-page history-page">
    <header class="mb-6">
      <h1 class="display-title text-h3 mt-2">HISTORY<span class="text-secondary">.</span></h1>
      <p class="text-body-2 muted mt-2">Progress is what remains after motivation leaves.</p>
    </header>

    <div class="stats-grid mb-6">
      <v-card class="stat-card surface-card pa-4">
        <span class="stat-label">Perfect days</span><strong>{{ completedDays }}</strong><small>last 14 days</small>
      </v-card>
      <v-card class="stat-card stat-card--accent pa-4" color="secondary">
        <span class="stat-label">Time logged</span><strong>{{ Number(totalLogged.toFixed(1)) }}h</strong><small>all tracked work</small>
      </v-card>
    </div>

    <div class="section-heading"><h2>Last 14 days</h2><span class="text-caption muted">Tap to inspect</span></div>
    <div class="history-strip mb-6">
      <button
        v-for="day in days"
        :key="day.toISOString()"
        class="history-day"
        :class="{ 'history-day--active': toDateKey(day) === toDateKey(selected) }"
        @click="selected = day"
      >
        <span>{{ format(day, 'EEEEE') }}</span>
        <strong>{{ format(day, 'd') }}</strong>
        <v-progress-circular :model-value="rateFor(day)" :size="24" :width="3" color="secondary" bg-color="surface-variant" />
      </button>
    </div>

    <v-card class="day-detail surface-card pa-5">
      <div class="d-flex align-center justify-space-between mb-5">
        <h2 class="text-h5 font-weight-black">{{ format(selected, 'MMMM d') }}</h2>
        <div class="day-score"><strong>{{ selectedRate }}%</strong><span>output</span></div>
      </div>

      <template v-if="selectedItems.length">
        <div v-for="item in selectedItems" :key="`${item.task.id}-${item.programStep?.id || ''}`" class="history-item py-3">
          <span class="status-icon" :class="`bg-${statusIcon(item).color}`">
            <v-icon
              :icon="statusIcon(item).icon"
              size="16"
              :color="statusIcon(item).color === 'surface-variant' ? 'primary' : 'on-secondary'"
            />
          </span>
          <div class="flex-grow-1 min-width-0">
            <strong class="text-body-2">{{ item.programStep?.name || item.task.name }}</strong>
            <p class="text-caption muted">{{ item.programStep ? item.task.name : item.task.description || 'Personal' }}</p>
          </div>
          <span v-if="item.value" class="history-value" :class="valueColor(item)">{{ Number(item.value.toFixed(2)) }} {{ item.programStep?.customUnit || item.programStep?.unit || item.task.customUnit || item.task.unit }}</span>
          <span v-else class="text-caption muted text-capitalize">{{ item.status }}</span>
        </div>
      </template>
      <div v-else class="text-center py-8">
        <v-icon icon="mdi-calendar-blank-outline" size="36" color="medium-emphasis" />
        <p class="text-body-2 muted mt-2">Nothing was scheduled.</p>
      </div>
    </v-card>

    <section v-if="selectedEntries.length">
      <div class="section-heading"><h2>Logged entries</h2><span class="text-caption muted">{{ selectedEntries.length }} records</span></div>
      <v-card class="surface-card pa-2">
        <v-list bg-color="transparent">
          <v-list-item
            v-for="entry in selectedEntries"
            :key="entry.id"
            :title="tasks.find(task => task.id === entry.task)?.name || 'Archived task'"
            :subtitle="entry.note || entry.kind"
          >
            <template #prepend><v-icon :icon="entry.kind === 'duration' ? 'mdi-timer-outline' : 'mdi-chart-donut'" /></template>
            <template #append><strong>{{ Number(entry.value.toFixed(2)) }} {{ entry.unit }}</strong></template>
          </v-list-item>
        </v-list>
      </v-card>
    </section>
  </main>
</template>

<style scoped>
.stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .7rem; }
.stat-card { display: flex; min-height: 130px; flex-direction: column; justify-content: flex-end; }
.stat-card strong { margin-top: .25rem; font-family: Impact, "Arial Narrow", sans-serif; font-size: 2.2rem; letter-spacing: -.03em; }
.stat-card small { color: rgb(var(--v-theme-on-surface) / .48); }
.stat-card--accent { color: #17200f; }
.stat-card--accent small { color: rgba(23,32,15,.64); }
.stat-label { font-size: .65rem; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
.history-strip { display: grid; grid-template-columns: repeat(14, minmax(52px, 1fr)); gap: .4rem; overflow-x: auto; padding: 2px 2px 8px; }
.history-day { display: flex; width: 100%; height: 100px; flex-direction: column; align-items: center; justify-content: center; gap: .35rem; border: 1px solid rgb(var(--v-theme-on-surface) / .08); border-radius: 18px; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); cursor: pointer; }
.history-day span { color: rgb(var(--v-theme-on-surface) / .5); font-size: .65rem; font-weight: 800; }
.history-day--active { border-color: #c7f464; background: #c7f464; color: #17200f; transform: translateY(-2px); }
.history-day--active span { color: rgba(23,32,15,.62); }
.day-score { display: flex; flex-direction: column; align-items: flex-end; }
.day-score strong { font-size: 1.5rem; }
.day-score span { color: rgb(var(--v-theme-on-surface) / .45); font-size: .6rem; text-transform: uppercase; }
.history-item { display: flex; align-items: center; gap: .75rem; border-top: 1px solid rgb(var(--v-theme-on-surface) / .07); }
.status-icon { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border-radius: 10px; }
.history-value { font-size: .78rem; font-weight: 850; }
@media (min-width: 700px) { .stats-grid { grid-template-columns: repeat(3, 1fr); } .day-detail { padding: 2rem !important; } }
</style>
