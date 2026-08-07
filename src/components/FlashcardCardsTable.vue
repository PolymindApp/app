<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useDisplay } from 'vuetify'
import { Intersect, Ripple } from 'vuetify/directives'
import type { Flashcard, FlashcardTag } from '@/types/domain'

const props = defineProps<{
  cards: Flashcard[]
  tags: FlashcardTag[]
  modelValue: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  'open-card': [card: Flashcard]
}>()

const { smAndDown } = useDisplay()
const vIntersect = Intersect
const vRipple = Ripple
const nativePlatform = Capacitor.getPlatform()
const usesInfiniteScroll = computed(() =>
  nativePlatform === 'android'
  || nativePlatform === 'ios'
  || smAndDown.value,
)
const PAGE_SIZE = 10
const cardPage = ref(1)
const visibleCardCount = ref(PAGE_SIZE)
const infiniteScrollOptions = { rootMargin: '0px 0px 192px 0px' }

const selectedCardIds = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const cardPageCount = computed(() => Math.ceil(props.cards.length / PAGE_SIZE))
const displayedCards = computed(() => {
  if (usesInfiniteScroll.value) return props.cards.slice(0, visibleCardCount.value)
  const start = (cardPage.value - 1) * PAGE_SIZE
  return props.cards.slice(start, start + PAGE_SIZE)
})
const allCardIds = computed(() => props.cards.map(card => card.id))
const allCardsSelected = computed(() =>
  allCardIds.value.length > 0
  && allCardIds.value.every(id => selectedCardIds.value.includes(id)),
)
const someCardsSelected = computed(() =>
  !allCardsSelected.value
  && allCardIds.value.some(id => selectedCardIds.value.includes(id)),
)
const hasMoreCards = computed(() => usesInfiniteScroll.value && displayedCards.value.length < props.cards.length)
const tagNames = computed(() => new Map(props.tags.map(tag => [tag.id, tag.name])))

watch(() => props.cards.map(card => card.id), (cardIds) => {
  const available = new Set(cardIds)
  const retainedSelection = selectedCardIds.value.filter(id => available.has(id))
  if (retainedSelection.length !== selectedCardIds.value.length) {
    selectedCardIds.value = retainedSelection
  }
  cardPage.value = 1
  visibleCardCount.value = PAGE_SIZE
}, { immediate: true })

watch(cardPageCount, count => {
  cardPage.value = Math.min(cardPage.value, Math.max(1, count))
})

watch(usesInfiniteScroll, () => {
  cardPage.value = 1
  visibleCardCount.value = PAGE_SIZE
})

function toggleAllSelection(selected: boolean) {
  const next = new Set(selectedCardIds.value)
  allCardIds.value.forEach(id => selected ? next.add(id) : next.delete(id))
  selectedCardIds.value = [...next]
}

function toggleCardSelection(cardId: string, selected: boolean) {
  const next = new Set(selectedCardIds.value)
  if (selected) next.add(cardId)
  else next.delete(cardId)
  selectedCardIds.value = [...next]
}

function loadMoreCards(intersecting: boolean) {
  if (!intersecting || !hasMoreCards.value) return
  visibleCardCount.value = Math.min(props.cards.length, visibleCardCount.value + PAGE_SIZE)
}

function cardTagNames(card: Flashcard) {
  return card.tags.length
    ? card.tags.map(tag => tagNames.value.get(tag) || 'Removed tag').join(', ')
    : 'No tags'
}
</script>

<template>
  <div class="flashcard-cards-table">
    <div class="card-library surface-card">
      <v-table density="compact" class="card-library-table">
        <thead>
          <tr>
            <th scope="col" class="card-library-table__select">
              <v-checkbox-btn
                :model-value="allCardsSelected"
                :indeterminate="someCardsSelected"
                color="secondary"
                density="compact"
                hide-details="auto"
                :aria-label="`Select all ${cards.length} cards`"
                @update:model-value="toggleAllSelection(Boolean($event))"
              />
            </th>
            <th scope="col" class="card-library-table__image-heading">Image</th>
            <th scope="col">Faces</th>
            <th scope="col">Tags</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="card in displayedCards"
            :key="card.id"
            tabindex="0"
            :class="{ 'card-library-table__row--selected': selectedCardIds.includes(card.id) }"
            :aria-label="`Edit card: ${card.front}`"
            @click="emit('open-card', card)"
            @keydown.enter="emit('open-card', card)"
            @keydown.space.prevent="emit('open-card', card)"
          >
            <td class="card-library-table__select" @click.stop @keydown.stop>
              <v-checkbox-btn
                :model-value="selectedCardIds.includes(card.id)"
                color="secondary"
                density="compact"
                hide-details="auto"
                :aria-label="`Select card: ${card.front}`"
                @click.stop
                @update:model-value="toggleCardSelection(card.id, Boolean($event))"
              />
            </td>
            <td class="card-library-table__image-cell">
              <div class="flashcard-table__image-frame">
                <v-img
                  v-if="card.image"
                  :src="card.image"
                  alt=""
                  cover
                  class="flashcard-table__image"
                >
                  <template #error>
                    <div class="flashcard-table__image-placeholder" aria-label="Image unavailable">
                      <v-icon icon="mdi-image-off-outline" size="18" aria-hidden="true" />
                    </div>
                  </template>
                </v-img>
                <div v-else class="flashcard-table__image-placeholder" aria-label="No image">
                  <v-icon icon="mdi-image-outline" size="18" aria-hidden="true" />
                </div>
              </div>
            </td>
            <td>
              <span v-ripple class="card-library-table__row-ripple" aria-hidden="true" />
              <div class="flashcard-table__faces">
                <strong class="flashcard-table__text flashcard-table__front">{{ card.front }}</strong>
                <span class="flashcard-table__text flashcard-table__back">{{ card.back }}</span>
              </div>
            </td>
            <td>
              <span class="flashcard-table__text flashcard-table__tags" :title="cardTagNames(card)">
                {{ cardTagNames(card) }}
              </span>
            </td>
          </tr>
        </tbody>
      </v-table>

      <div
        v-if="hasMoreCards"
        v-intersect="{ handler: loadMoreCards, options: infiniteScrollOptions }"
        class="card-library-load-more"
        role="status"
        aria-label="Loading more cards"
      >
        <v-progress-circular indeterminate color="secondary" size="18" width="2" />
        <span>{{ displayedCards.length }} of {{ cards.length }}</span>
      </div>

    </div>

    <v-pagination
      v-if="!usesInfiniteScroll && cardPageCount > 1"
      v-model="cardPage"
      :length="cardPageCount"
      :total-visible="7"
      color="secondary"
      rounded="lg"
      class="card-library-pagination mt-3"
      aria-label="Flashcard table pages"
    />
  </div>
</template>

<style scoped>
.card-library { overflow: clip; }
.card-library-table { background: transparent; }
.card-library-table :deep(.v-table__wrapper) { overflow: visible; }
.card-library-table :deep(table) { table-layout: fixed; }
.card-library-table th { position: sticky; z-index: 3; top: calc(3.75rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem))); height: 2.25rem !important; padding: 0 .75rem !important; background: rgb(var(--v-theme-surface)); box-shadow: 0 .0625rem 0 rgba(var(--v-theme-on-surface), .1); color: rgba(var(--v-theme-on-surface), .52); font-size: .64rem !important; font-weight: 900 !important; letter-spacing: .08em; text-transform: uppercase; }
.card-library-table th:nth-child(1) { width: 3rem; }
.card-library-table th:nth-child(2) { width: 3rem; }
.card-library-table th:nth-child(3) { width: 54%; }
.card-library-table th:nth-child(4) { width: auto; }
.card-library-table th.card-library-table__select,
.card-library-table td.card-library-table__select { padding-right: .25rem !important; padding-left: .25rem !important; text-align: center; }
.card-library-table th.card-library-table__image-heading,
.card-library-table td.card-library-table__image-cell { padding-right: .5rem !important; padding-left: .5rem !important; }
.card-library-table__select :deep(.v-selection-control) { position: relative; z-index: 2; justify-content: center; }
.card-library-table td { height: 4rem !important; padding: .5rem .75rem !important; vertical-align: middle; }
.card-library-table tbody tr { position: relative; overflow: hidden; cursor: pointer; transition: background-color 160ms ease; }
.card-library-table__row-ripple { position: absolute; z-index: 1; inset: 0; display: block; overflow: hidden; }
.card-library-table tbody tr:hover { background: rgba(var(--v-theme-on-surface), .045); }
.card-library-table tbody tr.card-library-table__row--selected { background: rgba(var(--v-theme-secondary), .09); }
.card-library-table tbody tr:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.125rem; }
.card-library-load-more { display: flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; color: rgba(var(--v-theme-on-surface), .52); font-size: .68rem; font-weight: 800; }
.card-library-pagination :deep(.v-btn) { min-width: 2.75rem; min-height: 2.75rem; }
.flashcard-table__text { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; font-size: .78rem; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.flashcard-table__faces { display: grid; min-width: 0; gap: .2rem; }
.flashcard-table__image-frame { width: 2rem; height: 2rem; overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .08); border-radius: .35rem; background: rgba(var(--v-theme-on-surface), .05); }
.flashcard-table__image { width: 100%; height: 100%; }
.flashcard-table__image-placeholder { display: grid; width: 100%; height: 100%; color: rgba(var(--v-theme-on-surface), .3); place-items: center; background: rgba(var(--v-theme-on-surface), .025); }
.flashcard-table__front { color: rgb(var(--v-theme-on-surface)); font-weight: 900; }
.flashcard-table__back { color: rgba(var(--v-theme-on-surface), .72); }
.flashcard-table__tags { color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }

@media (max-width: 31.25rem) {
  .card-library-table th,
  .card-library-table td { padding-right: .5rem !important; padding-left: .5rem !important; }
  .card-library-table th.card-library-table__select,
  .card-library-table td.card-library-table__select { padding-right: .125rem !important; padding-left: .125rem !important; }
  .card-library-table th:nth-child(2) { width: 3rem; }
  .card-library-table th:nth-child(3) { width: 52%; }
}
</style>
