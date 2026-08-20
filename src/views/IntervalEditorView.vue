<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import IntervalSettingsFields from '@/components/IntervalSettingsFields.vue'
import {
  cloneIntervalTemplateDraft,
  duplicateIntervalTemplateDraft,
  MIN_GLOBAL_REPETITIONS,
  validateIntervalDefinition,
} from '@/services/intervals'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplateDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const flashcardStore = useFlashcardStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const isEditing = computed(() => Boolean(route.params.id))

const draft = reactive<IntervalTemplateDraft>({
  name: '',
  description: '',
  color: '#C7F464',
  flashcardReviewSet: undefined,
  definition: {
    version: 1,
    children: [],
    globalRepetition: { enabled: false, defaultCount: MIN_GLOBAL_REPETITIONS },
  },
  cues: { soundEnabled: true, vibrationEnabled: true },
  sortOrder: 0,
})

const selectedReviewSet = computed(() => flashcardStore.reviewSets.find(
  reviewSet => reviewSet.id === draft.flashcardReviewSet,
))
onMounted(async () => {
  await Promise.all([
    store.loaded ? Promise.resolve() : store.load(),
    flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
  ])
  const duplicateTemplateId = typeof route.query.duplicate === 'string'
    ? route.query.duplicate
    : ''
  if (!route.params.id && !duplicateTemplateId) {
    draft.sortOrder = store.templates.length
    return
  }
  const templateId = typeof route.params.id === 'string'
    ? route.params.id
    : duplicateTemplateId
  const template = store.templates.find((item) => item.id === templateId)
  if (!template) {
    error.value = 'That interval template could not be found.'
    return
  }
  Object.assign(
    draft,
    duplicateTemplateId
      ? duplicateIntervalTemplateDraft(template, store.templates.length)
      : cloneIntervalTemplateDraft(template),
  )
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  const definitionErrors = validateIntervalDefinition(draft.definition)
  if (definitionErrors.length) {
    error.value = definitionErrors[0] || 'Check the interval sequence.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveTemplate(draft)
    await router.replace('/intervals')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the interval.'
  } finally {
    saving.value = false
  }
}

async function removeTemplate() {
  if (!draft.id) return
  deleting.value = true
  try {
    await store.deleteTemplate(draft.id)
    await router.replace('/intervals')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete the interval.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="app-page interval-editor">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm ref="form" validate-on="lazy" @submit.prevent="save">
      <div class="interval-form-cards">
      <v-card class="surface-card pa-5">
        <div class="field-stack">
          <v-text-field v-model="draft.name" label="Template name" :rules="[value => Boolean(value) || 'Name is required']" />
          <v-textarea v-model="draft.description" label="Description (optional)" rows="2" auto-grow />
        </div>
        <ColorSwatchPicker
          v-model="draft.color"
          label="Template color"
          custom-label="Choose a custom interval template color"
          class="mt-4"
        />
      </v-card>

      </div>

      <IntervalSettingsFields
        v-model:definition="draft.definition"
        v-model:cues="draft.cues"
        v-model:review-set="draft.flashcardReviewSet"
        :review-sets="flashcardStore.reviewSets"
        allow-review-set-create
        :review-set-speech-enabled="selectedReviewSet?.speechEnabled === true"
        class="mt-4"
      />
    </AppForm>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :show-delete="isEditing"
      delete-label="Delete interval"
      :delete-disabled="deleting"
      @submit="save"
      @cancel="router.back()"
      @delete="deleteDialog = true"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this interval?"
      message="The template will be removed, but completed session history will remain."
      confirm-text="Delete interval"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="removeTemplate"
    />
  </main>
</template>

<style scoped>
.interval-editor { padding-bottom: 6rem; }
.interval-form-cards { display: grid; gap: 1rem; }
.field-stack { display: grid; gap: 1rem; }
</style>
