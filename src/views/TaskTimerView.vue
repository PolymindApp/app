<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { format, isValid, parseISO } from 'date-fns'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { NavigationGuardNext } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { requestIntervalWakeLock } from '@/services/intervalCues'
import { progressPercent, toDateKey } from '@/services/schedule'
import {
  clearTaskTimer,
  createTaskTimer,
  formatTaskTimer,
  loadTaskTimer,
  pauseTaskTimer,
  resetTaskTimer,
  resumeTaskTimer,
  saveTaskTimer,
  taskTimerElapsedMs,
} from '@/services/taskTimer'
import { useTaskStore } from '@/stores/tasks'
import type { Task, TaskProgress } from '@/types/domain'
import type { TaskTimerState } from '@/services/taskTimer'

const route = useRoute()
const router = useRouter()
const store = useTaskStore()
const task = ref<Task>()
const progress = ref<TaskProgress>()
const timer = ref<TaskTimerState>()
const logDate = ref(new Date())
const nowMs = ref(Date.now())
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const logDialog = ref(false)
const discardDialog = ref(false)
let ticker: number | undefined
let wakeLock: { release: () => Promise<void> } | undefined
let mounted = false
let allowLeave = false
let pendingNavigation: NavigationGuardNext | undefined

const elapsedMs = computed(() => timer.value
  ? taskTimerElapsedMs(timer.value, new Date(nowMs.value))
  : 0)
const elapsedLabel = computed(() => formatTaskTimer(elapsedMs.value))
const elapsedHours = computed(() => elapsedMs.value / 3_600_000)
const running = computed(() => timer.value?.status === 'running')
const target = computed(() => task.value?.targetValue || 0)
const projectedValue = computed(() => (progress.value?.value || 0) + elapsedHours.value)
const projectedPercent = computed(() => progressPercent(
  projectedValue.value,
  target.value,
  task.value?.targetOperator,
))
const timerColor = computed(() => task.value?.color || 'secondary')
const dateLabel = computed(() => format(logDate.value, 'EEEE, MMMM d'))
const logMessage = computed(() =>
  `${formatTaskTimer(elapsedMs.value)} will be added to ${task.value?.name || 'this task'} for ${format(logDate.value, 'MMMM d')}.`,
)
const progressSummary = computed(() => {
  const current = formatHours(progress.value?.value || 0)
  if (!target.value) return `${current} logged before this timer`
  return `${current} logged · ${formatHours(target.value)} goal`
})
const projectedSummary = computed(() => {
  if (!target.value) return `${formatHours(projectedValue.value)} after logging`
  return `${formatHours(projectedValue.value)} of ${formatHours(target.value)} after logging`
})

onMounted(async () => {
  mounted = true
  try {
    const requestedDate = typeof route.query.date === 'string'
      ? parseISO(route.query.date)
      : new Date()
    logDate.value = isValid(requestedDate) ? requestedDate : new Date()
    store.selectedDate = logDate.value

    if (!store.tasks.length) await store.load()
    const found = store.tasks.find((item) => item.id === String(route.params.id))
    if (!found || found.type !== 'duration') {
      error.value = 'That duration task could not be found.'
      return
    }

    task.value = found
    progress.value = store.makeProgress(found, logDate.value)
    const dateKey = toDateKey(logDate.value)
    timer.value = loadTaskTimer(found.id, dateKey)
      || createTaskTimer(found.id, dateKey)
    nowMs.value = Date.now()
    ticker = window.setInterval(() => {
      nowMs.value = Date.now()
    }, 250)
    document.addEventListener('visibilitychange', handleVisibility)
    if (timer.value.status === 'running') void acquireWakeLock()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open the timer.'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  mounted = false
  if (ticker) window.clearInterval(ticker)
  document.removeEventListener('visibilitychange', handleVisibility)
  void releaseWakeLock()
})

onBeforeRouteLeave((_to, _from, next) => {
  if (allowLeave || elapsedMs.value < 1000) {
    next()
    return
  }
  pendingNavigation = next
  discardDialog.value = true
})

watch(discardDialog, (open) => {
  if (!open && pendingNavigation && !allowLeave) {
    const next = pendingNavigation
    pendingNavigation = undefined
    next(false)
  }
})

function formatHours(value: number) {
  const totalMinutes = Math.round(Math.max(0, value) * 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!hours) return `${minutes}m`
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

async function acquireWakeLock() {
  const lock = await requestIntervalWakeLock()
  if (!lock) return
  if (!mounted || !running.value) {
    await lock.release()
    return
  }
  wakeLock = lock
}

async function releaseWakeLock() {
  await wakeLock?.release()
  wakeLock = undefined
}

function handleVisibility() {
  nowMs.value = Date.now()
  if (document.visibilityState === 'visible' && running.value) void acquireWakeLock()
}

function start() {
  if (!timer.value) return
  const now = new Date()
  timer.value = resumeTaskTimer(timer.value, now)
  nowMs.value = now.getTime()
  saveTaskTimer(timer.value)
  void acquireWakeLock()
}

function pause() {
  if (!timer.value) return
  const now = new Date()
  timer.value = pauseTaskTimer(timer.value, now)
  nowMs.value = now.getTime()
  saveTaskTimer(timer.value)
  void releaseWakeLock()
}

function toggleTimer() {
  if (running.value) pause()
  else start()
}

function reset() {
  if (!timer.value) return
  const now = new Date()
  timer.value = resetTaskTimer(timer.value, now)
  nowMs.value = now.getTime()
  saveTaskTimer(timer.value)
}

async function logTime() {
  if (!task.value || !progress.value || !timer.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    const now = new Date()
    const stopped = pauseTaskTimer(timer.value, now)
    const seconds = Math.max(1, Math.round(stopped.accumulatedMs / 1000))
    timer.value = stopped
    nowMs.value = now.getTime()
    store.selectedDate = logDate.value
    await store.addEntry(progress.value, seconds / 3600, 'duration', 'Logged with timer')
    clearTaskTimer(task.value.id, toDateKey(logDate.value))
    logDialog.value = false
    allowLeave = true
    await releaseWakeLock()
    await router.replace('/tasks')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not log this time.'
    saveTaskTimer(timer.value)
  } finally {
    saving.value = false
  }
}

function discardAndLeave() {
  if (task.value) clearTaskTimer(task.value.id, toDateKey(logDate.value))
  allowLeave = true
  discardDialog.value = false
  void releaseWakeLock()
  const next = pendingNavigation
  pendingNavigation = undefined
  next?.()
}

function leave() {
  void router.push('/tasks')
}
</script>

<template>
  <main class="task-timer-page">
    <v-alert v-if="error" type="error" variant="tonal" class="timer-alert">{{ error }}</v-alert>

    <div v-if="loading" class="timer-loading">
      <v-progress-circular indeterminate color="secondary" />
    </div>

    <template v-else-if="task && progress && timer">
      <header class="task-timer-header">
        <v-btn icon="mdi-chevron-down" variant="text" aria-label="Leave timer" @click="leave" />
        <div class="text-center min-width-0">
          <strong class="text-truncate d-block">{{ task.name }}</strong>
          <span>{{ dateLabel }}</span>
        </div>
        <v-btn
          icon="mdi-stop-circle-outline"
          variant="text"
          color="error"
          aria-label="Stop and log time"
          :disabled="elapsedMs < 1000"
          @click="logDialog = true"
        />
      </header>

      <div class="task-timer-stage">
        <section class="task-timer-main">
          <div class="task-timer-details">
            <h1>{{ task.name }}</h1>
            <p>{{ dateLabel }}</p>
            <p class="progress-copy">{{ progressSummary }}</p>
          </div>

          <div class="timer-ring">
            <v-progress-circular
              :model-value="projectedPercent"
              :size="260"
              :width="12"
              :color="timerColor"
              bg-color="surface-variant"
            >
              <span class="timer-value">{{ elapsedLabel }}</span>
            </v-progress-circular>
          </div>

          <p class="projected-copy">{{ projectedSummary }}</p>
        </section>

        <footer class="timer-controls timer-controls--portrait">
          <v-btn
            icon="mdi-restart"
            variant="tonal"
            size="large"
            aria-label="Reset timer"
            :disabled="elapsedMs < 1000"
            @click="reset"
          />
          <v-btn
            :icon="running ? 'mdi-pause' : 'mdi-play'"
            :color="timerColor"
            size="x-large"
            :aria-label="running ? 'Pause timer' : 'Start timer'"
            @touchstart.stop
            @click.stop="toggleTimer"
          />
          <v-btn
            icon="mdi-stop-circle-outline"
            variant="tonal"
            color="error"
            size="large"
            aria-label="Stop and log time"
            :disabled="elapsedMs < 1000"
            @click="logDialog = true"
          />
        </footer>

        <footer class="timer-controls timer-controls--landscape">
          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            aria-label="Back to Tasks"
            @click="leave"
          />
          <v-btn
            icon="mdi-restart"
            variant="tonal"
            aria-label="Reset timer"
            :disabled="elapsedMs < 1000"
            @click="reset"
          />
          <v-btn
            :icon="running ? 'mdi-pause' : 'mdi-play'"
            :color="timerColor"
            class="timer-play-button"
            :aria-label="running ? 'Pause timer' : 'Start timer'"
            @touchstart.stop
            @click.stop="toggleTimer"
          />
          <v-btn
            prepend-icon="mdi-stop-circle-outline"
            color="error"
            class="timer-log-button"
            :disabled="elapsedMs < 1000"
            @click="logDialog = true"
          >
            Stop &amp; log
          </v-btn>
        </footer>
      </div>
    </template>

    <ConfirmDialog
      v-model="logDialog"
      title="Stop and log this time?"
      :message="logMessage"
      confirm-text="Stop and log"
      confirm-color="secondary"
      icon="mdi-timer-check-outline"
      :loading="saving"
      @confirm="logTime"
    />

    <ConfirmDialog
      v-model="discardDialog"
      title="Discard this timer?"
      message="The elapsed time will not be added to the task."
      confirm-text="Discard timer"
      icon="mdi-timer-remove-outline"
      @confirm="discardAndLeave"
    />
  </main>
</template>

<style scoped>
.task-timer-page {
  position: fixed;
  z-index: 1003;
  inset: 0;
  display: flex;
  width: 100%;
  max-width: 100vw;
  height: 100dvh;
  min-height: 0;
  padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom));
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: none;
  background: rgb(var(--v-theme-background));
}

.task-timer-page.page-depth-deeper-enter-active > *,
.task-timer-page.page-depth-deeper-leave-active > *,
.task-timer-page.page-depth-higher-enter-active > *,
.task-timer-page.page-depth-higher-leave-active > * {
  transition: none;
}

.task-timer-page.page-depth-deeper-enter-from > *,
.task-timer-page.page-depth-deeper-leave-to > *,
.task-timer-page.page-depth-higher-enter-from > *,
.task-timer-page.page-depth-higher-leave-to > * {
  transform: none;
}

.timer-alert {
  z-index: 2;
}

.timer-loading {
  display: grid;
  flex: 1;
  place-items: center;
}

.task-timer-header {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 48px;
  align-items: center;
}

.task-timer-header span {
  display: block;
  margin-top: .1rem;
  color: rgb(var(--v-theme-on-surface) / .52);
  font-size: .72rem;
}

.task-timer-stage {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.task-timer-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.task-timer-details {
  display: contents;
}

.task-timer-details h1 {
  max-width: 640px;
  font-size: clamp(2rem, 9vw, 4.5rem);
  font-weight: 900;
  line-height: 1;
}

.task-timer-details > p {
  margin-top: .65rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .78rem;
}

.task-timer-details .progress-copy {
  margin-top: .3rem;
}

.timer-ring {
  margin: 2.25rem 0 1.5rem;
}

.timer-value {
  display: inline-block;
  font-family: "Arial Narrow", Impact, sans-serif;
  font-size: 4rem;
  font-weight: 900;
  letter-spacing: -.04em;
}

.projected-copy {
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .78rem;
}

.timer-controls {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  justify-items: center;
  gap: 1rem;
}

.timer-controls--landscape {
  display: none;
}

@media (orientation: portrait) {
  .task-timer-page {
    padding-bottom: max(2rem, calc(env(safe-area-inset-bottom, 0px) + 1rem));
  }
}

@media (orientation: landscape) and (max-height: 700px) {
  .task-timer-page {
    width: 100%;
    max-width: 100vw;
    height: 100dvh;
    min-height: 0;
    padding:
      max(.5rem, env(safe-area-inset-top))
      max(1rem, env(safe-area-inset-right))
      max(.5rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
    overflow: hidden;
  }

  .timer-alert {
    position: fixed;
    z-index: 20;
    top: max(.5rem, env(safe-area-inset-top));
    left: 50%;
    width: min(34rem, calc(100vw - 2rem));
    margin: 0 !important;
    transform: translateX(-50%);
  }

  .task-timer-header {
    display: none;
  }

  .task-timer-stage {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-columns: minmax(0, 1.15fr) minmax(14rem, .85fr);
    grid-template-rows: minmax(0, 1fr) auto auto;
    gap: .5rem 1rem;
  }

  .task-timer-main {
    display: contents;
  }

  .task-timer-details {
    display: flex;
    min-width: 0;
    min-height: 0;
    padding:
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(.75rem, 2.5dvh, 1.25rem)
      clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 1;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
    border-left: 1px solid rgb(var(--v-theme-on-surface) / .12);
    text-align: left;
  }

  .task-timer-details h1 {
    max-width: none;
    overflow-wrap: anywhere;
    font-size: clamp(1.65rem, 4.5vw, 3.6rem);
    line-height: .96;
  }

  .task-timer-details > p {
    margin-top: .7rem;
  }

  .task-timer-details .progress-copy {
    margin-top: .3rem;
  }

  .timer-ring {
    --timer-ring-inset: clamp(2rem, 8dvh, 4rem);
    display: grid;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: var(--timer-ring-inset);
    grid-column: 1;
    grid-row: 1 / 4;
    place-items: center;
    overflow: visible;
  }

  .timer-ring :deep(.v-progress-circular) {
    width: min(
      100%,
      calc(
        100dvh
        - max(1rem, env(safe-area-inset-top))
        - max(1rem, env(safe-area-inset-bottom))
        - var(--timer-ring-inset)
        - var(--timer-ring-inset)
      )
    ) !important;
    height: auto !important;
    aspect-ratio: 1;
  }

  .timer-value {
    font-size: clamp(3rem, 18dvh, 6rem);
  }

  .projected-copy {
    min-width: 0;
    padding: .7rem 0 .7rem clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 2;
    overflow: hidden;
    border-top: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .12);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .timer-controls--portrait {
    display: none;
  }

  .timer-controls--landscape {
    display: grid;
    width: 100%;
    padding: .5rem 0 0 clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 3;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
    align-content: center;
    gap: .5rem;
  }

  .timer-controls--landscape :deep(.v-btn) {
    width: 100% !important;
    max-width: none;
    min-width: 0;
    height: clamp(2.75rem, 12dvh, 3.5rem);
  }

  .timer-controls--landscape .timer-play-button {
    height: clamp(3rem, 14dvh, 4rem);
  }

  .timer-controls--landscape .timer-log-button {
    grid-column: 1 / -1;
  }

  .timer-controls--landscape :deep(.v-btn__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
