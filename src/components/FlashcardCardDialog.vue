<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import AppForm from '@/components/AppForm.vue'
import FlashcardImageField from '@/components/FlashcardImageField.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import { squareImageSourceIsValid, squareImageSourceSignature } from '@/services/avatarImage'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard, FlashcardDraft, SquareImageSourceValue } from '@/types/domain'

const props = defineProps<{
  modelValue: boolean
  card?: Flashcard
  reviewSetId?: string
  initialTags?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [card: Flashcard]
}>()

const store = useFlashcardStore()
const form = ref()
const frontField = ref()
const saving = ref(false)
const error = ref('')
const original = ref('')
const draft = reactive<FlashcardDraft>({ front: '', back: '', note: '', tags: [] })
const cardImage = ref<SquareImageSourceValue>(emptyImage())
const isEditing = computed(() => Boolean(props.card))
const isReviewSetCard = computed(() => Boolean(props.reviewSetId))
const signature = computed(() => JSON.stringify({
  front: draft.front,
  back: draft.back,
  note: draft.note,
  tags: draft.tags,
  image: squareImageSourceSignature(cardImage.value),
}))
const canSave = computed(() => (
  !saving.value
  && signature.value !== original.value
  && Boolean(draft.front.trim())
  && Boolean(draft.back.trim())
  && squareImageSourceIsValid(cardImage.value)
))

watch(() => props.modelValue, async (open) => {
  if (!open) return
  error.value = ''
  const card = props.card
  Object.assign(draft, card
    ? { id: card.id, front: card.front, back: card.back, note: card.note, tags: [...card.tags] }
    : { id: undefined, front: '', back: '', note: '', tags: [...(props.initialTags || [])] })
  cardImage.value = card ? {
    source: card.imageSource,
    url: card.imageSource === 'url' ? card.image : '',
    existingUrl: card.image,
    existingSource: card.imageSource,
    existingLibraryImageId: card.libraryImage?.id,
    libraryImage: card.libraryImage,
  } : emptyImage()
  await nextTick()
  original.value = signature.value
  form.value?.resetValidation()
  frontField.value?.focus()
})

function emptyImage(): SquareImageSourceValue {
  return { source: 'none', url: '', existingUrl: '', existingSource: 'none' }
}

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid || !canSave.value) return
  saving.value = true
  error.value = ''
  try {
    const cardDraft = {
      id: draft.id,
      front: draft.front,
      back: draft.back,
      note: draft.note,
      tags: draft.tags,
    }
    const card = isReviewSetCard.value
      ? await store.saveReviewSetCard(props.reviewSetId!, cardDraft, cardImage.value)
      : await store.saveCard(cardDraft, cardImage.value)
    emit('saved', card)
    emit('update:modelValue', false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this flashcard.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    persistent
    scrollable
    fullscreen
    @update:model-value="!$event && !saving && emit('update:modelValue', false)"
  >
    <v-card class="flashcard-card-dialog" rounded="0">
      <v-card-title class="flashcard-card-dialog__header d-flex align-center ga-3">
        <v-icon :icon="isEditing ? 'mdi-pencil-outline' : 'mdi-card-plus-outline'" color="secondary" />
        <span>{{ isEditing ? 'Edit card' : 'Add card' }}</span>
      </v-card-title>
      <v-card-text class="px-5 py-4">
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
          {{ error }}
        </v-alert>
        <AppForm ref="form" @submit.prevent="save">
          <div class="flashcard-card-dialog__fields">
            <v-textarea
              ref="frontField"
              v-model="draft.front"
              rows="4"
              auto-grow
              maxlength="5000"
              counter
              autocomplete="off"
              :rules="[value => Boolean(value?.trim()) || 'Front is required']"
            >
              <template #label>Front <span class="required-mark">*</span></template>
            </v-textarea>
            <v-textarea
              v-model="draft.back"
              rows="5"
              auto-grow
              maxlength="5000"
              counter
              autocomplete="off"
              :rules="[value => Boolean(value?.trim()) || 'Back is required']"
            >
              <template #label>Back <span class="required-mark">*</span></template>
            </v-textarea>
            <v-textarea
              v-model="draft.note"
              label="Note"
              rows="2"
              auto-grow
              maxlength="2000"
              counter
              autocomplete="off"
            />
            <FlashcardTagCombobox v-if="!isReviewSetCard" v-model="draft.tags" />
            <v-alert v-else type="info" variant="tonal" density="compact">
              Card tags are controlled by the Review set owner.
            </v-alert>
            <FlashcardImageField
              v-model="cardImage"
              :loading="saving"
              :initial-search="draft.front || draft.back"
              @error="error = $event"
            />
          </div>
        </AppForm>
      </v-card-text>
      <v-divider />
      <v-card-actions class="flashcard-card-dialog__actions ga-2">
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn color="secondary" size="large" :loading="saving" :disabled="!canSave" @click="save">
          {{ isEditing ? 'Save' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.flashcard-card-dialog { min-height: 100dvh; }
.flashcard-card-dialog__header {
  padding:
    calc(1.25rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)))
    calc(1.25rem + env(safe-area-inset-right, 0rem))
    1rem
    calc(1.25rem + env(safe-area-inset-left, 0rem)) !important;
}
.flashcard-card-dialog__fields { display: grid; gap: 1rem; }
.flashcard-card-dialog__actions {
  padding:
    1rem
    calc(1rem + env(safe-area-inset-right, 0rem))
    calc(1rem + max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)))
    calc(1rem + env(safe-area-inset-left, 0rem)) !important;
}
.required-mark { color: rgb(var(--v-theme-error)); }
</style>
