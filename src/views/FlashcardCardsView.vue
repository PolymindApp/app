<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { Ripple } from 'vuetify/directives'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import { cardMatchesTags } from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard, FlashcardBulkAction } from '@/types/domain'

type FlashcardBulkTagAction = Extract<FlashcardBulkAction, 'add_tags' | 'set_tags' | 'remove_tags'>

const router = useRouter()
const { xs } = useDisplay()
const store = useFlashcardStore()
const selectedTags = ref<string[]>([])
const selectedCardIds = ref<string[]>([])
const bulkError = ref('')
const bulkSaving = ref(false)
const bulkTagSheetOpen = ref(false)
const bulkTagAction = ref<FlashcardBulkTagAction>('add_tags')
const bulkTagIds = ref<string[]>([])
const clearTagsDialog = ref(false)
const deleteCardsDialog = ref(false)
const cardPage = ref(1)
const vRipple = Ripple
const CARD_PAGE_SIZE = 10

const filteredCards = computed(() => store.cards.filter(card => cardMatchesTags(card, selectedTags.value)))
const cardPageCount = computed(() => Math.ceil(filteredCards.value.length / CARD_PAGE_SIZE))
const paginatedCards = computed(() => {
  const start = (cardPage.value - 1) * CARD_PAGE_SIZE
  return filteredCards.value.slice(start, start + CARD_PAGE_SIZE)
})
const pageCardIds = computed(() => paginatedCards.value.map(card => card.id))
const selectedCards = computed(() => {
  const selected = new Set(selectedCardIds.value)
  return store.cards.filter(card => selected.has(card.id))
})
const allPageCardsSelected = computed(() =>
  pageCardIds.value.length > 0
  && pageCardIds.value.every(id => selectedCardIds.value.includes(id)),
)
const somePageCardsSelected = computed(() =>
  !allPageCardsSelected.value
  && pageCardIds.value.some(id => selectedCardIds.value.includes(id)),
)
const selectedCardsHaveTags = computed(() => selectedCards.value.some(card => card.tags.length > 0))
const bulkRemovableTags = computed(() => {
  const assigned = new Set(selectedCards.value.flatMap(card => card.tags))
  return store.tags.filter(tag => assigned.has(tag.id))
})
const bulkTagCopy = computed(() => ({
  add_tags: {
    title: `Add tags to ${selectedCardIds.value.length} ${selectedCardIds.value.length === 1 ? 'card' : 'cards'}`,
    description: 'Keep the current tags and add the ones you select.',
    confirm: 'Add tags',
  },
  set_tags: {
    title: `Set tags on ${selectedCardIds.value.length} ${selectedCardIds.value.length === 1 ? 'card' : 'cards'}`,
    description: 'Replace every current tag with the same selected tags.',
    confirm: 'Set tags',
  },
  remove_tags: {
    title: `Remove tags from ${selectedCardIds.value.length} ${selectedCardIds.value.length === 1 ? 'card' : 'cards'}`,
    description: 'Remove the selected tags wherever they appear.',
    confirm: 'Remove tags',
  },
}[bulkTagAction.value]))

watch(() => store.tags, (tags) => {
  selectedTags.value = selectedTags.value.filter(id => tags.some(tag => tag.id === id))
}, { deep: true, immediate: true })

watch(selectedTags, () => {
  cardPage.value = 1
  selectedCardIds.value = []
}, { deep: true })

watch(() => store.cards.map(card => card.id), (ids) => {
  const existing = new Set(ids)
  selectedCardIds.value = selectedCardIds.value.filter(id => existing.has(id))
}, { immediate: true })

watch(() => filteredCards.value.length, () => {
  cardPage.value = Math.min(cardPage.value, Math.max(1, cardPageCount.value))
})

onMounted(() => {
  if (!store.loaded) store.load().catch(() => undefined)
})

function openNewCard() {
  void router.push({ name: 'flashcard-new' })
}

function openCard(card: Flashcard) {
  void router.push({ name: 'flashcard-edit', params: { id: card.id } })
}

function togglePageSelection(selected: boolean) {
  const next = new Set(selectedCardIds.value)
  pageCardIds.value.forEach(id => selected ? next.add(id) : next.delete(id))
  selectedCardIds.value = [...next]
  bulkError.value = ''
}

function toggleCardSelection(cardId: string, selected: boolean) {
  const next = new Set(selectedCardIds.value)
  if (selected) next.add(cardId)
  else next.delete(cardId)
  selectedCardIds.value = [...next]
  bulkError.value = ''
}

function openBulkTagAction(action: FlashcardBulkTagAction) {
  if (!selectedCardIds.value.length) return
  bulkTagAction.value = action
  bulkTagIds.value = []
  bulkError.value = ''
  bulkTagSheetOpen.value = true
}

async function runBulkAction(action: FlashcardBulkAction, tagIds: string[] = []) {
  const cardIds = [...selectedCardIds.value]
  if (!cardIds.length) return false
  bulkError.value = ''
  bulkSaving.value = true
  try {
    await store.bulkUpdateCards(action, cardIds, tagIds)
    selectedCardIds.value = []
    return true
  } catch (cause) {
    bulkError.value = cause instanceof Error ? cause.message : 'Could not update the selected cards.'
    return false
  } finally {
    bulkSaving.value = false
  }
}

async function applyBulkTags() {
  if (!bulkTagIds.value.length) {
    bulkError.value = 'Select at least one tag.'
    return
  }
  if (await runBulkAction(bulkTagAction.value, bulkTagIds.value)) {
    bulkTagSheetOpen.value = false
  }
}

async function clearSelectedCardTags() {
  await runBulkAction('clear_tags')
  clearTagsDialog.value = false
}

async function deleteSelectedCards() {
  await runBulkAction('delete')
  deleteCardsDialog.value = false
}

function tagName(id: string) {
  return store.tags.find(tag => tag.id === id)?.name || 'Removed tag'
}

function cardTagNames(card: Flashcard) {
  return card.tags.length ? card.tags.map(tagName).join(', ') : 'No tags'
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

    <section v-else>
      <div class="section-heading mt-0">
        <h2>Your cards</h2>
        <div class="d-flex align-center justify-end ga-4">
          <span class="text-caption muted">{{ filteredCards.length }} of {{ store.cards.length }}</span>
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="openNewCard">
            New
          </v-btn>
        </div>
      </div>

      <div class="card-filters mb-3">
        <v-select
          v-model="selectedTags"
          :items="store.tags"
          item-title="name"
          item-value="id"
          label="Filter by tags"
          multiple
          chips
          closable-chips
          clearable
          autocomplete="off"
          prepend-inner-icon="mdi-filter-variant"
          :disabled="!store.tags.length"
        />
        <v-btn
          icon="mdi-tag-multiple-outline"
          variant="tonal"
          aria-label="Manage flashcard tags"
          :to="{ name: 'flashcard-tags' }"
        />
      </div>

      <div v-if="filteredCards.length" class="card-library surface-card">
        <v-table density="compact" class="card-library-table">
          <thead>
            <tr>
              <th scope="col" class="card-library-table__select">
                <v-checkbox-btn
                  :model-value="allPageCardsSelected"
                  :indeterminate="somePageCardsSelected"
                  color="secondary"
                  density="compact"
                  hide-details="auto"
                  aria-label="Select all cards on this page"
                  @update:model-value="togglePageSelection(Boolean($event))"
                />
              </th>
              <th scope="col">Faces</th>
              <th scope="col">Tags</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="card in paginatedCards"
              :key="card.id"
              v-ripple
              tabindex="0"
              :class="{ 'card-library-table__row--selected': selectedCardIds.includes(card.id) }"
              :aria-label="`Edit card: ${card.front}`"
              @click="openCard(card)"
              @keydown.enter="openCard(card)"
              @keydown.space.prevent="openCard(card)"
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
              <td>
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

        <v-expand-transition>
          <div v-if="selectedCardIds.length" class="card-library-bulk">
            <strong class="card-library-bulk__count">
              {{ selectedCardIds.length }} selected
            </strong>
            <div class="card-library-bulk__actions">
              <v-btn size="small" variant="text" prepend-icon="mdi-tag-plus-outline" @click="openBulkTagAction('add_tags')">
                Add tags
              </v-btn>
              <v-btn size="small" variant="text" prepend-icon="mdi-tag-check-outline" @click="openBulkTagAction('set_tags')">
                Set tags
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-tag-minus-outline"
                :disabled="!selectedCardsHaveTags"
                @click="openBulkTagAction('remove_tags')"
              >
                Remove tags
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-tag-off-outline"
                :disabled="!selectedCardsHaveTags"
                @click="clearTagsDialog = true"
              >
                Clear tags
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                color="error"
                prepend-icon="mdi-delete-outline"
                @click="deleteCardsDialog = true"
              >
                Delete
              </v-btn>
            </div>
            <v-alert v-if="bulkError" type="error" variant="tonal" density="compact">
              {{ bulkError }}
            </v-alert>
          </div>
        </v-expand-transition>
      </div>

      <v-pagination
        v-if="cardPageCount > 1"
        v-model="cardPage"
        :length="cardPageCount"
        :total-visible="xs ? 3 : 7"
        color="secondary"
        rounded="lg"
        class="card-library-pagination mt-3"
        aria-label="Flashcard table pages"
      />

      <v-card v-if="!filteredCards.length" class="surface-card pa-8 text-center">
        <v-icon icon="mdi-cards-outline" size="44" color="secondary" />
        <h3 class="text-h6 font-weight-black mt-3">
          {{ store.cards.length ? 'No cards match these tags' : 'Your card library is empty' }}
        </h3>
        <p class="text-body-2 muted mt-2 mb-5">
          {{ store.cards.length ? 'Clear a filter or choose another tag.' : 'Add a prompt and answer, then keep entering cards without closing the form.' }}
        </p>
        <v-btn v-if="!store.cards.length" color="secondary" @click="openNewCard">Add your first card</v-btn>
        <v-btn v-else variant="tonal" @click="selectedTags = []">Clear filters</v-btn>
      </v-card>

      <div class="card-library-import-row mt-2">
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-file-import-outline"
          :to="{ name: 'flashcard-import' }"
        >
          Import
        </v-btn>
      </div>
    </section>

    <ActionBottomSheet
      v-model="bulkTagSheetOpen"
      :title="bulkTagCopy.title"
      :description="bulkTagCopy.description"
      :aria-label="bulkTagCopy.title"
    >
      <template #content>
        <FlashcardTagCombobox
          v-if="bulkTagAction !== 'remove_tags'"
          v-model="bulkTagIds"
          label="Tags"
          hint="Choose existing tags or type a new one"
          :disabled="bulkSaving"
        />
        <v-select
          v-else
          v-model="bulkTagIds"
          :items="bulkRemovableTags"
          item-title="name"
          item-value="id"
          label="Tags to remove"
          multiple
          chips
          closable-chips
          autocomplete="off"
          :disabled="bulkSaving"
        />
        <v-alert v-if="bulkError" type="error" variant="tonal" density="compact" class="mt-3">
          {{ bulkError }}
        </v-alert>
        <div class="bulk-tag-actions mt-4">
          <v-btn variant="text" :disabled="bulkSaving" @click="bulkTagSheetOpen = false">
            Cancel
          </v-btn>
          <v-btn
            color="secondary"
            :loading="bulkSaving"
            :disabled="!bulkTagIds.length"
            @click="applyBulkTags"
          >
            {{ bulkTagCopy.confirm }}
          </v-btn>
        </div>
      </template>
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="clearTagsDialog"
      :title="`Clear tags from ${selectedCardIds.length} ${selectedCardIds.length === 1 ? 'card' : 'cards'}?`"
      message="Every tag will be removed from the selected cards. The cards and their review history will stay intact."
      confirm-text="Clear tags"
      confirm-color="warning"
      icon="mdi-tag-off-outline"
      :loading="bulkSaving"
      @confirm="clearSelectedCardTags"
    />

    <ConfirmDialog
      v-model="deleteCardsDialog"
      :title="`Delete ${selectedCardIds.length} ${selectedCardIds.length === 1 ? 'card' : 'cards'}?`"
      message="The selected cards will be removed from future reviews. Existing review history keeps its saved front and back."
      confirm-text="Delete cards"
      icon="mdi-delete-outline"
      :loading="bulkSaving"
      @confirm="deleteSelectedCards"
    />
  </main>
</template>

<style scoped>
.card-filters { display: grid; grid-template-columns: minmax(0, 1fr) 2.75rem; align-items: start; gap: .75rem; }
.card-filters > .v-btn { min-width: 2.75rem; min-height: 2.75rem; }
.card-library { overflow: hidden; }
.card-library-table { background: transparent; }
.card-library-table :deep(.v-table__wrapper) { overflow-x: hidden; }
.card-library-table :deep(table) { table-layout: fixed; }
.card-library-table th { height: 2.25rem !important; padding: 0 .75rem !important; color: rgba(var(--v-theme-on-surface), .52); font-size: .64rem !important; font-weight: 900 !important; letter-spacing: .08em; text-transform: uppercase; }
.card-library-table th:nth-child(1) { width: 3rem; }
.card-library-table th:nth-child(2) { width: 64%; }
.card-library-table th:nth-child(3) { width: auto; }
.card-library-table th.card-library-table__select,
.card-library-table td.card-library-table__select { padding-right: .25rem !important; padding-left: .25rem !important; text-align: center; }
.card-library-table__select :deep(.v-selection-control) { justify-content: center; }
.card-library-table td { height: 4rem !important; padding: .5rem .75rem !important; vertical-align: middle; }
.card-library-table tbody tr { position: relative; overflow: hidden; cursor: pointer; transition: background-color 160ms ease; }
.card-library-table tbody tr:hover { background: rgba(var(--v-theme-on-surface), .045); }
.card-library-table tbody tr.card-library-table__row--selected { background: rgba(var(--v-theme-secondary), .09); }
.card-library-table tbody tr:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.125rem; }
.card-library-bulk { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: .5rem 1rem; padding: .625rem .75rem .75rem; border-top: .0625rem solid rgba(var(--v-theme-on-surface), .1); background: rgba(var(--v-theme-secondary), .055); }
.card-library-bulk__count { color: rgba(var(--v-theme-on-surface), .72); font-size: .72rem; white-space: nowrap; }
.card-library-bulk__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .125rem; }
.card-library-bulk__actions :deep(.v-btn) { min-height: 2.75rem; }
.card-library-bulk > .v-alert { grid-column: 1 / -1; }
.card-library-pagination :deep(.v-btn) { min-width: 2.75rem; min-height: 2.75rem; }
.card-library-import-row { display: flex; justify-content: flex-end; }
.card-library-import-row :deep(.v-btn) { min-height: 2.75rem; }
.flashcard-table__text { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; font-size: .78rem; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.flashcard-table__faces { display: grid; gap: .2rem; }
.flashcard-table__front { color: rgb(var(--v-theme-on-surface)); font-weight: 900; }
.flashcard-table__back { color: rgba(var(--v-theme-on-surface), .72); }
.flashcard-table__tags { color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
.bulk-tag-actions { display: flex; justify-content: flex-end; gap: .5rem; }
.bulk-tag-actions > .v-btn { min-width: 6rem; min-height: 2.75rem; }

@media (max-width: 31.25rem) {
  .card-library-table th,
  .card-library-table td { padding-right: .5rem !important; padding-left: .5rem !important; }
  .card-library-table th.card-library-table__select,
  .card-library-table td.card-library-table__select { padding-right: .125rem !important; padding-left: .125rem !important; }
  .card-library-table th:nth-child(2) { width: 62%; }
  .card-library-bulk { grid-template-columns: 1fr; }
  .card-library-bulk__actions { justify-content: flex-start; }
}
</style>
