<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, onMounted, ref } from 'vue'
import { format, isToday, isValid, parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DateTimePickerField from '@/components/DateTimePickerField.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import JournalImageField from '@/components/JournalImageField.vue'
import { squareImageSourceSignature } from '@/services/avatarImage'
import { useJournalStore } from '@/stores/journal'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'
import type { JournalEntry, SquareImageSourceValue } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const journalStore = useJournalStore()
const taskStore = useTaskStore()
const trackingStore = useTrackingStore()
const entryId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const isEditing = computed(() => Boolean(entryId.value))
const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const form = ref()
const title = ref('')
const body = ref('')
const color = ref('#C7F464')
const image = ref<SquareImageSourceValue>(reflectionImageValue())
const occurredLocal = ref('')
const task = ref<string>()
const trackers = ref<string[]>([])
const loading = ref(isEditing.value)
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const original = ref('')

const taskItems = computed(() => [...taskStore.tasks]
  .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
  .map(item => ({
    title: item.name,
    value: item.id,
    props: {
      subtitle: [
        item.type === 'journal' ? 'Writing completes this task' : '',
        item.active ? '' : 'Paused task',
      ].filter(Boolean).join(' · ') || undefined,
    },
  })))
const selectedTask = computed(() => taskStore.tasks.find(item => item.id === task.value))
const completesJournalTask = computed(() => selectedTask.value?.type === 'journal')
const trackerItems = computed(() => [...trackingStore.trackers]
  .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
  .map(item => ({
    title: item.name,
    value: item.id,
    props: {
      subtitle: item.active ? undefined : 'Archived tracker',
      prependIcon: item.icon,
    },
  })))
const signature = computed(() => JSON.stringify({
  title: title.value,
  body: body.value,
  color: color.value,
  image: squareImageSourceSignature(image.value),
  occurredLocal: occurredLocal.value,
  task: task.value || '',
  trackers: trackers.value,
}))
const canSave = computed(() =>
  Boolean(body.value.trim() && occurredLocal.value)
  && signature.value !== original.value
  && !saving.value,
)

function defaultOccurredLocal() {
  const queryDate = typeof route.query.date === 'string' ? parseISO(route.query.date) : undefined
  const date = queryDate && isValid(queryDate) ? new Date(queryDate) : new Date()
  if (!isToday(date)) date.setHours(12, 0, 0, 0)
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

function reflectionImageValue(existingUrl = ''): SquareImageSourceValue {
  const source = existingUrl ? 'upload' : 'none'
  return {
    source,
    url: '',
    existingUrl,
    existingSource: source,
  }
}

function destinationQuery() {
  const date = occurredLocal.value ? format(new Date(occurredLocal.value), 'yyyy-MM-dd') : undefined
  return {
    ...(date ? { date } : {}),
    ...(typeof route.query.task === 'string' ? { task: route.query.task } : {}),
    ...(typeof route.query.tracker === 'string' ? { tracker: route.query.tracker } : {}),
  }
}

function destinationRoute() {
  return route.query.from === 'tasks'
    ? { name: 'tasks' as const }
    : { name: 'journal' as const, query: destinationQuery() }
}

function applyEntry(entry: JournalEntry) {
  title.value = entry.title
  body.value = entry.body
  color.value = entry.color || '#C7F464'
  image.value = reflectionImageValue(entry.image)
  occurredLocal.value = format(new Date(entry.occurredAt), "yyyy-MM-dd'T'HH:mm")
  task.value = entry.task
  trackers.value = [...entry.trackers]
  original.value = signature.value
}

function initializeNewEntry() {
  occurredLocal.value = defaultOccurredLocal()
  task.value = typeof route.query.task === 'string' ? route.query.task : undefined
  trackers.value = typeof route.query.tracker === 'string' ? [route.query.tracker] : []
  original.value = signature.value
}

async function loadEntry() {
  error.value = ''
  try {
    applyEntry(await journalStore.getEntry(entryId.value))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this reflection.'
  } finally {
    loading.value = false
  }
}

function loadContextOptions() {
  return Promise.allSettled([
    taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
    trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
  ])
}

if (isEditing.value) {
  const cachedEntry = journalStore.entries.find(entry => entry.id === entryId.value)
  if (cachedEntry) {
    applyEntry(cachedEntry)
    loading.value = false
  }
} else {
  initializeNewEntry()
}

onMounted(() => {
  void loadContextOptions()
  if (isEditing.value && loading.value) void loadEntry()
})

async function save() {
  const validation = await form.value?.validate()
  if (!validation?.valid || !canSave.value) return
  const occurred = new Date(occurredLocal.value)
  saving.value = true
  error.value = ''
  try {
    await journalStore.saveEntry({
      id: entryId.value || undefined,
      title: title.value,
      body: body.value,
      color: color.value,
      occurredAt: occurred.toISOString(),
      localDate: format(occurred, 'yyyy-MM-dd'),
      timezoneOffset: occurred.getTimezoneOffset(),
      task: task.value,
      trackers: trackers.value,
    }, image.value)
    await router.replace(destinationRoute())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this reflection.'
  } finally {
    saving.value = false
  }
}

async function removeEntry() {
  if (!entryId.value) return
  deleting.value = true
  error.value = ''
  try {
    await journalStore.deleteEntry(entryId.value)
    deleteDialog.value = false
    await router.replace(destinationRoute())
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this reflection.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="app-page app-page--editor journal-editor-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loading" class="d-flex align-center justify-center ga-3 py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading reflection…</span>
    </div>

    <AppForm v-else ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="surface-card pa-5 mb-4">
        <div class="journal-editor-fields">
          <div class="journal-editor-reflection">
            <p class="journal-editor-privacy mb-2">All posts remain 100% private.</p>
            <v-textarea
              v-model="body"
              rows="10"
              auto-grow
              maxlength="20000"
              counter
              :autofocus="allowAutomaticFocus"
              :rules="[value => Boolean(value?.trim()) || 'Reflection is required']"
            >
              <template #label>
                Reflection <span class="required-mark">*</span>
              </template>
            </v-textarea>
          </div>
          <v-text-field
            v-model="title"
            label="Title (optional)"
            maxlength="160"
            counter
          />
          <DateTimePickerField v-model="occurredLocal" label="When" />
          <ColorSwatchPicker
            v-model="color"
            label="Reflection color"
            custom-label="Choose a custom reflection color"
          />
        </div>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <JournalImageField
          v-model="image"
          :loading="saving"
          @error="error = $event"
        />
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <h2 class="text-body-1 font-weight-black">Connect this reflection</h2>
        <p class="text-body-2 muted mt-1 mb-4">
          {{ completesJournalTask
            ? `Saving this reflection completes ${selectedTask?.name || 'the journaling task'} for its date.`
            : 'Add context without changing task progress or tracking logs.' }}
        </p>
        <div class="journal-editor-context">
          <v-select
            v-model="task"
            label="Task (optional)"
            :items="taskItems"
            :loading="taskStore.loading && !taskItems.length"
            clearable
            variant="outlined"
            hide-details="auto"
          />
          <v-select
            v-model="trackers"
            label="Trackers (optional)"
            :items="trackerItems"
            :loading="trackingStore.loading && !trackerItems.length"
            clearable
            multiple
            chips
            closable-chips
            variant="outlined"
            hide-details="auto"
          />
        </div>
      </v-card>
    </AppForm>

    <FormActionBar
      v-if="!loading"
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :primary-disabled="!canSave"
      :show-delete="isEditing"
      delete-label="Delete reflection"
      :delete-disabled="deleting"
      @submit="save"
      @cancel="router.back()"
      @delete="deleteDialog = true"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this reflection?"
      message="This permanently removes the journal entry. Its linked task and trackers are not affected."
      confirm-text="Delete reflection"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="removeEntry"
    />
  </main>
</template>

<style scoped>
.journal-editor-page { padding-bottom: 5rem; }
.journal-editor-fields,
.journal-editor-context { display: grid; gap: 1rem; }
.journal-editor-reflection { display: grid; gap: .25rem; }
.journal-editor-privacy { color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; font-style: italic; line-height: 1.4; }
.required-mark { color: rgb(var(--v-theme-error)); }
@media (min-width: 48rem) {
  .journal-editor-context { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
