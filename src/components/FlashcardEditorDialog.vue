<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard, FlashcardDraft } from '@/types/domain'

const props = defineProps<{
  modelValue: boolean
  card?: Flashcard
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [card: Flashcard]
  deleted: [id: string]
}>()

const { xs } = useDisplay()
const store = useFlashcardStore()
const form = ref()
const frontField = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const savedNotice = ref(false)
const draft = reactive<FlashcardDraft>({ front: '', back: '', tags: [] })
const isEditing = computed(() => Boolean(props.card))
const original = computed(() => props.card
  ? JSON.stringify({ front: props.card.front, back: props.card.back, tags: props.card.tags })
  : JSON.stringify({ front: '', back: '', tags: [] }))
const changed = computed(() => JSON.stringify({
  front: draft.front,
  back: draft.back,
  tags: draft.tags,
}) !== original.value)
const canSave = computed(() => changed.value && Boolean(draft.front.trim()) && Boolean(draft.back.trim()))

watch(() => props.modelValue, async (open) => {
  if (!open) return
  Object.assign(draft, props.card
    ? { id: props.card.id, front: props.card.front, back: props.card.back, tags: [...props.card.tags] }
    : { id: undefined, front: '', back: '', tags: [] })
  error.value = ''
  savedNotice.value = false
  await nextTick()
  form.value?.resetValidation()
  if (Capacitor.getPlatform() !== 'android') frontField.value?.focus()
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid || !canSave.value) return
  saving.value = true
  error.value = ''
  try {
    const wasEditing = isEditing.value
    const card = await store.saveCard({
      id: draft.id,
      front: draft.front,
      back: draft.back,
      tags: draft.tags,
    })
    emit('saved', card)
    if (wasEditing) {
      emit('update:modelValue', false)
      return
    }
    const retainedTags = [...draft.tags]
    Object.assign(draft, { id: undefined, front: '', back: '', tags: retainedTags })
    savedNotice.value = true
    await nextTick()
    form.value?.resetValidation()
    if (Capacitor.getPlatform() !== 'android') frontField.value?.focus()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this card.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!props.card) return
  deleting.value = true
  error.value = ''
  try {
    await store.deleteCard(props.card.id)
    deleteDialog.value = false
    emit('deleted', props.card.id)
    emit('update:modelValue', false)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete this card.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    :fullscreen="xs"
    max-width="42rem"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="flashcard-editor" :rounded="xs ? '0' : 'xl'">
      <div class="flashcard-editor__header px-5 py-4">
        <div>
          <h2 class="text-h6 font-weight-black">{{ isEditing ? 'Edit card' : 'Add flashcards' }}</h2>
          <p class="text-caption muted mt-1">
            {{ isEditing ? 'Update the prompt, answer, or tags.' : 'Save and keep going. Your tags stay selected.' }}
          </p>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Close card editor"
          @click="emit('update:modelValue', false)"
        />
      </div>

      <v-divider />
      <v-card-text class="pa-5">
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
          Card added. Ready for the next one.
        </v-alert>

        <AppForm ref="form" class="flashcard-editor__form" @submit.prevent="save">
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
          <FlashcardTagCombobox v-model="draft.tags" />
        </AppForm>
      </v-card-text>

      <div class="px-5 pb-4">
        <FormActionBar
          embedded
          :primary-text="isEditing ? 'Save' : 'Add card'"
          :loading="saving"
          :primary-disabled="!canSave"
          :show-delete="isEditing"
          delete-label="Delete card"
          :delete-disabled="deleting"
          @submit="save"
          @cancel="emit('update:modelValue', false)"
          @delete="deleteDialog = true"
        />
      </div>
    </v-card>

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this card?"
      message="The card will be removed from future reviews. Existing review history keeps its saved front and back."
      confirm-text="Delete card"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="remove"
    />
  </v-dialog>
</template>

<style scoped>
.flashcard-editor { max-height: min(52rem, 94dvh); }
.flashcard-editor__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.flashcard-editor__form { display: grid; gap: 1rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
@media (max-width: 37.4375rem) {
  .flashcard-editor { min-height: 100dvh; max-height: 100dvh; padding-top: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)); padding-bottom: max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0rem)); }
}
</style>
