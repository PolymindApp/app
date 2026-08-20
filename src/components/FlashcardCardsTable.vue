<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useDisplay } from 'vuetify'
import { Intersect, Ripple } from 'vuetify/directives'
import type { Flashcard, FlashcardTag } from '@/types/domain'

const props = withDefaults(defineProps<{
  cards: Flashcard[]
  tags: FlashcardTag[]
  modelValue: string[]
  selectable?: boolean
  interactive?: boolean
  surface?: boolean
  showLastColumn?: boolean
  rowClass?: (card: Flashcard) => string | undefined
}>(), {
  selectable: true,
  interactive: true,
  surface: true,
  showLastColumn: true,
})

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
const horizontalScrollLeft = ref(0)
const tableScroll = ref<HTMLElement>()
const headerColumnWidths = ref<number[]>([])
const headerTrackWidth = ref(0)
const infiniteScrollOptions = { rootMargin: '0px 0px 192px 0px' }
let tableResizeObserver: ResizeObserver | undefined

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
const headerTrackStyle = computed(() => ({
  width: headerTrackWidth.value ? `${headerTrackWidth.value}px` : undefined,
  gridTemplateColumns: headerColumnWidths.value.length
    ? headerColumnWidths.value.map(width => `${width}px`).join(' ')
    : undefined,
  transform: `translateX(-${horizontalScrollLeft.value}px)`,
}))

function syncHeaderColumns() {
  const table = tableScroll.value?.querySelector('table')
  const cells = table?.querySelector('tbody tr')?.children
  if (!table || !cells?.length) return
  const columnWidths = Array.from(cells, cell => cell.getBoundingClientRect().width)
  headerColumnWidths.value = columnWidths
  headerTrackWidth.value = columnWidths.reduce((total, width) => total + width, 0)
}

function observeTableSize() {
  tableResizeObserver?.disconnect()
  syncHeaderColumns()
  if (typeof ResizeObserver === 'undefined') return
  tableResizeObserver = new ResizeObserver(syncHeaderColumns)
  const table = tableScroll.value?.querySelector('table')
  if (table) tableResizeObserver.observe(table)
  if (tableScroll.value) tableResizeObserver.observe(tableScroll.value)
}

onMounted(() => nextTick(observeTableSize))
onBeforeUnmount(() => tableResizeObserver?.disconnect())

watch([
  displayedCards,
  () => props.selectable,
  () => props.showLastColumn,
  () => props.tags,
], () => nextTick(observeTableSize), { deep: true })

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

function activateCardRow(card: Flashcard) {
  if (props.interactive) {
    emit('open-card', card)
    return
  }
  if (props.selectable) {
    toggleCardSelection(card.id, !selectedCardIds.value.includes(card.id))
  }
}

function loadMoreCards(intersecting: boolean) {
  if (!intersecting || !hasMoreCards.value) return
  visibleCardCount.value = Math.min(props.cards.length, visibleCardCount.value + PAGE_SIZE)
}

function syncHeaderScroll(event: Event) {
  horizontalScrollLeft.value = Math.max(0, (event.currentTarget as HTMLElement).scrollLeft)
}

function cardTagNames(card: Flashcard) {
  return card.tags.length
    ? card.tags.map(tag => tagNames.value.get(tag) || 'Removed tag').join(', ')
    : 'No tags'
}
</script>

<template>
  <div class="flashcard-cards-table">
    <div class="card-library" :class="{ 'surface-card': surface }">
      <div class="card-library-header" aria-label="Flashcard table columns">
        <div
          class="card-library-header__track"
          :class="{
            'card-library-header__track--without-selection': !selectable,
            'card-library-header__track--without-last-column': !showLastColumn,
          }"
          :style="headerTrackStyle"
        >
          <div v-if="selectable" class="card-library-header__cell card-library-header__select">
            <v-checkbox-btn
              :model-value="allCardsSelected"
              :indeterminate="someCardsSelected"
              color="secondary"
              density="compact"
              hide-details="auto"
              :aria-label="`Select all ${cards.length} cards`"
              @update:model-value="toggleAllSelection(Boolean($event))"
            />
          </div>
          <div class="card-library-header__cell" aria-hidden="true">
            <slot name="action-column-heading">Card</slot>
          </div>
          <div class="card-library-header__cell" aria-hidden="true">Faces</div>
          <div class="card-library-header__cell" aria-hidden="true">Transliteration</div>
          <div v-if="showLastColumn" class="card-library-header__cell" aria-hidden="true">
            <slot name="last-column-heading">Tags</slot>
          </div>
          <div v-if="showLastColumn" class="card-library-header__cell" aria-hidden="true">Notes</div>
        </div>
      </div>
      <div
        ref="tableScroll"
        class="card-library-scroll"
        role="region"
        aria-label="Flashcard table"
        tabindex="0"
        @scroll.passive="syncHeaderScroll"
      >
        <v-table
          density="compact"
          class="card-library-table"
          :class="{ 'card-library-table--without-last-column': !showLastColumn }"
        >
          <colgroup>
            <col v-if="selectable" class="card-library-table__select-column">
            <col class="card-library-table__action-column">
            <col class="card-library-table__faces-column">
            <col class="card-library-table__transliteration-column">
            <col v-if="showLastColumn" class="card-library-table__tags-column">
            <col v-if="showLastColumn" class="card-library-table__notes-column">
          </colgroup>
          <thead class="card-library-table__semantic-heading">
            <tr>
              <th v-if="selectable" scope="col" aria-label="Selection" />
              <th scope="col" class="card-library-table__action-heading">
                <slot name="action-column-heading">Card</slot>
              </th>
              <th scope="col" class="card-library-table__faces-heading">Faces</th>
              <th scope="col" class="card-library-table__transliteration-heading">Transliteration</th>
              <th v-if="showLastColumn" scope="col" class="card-library-table__tags-heading">
                <slot name="last-column-heading">Tags</slot>
              </th>
              <th v-if="showLastColumn" scope="col" class="card-library-table__notes-heading">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="card in displayedCards"
              :key="card.id"
              :tabindex="interactive || selectable ? 0 : undefined"
              :class="[
                {
                  'card-library-table__row--selected': selectedCardIds.includes(card.id),
                  'card-library-table__row--interactive': interactive || selectable,
                },
                rowClass?.(card),
              ]"
              :aria-label="interactive
                ? `Edit card: ${card.front}`
                : selectable ? `Select card: ${card.front}` : undefined"
              :aria-selected="selectable ? selectedCardIds.includes(card.id) : undefined"
              @click="activateCardRow(card)"
              @keydown.enter="activateCardRow(card)"
              @keydown.space.prevent="activateCardRow(card)"
            >
              <td
                v-if="selectable"
                class="card-library-table__select text-no-wrap"
                @touchstart.stop
                @click.stop="toggleCardSelection(card.id, !selectedCardIds.includes(card.id))"
                @keydown.stop
              >
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
              <td class="card-library-table__action-cell text-no-wrap">
                <slot name="action-column" :card="card">
                  <v-icon icon="mdi-card-text-outline" size="18" color="secondary" aria-hidden="true" />
                </slot>
              </td>
              <td class="card-library-table__faces-cell text-no-wrap">
                <span v-ripple class="card-library-table__row-ripple" aria-hidden="true" />
                <div class="flashcard-table__faces">
                  <strong class="flashcard-table__text flashcard-table__front">{{ card.front }}</strong>
                  <span class="flashcard-table__text flashcard-table__back">{{ card.back }}</span>
                </div>
              </td>
              <td class="card-library-table__transliteration-cell">
                <span
                  class="flashcard-table__text flashcard-table__transliteration"
                  :title="card.transliteration || 'No transliteration'"
                >
                  {{ card.transliteration || '—' }}
                </span>
              </td>
              <td v-if="showLastColumn" class="card-library-table__tags-cell text-no-wrap">
                <slot name="last-column" :card="card">
                  <span class="flashcard-table__text flashcard-table__tags" :title="cardTagNames(card)">
                    {{ cardTagNames(card) }}
                  </span>
                </slot>
              </td>
              <td v-if="showLastColumn" class="card-library-table__notes-cell">
                <span class="flashcard-table__text flashcard-table__notes" :title="card.note || 'No notes'">
                  {{ card.note || '—' }}
                </span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

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
.card-library-header { position: sticky; z-index: 3; top: calc(3.75rem + max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem))); width: 100%; height: 2.25rem; overflow: hidden; background: rgb(var(--v-theme-surface)); box-shadow: 0 .0625rem 0 rgba(var(--v-theme-on-surface), .1); }
.card-library-header__track { display: grid; width: max(68rem, 100%); height: 100%; grid-template-columns: 3rem 3rem repeat(4, minmax(12rem, 1fr)); will-change: transform; }
.card-library-header__track--without-selection { grid-template-columns: 3rem repeat(4, minmax(12rem, 1fr)); }
.card-library-header__track--without-last-column { width: max(32rem, 100%); grid-template-columns: 3rem 3rem repeat(2, minmax(12rem, 1fr)); }
.card-library-header__track--without-selection.card-library-header__track--without-last-column { grid-template-columns: 3rem repeat(2, minmax(12rem, 1fr)); }
.card-library-header__cell { display: flex; min-width: 0; height: 2.25rem; padding: 0 .75rem; align-items: center; color: rgba(var(--v-theme-on-surface), .52); font-size: .64rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.card-library-header__select { justify-content: center; padding-right: .25rem; padding-left: .25rem; }
.card-library-header__select :deep(.v-selection-control) { justify-content: center; }
.card-library-scroll { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; }
.card-library-scroll:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.125rem; }
.card-library-table { min-width: 68rem; max-width: none; background: transparent; }
.card-library-table--without-last-column { min-width: 32rem; }
.card-library-table :deep(.v-table__wrapper) { overflow: visible; }

.card-library-table__semantic-heading { position: absolute; width: .0625rem; height: .0625rem; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.card-library-table__select-column { width: 3rem; }
.card-library-table__action-column { width: 3rem; }
.card-library-table--without-last-column .card-library-table__faces-column,
.card-library-table--without-last-column .card-library-table__transliteration-column { width: 50%; }
.card-library-table__faces-column,
.card-library-table__transliteration-column,
.card-library-table__tags-column,
.card-library-table__notes-column { width: 25%; }
.card-library-table th.card-library-table__select,
.card-library-table td.card-library-table__select { padding-right: .25rem !important; padding-left: .25rem !important; text-align: center; }
.card-library-table th.card-library-table__action-heading,
.card-library-table td.card-library-table__action-cell { padding-right: .5rem !important; padding-left: .5rem !important; text-align: center; }
.card-library-table tbody .card-library-table__select { position: relative; z-index: 2; cursor: pointer; }
.card-library-table__select :deep(.v-selection-control) { position: relative; z-index: 2; justify-content: center; }
.card-library-table td { height: 4rem !important; padding: .5rem .75rem !important; vertical-align: middle; }
.card-library-table tbody tr { position: relative; overflow: hidden; transition: background-color 160ms ease; }
.card-library-table tbody tr.card-library-table__row--interactive { cursor: pointer; }
.card-library-table__row-ripple { position: absolute; z-index: 1; inset: 0; display: block; overflow: hidden; }
.card-library-table tbody tr:hover { background: rgba(var(--v-theme-on-surface), .045); }
.card-library-table tbody tr.card-library-table__row--excluded {
  background: repeating-linear-gradient(
    135deg,
    rgba(var(--v-theme-warning), .09) 0,
    rgba(var(--v-theme-warning), .09) .35rem,
    rgba(var(--v-theme-warning), .025) .35rem,
    rgba(var(--v-theme-warning), .025) .75rem
  );
}
.card-library-table tbody tr.card-library-table__row--selected { background: rgba(var(--v-theme-secondary), .09); }
.card-library-table tbody tr:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.125rem; }
.card-library-load-more { display: flex; min-height: 2.75rem; align-items: center; justify-content: center; gap: .5rem; color: rgba(var(--v-theme-on-surface), .52); font-size: .68rem; font-weight: 800; }
.card-library-pagination :deep(.v-btn) { min-width: 2.75rem; min-height: 2.75rem; }
.flashcard-table__text { display: -webkit-box; overflow-wrap: anywhere; font-size: .78rem; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.flashcard-table__faces { display: grid; min-width: 0; gap: .2rem; }
.flashcard-table__front { color: rgb(var(--v-theme-on-surface)); font-weight: 900; }
.flashcard-table__back { color: rgba(var(--v-theme-on-surface), .72); }
.flashcard-table__transliteration,
.flashcard-table__tags,
.flashcard-table__notes { color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }

@media (max-width: 31.25rem) {
  .card-library-header__cell { padding-right: .5rem; padding-left: .5rem; }
  .card-library-header__select { padding-right: .125rem; padding-left: .125rem; }
  .card-library-table th,
  .card-library-table td { padding-right: .5rem !important; padding-left: .5rem !important; }
  .card-library-table th.card-library-table__select,
  .card-library-table td.card-library-table__select { padding-right: .125rem !important; padding-left: .125rem !important; }
  .card-library-header__track { grid-template-columns: 3rem 3rem repeat(4, minmax(12rem, 1fr)); }
  .card-library-header__track--without-selection { grid-template-columns: 3rem repeat(4, minmax(12rem, 1fr)); }
}
</style>
