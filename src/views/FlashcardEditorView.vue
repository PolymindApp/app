<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardImageField from '@/components/FlashcardImageField.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import {
  squareImageSourceIsValid,
  squareImageSourceSignature,
} from '@/services/avatarImage'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardDraft, SquareImageSourceValue } from '@/types/domain'

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

const cardId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
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
}))
const canSave = computed(() => (
  ready.value
  && !saving.value
  && signature.value !== original.value
  && Boolean(draft.front.trim())
  && Boolean(draft.back.trim())
  && squareImageSourceIsValid(cardImage.value)
))

onMounted(async () => {
  error.value = ''
  try {
    if (!store.loaded) await store.load()
    if (isEditing.value) {
      const card = store.cards.find(item => item.id === cardId.value)
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
    }
    original.value = signature.value
    ready.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open this flashcard.'
  } finally {
    loading.value = false
  }
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid || !canSave.value) return
  saving.value = true
  error.value = ''
  savedNotice.value = false
  try {
    await store.saveCard({
      id: draft.id,
      front: draft.front,
      back: draft.back,
      note: draft.note,
      tags: draft.tags,
    }, cardImage.value)
    if (isEditing.value || returnTo.value) {
      await router.replace(returnTo.value || { name: 'flashcard-cards' })
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
    original.value = signature.value
    savedNotice.value = true
    await nextTick()
    form.value?.resetValidation()
    if (allowAutomaticFocus) frontField.value?.focus()
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
    await store.deleteCard(cardId.value)
    deleteDialog.value = false
    await router.replace(returnTo.value || { name: 'flashcard-cards' })
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
          <FlashcardImageField
            v-model="cardImage"
            :loading="saving"
            @error="error = $event"
          />
          <FlashcardTagCombobox v-model="draft.tags" />
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
      message="The card will be removed from future reviews. Existing review history keeps its saved front and back."
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
