<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { defaultAggregation, TRACKING_PRESETS, trackerDraftFromPreset } from '@/services/tracking'
import {
  reconcileTrackingReminders,
  requestTrackingReminderPermission,
  trackingRemindersAvailable,
} from '@/services/trackingReminders'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackerKind, TrackingTrackerDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useTrackingStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const archiveDialog = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const reminderAvailable = trackingRemindersAvailable()

const kindOptions: Array<{ value: TrackerKind; title: string; subtitle: string; icon: string }> = [
  { value: 'yes_no', title: 'Yes / no', subtitle: 'One explicit answer per log', icon: 'mdi-check-circle-outline' },
  { value: 'event', title: 'Repeatable event', subtitle: 'Count occurrences during a day', icon: 'mdi-counter' },
  { value: 'number', title: 'Number', subtitle: 'Any measured numeric value', icon: 'mdi-numeric' },
  { value: 'rating', title: 'Rating', subtitle: 'A bounded scale, such as 1–10', icon: 'mdi-star-outline' },
  { value: 'duration', title: 'Duration', subtitle: 'Minutes spent on something', icon: 'mdi-timer-outline' },
]

const categoryOptions = [
  { title: 'Mindfulness', value: 'mindfulness' },
  { title: 'Medication', value: 'medication' },
  { title: 'Nutrition', value: 'nutrition' },
  { title: 'Mood', value: 'mood' },
  { title: 'Symptom', value: 'symptom' },
  { title: 'Sleep', value: 'sleep' },
  { title: 'Activity', value: 'activity' },
  { title: 'Other', value: 'other' },
]

const draft = reactive<TrackingTrackerDraft>({
  name: '',
  description: '',
  role: 'factor',
  kind: 'yes_no',
  category: 'other',
  unit: '',
  scaleMin: 1,
  scaleMax: 10,
  favorableDirection: 'neutral',
  dailyAggregation: 'last',
  active: true,
  sortOrder: 0,
  color: '#C7F464',
  icon: 'mdi-checkbox-marked-circle-outline',
  reminderEnabled: false,
  reminderTime: '20:00',
  reminderShowName: false,
})

const editing = computed(() => Boolean(draft.id))
const hasEntries = computed(() => Boolean(draft.id && store.entries.some((entry) => entry.tracker === draft.id)))
const measurementLocked = computed(() => editing.value && hasEntries.value)

watch(() => draft.kind, (kind) => {
  if (measurementLocked.value) return
  draft.dailyAggregation = defaultAggregation(kind)
  if (kind === 'rating') {
    draft.scaleMin = 1
    draft.scaleMax = 10
    draft.unit = '/ 10'
  } else if (kind === 'yes_no') {
    draft.scaleMin = 0
    draft.scaleMax = 1
    draft.unit = ''
  } else if (kind === 'event') {
    draft.scaleMin = 0
    draft.scaleMax = 0
    draft.unit = 'times'
  } else if (kind === 'duration') {
    draft.scaleMin = 0
    draft.scaleMax = 0
    draft.unit = 'minutes'
  }
})

watch(() => draft.role, (role) => {
  if (role === 'factor') draft.favorableDirection = 'neutral'
  else if (draft.favorableDirection === 'neutral') draft.favorableDirection = 'higher'
})

onMounted(async () => {
  if (!store.loaded) await store.load().catch(() => undefined)
  const id = typeof route.params.id === 'string' ? route.params.id : ''
  if (id) {
    const tracker = store.trackers.find((item) => item.id === id)
    if (!tracker) {
      error.value = 'That tracker could not be found.'
      return
    }
    Object.assign(draft, tracker)
    return
  }
  const presetId = typeof route.query.preset === 'string' ? route.query.preset : ''
  const preset = TRACKING_PRESETS.find((item) => item.id === presetId)
  if (preset) Object.assign(draft, trackerDraftFromPreset(preset, store.trackers.length))
  else draft.sortOrder = store.trackers.length
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  if (draft.kind === 'rating' && draft.scaleMax <= draft.scaleMin) {
    error.value = 'The top of a rating scale must be greater than the bottom.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    if (draft.reminderEnabled && !await requestTrackingReminderPermission()) {
      throw new Error('Notification permission is required to enable this reminder.')
    }
    await store.saveTracker(draft)
    await reconcileTrackingReminders(store.trackers)
    await router.replace('/tracking')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this tracker.'
  } finally {
    saving.value = false
  }
}

async function archive() {
  if (!draft.id) return
  deleting.value = true
  try {
    await store.archiveTracker(draft.id)
    await reconcileTrackingReminders(store.trackers)
    await router.replace('/tracking')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not archive this tracker.'
  } finally {
    deleting.value = false
    archiveDialog.value = false
  }
}

async function remove() {
  if (!draft.id) return
  deleting.value = true
  try {
    await store.deleteTracker(draft.id)
    await reconcileTrackingReminders(store.trackers)
    await router.replace('/tracking')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this tracker.'
  } finally {
    deleting.value = false
    deleteDialog.value = false
  }
}
</script>

<template>
  <main class="app-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-alert v-if="measurementLocked" type="info" variant="tonal" density="compact" class="mb-4">
      Measurement type, unit, scale, and daily calculation are locked because this tracker has logs.
    </v-alert>

    <v-form ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="tracker-form-section surface-card pa-5 mb-4">
        <h2 class="section-title">Basics</h2>
        <v-text-field v-model="draft.name" label="Name" :rules="[(value: string) => Boolean(value?.trim()) || 'Name is required']" maxlength="160" variant="outlined" />
        <v-textarea v-model="draft.description" label="What are you tracking? (optional)" maxlength="2000" rows="2" auto-grow variant="outlined" />
        <v-select v-model="draft.category" label="Category" :items="categoryOptions" variant="outlined" />
        <ColorSwatchPicker v-model="draft.color" />
      </v-card>

      <v-card class="tracker-form-section surface-card pa-5 mb-4">
        <h2 class="section-title">Purpose</h2>
        <v-btn-toggle v-model="draft.role" mandatory color="secondary" class="purpose-toggle">
          <v-btn value="factor" prepend-icon="mdi-flask-outline">Thing I did</v-btn>
          <v-btn value="outcome" prepend-icon="mdi-chart-line">How I felt</v-btn>
        </v-btn-toggle>
        <p class="field-help">
          {{ draft.role === 'factor' ? 'A factor you may compare with an outcome later.' : 'A result you want to observe over time.' }}
        </p>
        <v-select
          v-if="draft.role === 'outcome'"
          v-model="draft.favorableDirection"
          label="Which direction is favorable?"
          :items="[
            { title: 'Higher is more favorable', value: 'higher' },
            { title: 'Lower is more favorable', value: 'lower' },
            { title: 'No favorable direction', value: 'neutral' },
          ]"
          variant="outlined"
        />
      </v-card>

      <v-card class="tracker-form-section surface-card pa-5 mb-4">
        <h2 class="section-title">Measurement</h2>
        <v-radio-group v-model="draft.kind" :disabled="measurementLocked" class="kind-list" hide-details>
          <v-radio v-for="kind in kindOptions" :key="kind.value" :value="kind.value" color="secondary">
            <template #label>
              <div class="kind-option"><v-icon :icon="kind.icon" /><div><strong>{{ kind.title }}</strong><span>{{ kind.subtitle }}</span></div></div>
            </template>
          </v-radio>
        </v-radio-group>

        <div v-if="draft.kind === 'rating'" class="scale-grid">
          <v-number-input v-model="draft.scaleMin" label="Scale minimum" :disabled="measurementLocked" variant="outlined" />
          <v-number-input v-model="draft.scaleMax" label="Scale maximum" :disabled="measurementLocked" variant="outlined" />
        </div>
        <v-text-field
          v-if="draft.kind === 'number' || draft.kind === 'rating'"
          v-model="draft.unit"
          label="Unit or scale label (optional)"
          maxlength="30"
          :disabled="measurementLocked"
          variant="outlined"
        />
        <v-select
          v-if="draft.kind === 'number'"
          v-model="draft.dailyAggregation"
          label="When there are several logs in a day"
          :disabled="measurementLocked"
          :items="[
            { title: 'Use the average', value: 'average' },
            { title: 'Add them together', value: 'sum' },
            { title: 'Use the last log', value: 'last' },
          ]"
          variant="outlined"
        />
        <p class="field-help">Missing data stays missing. Use an explicit “No” or “None” log when that is what happened.</p>
      </v-card>

      <v-card class="tracker-form-section surface-card pa-5 mb-4">
        <div class="setting-row">
          <div><h2 class="section-title">Daily reminder</h2><p class="field-help mt-1">One inexact local reminder each day.</p></div>
          <v-switch v-model="draft.reminderEnabled" color="secondary" hide-details :disabled="!reminderAvailable" />
        </div>
        <v-alert v-if="!reminderAvailable" type="info" variant="tonal" density="compact">Reminders are available in the Android app.</v-alert>
        <template v-if="draft.reminderEnabled">
          <v-text-field v-model="draft.reminderTime" type="time" label="Reminder time" variant="outlined" />
          <v-switch v-model="draft.reminderShowName" color="secondary" label="Show tracker name on the lock screen" hide-details />
          <p class="field-help">Off by default for privacy. The generic reminder does not reveal what you track.</p>
        </template>
        <v-switch v-if="editing" v-model="draft.active" color="secondary" label="Active tracker" hide-details />
      </v-card>

      <div class="editor-actions">
        <v-btn type="submit" color="secondary" size="large" :loading="saving">Save tracker</v-btn>
        <template v-if="editing">
          <v-btn v-if="draft.active" variant="tonal" color="warning" :disabled="saving" @click="archiveDialog = true">Archive</v-btn>
          <v-btn variant="text" color="error" :disabled="saving" @click="deleteDialog = true">Delete permanently</v-btn>
        </template>
      </div>
    </v-form>

    <ConfirmDialog v-model="archiveDialog" title="Archive tracker?" message="Its history stays available, but it will no longer appear in daily tracking." confirm-text="Archive" icon="mdi-archive-outline" :loading="deleting" @confirm="archive" />
    <ConfirmDialog v-model="deleteDialog" title="Delete tracker permanently?" message="This also deletes every log for this tracker. This cannot be undone." confirm-text="Delete" icon="mdi-delete-outline" :loading="deleting" @confirm="remove" />
  </main>
</template>

<style scoped>
.section-title { font-size: .78rem; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
.tracker-form-section { display: grid; gap: 1rem; }
.field-help { color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; line-height: 1.5; }
.purpose-toggle { display: grid; width: 100%; grid-template-columns: 1fr 1fr; }
.purpose-toggle :deep(.v-btn) { min-width: 0; }
.kind-list :deep(.v-selection-control) { min-height: 58px; padding: .35rem .25rem; }
.kind-option { display: flex; align-items: center; gap: .8rem; }
.kind-option div { display: flex; flex-direction: column; }
.kind-option span { color: rgb(var(--v-theme-on-surface) / .52); font-size: .7rem; }
.scale-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.editor-actions { display: grid; gap: .75rem; }
</style>
