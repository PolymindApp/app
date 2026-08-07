<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import {
  DEFAULT_FLASHCARD_BACK_SPEECH_REPEATS,
  DEFAULT_FLASHCARD_SESSION_CARDS,
  FLASHCARD_REVIEW_SORT_OPTIONS,
  MAX_FLASHCARD_BACK_SPEECH_REPEATS,
  MAX_FLASHCARD_SESSION_CARDS,
  MIN_FLASHCARD_BACK_SPEECH_REPEATS,
  MIN_FLASHCARD_SESSION_CARDS,
} from '@/services/flashcards'
import {
  defaultFlashcardSpeechLanguage,
  loadFlashcardSpeechSupport,
  speechLanguageOptions,
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
const draft = reactive<FlashcardReviewSetDraft>({
  name: '',
  tags: [],
  mode: 'manual',
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
  return JSON.stringify({
    name: draft.name,
    tags: draft.tags,
    mode: draft.mode,
    indefinite: draft.indefinite,
    maxCards: draft.maxCards,
    frontSeconds: draft.frontSeconds,
    backSeconds: draft.backSeconds,
    backSpeechRepeatCount: draft.backSpeechRepeatCount,
    speechEnabled: draft.speechEnabled,
    frontLanguage: draft.frontLanguage,
    backLanguage: draft.backLanguage,
    sortMode: draft.sortMode,
    sortOrder: draft.sortOrder,
  })
}

const changed = computed(() => ready.value && serializedDraft() !== original.value)
const canSave = computed(() => (
  changed.value
  && Boolean(draft.name.trim())
  && Number.isInteger(draft.maxCards)
  && draft.maxCards >= MIN_FLASHCARD_SESSION_CARDS
  && draft.maxCards <= MAX_FLASHCARD_SESSION_CARDS
  && Number.isInteger(draft.backSpeechRepeatCount)
  && draft.backSpeechRepeatCount >= MIN_FLASHCARD_BACK_SPEECH_REPEATS
  && draft.backSpeechRepeatCount <= MAX_FLASHCARD_BACK_SPEECH_REPEATS
  && (!draft.speechEnabled || Boolean(draft.frontLanguage && draft.backLanguage))
))
const matchingCardCount = computed(() => store.matchingCards(draft.tags).length)
const speechLanguages = computed(() => speechLanguageOptions([
  ...speechSupport.value.languages.map(language => language.tag),
  draft.frontLanguage,
  draft.backLanguage,
]))

function ensureSpeechLanguages() {
  const fallback = defaultFlashcardSpeechLanguage(speechSupport.value.languages)
  if (!draft.frontLanguage) draft.frontLanguage = fallback
  if (!draft.backLanguage) draft.backLanguage = fallback
}

function updateSpeechEnabled(enabled: boolean | null) {
  if (enabled) ensureSpeechLanguages()
}

watch(() => draft.mode, (mode) => {
  if (mode !== 'passive') draft.indefinite = false
})

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
    await store.saveReviewSet(draft)
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
        <div class="field-stack">
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

        <div class="review-set-summary mt-4">
          <v-icon icon="mdi-cards-outline" color="secondary" />
          <div>
            <strong>{{ matchingCardCount }} matching {{ matchingCardCount === 1 ? 'card' : 'cards' }}</strong>
            <p>{{ draft.tags.length ? 'Cards matching any selected tag' : 'Every card in your library' }}</p>
          </div>
        </div>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <label class="field-label">Review mode <span class="required-mark">*</span></label>
        <v-btn-toggle
          v-model="draft.mode"
          mandatory
          color="secondary"
          variant="tonal"
          class="mode-toggle mt-2"
        >
          <v-btn value="manual" prepend-icon="mdi-gesture-tap">Manual</v-btn>
          <v-btn value="passive" prepend-icon="mdi-play-speed">Passive</v-btn>
        </v-btn-toggle>
        <p class="mode-hint mt-3" aria-live="polite">
          <v-icon icon="mdi-information-outline" size="18" />
          <span v-if="draft.mode === 'manual'">
            Reveal the back when you're ready, then mark the card as a success or error.
          </span>
          <span v-else>
            Front and back advance automatically using the durations below; cards count as viewed, not graded.
          </span>
        </p>

        <v-expand-transition>
          <div v-if="draft.mode === 'passive'" class="passive-settings mt-5">
            <v-number-input
              v-model="draft.frontSeconds"
              label="Front duration"
              suffix="seconds"
              :min="1"
              :max="60"
              :step="1"
              :rules="[value => value >= 1 && value <= 60 || 'Use 1–60 seconds']"
            />
            <v-number-input
              v-model="draft.backSeconds"
              label="Back duration"
              suffix="seconds"
              :min="1"
              :max="60"
              :step="1"
              :rules="[value => value >= 1 && value <= 60 || 'Use 1–60 seconds']"
            />
            <div class="setting-row passive-settings__indefinite">
              <div>
                <strong>Run indefinitely</strong>
                <p>Loop through these cards until you end the review; it will not finish on its own</p>
              </div>
              <v-switch
                v-model="draft.indefinite"
                color="secondary"
                hide-details="auto"
                inset
                aria-label="Run review indefinitely"
              />
            </div>
          </div>
        </v-expand-transition>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <div class="setting-row">
          <div>
            <strong>Read cards aloud</strong>
            <p v-if="speechLoading">Checking speech synthesis on this device…</p>
            <p v-else-if="speechSupport.available">Speak the front and back whenever each side appears</p>
            <p v-else>Speech synthesis is not available on this device</p>
          </div>
          <v-switch
            v-model="draft.speechEnabled"
            color="secondary"
            :loading="speechLoading"
            :disabled="speechLoading || (!speechSupport.available && !draft.speechEnabled)"
            hide-details="auto"
            inset
            aria-label="Read cards aloud"
            @update:model-value="updateSpeechEnabled"
          />
        </div>

        <v-expand-transition>
          <div v-if="draft.speechEnabled" class="speech-language-fields mt-5">
            <v-select
              v-model="draft.frontLanguage"
              :items="speechLanguages"
              item-title="title"
              item-value="tag"
              :disabled="!speechSupport.available"
              :rules="[value => Boolean(value) || 'Select a front language']"
            >
              <template #label>Front language <span class="required-mark">*</span></template>
            </v-select>
            <v-select
              v-model="draft.backLanguage"
              :items="speechLanguages"
              item-title="title"
              item-value="tag"
              :disabled="!speechSupport.available"
              :rules="[value => Boolean(value) || 'Select a back language']"
            >
              <template #label>Back language <span class="required-mark">*</span></template>
            </v-select>
            <div v-if="draft.mode === 'passive'" class="speech-repeat-setting">
              <LabeledSlider
                v-model="draft.backSpeechRepeatCount"
                title="Repeat back aloud"
                :min="MIN_FLASHCARD_BACK_SPEECH_REPEATS"
                :max="MAX_FLASHCARD_BACK_SPEECH_REPEATS"
                :step="1"
                :value-label="draft.backSpeechRepeatCount === 1 ? 'Once' : `${draft.backSpeechRepeatCount} times`"
                min-label="Once"
                :max-label="`${MAX_FLASHCARD_BACK_SPEECH_REPEATS} times`"
                aria-label="Number of times to read each flashcard back aloud"
              />
              <p class="mode-hint mt-3">
                <v-icon icon="mdi-information-outline" size="18" />
                Each repeat adds the configured back duration before advancing to the next card.
              </p>
            </div>
            <p class="speech-background-hint">
              <v-icon icon="mdi-cellphone-sound" size="18" />
              Passive reviews keep speaking on Android while the app is in the background or the screen is locked.
            </p>
          </div>
        </v-expand-transition>
      </v-card>

      <v-card class="surface-card pa-5">
        <v-select
          v-model="draft.sortMode"
          label="Card order"
          :items="FLASHCARD_REVIEW_SORT_OPTIONS"
          item-title="title"
          item-value="value"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" :title="item.raw.title" :subtitle="item.raw.subtitle" />
          </template>
        </v-select>
        <v-divider class="my-5" />
        <LabeledSlider
          v-model="draft.maxCards"
          title="Max cards per session"
          :min="MIN_FLASHCARD_SESSION_CARDS"
          :max="MAX_FLASHCARD_SESSION_CARDS"
          :step="1"
          :value-label="`${draft.maxCards} cards`"
          min-label="1 card"
          :max-label="`${MAX_FLASHCARD_SESSION_CARDS} cards`"
          aria-label="Maximum cards per Review set session"
        />
        <p class="mode-hint mt-3">
          <v-icon icon="mdi-information-outline" size="18" />
          Cards are filtered and ordered first, then up to {{ draft.maxCards }} are included in each session.
        </p>
      </v-card>
    </AppForm>

    <div v-else-if="!error" class="review-set-loading py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading Review set…</span>
    </div>

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :primary-disabled="!canSave"
      :show-delete="isEditing"
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
.field-label { color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 800; }
.required-mark { color: rgb(var(--v-theme-error)); }
.review-set-summary { display: flex; align-items: center; gap: .75rem; padding: .85rem; border-radius: 1rem; background: rgba(var(--v-theme-secondary), .08); }
.review-set-summary strong { font-size: .82rem; }
.review-set-summary p { margin-top: .15rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
.mode-toggle { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.mode-toggle :deep(.v-btn) { width: 100%; min-height: 3rem; }
.mode-hint { display: flex; align-items: flex-start; gap: .5rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.5; }
.mode-hint .v-icon { flex: 0 0 auto; }
.passive-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.passive-settings__indefinite { grid-column: 1 / -1; }
.setting-row { display: grid; min-height: 4rem; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
.setting-row > div { min-width: 0; }
.setting-row p { margin-top: .15rem; color: rgba(var(--v-theme-on-surface), .5); font-size: .7rem; }
.speech-language-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.speech-repeat-setting { grid-column: 1 / -1; }
.speech-background-hint { display: flex; grid-column: 1 / -1; align-items: flex-start; gap: .5rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.5; }
.speech-background-hint .v-icon { flex: 0 0 auto; }
.review-set-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
@media (max-width: 31.25rem) {
  .passive-settings,
  .speech-language-fields { grid-template-columns: 1fr; }
  .speech-background-hint { grid-column: auto; }
}
</style>
