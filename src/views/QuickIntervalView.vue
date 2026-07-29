<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'
import { prepareIntervalCues } from '@/services/intervalCues'
import { formatIntervalDuration, intervalDuration, quickIntervalDefinition } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { QuickIntervalDraft } from '@/types/domain'

const router = useRouter()
const store = useIntervalStore()
const starting = ref(false)
const error = ref('')
const includeRest = ref(false)
const draft = reactive<QuickIntervalDraft>({
  warmupSeconds: 0,
  workSeconds: 30,
  restSeconds: 15,
  rounds: 1,
  cooldownSeconds: 0,
  restAfterLastRound: false,
  cues: store.getQuickCues(),
})
const definition = computed(() => quickIntervalDefinition({
  ...draft,
  restSeconds: includeRest.value ? draft.restSeconds : 0,
  restAfterLastRound: includeRest.value,
}))
const totalDuration = computed(() => intervalDuration(definition.value))

async function start() {
  if (draft.workSeconds <= 0 || !Number.isInteger(draft.rounds) || draft.rounds <= 0) {
    error.value = 'Add a positive work duration and at least one round.'
    return
  }
  if (includeRest.value && draft.restSeconds <= 0) {
    error.value = 'Add a positive rest duration or turn off the rest period.'
    return
  }
  starting.value = true
  error.value = ''
  try {
    store.rememberQuickCues(draft.cues)
    await prepareIntervalCues(draft.cues)
    if (!store.sessions.length) await store.load()
    const session = await store.startSession({
      name: 'Quick interval',
      source: 'quick',
      definition: definition.value,
      cues: draft.cues,
    })
    await router.push(`/intervals/run/${session.id}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the interval.'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <main class="app-page quick-page">
    <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>

    <v-card class="surface-card pa-5">
      <div class="quick-fields">
        <header class="quick-intro">
          <h1>Set your timing</h1>
          <p>Build a one-time timer with focused work, optional rest, and repeatable rounds.</p>
        </header>
        <fieldset class="duration-wheel">
          <legend>Work</legend>
          <TimerWheelPicker v-model="draft.workSeconds" />
        </fieldset>
        <div class="rest-control">
          <v-checkbox
            v-model="includeRest"
            label="Include rest period"
            color="secondary"
            density="comfortable"
            hide-details
          />
          <v-expand-transition>
            <div v-show="includeRest" class="rest-control__expand">
              <div class="rest-control__content">
                <fieldset class="duration-wheel">
                  <legend>Rest</legend>
                  <TimerWheelPicker v-model="draft.restSeconds" :active="includeRest" />
                </fieldset>
              </div>
            </div>
          </v-expand-transition>
        </div>
        <div class="rounds-control">
          <div class="rounds-control__heading">
            <span>Rounds</span>
            <strong>{{ draft.rounds }}</strong>
          </div>
          <v-slider
            v-model="draft.rounds"
            :min="1"
            :max="15"
            :step="1"
            color="secondary"
            hide-details
            aria-label="Rounds"
          />
          <div class="rounds-control__range" aria-hidden="true">
            <span>1</span>
            <span>15</span>
          </div>
        </div>
      </div>
    </v-card>

    <v-card class="surface-card pa-5">
      <div class="setting-row">
        <div><strong>Sound cues</strong><p>Count down the final three seconds and signal each interval</p></div>
        <v-switch v-model="draft.cues.soundEnabled" color="secondary" hide-details inset />
      </div>
      <v-divider class="my-3" />
      <div class="setting-row">
        <div><strong>Vibration</strong><p>Use supported device haptics</p></div>
        <v-switch v-model="draft.cues.vibrationEnabled" color="secondary" hide-details inset />
      </div>
    </v-card>

    <v-card class="quick-summary page-action-area pa-5" color="secondary">
      <div><span>Total time</span><strong>{{ formatIntervalDuration(totalDuration) }}</strong></div>
      <v-btn color="primary" size="large" append-icon="mdi-play" :loading="starting" @click="start">Start</v-btn>
    </v-card>
  </main>
</template>

<style scoped>
.quick-page { display: grid; gap: 1rem; }
.quick-intro { display: grid; gap: .35rem; }
.quick-intro h1 { font-size: 1.4rem; font-weight: 900; letter-spacing: -.025em; line-height: 1.2; }
.quick-intro p { max-width: 38rem; color: rgb(var(--v-theme-on-background) / .58); font-size: .82rem; line-height: 1.5; }
.quick-fields { display: grid; gap: 1rem; }
.duration-wheel { min-width: 0; margin: 0; padding: 0; border: 0; }
.duration-wheel > legend { margin-bottom: .5rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 800; }
.rest-control__expand { overflow: hidden; }
.rest-control__content { padding-top: 1rem; }
.rounds-control__heading { display: flex; margin-bottom: .25rem; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 800; }
.rounds-control__heading strong { display: grid; min-width: 2rem; height: 2rem; padding: 0 .5rem; place-items: center; border-radius: 10px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); font-size: .8rem; }
.rounds-control__range { display: flex; margin-top: -.2rem; padding: 0 .5rem; justify-content: space-between; color: rgb(var(--v-theme-on-surface) / .5); font-size: .7rem; font-weight: 700; }
.setting-row { display: grid; min-height: 64px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
.setting-row > div { min-width: 0; }
.setting-row p { margin-top: .15rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .7rem; }
.quick-summary { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.quick-summary div { display: flex; flex-direction: column; }
.quick-summary span { font-size: .65rem; font-weight: 850; text-transform: uppercase; }
.quick-summary strong { font-size: 1.5rem; }

@media (max-width: 959px) {
  .quick-page {
    padding-bottom: calc(7rem + env(safe-area-inset-bottom));
  }

  .quick-summary {
    position: fixed;
    z-index: 20;
    right: 0;
    bottom: calc(72px + env(safe-area-inset-bottom));
    left: 0;
    border-radius: 0 !important;
    box-shadow: 0 -12px 30px rgba(0, 0, 0, .28) !important;
  }
}

</style>
