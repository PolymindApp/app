<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import FlashcardReviewSettingsFields from '@/components/FlashcardReviewSettingsFields.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import {
  DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
  DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
  DEFAULT_FLASHCARD_SESSION_CARDS,
  flashcardReviewSettingsAreValid,
  flashcardReviewSettingsSignature,
} from '@/services/flashcards'
import {
  defaultFlashcardSpeechLanguage,
  loadFlashcardSpeechSupport,
} from '@/services/flashcardSpeech'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardReviewSetDraft, FlashcardSpeechSupport } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const ready = ref(false)
const original = ref('')
const speechLoading = ref(true)
const speechSupport = ref<FlashcardSpeechSupport>({ available: false, languages: [] })
const isEditing = computed(() => Boolean(route.params.id))
const currentReviewSet = computed(() => store.reviewSets.find(item => item.id === route.params.id))
const isOwner = computed(() => !isEditing.value || currentReviewSet.value?.accessRole === 'owner')
const draft = reactive<FlashcardReviewSetDraft>({
  name: '',
  tags: [],
  mode: 'manual',
  cardSides: DEFAULT_FLASHCARD_REVIEW_CARD_SIDES,
  indefinite: false,
  maxCards: DEFAULT_FLASHCARD_SESSION_CARDS,
  frontSeconds: 5,
  backSeconds: 5,
  backSpeechRepeatCount: DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
  speechEnabled: false,
  frontLanguage: '',
  backLanguage: '',
  sortMode: 'difficult',
  sortOrder: 0,
})

function serializedDraft() {
  return JSON.stringify(isOwner.value ? {
      name: draft.name,
      tags: draft.tags,
      settings: flashcardReviewSettingsSignature(draft),
      sortOrder: draft.sortOrder,
    } : {
      settings: flashcardReviewSettingsSignature(draft),
    })
}

const changed = computed(() => ready.value && serializedDraft() !== original.value)
const canSave = computed(() => (
  changed.value
  && (!isOwner.value || Boolean(draft.name.trim()))
  && flashcardReviewSettingsAreValid(draft)
))
const matchingCardCount = computed(() => isOwner.value
  ? store.matchingCards(draft.tags).length
  : currentReviewSet.value?.matchingCardCount || 0)

function ensureSpeechLanguages() {
  const fallback = defaultFlashcardSpeechLanguage(speechSupport.value.languages)
  if (!draft.frontLanguage) draft.frontLanguage = fallback
  if (!draft.backLanguage) draft.backLanguage = fallback
}

onMounted(async () => {
  try {
    const supportPromise = loadFlashcardSpeechSupport()
    if (!store.loaded) await store.load()
    speechSupport.value = await supportPromise
    speechLoading.value = false
    if (route.params.id) {
      const reviewSet = store.reviewSets.find(item => item.id === route.params.id)
      if (!reviewSet) {
        error.value = 'That Review set could not be found.'
        return
      }
      Object.assign(draft, {
        id: reviewSet.id,
        name: reviewSet.name,
        tags: [...reviewSet.tags],
        mode: reviewSet.mode,
        cardSides: reviewSet.cardSides,
        indefinite: reviewSet.indefinite,
        maxCards: reviewSet.maxCards,
        frontSeconds: reviewSet.frontSeconds,
        backSeconds: reviewSet.backSeconds,
        backSpeechRepeatCount: reviewSet.backSpeechRepeatCount,
        speechEnabled: reviewSet.speechEnabled,
        frontLanguage: reviewSet.frontLanguage,
        backLanguage: reviewSet.backLanguage,
        sortMode: reviewSet.sortMode,
        sortOrder: reviewSet.sortOrder,
      })
    } else {
      draft.sortOrder = store.reviewSets.length
      ensureSpeechLanguages()
    }
    original.value = serializedDraft()
    ready.value = true
  } catch (cause) {
    speechLoading.value = false
    error.value = cause instanceof Error ? cause.message : 'Could not load this Review set.'
  }
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid || !canSave.value) return
  saving.value = true
  error.value = ''
  try {
    if (isOwner.value) await store.saveReviewSet(draft)
    else if (draft.id) await store.saveReviewSetPreferences(draft.id, draft)
    await router.replace('/flashcards')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this Review set.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!draft.id) return
  deleting.value = true
  error.value = ''
  try {
    await store.deleteReviewSet(draft.id)
    deleteDialog.value = false
    await router.replace('/flashcards')
  } catch (cause) {
    error.value = store.error || (cause instanceof Error ? cause.message : 'Could not delete this Review set.')
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="app-page app-page--editor review-set-editor">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm v-if="ready" ref="form" @submit.prevent="save">
      <v-card class="surface-card pa-5 mb-4">
        <div v-if="isOwner" class="field-stack">
          <v-text-field
            v-model="draft.name"
            maxlength="160"
            autocomplete="off"
            :rules="[value => Boolean(value?.trim()) || 'Name is required']"
          >
            <template #label>Review set name <span class="required-mark">*</span></template>
          </v-text-field>
          <FlashcardTagCombobox
            v-model="draft.tags"
            hint="Leave empty to include every flashcard"
          />
        </div>

        <div v-else class="shared-set-heading">
          <div class="min-width-0">
            <h1 class="text-h6 font-weight-black text-truncate">{{ draft.name }}</h1>
            <p class="text-body-2 muted mt-1">
              Shared by {{ currentReviewSet?.ownerName || 'another account' }} · Your review settings are private.
            </p>
          </div>
          <v-chip size="small" :color="currentReviewSet?.accessRole === 'editor' ? 'secondary' : undefined">
            {{ currentReviewSet?.accessRole === 'editor' ? 'Editor' : 'Read only' }}
          </v-chip>
        </div>

        <div class="review-set-summary mt-4">
          <v-icon icon="mdi-cards-outline" color="secondary" />
          <div>
            <strong>{{ matchingCardCount }} matching {{ matchingCardCount === 1 ? 'card' : 'cards' }}</strong>
            <p>
              {{ draft.tags.length
                ? 'Cards matching any selected tag'
                : isOwner ? 'Every card in your library' : 'Every card in the owner’s library' }}
            </p>
          </div>
        </div>
      </v-card>
      <FlashcardReviewSettingsFields
        :model-value="draft"
        :speech-support="speechSupport"
        :speech-loading="speechLoading"
      />
    </AppForm>

    <div v-else-if="!error" class="review-set-loading py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading Review set…</span>
    </div>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :primary-disabled="!canSave"
      :show-delete="isEditing && isOwner"
      delete-label="Delete Review set"
      :delete-disabled="deleting"
      @submit="save"
      @cancel="router.back()"
      @delete="deleteDialog = true"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this Review set?"
      message="The saved setup will be removed. Completed review history and its card snapshots will stay."
      confirm-text="Delete Review set"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="remove"
    />
  </main>
</template>

<style scoped>
.field-stack { display: grid; gap: 1rem; }
.shared-set-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
.review-set-summary { display: flex; align-items: center; gap: .75rem; padding: .85rem; border-radius: 1rem; background: rgba(var(--v-theme-secondary), .08); }
.review-set-summary strong { font-size: .82rem; }
.review-set-summary p { margin-top: .15rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
.review-set-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
</style>
