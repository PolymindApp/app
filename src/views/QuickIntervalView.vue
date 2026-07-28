<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import DurationInput from '@/components/DurationInput.vue'
import { prepareIntervalCues, previewIntervalCue } from '@/services/intervalCues'
import { formatIntervalDuration, intervalDuration, quickIntervalDefinition } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalCueSound, QuickIntervalDraft } from '@/types/domain'

const router = useRouter()
const store = useIntervalStore()
const starting = ref(false)
const error = ref('')
const draft = reactive<QuickIntervalDraft>({
  warmupSeconds: 0,
  workSeconds: 30,
  restSeconds: 15,
  rounds: 5,
  cooldownSeconds: 0,
  restAfterLastRound: false,
  cues: store.getQuickCues(),
})
const definition = computed(() => quickIntervalDefinition(draft))
const totalDuration = computed(() => intervalDuration(definition.value))

function previewSound(sound: unknown = draft.cues.sound) {
  return previewIntervalCue({ ...draft.cues, sound: sound as IntervalCueSound })
}

async function start() {
  if (draft.workSeconds <= 0 || !Number.isInteger(draft.rounds) || draft.rounds <= 0) {
    error.value = 'Add a positive work duration and at least one round.'
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
    <header class="editor-header mb-6">
      <v-btn icon="mdi-arrow-left" variant="tonal" aria-label="Go back" @click="router.back()" />
      <h1 class="display-title text-h5 text-center">QUICK INTERVAL<span class="text-secondary">.</span></h1>
      <div />
    </header>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-card class="surface-card pa-5 mb-4">
      <div class="quick-fields">
        <DurationInput v-model="draft.warmupSeconds" label="Warm-up (optional)" />
        <DurationInput v-model="draft.workSeconds" label="Work" />
        <DurationInput v-model="draft.restSeconds" label="Rest" />
        <v-text-field v-model.number="draft.rounds" label="Rounds" type="number" min="1" />
        <DurationInput v-model="draft.cooldownSeconds" label="Cooldown (optional)" />
      </div>
      <div class="setting-row mt-4">
        <div><strong>Rest after final round</strong><p>Include the final rest before cooldown</p></div>
        <v-switch v-model="draft.restAfterLastRound" color="secondary" hide-details inset />
      </div>
    </v-card>

    <v-card class="surface-card pa-5 mb-4">
      <div class="setting-row">
        <div><strong>Sound cues</strong><p>Signal each transition</p></div>
        <v-switch v-model="draft.cues.soundEnabled" color="secondary" hide-details inset />
      </div>
      <v-select
        v-if="draft.cues.soundEnabled"
        v-model="draft.cues.sound"
        label="Cue sound"
        :items="[{ title: 'Beep', value: 'beep' }, { title: 'Bell', value: 'bell' }, { title: 'Soft', value: 'soft' }]"
        class="mt-4"
      >
        <template #append-inner>
          <v-btn
            icon="mdi-play"
            variant="text"
            size="small"
            aria-label="Preview cue sound"
            @mousedown.stop
            @click.stop="previewSound()"
          />
        </template>
        <template #item="{ props, item }">
          <v-list-item v-bind="props">
            <template #append>
              <v-btn
                icon="mdi-play"
                variant="text"
                size="small"
                :aria-label="`Preview ${item.title} sound`"
                @mousedown.stop
                @click.stop="previewSound(item.value)"
              />
            </template>
          </v-list-item>
        </template>
      </v-select>
      <v-divider class="my-3" />
      <div class="setting-row">
        <div><strong>Vibration</strong><p>Use supported device haptics</p></div>
        <v-switch v-model="draft.cues.vibrationEnabled" color="secondary" hide-details inset />
      </div>
    </v-card>

    <v-card class="quick-summary pa-5" color="secondary">
      <div><span>Total time</span><strong>{{ formatIntervalDuration(totalDuration) }}</strong></div>
      <v-btn color="primary" size="large" append-icon="mdi-play" :loading="starting" @click="start">Start</v-btn>
    </v-card>
  </main>
</template>

<style scoped>
.editor-header { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; }
.quick-fields { display: grid; gap: 1rem; }
.setting-row { display: flex; min-height: 64px; align-items: center; justify-content: space-between; gap: 1rem; }
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
