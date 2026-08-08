<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useFlashcardStore()
const loading = ref(true)
const error = ref('')
const filteredCardCount = ref(0)
const reviewSetId = computed(() => String(route.params.id || ''))
const reviewSet = computed(() => store.reviewSets.find(item => item.id === reviewSetId.value))
const cards = computed(() => store.reviewSetCards[reviewSetId.value] || [])
const canEdit = computed(() => (
  reviewSet.value?.accessRole === 'owner' || reviewSet.value?.accessRole === 'editor'
))
const tags = computed(() => {
  const tagMap = new Map<string, { id: string; name: string }>()
  cards.value.flatMap(card => card.tagDetails || []).forEach(tag => tagMap.set(tag.id, tag))
  return [...tagMap.values()]
})

onMounted(async () => {
  try {
    if (!store.loaded) await store.load()
    if (!reviewSet.value) throw new Error('That Review set could not be found.')
    await store.loadReviewSetCards(reviewSetId.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load these cards.'
  } finally {
    loading.value = false
  }
})

function openCard(card: Flashcard) {
  if (!canEdit.value) return
  void router.push({
    name: 'flashcard-review-set-card-edit',
    params: { reviewSetId: reviewSetId.value, id: card.id },
  })
}

function openNewCard() {
  if (!canEdit.value) return
  void router.push({
    name: 'flashcard-review-set-card-new',
    params: { reviewSetId: reviewSetId.value },
  })
}

function bulkUpdateCards(action: Parameters<typeof store.bulkUpdateReviewSetCards>[1], cardIds: string[]) {
  return store.bulkUpdateReviewSetCards(reviewSetId.value, action, cardIds)
}

function assignCardImage(cardId: string, imageId: number) {
  return store.assignReviewSetLibraryImage(reviewSetId.value, cardId, imageId)
}
</script>

<template>
  <main class="app-page review-set-cards-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loading" class="cards-loading py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading shared cards…</span>
    </div>

    <template v-else-if="reviewSet">
      <v-card class="surface-card pa-5 mb-4">
        <div class="cards-heading">
          <div class="min-width-0">
            <h1 class="text-h6 font-weight-black text-truncate">{{ reviewSet.name }}</h1>
            <p class="text-body-2 muted mt-1">
              <template v-if="reviewSet.accessRole === 'owner'">Your live matching cards</template>
              <template v-else>Shared by {{ reviewSet.ownerName || 'another account' }}</template>
            </p>
          </div>
          <v-chip
            v-if="reviewSet.accessRole !== 'owner'"
            size="small"
            :color="reviewSet.accessRole === 'editor' ? 'secondary' : undefined"
          >
            {{ reviewSet.accessRole === 'editor' ? 'Editor' : 'Read only' }}
          </v-chip>
        </div>
      </v-card>

      <div class="section-heading mt-0">
        <h2>Cards</h2>
        <span class="text-caption muted">
          {{ filteredCardCount === cards.length ? cards.length : `${filteredCardCount} of ${cards.length}` }}
        </span>
      </div>

      <FlashcardCardsManager
        :cards="cards"
        :tags="tags"
        :selectable="canEdit"
        :interactive="canEdit"
        :can-add="canEdit"
        :show-import="canEdit"
        :import-review-set-id="reviewSetId"
        :bulk-actions="canEdit ? ['assign_images', 'delete'] : []"
        :bulk-action-handler="bulkUpdateCards"
        :assign-image-handler="assignCardImage"
        add-aria-label="Add a card to this Review set"
        empty-title="No matching cards"
        :empty-description="canEdit ? 'Add a card to this live Review set.' : 'The owner has not added a matching card yet.'"
        first-card-label="Add the first card"
        @update:filtered-count="filteredCardCount = $event"
        @add-card="openNewCard"
        @open-card="openCard"
      />
    </template>
  </main>
</template>

<style scoped>
.cards-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.cards-heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 1rem; }
</style>
