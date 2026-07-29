<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { stopBackgroundInterval, syncBackgroundInterval } from '@/services/backgroundInterval'
import { notifyIntervalTransition, playIntervalCue, prepareIntervalCues, requestIntervalWakeLock } from '@/services/intervalCues'
import {
  createRuntimeState,
  formatIntervalDuration,
  reconcileIntervalRuntime,
  resolveIntervalStep,
} from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalRuntimeState, IntervalSession } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const displayRemainingMs = ref(0)
const syncing = ref(false)
const endDialog = ref(false)
const error = ref('')
const backgroundError = ref('')
let ticker: number | undefined
let wakeLock: { release: () => Promise<void> } | undefined

const session = computed(() => store.sessions.find((item) => item.id === route.params.sessionId))
const current = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex) : undefined)
const next = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex + 1) : undefined)
const finished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const currentDurationMs = computed(() => (current.value?.step.durationSeconds || 0) * 1000)
const remainingLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.ceil(displayRemainingMs.value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
})
const progress = computed(() => {
  if (!current.value || !currentDurationMs.value) return finished.value ? 100 : 0
  const stepProgress = 1 - (displayRemainingMs.value / currentDurationMs.value)
  return Math.min(100, ((current.value.index + stepProgress) / current.value.totalSteps) * 100)
})
const elapsedSeconds = computed(() => {
  const item = session.value
  if (!item) return 0
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return Math.round(item.runtime.accumulatedMs / 1000)
  return Math.round((item.runtime.accumulatedMs + Math.max(0, Date.now() - new Date(item.runtime.stepStartedAt).getTime())) / 1000)
})

onMounted(async () => {
  try {
    if (!store.sessions.length) await store.load()
    if (!session.value) {
      error.value = 'That interval session could not be found.'
      return
    }
    displayRemainingMs.value = session.value.runtime.remainingMs
    if (session.value.status === 'running') {
      await prepareIntervalCues(session.value.cues)
      wakeLock = await requestIntervalWakeLock()
    }
    await tick()
    if (session.value?.status === 'running') await syncNativeTimer(session.value)
    ticker = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', mirrorCurrentRuntime)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not restore the interval.'
  }
})

onBeforeUnmount(() => {
  if (ticker) window.clearInterval(ticker)
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('pagehide', mirrorCurrentRuntime)
  void wakeLock?.release()
})

function reconciled(item: IntervalSession) {
  return item.status === 'running'
    ? reconcileIntervalRuntime(item.definition, item.runtime)
    : { runtime: { ...item.runtime }, completed: false, transitions: 0 }
}

async function syncNativeTimer(item: IntervalSession) {
  try {
    await syncBackgroundInterval(item)
    backgroundError.value = ''
  } catch (cause) {
    backgroundError.value = cause instanceof Error ? cause.message : 'Background interval timing is unavailable.'
  }
}

function mirrorCurrentRuntime() {
  const item = session.value
  if (!item || item.status !== 'running') return
  const result = reconciled(item)
  store.mirrorRuntime(item.id, result.runtime)
}

async function handleVisibility() {
  if (document.visibilityState === 'visible' && session.value?.status === 'running') {
    wakeLock = await requestIntervalWakeLock()
    await tick()
  }
}

async function tick() {
  const item = session.value
  if (!item || syncing.value || finished.value) return
  if (item.status === 'paused') {
    displayRemainingMs.value = item.runtime.remainingMs
    return
  }
  const result = reconciled(item)
  displayRemainingMs.value = result.runtime.remainingMs
  if (!result.transitions) return

  syncing.value = true
  store.mirrorRuntime(item.id, result.runtime)
  try {
    if (result.completed) {
      await completeSession(item, result.runtime)
      return
    }
    const updated = await store.updateSession(item.id, {
      runtime: result.runtime,
      elapsedSeconds: Math.round(result.runtime.accumulatedMs / 1000),
    })
    const resolved = resolveIntervalStep(updated.definition, updated.runtime.stepIndex)
    if (resolved) {
      playIntervalCue(updated.cues)
      await notifyIntervalTransition(resolved.step.name, `Interval ${resolved.index + 1} of ${resolved.totalSteps}`)
    }
  } finally {
    syncing.value = false
  }
}

async function completeSession(item: IntervalSession, runtime: IntervalRuntimeState) {
  playIntervalCue(item.cues)
  await notifyIntervalTransition(`${item.name} complete`, 'Your interval session is finished.')
  await stopBackgroundInterval()
  await store.updateSession(item.id, {
    status: 'completed',
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    endedAt: new Date().toISOString(),
  })
  await wakeLock?.release()
  wakeLock = undefined
}

async function pause() {
  const item = session.value
  if (!item || item.status !== 'running') return
  const result = reconciled(item)
  if (result.completed) return completeSession(item, result.runtime)
  const runtime = { ...result.runtime, stepStartedAt: undefined, updatedAt: new Date().toISOString() }
  await store.updateSession(item.id, {
    status: 'paused',
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
  })
  displayRemainingMs.value = runtime.remainingMs
  await stopBackgroundInterval()
  await wakeLock?.release()
  wakeLock = undefined
}

async function resume() {
  const item = session.value
  if (!item || item.status !== 'paused') return
  const now = new Date().toISOString()
  const runtime = { ...item.runtime, stepStartedAt: now, updatedAt: now }
  await prepareIntervalCues(item.cues)
  const updated = await store.updateSession(item.id, { status: 'running', runtime })
  await syncNativeTimer(updated)
  wakeLock = await requestIntervalWakeLock()
}

async function skip() {
  const item = session.value
  if (!item || finished.value) return
  const result = reconciled(item)
  const nextIndex = result.runtime.stepIndex + 1
  const nextStep = resolveIntervalStep(item.definition, nextIndex)
  if (!nextStep) return completeSession(item, { ...result.runtime, stepIndex: nextIndex, remainingMs: 0, stepStartedAt: undefined })
  const now = new Date().toISOString()
  const runtime = {
    ...result.runtime,
    stepIndex: nextIndex,
    remainingMs: nextStep.step.durationSeconds * 1000,
    stepStartedAt: item.status === 'running' ? now : undefined,
    updatedAt: now,
  }
  const updated = await store.updateSession(item.id, { runtime, elapsedSeconds: Math.round(runtime.accumulatedMs / 1000) })
  displayRemainingMs.value = runtime.remainingMs
  if (updated.status === 'running') await syncNativeTimer(updated)
  playIntervalCue(item.cues)
}

async function previous() {
  const item = session.value
  if (!item || finished.value) return
  const result = reconciled(item)
  const previousIndex = Math.max(0, result.runtime.stepIndex - 1)
  const previousStep = resolveIntervalStep(item.definition, previousIndex)
  if (!previousStep) return
  const now = new Date().toISOString()
  const runtime = {
    ...result.runtime,
    stepIndex: previousIndex,
    remainingMs: previousStep.step.durationSeconds * 1000,
    stepStartedAt: item.status === 'running' ? now : undefined,
    updatedAt: now,
  }
  const updated = await store.updateSession(item.id, { runtime, elapsedSeconds: Math.round(runtime.accumulatedMs / 1000) })
  displayRemainingMs.value = runtime.remainingMs
  if (updated.status === 'running') await syncNativeTimer(updated)
}

async function restart() {
  const item = session.value
  if (!item) return
  const runtime = createRuntimeState(item.definition)
  if (item.status === 'paused') runtime.stepStartedAt = undefined
  const updated = await store.updateSession(item.id, { status: item.status === 'paused' ? 'paused' : 'running', runtime, elapsedSeconds: 0 })
  displayRemainingMs.value = runtime.remainingMs
  if (updated.status === 'running') await syncNativeTimer(updated)
}

async function endEarly() {
  const item = session.value
  if (!item) return
  const result = reconciled(item)
  const runtime = { ...result.runtime, stepStartedAt: undefined, updatedAt: new Date().toISOString() }
  await store.updateSession(item.id, {
    status: 'ended',
    runtime,
    elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    endedAt: new Date().toISOString(),
  })
  endDialog.value = false
  await stopBackgroundInterval()
  await wakeLock?.release()
  wakeLock = undefined
}

async function runAgain() {
  const item = session.value
  if (!item) return
  await prepareIntervalCues(item.cues)
  const nextSession = await store.startSession({
    name: item.name,
    source: item.source,
    definition: item.definition,
    cues: item.cues,
    template: item.template,
  })
  await router.replace(`/intervals/run/${nextSession.id}`)
  displayRemainingMs.value = nextSession.runtime.remainingMs
  await syncNativeTimer(nextSession)
  wakeLock = await requestIntervalWakeLock()
}
</script>

<template>
  <main class="runner-page">
    <v-alert v-if="backgroundError" type="warning" variant="tonal" class="mb-3">{{ backgroundError }}</v-alert>
    <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>

    <template v-else-if="session && finished">
      <section class="finish-card">
        <div class="finish-icon"><v-icon :icon="session.status === 'completed' ? 'mdi-check-bold' : 'mdi-stop'" size="34" /></div>
        <p class="runner-label">{{ session.status === 'completed' ? 'Session complete' : 'Session ended' }}</p>
        <h1 class="display-title">{{ session.name }}<span class="text-secondary">.</span></h1>
        <div class="finish-stats">
          <div><span>Planned</span><strong>{{ formatIntervalDuration(session.plannedSeconds) }}</strong></div>
          <div><span>Elapsed</span><strong>{{ formatIntervalDuration(session.elapsedSeconds) }}</strong></div>
          <div><span>Intervals</span><strong>{{ Math.min(session.runtime.stepIndex, current?.totalSteps || session.runtime.stepIndex) }}</strong></div>
        </div>
        <div class="finish-actions">
          <v-btn color="secondary" size="large" prepend-icon="mdi-replay" @click="runAgain">Run again</v-btn>
          <v-btn variant="outlined" size="large" to="/intervals">Done</v-btn>
        </div>
      </section>
    </template>

    <template v-else-if="session && current">
      <header class="runner-header">
        <v-btn icon="mdi-chevron-down" variant="text" aria-label="Leave runner" to="/intervals" />
        <div class="text-center min-width-0">
          <p class="runner-label">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</p>
          <strong class="text-truncate d-block">{{ session.name }}</strong>
        </div>
        <v-btn icon="mdi-stop-circle-outline" variant="text" color="error" aria-label="End session" @click="endDialog = true" />
      </header>

      <section class="runner-main">
        <div v-if="current.groups.length" class="group-breadcrumb">
          <span v-for="group in current.groups" :key="`${group.name}-${group.iteration}`">{{ group.name }} {{ group.iteration }}/{{ group.total }}</span>
        </div>
        <p class="step-kind">{{ current.step.kind }}</p>
        <h1 class="runner-step">{{ current.step.name }}</h1>
        <div class="timer-ring">
          <v-progress-circular :model-value="progress" :size="260" :width="12" color="secondary" bg-color="surface-variant">
            <span class="timer-value">{{ remainingLabel }}</span>
          </v-progress-circular>
        </div>
        <p class="next-copy">{{ next ? `Next: ${next.step.name}` : 'Final interval' }}</p>
      </section>

      <footer class="runner-controls">
        <v-btn icon="mdi-skip-previous" variant="tonal" size="large" aria-label="Previous interval" :disabled="current.index === 0" @click="previous" />
        <v-btn
          :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
          color="secondary"
          size="x-large"
          :aria-label="session.status === 'paused' ? 'Resume' : 'Pause'"
          @click="session.status === 'paused' ? resume() : pause()"
        />
        <v-btn icon="mdi-skip-next" variant="tonal" size="large" aria-label="Skip interval" @click="skip" />
        <v-btn prepend-icon="mdi-restart" variant="text" class="restart-button" @click="restart">Restart</v-btn>
      </footer>
    </template>

    <ConfirmDialog
      v-model="endDialog"
      title="End this session?"
      message="Your elapsed time will be saved, but this run will be marked as ended early."
      confirm-text="End session"
      icon="mdi-stop-circle-outline"
      @confirm="endEarly"
    />
  </main>
</template>

<style scoped>
.runner-page { min-height: 100dvh; display: flex; flex-direction: column; padding: max(1rem, env(safe-area-inset-top)) 1rem max(1rem, env(safe-area-inset-bottom)); background: rgb(var(--v-theme-background)); }
.runner-header { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; }
.runner-label, .step-kind { color: rgb(var(--v-theme-on-surface) / .52); font-size: .68rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.runner-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.group-breadcrumb { display: flex; flex-wrap: wrap; justify-content: center; gap: .35rem; margin-bottom: 1.25rem; }
.group-breadcrumb span { padding: 4px 8px; border-radius: 999px; background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-on-surface) / .7); font-size: .65rem; }
.runner-step { max-width: 640px; margin-top: .5rem; font-size: clamp(2rem, 10vw, 4.5rem); font-weight: 900; line-height: 1; }
.timer-ring { margin: 2.25rem 0 1.5rem; }
.timer-value { font-family: "Arial Narrow", Impact, sans-serif; font-size: 4rem; font-weight: 900; letter-spacing: -.04em; }
.next-copy { color: rgb(var(--v-theme-on-surface) / .56); font-size: .78rem; }
.runner-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; justify-items: center; gap: 1rem; }
.restart-button { grid-column: 1 / -1; }
.finish-card { width: 100%; max-width: 620px; margin: auto; text-align: center; }
.finish-icon { display: grid; width: 72px; height: 72px; margin: 0 auto 1rem; place-items: center; border-radius: 24px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.finish-card h1 { margin-top: .75rem; font-size: clamp(2.8rem, 12vw, 5rem); }
.finish-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; margin: 2rem 0; }
.finish-stats div { display: flex; padding: 1rem .5rem; flex-direction: column; border-radius: 16px; background: rgb(var(--v-theme-surface)); }
.finish-stats span { color: rgb(var(--v-theme-on-surface) / .52); font-size: .6rem; text-transform: uppercase; }
.finish-stats strong { margin-top: .25rem; font-size: 1rem; }
.finish-actions { display: grid; gap: .75rem; }
@media (min-width: 700px) { .finish-actions { grid-template-columns: 1fr 1fr; } }
</style>
