<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardTag } from '@/types/domain'

const store = useFlashcardStore()
const tagNames = reactive<Record<string, string>>({})
const tagSaving = ref('')
const tagError = ref('')
const deleteTagDialog = ref(false)
const deletingTag = ref<FlashcardTag>()

watch(() => store.tags, (tags) => {
  const tagIds = new Set(tags.map(tag => tag.id))
  for (const id of Object.keys(tagNames)) {
    if (!tagIds.has(id)) delete tagNames[id]
  }
  for (const tag of tags) tagNames[tag.id] = tag.name
}, { deep: true, immediate: true })

onMounted(() => {
  if (!store.loaded) store.load().catch(() => undefined)
})

async function saveTagName(tag: FlashcardTag) {
  const name = tagNames[tag.id]?.trim()
  if (!name || name === tag.name) return
  tagSaving.value = tag.id
  tagError.value = ''
  try {
    await store.renameTag(tag.id, name)
  } catch (cause) {
    tagError.value = cause instanceof Error ? cause.message : 'Could not rename this tag.'
    tagNames[tag.id] = tag.name
  } finally {
    tagSaving.value = ''
  }
}

function confirmDelete(tag: FlashcardTag) {
  deletingTag.value = tag
  deleteTagDialog.value = true
}

async function removeTag() {
  if (!deletingTag.value) return
  tagSaving.value = deletingTag.value.id
  tagError.value = ''
  try {
    await store.deleteTag(deletingTag.value.id)
    deleteTagDialog.value = false
    deletingTag.value = undefined
  } catch (cause) {
    tagError.value = cause instanceof Error ? cause.message : 'Could not delete this tag.'
    deleteTagDialog.value = false
  } finally {
    tagSaving.value = ''
  }
}
</script>

<template>
  <main class="app-page flashcard-tags-page">
    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">
      {{ store.error }}
      <template #append>
        <v-btn size="small" variant="text" @click="store.load">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-if="tagError" type="error" variant="tonal" class="mb-4">{{ tagError }}</v-alert>

    <p class="text-body-2 muted mb-4">
      Renaming a tag updates every card and Review set that uses it.
    </p>

    <div v-if="store.loading && !store.loaded" class="flashcard-tags-loading py-12">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading tags…</span>
    </div>

    <v-card v-else-if="store.tags.length" class="surface-card pa-4">
      <div class="flashcard-tags-list">
        <div v-for="tag in store.tags" :key="tag.id" class="flashcard-tag-row">
          <v-text-field
            v-model="tagNames[tag.id]"
            label="Tag name"
            maxlength="50"
            autocomplete="off"
            prepend-inner-icon="mdi-tag-outline"
            :disabled="tagSaving === tag.id"
            :rules="[value => Boolean(value?.trim()) || 'Tag name is required']"
            @keyup.enter="saveTagName(tag)"
          />
          <v-btn
            icon="mdi-content-save-outline"
            variant="tonal"
            color="secondary"
            :loading="tagSaving === tag.id"
            :disabled="!tagNames[tag.id]?.trim() || tagNames[tag.id]?.trim() === tag.name"
            :aria-label="`Save ${tag.name}`"
            @click="saveTagName(tag)"
          />
          <v-btn
            icon="mdi-delete-outline"
            variant="text"
            color="error"
            :disabled="Boolean(tagSaving)"
            :aria-label="`Delete ${tag.name}`"
            @click="confirmDelete(tag)"
          />
        </div>
      </div>
    </v-card>

    <v-card v-else-if="store.loaded" class="surface-card pa-8 text-center">
      <v-icon icon="mdi-tag-outline" size="44" color="secondary" />
      <h2 class="text-h6 font-weight-black mt-3">No tags yet</h2>
      <p class="text-body-2 muted mt-2 mb-5">
        Create tags while adding a flashcard or configuring a Review set.
      </p>
      <v-btn color="secondary" :to="{ name: 'flashcard-new' }" prepend-icon="mdi-card-plus-outline">
        Add a card
      </v-btn>
    </v-card>

    <ConfirmDialog
      v-model="deleteTagDialog"
      title="Delete this tag?"
      message="The tag will be removed from every card and Review set. The cards themselves will stay."
      confirm-text="Delete tag"
      icon="mdi-tag-remove-outline"
      :loading="Boolean(deletingTag && tagSaving === deletingTag.id)"
      @confirm="removeTag"
    />
  </main>
</template>

<style scoped>
.flashcard-tags-list { display: grid; gap: .75rem; }
.flashcard-tag-row { display: grid; grid-template-columns: minmax(0, 1fr) 2.75rem 2.75rem; align-items: start; gap: .5rem; }
.flashcard-tag-row > .v-btn { min-width: 2.75rem; min-height: 2.75rem; }
.flashcard-tags-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
</style>
