<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import FlashcardCardsManager from '@/components/FlashcardCardsManager.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard } from '@/types/domain'

const router = useRouter()
const store = useFlashcardStore()
const filteredCardCount = ref(0)
onMounted(() => {
  if (!store.loaded) store.load().catch(() => undefined)
})

function openNewCard() {
  void router.push({ name: 'flashcard-new' })
}

function openCard(card: Flashcard) {
  void router.push({ name: 'flashcard-edit', params: { id: card.id } })
}

</script>

<template>
  <main class="app-page flashcard-cards-page">
    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">
      {{ store.error }}
      <template #append>
        <v-btn size="small" variant="text" @click="store.load">Retry</v-btn>
      </template>
    </v-alert>

    <div v-if="store.loading && !store.loaded" class="d-flex justify-center py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="ml-3 muted">Loading cards…</span>
    </div>

    <template v-else>
      <section>
        <div class="section-heading mt-0">
          <h2>Tags</h2>
        </div>
        <v-btn
          size="large"
          variant="tonal"
          prepend-icon="mdi-tag-multiple-outline"
          :to="{ name: 'flashcard-tags' }"
        >
          Manage tags
        </v-btn>
      </section>

      <section>
        <div class="section-heading">
          <h2>Your cards</h2>
          <span class="text-caption muted">{{ filteredCardCount }} of {{ store.cards.length }}</span>
        </div>
        <FlashcardCardsManager
          :cards="store.cards"
          :tags="store.tags"
          library-actions
          selectable
          :interactive="false"
          @update:filtered-count="filteredCardCount = $event"
          @add-card="openNewCard"
          @open-card="openCard"
        >
          <template #image-column-heading><span class="d-sr-only">Edit</span></template>
          <template #image-column="{ card }">
            <div
              class="flashcard-card-edit"
              @pointerdown.stop
              @touchstart.stop
              @click.stop
              @keydown.stop
            >
              <v-btn
                icon="mdi-pencil-outline"
                variant="text"
                size="small"
                :aria-label="`Edit card: ${card.front}`"
                @click.stop="openCard(card)"
              />
            </div>
          </template>
        </FlashcardCardsManager>
      </section>
    </template>
  </main>
</template>

<style scoped>
.flashcard-card-edit { position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; }
</style>
