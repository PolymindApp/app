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
import { reviewSortTitle } from '@/services/flashcards'
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

const reviewSetItems = computed(() => flashcardStore.reviewSets.map(reviewSet => {
  const cardCount = reviewSet.matchingCardCount
  return {
    title: reviewSet.name,
    value: reviewSet.id,
    subtitle: `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`,
    props: { disabled: cardCount === 0 },
  }
}))
const selectedReviewSet = computed(() => flashcardStore.reviewSets.find(
  reviewSet => reviewSet.id === draft.flashcardReviewSet,
))
const selectedReviewCardCount = computed(() => selectedReviewSet.value
  ? selectedReviewSet.value.matchingCardCount
  : 0)
const selectedReviewTiming = computed(() => {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet || reviewSet.mode !== 'passive') return '5s front · 5s back'
  return `${reviewSet.frontSeconds}s front · ${reviewSet.backSeconds}s back`
})
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

      <v-card class="surface-card pa-5">
        <div class="review-attachment-heading mb-4">
          <span class="review-attachment-heading__icon">
            <v-icon icon="mdi-cards-outline" size="24" />
          </span>
          <div class="min-width-0">
            <h2 class="text-body-1 font-weight-black">Review cards</h2>
            <p class="text-caption muted mt-1">Optionally cycle through a Review set throughout this interval.</p>
          </div>
        </div>

        <template v-if="flashcardStore.reviewSets.length">
          <v-select
            v-model="draft.flashcardReviewSet"
            :items="reviewSetItems"
            item-title="title"
            item-value="value"
            label="Review set (optional)"
            prepend-inner-icon="mdi-cards-playing-outline"
            clearable
            autocomplete="off"
            :rules="[
              value => !value || selectedReviewCardCount > 0 || 'Choose a Review set with at least one matching card',
            ]"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                prepend-icon="mdi-cards-outline"
                :title="item.raw.title"
                :subtitle="item.raw.subtitle"
              />
            </template>
          </v-select>

          <v-expand-transition>
            <div v-if="selectedReviewSet" class="review-attachment-summary mt-4">
              <div class="review-attachment-summary__chips">
                <v-chip size="small" variant="tonal" prepend-icon="mdi-infinity">Repeating passive</v-chip>
                <v-chip size="small" variant="tonal" prepend-icon="mdi-cards-outline">
                  {{ selectedReviewCardCount }} {{ selectedReviewCardCount === 1 ? 'card' : 'cards' }}
                </v-chip>
                <v-chip size="small" variant="tonal" prepend-icon="mdi-timer-outline">{{ selectedReviewTiming }}</v-chip>
                <v-chip
                  v-if="selectedReviewSet.speechEnabled"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-account-voice"
                >
                  Read aloud
                </v-chip>
              </div>
              <p class="text-caption muted mt-3">
                {{ reviewSortTitle(selectedReviewSet.sortMode) }} order.
                {{ selectedReviewSet.mode === 'manual'
                  ? 'This Manual set will use 5 seconds for the front and 5 seconds for the back.'
                  : 'Its Passive timing will be used.' }}
              </p>
            </div>
          </v-expand-transition>
        </template>

        <div v-else class="review-attachment-empty">
          <p class="text-body-2 muted">Create a Review set before attaching cards to an interval.</p>
          <v-btn variant="tonal" color="secondary" prepend-icon="mdi-plus" :to="{ name: 'flashcard-review-set-new' }">
            Create Review set
          </v-btn>
        </div>
      </v-card>

      </div>

      <IntervalSettingsFields
        v-model:definition="draft.definition"
        v-model:cues="draft.cues"
        :review-set-speech-enabled="selectedReviewSet?.speechEnabled === true"
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
.review-attachment-heading { display: flex; align-items: center; gap: .75rem; }
.review-attachment-heading__icon { display: grid; width: 2.75rem; height: 2.75rem; flex: 0 0 auto; place-items: center; border-radius: .875rem; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.review-attachment-summary { padding: .875rem; border: 1px solid rgb(var(--v-theme-on-surface) / .08); border-radius: 1rem; background: rgb(var(--v-theme-surface-variant) / .32); }
.review-attachment-summary__chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.review-attachment-empty { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
@media (max-width: 32rem) { .review-attachment-empty { align-items: stretch; flex-direction: column; } }
</style>
