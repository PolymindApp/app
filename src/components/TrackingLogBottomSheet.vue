<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { format, isToday, isValid, parseISO } from 'date-fns'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import DateTimePickerField from '@/components/DateTimePickerField.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import { useTrackingStore } from '@/stores/tracking'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

const props = defineProps<{
  modelValue: boolean
  tracker?: TrackingTracker
  entry?: TrackingEntry
  date: string
  context?: string
  keepOpenOnSave?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [entry: TrackingEntry]
  deleted: [id: string]
}>()

const store = useTrackingStore()
const value = ref(1)
const occurredLocal = ref('')
const note = ref('')
const saving = ref(false)
const error = ref('')
const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

function selectedLogTime() {
  const selected = parseISO(props.date)
  if (!isValid(selected) || isToday(selected)) return new Date()
  selected.setHours(12, 0, 0, 0)
  return selected
}

function resetFields() {
  if (!props.modelValue || !props.tracker) return
  const tracker = props.tracker
  value.value = props.entry
    ? tracker.kind === 'duration' ? props.entry.value / 60 : props.entry.value
    : tracker.kind === 'rating' ? tracker.scaleMin : 1
  const when = props.entry ? new Date(props.entry.occurredAt) : selectedLogTime()
  occurredLocal.value = format(when, "yyyy-MM-dd'T'HH:mm")
  note.value = props.entry?.note || ''
  error.value = ''
}

watch(
  () => [props.modelValue, props.tracker?.id, props.entry?.id, props.date],
  resetFields,
  { immediate: true },
)

async function save(explicitValue?: number) {
  const tracker = props.tracker
  if (!tracker || !occurredLocal.value) return
  saving.value = true
  error.value = ''
  try {
    const localDate = new Date(occurredLocal.value)
    const storedValue = explicitValue ?? value.value
    const draft = {
      tracker: tracker.id,
      occurredAt: localDate.toISOString(),
      localDate: format(localDate, 'yyyy-MM-dd'),
      timezoneOffset: localDate.getTimezoneOffset(),
      value: tracker.kind === 'duration' ? storedValue * 60 : storedValue,
      note: note.value.trim(),
    }
    const savedEntry = props.entry
      ? await store.updateEntry({ ...draft, id: props.entry.id })
      : await store.addEntry(draft)
    emit('saved', savedEntry)
    if (!props.keepOpenOnSave) open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this log.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.entry) return
  saving.value = true
  error.value = ''
  try {
    await store.deleteEntry(props.entry.id)
    emit('deleted', props.entry.id)
    open.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this log.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ActionBottomSheet
    v-model="open"
    :title="entry ? `Edit ${tracker?.name || 'log'}` : `Log ${tracker?.name || ''}`"
    :description="tracker?.description"
  >
    <template #content>
      <div v-if="tracker" class="d-flex flex-column ga-4">
        <v-alert v-if="error" type="error" variant="tonal" density="compact">
          {{ error }}
        </v-alert>
        <div v-if="context" class="tracking-log-context">
          <v-icon icon="mdi-format-list-checks" size="18" />
          <span>{{ context }}</span>
        </div>
        <LabeledSlider
          v-if="tracker.kind === 'rating'"
          v-model="value"
          title="Rating"
          :value-label="`${value}${tracker.unit ? ` ${tracker.unit}` : ''}`"
          :min="tracker.scaleMin"
          :max="tracker.scaleMax"
          :step="1"
          :aria-label="`${tracker.name} rating`"
        />
        <v-number-input
          v-else-if="tracker.kind === 'number'"
          v-model="value"
          :label="tracker.unit ? `Value (${tracker.unit})` : 'Value'"
          autocomplete="off"
          variant="outlined"
          hide-details
        />
        <v-number-input
          v-else-if="tracker.kind === 'duration'"
          v-model="value"
          label="Minutes"
          :min="0"
          autocomplete="off"
          variant="outlined"
          hide-details
        />
        <v-textarea
          v-model="note"
          label="Note (optional)"
          rows="2"
          auto-grow
          autocomplete="off"
          variant="outlined"
          hide-details
        />
        <DateTimePickerField v-model="occurredLocal" label="When" />
        <div v-if="tracker.kind === 'yes_no'" class="tracking-log-actions">
          <v-btn color="secondary" :loading="saving" @click="save(1)">Yes</v-btn>
          <v-btn variant="tonal" :disabled="saving" @click="save(0)">No</v-btn>
        </div>
        <div v-else-if="tracker.kind === 'event'" class="tracking-log-actions">
          <v-btn color="secondary" :loading="saving" @click="save(1)">Log occurrence</v-btn>
          <v-btn variant="tonal" :disabled="saving" @click="save(0)">None today</v-btn>
        </div>
        <v-btn v-else block color="secondary" :loading="saving" @click="save()">Save log</v-btn>
        <v-btn v-if="entry" block color="error" variant="text" :disabled="saving" @click="remove">Delete log</v-btn>
      </div>
    </template>
  </ActionBottomSheet>
</template>

<style scoped>
.tracking-log-context {
  display: flex;
  align-items: center;
  gap: .55rem;
  padding: .7rem .8rem;
  border-radius: .75rem;
  background: rgba(var(--v-theme-secondary), .1);
  color: rgba(var(--v-theme-on-surface), .7);
  font-size: .72rem;
  font-weight: 750;
}

.tracking-log-context .v-icon {
  color: rgb(var(--v-theme-secondary));
}

.tracking-log-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .75rem;
}
</style>
