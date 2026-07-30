<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { stopBackgroundInterval, syncBackgroundInterval } from '@/services/backgroundInterval'
import {
  notifyIntervalTransition,
  playIntervalCountCue,
  playIntervalGoCue,
  prepareIntervalCues,
  requestIntervalWakeLock,
} from '@/services/intervalCues'
import {
  createRuntimeState,
  formatIntervalDuration,
  intervalDuration,
  intervalRunProgress,
  reconcileIntervalRuntime,
  resolveIntervalStep,
  intervalStepDurationSeconds,
} from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalRuntimeState, IntervalSession } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const displayRemainingMs = ref(0)
const syncing = ref(false)
const starting = ref(false)
const endDialog = ref(false)
const error = ref('')
const backgroundError = ref('')
const timerEffect = ref<'count' | ''>('')
const timerEffectKey = ref(0)
let ticker: number | undefined
let wakeLock: { release: () => Promise<void> } | undefined
let runnerMounted = false
let lastCountCue = ''
let timerEffectTimeout: number | undefined

const previewSession = ref<IntervalSession>()
const isTemplatePreview = computed(() => Boolean(route.params.templateId))
const persistedSession = computed(() => store.sessions.find((item) => item.id === route.params.sessionId))
const session = computed(() => persistedSession.value || previewSession.value)
const current = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex) : undefined)
const next = computed(() => session.value ? resolveIntervalStep(session.value.definition, session.value.runtime.stepIndex + 1) : undefined)
const finished = computed(() => session.value?.status === 'completed' || session.value?.status === 'ended')
const currentConfirmation = computed(() => current.value?.step.kind === 'confirmation')
const remainingLabel = computed(() => {
  const totalSeconds = Math.max(0, Math.ceil(displayRemainingMs.value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
})
const progress = computed(() => {
  if (!session.value || !current.value) {
    return { total: finished.value ? 100 : 0, item: finished.value ? 100 : 0 }
  }
  return intervalRunProgress(
    session.value.definition,
    current.value.index,
    displayRemainingMs.value,
  )
})
const showTotalProgress = computed(() => (current.value?.totalSteps || 0) > 1)
const showRoundProgress = computed(() => progress.value.round !== undefined)
const elapsedSeconds = computed(() => {
  const item = session.value
  if (!item) return 0
  if (item.status !== 'running' || !item.runtime.stepStartedAt) return Math.round(item.runtime.accumulatedMs / 1000)
  return Math.round((item.runtime.accumulatedMs + Math.max(0, Date.now() - new Date(item.runtime.stepStartedAt).getTime())) / 1000)
})
const hasStarted = computed(() => {
  const item = session.value
  if (!item) return false
  const initialStep = resolveIntervalStep(item.definition, 0)
  const initialDurationMs = initialStep ? intervalStepDurationSeconds(initialStep.step) * 1000 : 0
  return item.runtime.stepIndex > 0
    || item.runtime.accumulatedMs > 0
    || item.runtime.remainingMs < initialDurationMs
})
const playActionLabel = computed(() => hasStarted.value ? 'Resume' : 'Start')

onMounted(async () => {
  runnerMounted = true
  try {
    if (!store.loaded) await store.load()
    if (isTemplatePreview.value) {
      const template = store.templates.find((item) => item.id === route.params.templateId)
      if (!template) {
        error.value = 'That interval template could not be found.'
        return
      }
      const now = new Date()
      const runtime = createRuntimeState(template.definition, now)
      runtime.stepStartedAt = undefined
      previewSession.value = {
        id: `template-preview-${template.id}`,
        template: template.id,
        source: 'template',
        status: 'paused',
        name: template.name,
        definition: template.definition,
        cues: template.cues,
        startedAt: now.toISOString(),
        plannedSeconds: intervalDuration(template.definition),
        elapsedSeconds: 0,
        runtime,
        updated: now.toISOString(),
      }
    }
    if (!session.value) {
      error.value = 'That interval session could not be found.'
      return
    }
    displayRemainingMs.value = session.value.runtime.remainingMs
    await tick()
    ticker = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', mirrorCurrentRuntime)

    const active = session.value
    if (active?.status === 'running') {
      void prepareIntervalCues(active.cues)
      void syncNativeTimer(active)
      void requestIntervalWakeLock().then(async (lock) => {
        if (!runnerMounted || session.value?.id !== active.id || session.value.status !== 'running') {
          await lock?.release()
          return
        }
        wakeLock = lock
      })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not restore the interval.'
  }
})

onBeforeUnmount(() => {
  runnerMounted = false
  if (ticker) window.clearInterval(ticker)
  if (timerEffectTimeout) window.clearTimeout(timerEffectTimeout)
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('pagehide', mirrorCurrentRuntime)
  void wakeLock?.release()
})

function pulseTimer(effect: 'count') {
  if (timerEffectTimeout) window.clearTimeout(timerEffectTimeout)
  timerEffect.value = effect
  timerEffectKey.value += 1
  timerEffectTimeout = window.setTimeout(() => {
    timerEffect.value = ''
    timerEffectTimeout = undefined
  }, 560)
}

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
  if (!result.transitions) {
    const remainingSeconds = Math.ceil(result.runtime.remainingMs / 1000)
    if (remainingSeconds >= 1 && remainingSeconds <= 3) {
      const cue = `${result.runtime.stepIndex}:${remainingSeconds}`
      if (cue !== lastCountCue) {
        lastCountCue = cue
        pulseTimer('count')
        playIntervalCountCue(item.cues)
      }
    }
  }
  if (!result.transitions) return

  syncing.value = true
  store.mirrorRuntime(item.id, result.runtime)
  try {
    if (result.completed) {
      await completeSession(item, result.runtime)
      return
    }
    playIntervalGoCue(item.cues)
    const updated = await store.updateSession(item.id, {
      runtime: result.runtime,
      elapsedSeconds: Math.round(result.runtime.accumulatedMs / 1000),
    })
    const resolved = resolveIntervalStep(updated.definition, updated.runtime.stepIndex)
    if (resolved) {
      await notifyIntervalTransition(resolved.step.name, `Interval ${resolved.index + 1} of ${resolved.totalSteps}`)
    }
  } finally {
    syncing.value = false
  }
}

async function completeSession(item: IntervalSession, runtime: IntervalRuntimeState) {
  playIntervalGoCue(item.cues)
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
  const step = resolveIntervalStep(item.definition, item.runtime.stepIndex)
  const runtime = {
    ...item.runtime,
    stepStartedAt: step?.step.kind === 'confirmation' ? undefined : now,
    updatedAt: now,
  }
  await prepareIntervalCues(item.cues)
  const updated = await store.updateSession(item.id, { status: 'running', runtime })
  await syncNativeTimer(updated)
  wakeLock = await requestIntervalWakeLock()
}

async function startTemplate() {
  const item = previewSession.value
  if (!item || starting.value) return
  starting.value = true
  error.value = ''
  try {
    await prepareIntervalCues(item.cues)
    const started = await store.startSession({
      name: item.name,
      source: 'template',
      definition: item.definition,
      cues: item.cues,
      template: item.template,
    })
    previewSession.value = undefined
    await router.replace(`/intervals/run/${started.id}`)
    displayRemainingMs.value = started.runtime.remainingMs
    if (started.status === 'running') {
      await syncNativeTimer(started)
      wakeLock = await requestIntervalWakeLock()
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the interval.'
  } finally {
    starting.value = false
  }
}

async function advanceCurrent(item: IntervalSession) {
  if (syncing.value) return
  syncing.value = true
  const result = reconciled(item)
  const nextIndex = result.runtime.stepIndex + 1
  const nextStep = resolveIntervalStep(item.definition, nextIndex)
  try {
    if (!nextStep) {
      await completeSession(item, {
        ...result.runtime,
        stepIndex: nextIndex,
        remainingMs: 0,
        stepStartedAt: undefined,
      })
      return
    }
    const now = new Date().toISOString()
    const runtime = {
      ...result.runtime,
      stepIndex: nextIndex,
      remainingMs: intervalStepDurationSeconds(nextStep.step) * 1000,
      stepStartedAt: item.status === 'running' && nextStep.step.kind !== 'confirmation'
        ? now
        : undefined,
      updatedAt: now,
    }
    const updated = await store.updateSession(item.id, {
      runtime,
      elapsedSeconds: Math.round(runtime.accumulatedMs / 1000),
    })
    displayRemainingMs.value = runtime.remainingMs
    lastCountCue = ''
    if (updated.status === 'running') await syncNativeTimer(updated)
    playIntervalGoCue(item.cues)
  } finally {
    syncing.value = false
  }
}

async function confirmCurrent() {
  const item = session.value
  if (
    !item
    || item.status !== 'running'
    || current.value?.step.kind !== 'confirmation'
    || finished.value
  ) return
  await advanceCurrent(item)
}

async function skip() {
  const item = session.value
  if (!item || currentConfirmation.value || finished.value) return
  await advanceCurrent(item)
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
    remainingMs: intervalStepDurationSeconds(previousStep.step) * 1000,
    stepStartedAt: item.status === 'running' && previousStep.step.kind !== 'confirmation'
      ? now
      : undefined,
    updatedAt: now,
  }
  const updated = await store.updateSession(item.id, { runtime, elapsedSeconds: Math.round(runtime.accumulatedMs / 1000) })
  displayRemainingMs.value = runtime.remainingMs
  lastCountCue = ''
  if (updated.status === 'running') await syncNativeTimer(updated)
}

async function restart() {
  const item = session.value
  if (!item) return
  const runtime = createRuntimeState(item.definition)
  if (item.status === 'paused') runtime.stepStartedAt = undefined
  const updated = await store.updateSession(item.id, { status: item.status === 'paused' ? 'paused' : 'running', runtime, elapsedSeconds: 0 })
  displayRemainingMs.value = runtime.remainingMs
  lastCountCue = ''
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
  <main class="runner-page" :class="{ 'runner-page--finished': finished }">
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
        <v-btn icon="mdi-stop-circle-outline" variant="text" color="error" aria-label="End session" :disabled="isTemplatePreview" @click="endDialog = true" />
      </header>

      <div class="runner-stage">
        <section class="runner-main">
          <div class="runner-details">
            <p class="runner-session">{{ session.name }}</p>
            <p class="runner-label runner-position">Interval {{ current.index + 1 }} of {{ current.totalSteps }}</p>
            <div v-if="current.groups.length" class="group-breadcrumb">
              <span v-for="group in current.groups" :key="`${group.name}-${group.iteration}`">{{ group.name }} {{ group.iteration }}/{{ group.total }}</span>
            </div>
            <h1 class="runner-step">{{ current.step.name }}</h1>
          </div>
          <div class="runner-progress" :class="{ 'runner-progress--confirmation': currentConfirmation }">
            <div class="progress-rings">
              <v-progress-circular
                v-if="showTotalProgress"
                class="progress-ring progress-ring--total"
                :model-value="progress.total"
                :width="7"
                color="info"
                bg-color="surface-variant"
                :aria-label="`Total progress: ${Math.round(progress.total)}%`"
              />
              <v-progress-circular
                v-if="showRoundProgress"
                class="progress-ring progress-ring--round"
                :model-value="progress.round"
                :width="7"
                color="warning"
                bg-color="surface-variant"
                :aria-label="`Current round progress: ${Math.round(progress.round || 0)}%`"
              />
              <v-progress-circular
                class="progress-ring progress-ring--item"
                :model-value="progress.item"
                :width="12"
                color="secondary"
                bg-color="surface-variant"
                :aria-label="`Current item progress: ${Math.round(progress.item)}%`"
              />
              <div class="progress-rings__content">
                <v-btn
                  v-if="currentConfirmation"
                  color="secondary"
                  size="large"
                  prepend-icon="mdi-check-bold"
                  :loading="starting || syncing"
                  :disabled="!isTemplatePreview && session.status !== 'running'"
                  @touchstart.stop
                  @click.stop="isTemplatePreview ? startTemplate() : confirmCurrent()"
                >
                  {{ isTemplatePreview ? playActionLabel : 'Confirm and continue' }}
                </v-btn>
                <span
                  v-else
                  :key="timerEffectKey"
                  class="timer-value"
                  :class="{
                    'timer-value--count': timerEffect === 'count',
                  }"
                >
                  {{ remainingLabel }}
                </span>
              </div>
            </div>
          </div>
          <p class="next-copy">{{ next ? `Next: ${next.step.name}` : 'Final interval' }}</p>
        </section>

        <footer class="runner-controls runner-controls--portrait">
          <v-btn icon="mdi-skip-previous" variant="tonal" size="large" aria-label="Previous interval" :disabled="isTemplatePreview || current.index === 0" @click="previous" />
          <v-btn
            :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
            color="secondary"
            size="x-large"
            :loading="starting"
            :aria-label="session.status === 'paused' ? playActionLabel : 'Pause'"
            @touchstart.stop
            @click.stop="isTemplatePreview ? startTemplate() : session.status === 'paused' ? resume() : pause()"
          />
          <v-btn icon="mdi-skip-next" variant="tonal" size="large" aria-label="Skip interval" :disabled="isTemplatePreview || currentConfirmation" @click="skip" />
          <v-btn prepend-icon="mdi-restart" variant="text" class="restart-button" :disabled="isTemplatePreview" @click="restart">Restart</v-btn>
        </footer>

        <footer class="runner-controls runner-controls--landscape">
          <v-btn
            icon="mdi-skip-previous"
            variant="tonal"
            :disabled="isTemplatePreview || current.index === 0"
            aria-label="Previous interval"
            @click="previous"
          />
          <v-btn
            :icon="session.status === 'paused' ? 'mdi-play' : 'mdi-pause'"
            color="secondary"
            class="runner-pause-button"
            :loading="starting"
            :aria-label="session.status === 'paused' ? playActionLabel : 'Pause'"
            @touchstart.stop
            @click.stop="isTemplatePreview ? startTemplate() : session.status === 'paused' ? resume() : pause()"
          />
          <v-btn icon="mdi-skip-next" variant="tonal" aria-label="Next interval" :disabled="isTemplatePreview || currentConfirmation" @click="skip" />
          <v-btn
            icon="mdi-chevron-left"
            variant="text"
            class="runner-back-button"
            aria-label="Back to intervals"
            to="/intervals"
          />
          <v-btn
            icon="mdi-restart"
            variant="text"
            class="restart-button"
            aria-label="Restart interval"
            :disabled="isTemplatePreview"
            @click="restart"
          />
          <v-btn
            icon="mdi-stop-circle-outline"
            variant="text"
            color="error"
            class="runner-stop-button"
            aria-label="Stop interval"
            :disabled="isTemplatePreview"
            @click="endDialog = true"
          />
        </footer>
      </div>
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
.runner-page {
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
  background: rgb(var(--v-theme-background));
}
.runner-page.page-depth-deeper-enter-active > *,
.runner-page.page-depth-deeper-leave-active > *,
.runner-page.page-depth-higher-enter-active > *,
.runner-page.page-depth-higher-leave-active > * {
  transition: none;
}
.runner-page.page-depth-deeper-enter-from > *,
.runner-page.page-depth-deeper-leave-to > *,
.runner-page.page-depth-higher-enter-from > *,
.runner-page.page-depth-higher-leave-to > * {
  transform: none;
}
.runner-header { display: grid; grid-template-columns: 48px minmax(0, 1fr) 48px; align-items: center; }
.runner-label { color: rgb(var(--v-theme-on-surface) / .52); font-size: .68rem; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.runner-stage { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.runner-main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.runner-details { display: contents; }
.runner-session { display: none; }
.runner-position { display: none; }
.group-breadcrumb { display: flex; flex-wrap: wrap; justify-content: center; gap: .35rem; margin-bottom: 1.25rem; }
.group-breadcrumb span { padding: 4px 8px; border-radius: 999px; background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-on-surface) / .7); font-size: .65rem; }
.runner-step { max-width: 640px; margin-top: .5rem; font-size: clamp(2rem, 10vw, 4.5rem); font-weight: 900; line-height: 1; }
.runner-progress {
  display: flex;
  width: 100%;
  margin: 2.25rem 0 1.5rem;
  flex-direction: column;
  align-items: center;
}
.progress-rings {
  position: relative;
  width: min(292px, calc(100vw - 2rem));
  aspect-ratio: 1;
}
.progress-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.progress-ring--total {
  width: 100% !important;
  height: 100% !important;
}
.progress-ring--round {
  width: calc(100% - 16px) !important;
  height: calc(100% - 16px) !important;
}
.progress-ring--item {
  width: calc(100% - 32px) !important;
  height: calc(100% - 32px) !important;
}
.progress-rings__content {
  position: absolute;
  inset: 40px;
  display: grid;
  place-items: center;
}
.runner-progress--confirmation .progress-rings__content :deep(.v-btn) {
  width: min(100%, 13rem);
  min-height: 64px;
  white-space: normal;
}
.timer-value { display: inline-block; font-family: "Arial Narrow", Impact, sans-serif; font-size: 4rem; font-weight: 900; letter-spacing: -.04em; transform-origin: center; }
.timer-value--count { color: rgb(var(--v-theme-warning)); animation: timer-value-pulse 560ms cubic-bezier(.22, 1, .36, 1); }
@keyframes timer-value-pulse {
  0% { transform: scale(1); }
  38% { transform: scale(1.16); }
  100% { transform: scale(1); }
}
.next-copy { color: rgb(var(--v-theme-on-surface) / .56); font-size: .78rem; }
.runner-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; justify-items: center; gap: 1rem; }
.runner-controls--landscape { display: none; }
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

@media (orientation: portrait) {
  .runner-page {
    padding-bottom: max(2rem, calc(env(safe-area-inset-bottom, 0px) + 1rem));
  }
}

@media (orientation: landscape) and (max-height: 700px) {
  .runner-page {
    display: flex;
    width: 100%;
    max-width: 100vw;
    height: 100dvh;
    min-height: 0;
    padding:
      max(.5rem, env(safe-area-inset-top))
      max(1rem, env(safe-area-inset-right))
      max(.5rem, env(safe-area-inset-bottom))
      max(1rem, env(safe-area-inset-left));
    gap: .5rem;
    overflow: hidden;
  }

  .runner-page > :deep(.v-alert) {
    position: fixed;
    z-index: 20;
    top: max(.5rem, env(safe-area-inset-top));
    left: 50%;
    width: min(34rem, calc(100vw - 2rem));
    margin: 0 !important;
    transform: translateX(-50%);
  }

  .runner-header {
    display: none;
  }

  .runner-stage {
    display: grid;
    min-width: 0;
    min-height: 0;
    grid-template-columns: minmax(0, 1.15fr) minmax(14rem, .85fr);
    grid-template-rows: minmax(0, 1fr) auto auto;
    gap: .5rem 1rem;
  }

  .runner-main {
    display: contents;
  }

  .runner-details {
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
    border-radius: 0;
    background: transparent;
    text-align: left;
  }

  .runner-session {
    display: block;
    margin-bottom: clamp(.6rem, 2dvh, 1rem);
    overflow: hidden;
    color: rgb(var(--v-theme-on-surface) / .5);
    font-size: .72rem;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-position {
    display: block;
    margin-bottom: .45rem;
    color: rgb(var(--v-theme-secondary));
  }

  .group-breadcrumb {
    min-width: 0;
    margin: 0 0 .55rem;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow: hidden;
  }

  .group-breadcrumb span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-step {
    max-width: none;
    margin-top: 0;
    overflow-wrap: anywhere;
    font-size: clamp(1.65rem, 4.5vw, 3.6rem);
    line-height: .96;
  }

  .runner-progress {
    --runner-progress-inset: clamp(1rem, 5dvh, 2.5rem);
    display: flex;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: var(--runner-progress-inset);
    grid-column: 1;
    grid-row: 1 / 4;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: visible;
    border-radius: 0;
    background: transparent;
  }

  .progress-rings {
    width: min(
      100%,
      calc(
        100dvh
        - max(1rem, env(safe-area-inset-top))
        - max(1rem, env(safe-area-inset-bottom))
        - var(--runner-progress-inset)
        - var(--runner-progress-inset)
      )
    );
  }

  .timer-value {
    font-size: clamp(3rem, 18dvh, 6rem);
  }

  .runner-progress--confirmation .progress-rings__content :deep(.v-btn) {
    min-height: clamp(3.5rem, 18dvh, 5rem);
  }

  .next-copy {
    min-width: 0;
    padding: .7rem 0 .7rem clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 2;
    overflow: hidden;
    border-top: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .12);
    border-radius: 0;
    background: transparent;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .runner-controls--portrait {
    display: none;
  }

  .runner-controls--landscape {
    display: grid;
    width: 100%;
    padding: .5rem 0 0 clamp(1rem, 3vw, 2rem);
    grid-column: 2;
    grid-row: 3;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;
    align-content: center;
    gap: .5rem;
    border-radius: 0;
    background: transparent;
  }

  .runner-controls :deep(.v-btn) {
    width: 100% !important;
    max-width: none;
    min-width: 0;
  }

  .runner-controls--landscape :deep(.v-btn) {
    height: clamp(2.75rem, 12dvh, 3.5rem);
  }

  .runner-controls--landscape :deep(.runner-pause-button) {
    height: clamp(3rem, 14dvh, 4rem);
  }

  .runner-controls--landscape :deep(.v-btn__content) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .runner-controls--landscape .runner-back-button {
    grid-column: 1;
  }

  .runner-controls--landscape .restart-button {
    grid-column: 2;
  }

  .runner-controls--landscape .runner-stop-button {
    grid-column: 3;
  }

  .restart-button {
    grid-column: 1 / -1;
  }

  .runner-page--finished {
    display: grid;
    place-items: center;
  }

  .finish-card {
    display: grid;
    width: min(100%, 56rem);
    max-width: none;
    margin: 0;
    padding: clamp(.75rem, 3dvh, 1.25rem);
    grid-column: 1 / -1;
    grid-row: 1 / -1;
    grid-template-columns: auto minmax(10rem, 1fr) minmax(9rem, auto);
    grid-template-rows: auto auto auto;
    align-items: center;
    gap: .35rem clamp(.75rem, 3vw, 2rem);
    border-radius: 28px;
    background: rgb(var(--v-theme-surface) / .72);
    text-align: left;
  }

  .finish-icon {
    width: clamp(3rem, 12dvh, 4rem);
    height: clamp(3rem, 12dvh, 4rem);
    margin: 0;
    grid-column: 1;
    grid-row: 1 / -1;
    border-radius: 18px;
  }

  .finish-card > .runner-label {
    grid-column: 2;
    grid-row: 1;
    align-self: end;
  }

  .finish-card h1 {
    margin-top: 0;
    grid-column: 2;
    grid-row: 2;
    font-size: clamp(1.8rem, 6vw, 3.5rem);
  }

  .finish-stats {
    margin: .5rem 0 0;
    grid-column: 2;
    grid-row: 3;
    gap: .4rem;
  }

  .finish-stats div {
    padding: .5rem;
  }

  .finish-actions {
    min-width: 9rem;
    grid-column: 3;
    grid-row: 1 / -1;
    grid-template-columns: 1fr;
    align-self: center;
    gap: .5rem;
  }
}
</style>
