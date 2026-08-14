<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardAudioSection from '@/components/FlashcardAudioSection.vue'
import FlashcardImageField from '@/components/FlashcardImageField.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import {
  squareImageSourceIsValid,
  squareImageSourceSignature,
} from '@/services/avatarImage'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardAudioValue, FlashcardDraft, SquareImageSourceValue } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const form = ref()
const frontField = ref()
const loading = ref(true)
const ready = ref(false)
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const savedNotice = ref(false)
const original = ref('')
const draft = reactive<FlashcardDraft>({ front: '', back: '', note: '', tags: [] })
const cardImage = ref<SquareImageSourceValue>({
  source: 'none',
  url: '',
  existingUrl: '',
  existingSource: 'none',
})
const frontAudio = ref<FlashcardAudioValue>(emptyAudio())
const backAudio = ref<FlashcardAudioValue>(emptyAudio())
const frontAudioRecording = ref(false)
const backAudioRecording = ref(false)

const cardId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const reviewSetId = computed(() => typeof route.params.reviewSetId === 'string' ? route.params.reviewSetId : '')
const isReviewSetCard = computed(() => Boolean(reviewSetId.value))
const isEditing = computed(() => Boolean(cardId.value))
const returnTo = computed(() => typeof route.query.returnTo === 'string'
  && route.query.returnTo.startsWith('/')
  && !route.query.returnTo.startsWith('//')
  ? route.query.returnTo
  : '')
const signature = computed(() => JSON.stringify({
  front: draft.front,
  back: draft.back,
  note: draft.note,
  tags: draft.tags,
  image: squareImageSourceSignature(cardImage.value),
  frontAudio: frontAudio.value.url,
  backAudio: backAudio.value.url,
}))
const canSave = computed(() => (
  ready.value
  && !saving.value
  && !frontAudioRecording.value
  && !backAudioRecording.value
  && signature.value !== original.value
  && Boolean(draft.front.trim())
  && Boolean(draft.back.trim())
  && squareImageSourceIsValid(cardImage.value)
))

function focusFrontWithoutScrolling() {
  if (!allowAutomaticFocus) return
  const fieldElement = frontField.value?.$el
  const textarea = fieldElement instanceof HTMLTextAreaElement
    ? fieldElement
    : fieldElement?.querySelector?.('textarea')
  textarea?.focus({ preventScroll: true })
}

function scrollToFormTop() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  window.scrollTo({
    top: 0,
    left: 0,
    behavior: reduceMotion ? 'auto' : 'smooth',
  })
}

onMounted(async () => {
  error.value = ''
  try {
    if (!store.loaded) await store.load()
    if (isReviewSetCard.value) {
      const reviewSet = store.reviewSets.find(item => item.id === reviewSetId.value)
      if (!reviewSet || reviewSet.accessRole === 'readonly') {
        throw new Error('Editor access is required to change these cards.')
      }
      await store.loadReviewSetCards(reviewSetId.value)
    }
    if (isEditing.value) {
      const card = isReviewSetCard.value
        ? store.reviewSetCards[reviewSetId.value]?.find(item => item.id === cardId.value)
        : store.cards.find(item => item.id === cardId.value)
      if (!card) throw new Error('That flashcard could not be found.')
      Object.assign(draft, {
        id: card.id,
        front: card.front,
        back: card.back,
        note: card.note,
        tags: [...card.tags],
      })
      cardImage.value = {
        source: card.imageSource,
        url: card.imageSource === 'url' ? card.image : '',
        existingUrl: card.image,
        existingSource: card.imageSource,
      }
      frontAudio.value = existingAudio(card.frontAudio || '')
      backAudio.value = existingAudio(card.backAudio || '')
    }
    original.value = signature.value
    ready.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
  } finally {
    loading.value = false
  }
})

function emptyAudio(): FlashcardAudioValue {
  return { url: '', existingUrl: '' }
}

function existingAudio(url: string): FlashcardAudioValue {
  return { url, existingUrl: url }
}

function setAudioRecording(side: 'front' | 'back', recording: boolean) {
  if (side === 'front') frontAudioRecording.value = recording
  else backAudioRecording.value = recording
}

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid || !canSave.value) return
  saving.value = true
  error.value = ''
  savedNotice.value = false
  try {
    const cardDraft = {
      id: draft.id,
      front: draft.front,
      back: draft.back,
      note: draft.note,
      tags: draft.tags,
    }
    if (isReviewSetCard.value) {
      await store.saveReviewSetCard(
        reviewSetId.value,
        cardDraft,
        cardImage.value,
        { front: frontAudio.value, back: backAudio.value },
      )
    } else {
      await store.saveCard(
        cardDraft,
        cardImage.value,
        { front: frontAudio.value, back: backAudio.value },
      )
    }
    if (isEditing.value || returnTo.value) {
      await router.replace(returnTo.value || (isReviewSetCard.value
        ? { name: 'flashcard-review-set-cards', params: { id: reviewSetId.value } }
        : { name: 'flashcard-cards' }))
      return
    }

    const retainedTags = [...draft.tags]
    Object.assign(draft, { id: undefined, front: '', back: '', note: '', tags: retainedTags })
    cardImage.value = {
      source: 'none',
      url: '',
      existingUrl: '',
      existingSource: 'none',
    }
    frontAudio.value = emptyAudio()
    backAudio.value = emptyAudio()
    original.value = signature.value
    savedNotice.value = true
    await nextTick()
    form.value?.resetValidation()
    focusFrontWithoutScrolling()
    scrollToFormTop()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this flashcard.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!cardId.value) return
  deleting.value = true
  error.value = ''
  try {
    if (isReviewSetCard.value) {
      await store.deleteReviewSetCard(reviewSetId.value, cardId.value)
    } else {
      await store.deleteCard(cardId.value)
    }
    deleteDialog.value = false
    await router.replace(returnTo.value || (isReviewSetCard.value
      ? { name: 'flashcard-review-set-cards', params: { id: reviewSetId.value } }
      : { name: 'flashcard-cards' }))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this flashcard.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="app-page app-page--editor flashcard-editor-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-alert
      v-if="savedNotice && !isEditing"
      type="success"
      variant="tonal"
      density="compact"
      class="mb-4"
      closable
      @click:close="savedNotice = false"
    >
      Card added. Ready for the next one; your tags remain selected.
    </v-alert>

    <div v-if="loading" class="flashcard-editor-loading py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading flashcard…</span>
    </div>

    <AppForm v-if="ready" ref="form" @submit.prevent="save">
      <v-card class="surface-card pa-5">
        <div class="flashcard-editor-fields">
          <v-textarea
            ref="frontField"
            v-model="draft.front"
            rows="4"
            auto-grow
            maxlength="5000"
            counter
            autocomplete="off"
            :autofocus="allowAutomaticFocus"
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
            hint="Shown as a subtitle beneath the back during reviews"
            rows="2"
            auto-grow
            maxlength="2000"
            counter
            autocomplete="off"
          />
          <FlashcardTagCombobox v-if="!isReviewSetCard" v-model="draft.tags" />
          <v-alert v-else type="info" variant="tonal" density="compact">
            Card tags are controlled by the Review set owner so this card stays in the live set.
          </v-alert>
          <FlashcardAudioSection
            v-model:front="frontAudio"
            v-model:back="backAudio"
            :disabled="saving"
            @recording-change="setAudioRecording"
            @error="error = $event"
          />
          <FlashcardImageField
            v-model="cardImage"
            :loading="saving"
            :initial-search="draft.front || draft.back"
            @error="error = $event"
          />
        </div>
      </v-card>
    </AppForm>

    <FormActionBar
      v-if="ready"
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :primary-disabled="!canSave"
      :show-delete="isEditing"
      delete-label="Delete flashcard"
      :delete-disabled="deleting"
      @submit="save"
      @cancel="router.back()"
      @delete="deleteDialog = true"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this flashcard?"
      :message="isReviewSetCard
        ? 'This removes the owner’s source card from their library and every Review set it matches. Existing review history keeps its saved front and back.'
        : 'The card will be removed from future reviews. Existing review history keeps its saved front and back.'"
      confirm-text="Delete flashcard"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="remove"
    />
  </main>
</template>

<style scoped>
.flashcard-editor-fields { display: grid; gap: 1rem; }
.flashcard-editor-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
</style>
