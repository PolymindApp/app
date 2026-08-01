<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addDays, format, isToday, parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import DateTimePickerField from '@/components/DateTimePickerField.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import { formatTrackingValue, TRACKING_PRESETS, trackerDraftFromPreset } from '@/services/tracking'
import { reconcileTrackingReminders } from '@/services/trackingReminders'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useTrackingStore()
const selectedDate = ref(new Date())
const sheetOpen = ref(false)
const sheetTracker = ref<TrackingTracker>()
const editingEntry = ref<TrackingEntry>()
const value = ref(1)
const occurredLocal = ref('')
const note = ref('')
const saving = ref(false)
const addingPreset = ref('')
const error = ref('')

const dateKey = computed(() => format(selectedDate.value, 'yyyy-MM-dd'))
const dateTitle = computed(() => isToday(selectedDate.value) ? 'Today' : format(selectedDate.value, 'EEEE, MMM d'))
const dayEntries = computed(() => store.entries
  .filter((entry) => entry.localDate === dateKey.value)
  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))
const outcomes = computed(() => store.activeTrackers.filter((tracker) => tracker.role === 'outcome'))
const factors = computed(() => store.activeTrackers.filter((tracker) => tracker.role === 'factor'))
const canGoForward = computed(() => dateKey.value < format(new Date(), 'yyyy-MM-dd'))
const archivedTrackers = computed(() => store.trackers.filter((tracker) => !tracker.active))

function trackerEntries(tracker: TrackingTracker) {
  return store.entriesFor(tracker.id, dateKey.value)
}

function trackerSummary(tracker: TrackingTracker) {
  const daily = store.dailyValues(tracker.id).find((item) => item.date === dateKey.value)
  return daily ? formatTrackingValue(tracker, daily.value) : 'Not logged'
}

function startLog(tracker: TrackingTracker, entry?: TrackingEntry) {
  sheetTracker.value = tracker
  editingEntry.value = entry
  value.value = entry
    ? tracker.kind === 'duration' ? entry.value / 60 : entry.value
    : tracker.kind === 'rating' ? tracker.scaleMin : 1
  const when = entry ? new Date(entry.occurredAt) : selectedLogTime()
  occurredLocal.value = format(when, "yyyy-MM-dd'T'HH:mm")
  note.value = entry?.note || ''
  sheetOpen.value = true
}

function selectedLogTime() {
  const now = new Date()
  if (isToday(selectedDate.value)) return now
  const selected = new Date(selectedDate.value)
  selected.setHours(12, 0, 0, 0)
  return selected
}

async function saveLog(explicitValue?: number) {
  const tracker = sheetTracker.value
  if (!tracker || !occurredLocal.value) return
  saving.value = true
  error.value = ''
  try {
    const localDate = new Date(occurredLocal.value)
    const storedValue = explicitValue ?? value.value
    const draft = {
      id: editingEntry.value?.id,
      tracker: tracker.id,
      occurredAt: localDate.toISOString(),
      localDate: format(localDate, 'yyyy-MM-dd'),
      timezoneOffset: localDate.getTimezoneOffset(),
      value: tracker.kind === 'duration' ? storedValue * 60 : storedValue,
      note: note.value.trim(),
    }
    if (draft.id) await store.updateEntry({ ...draft, id: draft.id })
    else await store.addEntry(draft)
    sheetOpen.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this log.'
  } finally {
    saving.value = false
  }
}

async function removeEntry() {
  if (!editingEntry.value) return
  saving.value = true
  try {
    await store.deleteEntry(editingEntry.value.id)
    sheetOpen.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this log.'
  } finally {
    saving.value = false
  }
}

async function addPreset(presetId: string) {
  const preset = TRACKING_PRESETS.find((item) => item.id === presetId)
  if (!preset) return
  addingPreset.value = presetId
  error.value = ''
  try {
    await store.saveTracker(trackerDraftFromPreset(preset, store.trackers.length))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not add this tracker.'
  } finally {
    addingPreset.value = ''
  }
}

function openRequestedTracker() {
  const id = typeof route.query.log === 'string' ? route.query.log : ''
  if (!id) return
  const tracker = store.activeTrackers.find((item) => item.id === id)
  if (!tracker) return
  startLog(tracker)
  void router.replace({ path: '/tracking' })
}

watch(() => route.query.log, () => nextTick(openRequestedTracker))

onMounted(async () => {
  await store.load().catch(() => undefined)
  await reconcileTrackingReminders(store.trackers).catch(() => undefined)
  openRequestedTracker()
})
</script>

<template>
  <main class="app-page tracking-page">
    <v-alert v-if="error || store.error" type="error" variant="tonal" class="mb-4">
      {{ error || store.error }}
    </v-alert>

    <div class="tracking-toolbar mb-5">
      <v-btn icon="mdi-chevron-left" variant="tonal" aria-label="Previous day" @click="selectedDate = addDays(selectedDate, -1)" />
      <button class="date-heading" type="button" @click="selectedDate = new Date()">
        <strong>{{ dateTitle }}</strong>
        <span>{{ format(selectedDate, 'MMMM d, yyyy') }}</span>
      </button>
      <v-btn icon="mdi-chevron-right" variant="tonal" :disabled="!canGoForward" aria-label="Next day" @click="selectedDate = addDays(selectedDate, 1)" />
    </div>

    <div v-if="store.loading && !store.loaded" class="d-flex justify-center py-12">
      <v-progress-circular indeterminate color="secondary" />
    </div>

    <template v-else-if="store.trackers.length">
      <v-card class="insight-card surface-card pa-5 mb-6" to="/tracking/insights/compare">
        <div class="insight-card__icon"><v-icon icon="mdi-chart-box-outline" /></div>
        <div>
          <strong>Explore your patterns</strong>
          <p>Compare logged factors with outcomes across dates.</p>
        </div>
        <v-icon icon="mdi-chevron-right" />
      </v-card>

      <section v-if="factors.length">
        <div class="section-heading"><h2>Things you did</h2><span class="muted text-caption">{{ factors.length }}</span></div>
        <div class="tracker-grid">
          <v-card
            v-for="tracker in factors"
            :key="tracker.id"
            class="tracker-card surface-card"
            @click="startLog(tracker)"
          >
            <div class="tracker-card__accent" :style="{ background: tracker.color }" />
            <div class="tracker-card__body">
              <div class="tracker-card__icon" :style="{ color: tracker.color }"><v-icon :icon="tracker.icon" /></div>
              <div class="min-width-0 flex-grow-1">
                <strong class="d-block text-truncate">{{ tracker.name }}</strong>
                <span :class="{ 'tracker-card__logged': trackerEntries(tracker).length }">{{ trackerSummary(tracker) }}</span>
              </div>
              <v-btn icon="mdi-pencil-outline" variant="text" size="small" :to="`/tracking/${tracker.id}/edit`" @click.stop />
            </div>
          </v-card>
        </div>
      </section>

      <section v-if="outcomes.length">
        <div class="section-heading"><h2>How you felt</h2><span class="muted text-caption">{{ outcomes.length }}</span></div>
        <div class="tracker-grid">
          <v-card
            v-for="tracker in outcomes"
            :key="tracker.id"
            class="tracker-card surface-card"
            @click="startLog(tracker)"
          >
            <div class="tracker-card__accent" :style="{ background: tracker.color }" />
            <div class="tracker-card__body">
              <div class="tracker-card__icon" :style="{ color: tracker.color }"><v-icon :icon="tracker.icon" /></div>
              <div class="min-width-0 flex-grow-1">
                <strong class="d-block text-truncate">{{ tracker.name }}</strong>
                <span :class="{ 'tracker-card__logged': trackerEntries(tracker).length }">{{ trackerSummary(tracker) }}</span>
              </div>
              <v-btn icon="mdi-pencil-outline" variant="text" size="small" :to="`/tracking/${tracker.id}/edit`" @click.stop />
            </div>
          </v-card>
        </div>
      </section>

      <section>
        <div class="section-heading"><h2>Timeline</h2><span class="muted text-caption">{{ dayEntries.length }}</span></div>
        <v-card v-if="dayEntries.length" class="surface-card pa-2">
          <v-list bg-color="transparent">
            <v-list-item
              v-for="entry in dayEntries"
              :key="entry.id"
              :title="store.trackers.find(item => item.id === entry.tracker)?.name || 'Archived tracker'"
              :subtitle="`${format(new Date(entry.occurredAt), 'h:mm a')}${entry.note ? ` · ${entry.note}` : ''}`"
              @click="store.trackers.find(item => item.id === entry.tracker) && startLog(store.trackers.find(item => item.id === entry.tracker)!, entry)"
            >
              <template #prepend>
                <v-icon :icon="store.trackers.find(item => item.id === entry.tracker)?.icon || 'mdi-circle-outline'" />
              </template>
              <template #append>
                <strong>{{ store.trackers.find(item => item.id === entry.tracker) ? formatTrackingValue(store.trackers.find(item => item.id === entry.tracker)!, entry.value) : entry.value }}</strong>
              </template>
            </v-list-item>
          </v-list>
        </v-card>
        <v-card v-else class="surface-card pa-7 text-center"><p class="muted text-body-2">No logs for this day yet.</p></v-card>
      </section>

      <div class="tracking-actions mt-6">
        <v-btn variant="tonal" prepend-icon="mdi-plus" to="/tracking/new">New tracker</v-btn>
      </div>

      <section v-if="archivedTrackers.length">
        <div class="section-heading"><h2>Archived</h2><span class="muted text-caption">{{ archivedTrackers.length }}</span></div>
        <v-card class="surface-card pa-2">
          <v-list bg-color="transparent">
            <v-list-item
              v-for="tracker in archivedTrackers"
              :key="tracker.id"
              :title="tracker.name"
              subtitle="History retained"
              :prepend-icon="tracker.icon"
              append-icon="mdi-chevron-right"
              :to="`/tracking/${tracker.id}/edit`"
            />
          </v-list>
        </v-card>
      </section>
    </template>

    <template v-else-if="store.loaded">
      <div class="section-heading"><h2>Start with a tracker</h2></div>
      <div class="preset-grid">
        <v-card v-for="preset in TRACKING_PRESETS" :key="preset.id" class="preset-card surface-card pa-4">
          <div class="preset-card__content">
            <div class="preset-card__icon" :style="{ color: preset.color }">
              <v-icon :icon="preset.icon" size="26" />
            </div>
            <div class="min-width-0">
              <strong class="d-block">{{ preset.name }}</strong>
              <span>{{ preset.description }}</span>
            </div>
          </div>
          <v-btn block size="large" variant="tonal" :loading="addingPreset === preset.id" @click="addPreset(preset.id)">Add</v-btn>
        </v-card>
      </div>
      <v-btn block size="large" class="mt-4" color="secondary" prepend-icon="mdi-tune-variant" to="/tracking/new">Create a custom tracker</v-btn>
    </template>

    <ActionBottomSheet
      v-model="sheetOpen"
      :title="editingEntry ? `Edit ${sheetTracker?.name || 'log'}` : `Log ${sheetTracker?.name || ''}`"
      :description="sheetTracker?.description"
    >
      <template #content>
        <div v-if="sheetTracker" class="d-flex flex-column ga-4">
          <DateTimePickerField v-model="occurredLocal" label="When" />
          <LabeledSlider
            v-if="sheetTracker.kind === 'rating'"
            v-model="value"
            title="Rating"
            :value-label="`${value}${sheetTracker.unit ? ` ${sheetTracker.unit}` : ''}`"
            :min="sheetTracker.scaleMin"
            :max="sheetTracker.scaleMax"
            :step="1"
            :aria-label="`${sheetTracker.name} rating`"
          />
          <v-number-input v-else-if="sheetTracker.kind === 'number'" v-model="value" :label="sheetTracker.unit ? `Value (${sheetTracker.unit})` : 'Value'" variant="outlined" hide-details />
          <v-number-input v-else-if="sheetTracker.kind === 'duration'" v-model="value" label="Minutes" :min="0" variant="outlined" hide-details />
          <v-textarea v-model="note" label="Note (optional)" rows="2" auto-grow variant="outlined" hide-details />
          <div v-if="sheetTracker.kind === 'yes_no'" class="sheet-buttons">
            <v-btn color="secondary" :loading="saving" @click="saveLog(1)">Yes</v-btn>
            <v-btn variant="tonal" :disabled="saving" @click="saveLog(0)">No</v-btn>
          </div>
          <div v-else-if="sheetTracker.kind === 'event'" class="sheet-buttons">
            <v-btn color="secondary" :loading="saving" @click="saveLog(1)">Log occurrence</v-btn>
            <v-btn variant="tonal" :disabled="saving" @click="saveLog(0)">None today</v-btn>
          </div>
          <v-btn v-else block color="secondary" :loading="saving" @click="saveLog()">Save log</v-btn>
          <v-btn v-if="editingEntry" block color="error" variant="text" :disabled="saving" @click="removeEntry">Delete log</v-btn>
        </div>
      </template>
    </ActionBottomSheet>
  </main>
</template>

<style scoped>
.tracking-toolbar { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; gap: .75rem; }
.date-heading { display: flex; min-width: 0; flex-direction: column; align-items: center; border: 0; background: none; color: inherit; }
.date-heading strong { font-size: 1rem; }
.date-heading span { color: rgb(var(--v-theme-on-surface) / .56); font-size: .72rem; }
.insight-card { display: grid; grid-template-columns: 44px 1fr auto; align-items: center; gap: 1rem; background: linear-gradient(135deg, rgb(var(--v-theme-surface)), rgb(var(--v-theme-secondary) / .08)); }
.insight-card__icon { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 14px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
.insight-card p { margin-top: .2rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; }
.tracker-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr)); }
.tracker-card { position: relative; overflow: hidden; cursor: pointer; }
.tracker-card__accent { position: absolute; top: 0; bottom: 0; left: 0; width: 4px; }
.tracker-card__body { display: flex; align-items: center; gap: .85rem; padding: 1rem 1rem 1rem 1.2rem; }
.tracker-card__icon { display: grid; width: 38px; height: 38px; flex: 0 0 auto; place-items: center; border-radius: 12px; background: currentColor; }
.tracker-card__icon :deep(.v-icon) { color: rgb(var(--v-theme-background)); }
.tracker-card span { color: rgb(var(--v-theme-on-surface) / .48); font-size: .72rem; }
.tracker-card .tracker-card__logged { color: rgb(var(--v-theme-secondary)); font-weight: 800; }
.tracking-actions { display: flex; justify-content: center; }
.preset-grid { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); }
.preset-card { display: grid; min-height: 150px; grid-template-rows: 1fr auto; align-items: start; gap: 1rem; }
.preset-card__content { display: flex; align-items: flex-start; gap: .8rem; }
.preset-card__icon { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border-radius: 12px; background: currentColor; }
.preset-card__icon :deep(.v-icon) { color: rgb(var(--v-theme-background)); }
.preset-card span { display: block; margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .72rem; line-height: 1.45; }
.sheet-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
.min-width-0 { min-width: 0; }
</style>
