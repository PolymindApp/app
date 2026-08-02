<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, onMounted, ref } from 'vue'
import { format, isToday, isValid, parseISO } from 'date-fns'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DateTimePickerField from '@/components/DateTimePickerField.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import { useJournalStore } from '@/stores/journal'
import { useTaskStore } from '@/stores/tasks'
import { useTrackingStore } from '@/stores/tracking'

const route = useRoute()
const router = useRouter()
const journalStore = useJournalStore()
const taskStore = useTaskStore()
const trackingStore = useTrackingStore()
const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const form = ref()
const title = ref('')
const body = ref('')
const occurredLocal = ref('')
const task = ref<string>()
const tracker = ref<string>()
const loading = ref(true)
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const original = ref('')

const entryId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const isEditing = computed(() => Boolean(entryId.value))
const taskItems = computed(() => [...taskStore.tasks]
  .sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name))
  .map(item => ({
    title: item.name,
    value: item.id,
    props: { subtitle: item.active ? undefined : 'Paused task' },
  })))
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
  occurredLocal: occurredLocal.value,
  task: task.value || '',
  tracker: tracker.value || '',
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

function destinationQuery() {
  const date = occurredLocal.value ? format(new Date(occurredLocal.value), 'yyyy-MM-dd') : undefined
  return {
    ...(date ? { date } : {}),
    ...(typeof route.query.task === 'string' ? { task: route.query.task } : {}),
    ...(typeof route.query.tracker === 'string' ? { tracker: route.query.tracker } : {}),
  }
}

onMounted(async () => {
  error.value = ''
  try {
    await Promise.allSettled([
      taskStore.tasks.length ? Promise.resolve() : taskStore.load(),
      trackingStore.loaded ? Promise.resolve() : trackingStore.load(),
    ])
    if (isEditing.value) {
      const entry = await journalStore.getEntry(entryId.value)
      title.value = entry.title
      body.value = entry.body
      occurredLocal.value = format(new Date(entry.occurredAt), "yyyy-MM-dd'T'HH:mm")
      task.value = entry.task
      tracker.value = entry.tracker
    } else {
      occurredLocal.value = defaultOccurredLocal()
      task.value = typeof route.query.task === 'string'
        && taskStore.tasks.some(item => item.id === route.query.task)
        ? route.query.task
        : undefined
      tracker.value = typeof route.query.tracker === 'string'
        && trackingStore.trackers.some(item => item.id === route.query.tracker)
        ? route.query.tracker
        : undefined
    }
    original.value = signature.value
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this reflection.'
  } finally {
    loading.value = false
  }
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
      occurredAt: occurred.toISOString(),
      localDate: format(occurred, 'yyyy-MM-dd'),
      timezoneOffset: occurred.getTimezoneOffset(),
      task: task.value,
      tracker: tracker.value,
    })
    await router.replace({ name: 'journal', query: destinationQuery() })
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
    await router.replace({ name: 'journal', query: destinationQuery() })
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

    <v-form v-else ref="form" validate-on="lazy" @submit.prevent="save">
      <v-card class="surface-card pa-5 mb-4">
        <div class="journal-editor-fields">
          <v-text-field
            v-model="title"
            label="Title (optional)"
            maxlength="160"
            counter
            :autofocus="allowAutomaticFocus"
          />
          <v-textarea
            v-model="body"
            rows="10"
            auto-grow
            maxlength="20000"
            counter
            :rules="[value => Boolean(value?.trim()) || 'Reflection is required']"
          >
            <template #label>
              Reflection <span class="required-mark">*</span>
            </template>
          </v-textarea>
          <DateTimePickerField v-model="occurredLocal" label="When" />
        </div>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <h2 class="text-body-1 font-weight-black">Connect this reflection</h2>
        <p class="text-body-2 muted mt-1 mb-4">Add context without changing task progress or tracking logs.</p>
        <div class="journal-editor-context">
          <v-select
            v-model="task"
            label="Task (optional)"
            :items="taskItems"
            clearable
            variant="outlined"
            hide-details="auto"
          />
          <v-select
            v-model="tracker"
            label="Tracker (optional)"
            :items="trackerItems"
            clearable
            variant="outlined"
            hide-details="auto"
          />
        </div>
      </v-card>
    </v-form>

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
      message="This permanently removes the journal entry. Its linked task and tracker are not affected."
      confirm-text="Delete reflection"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="removeEntry"
    />
  </main>
</template>

<style scoped>
.journal-editor-page { padding-bottom: 6rem; }
.journal-editor-fields,
.journal-editor-context { display: grid; gap: 1rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
@media (min-width: 48rem) {
  .journal-editor-context { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
