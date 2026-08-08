<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardBulkImageAssignmentDialog from '@/components/FlashcardBulkImageAssignmentDialog.vue'
import FlashcardCardsTable from '@/components/FlashcardCardsTable.vue'
import FlashcardTagCombobox from '@/components/FlashcardTagCombobox.vue'
import { cardMatchesTags, FLASHCARD_BULK_MENU_ITEMS } from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import type {
  Flashcard,
  FlashcardBulkAction,
  FlashcardBulkRecordAction,
  FlashcardTag,
} from '@/types/domain'

type FlashcardBulkTagAction = Extract<FlashcardBulkAction, 'add_tags' | 'set_tags' | 'remove_tags'>

const props = withDefaults(defineProps<{
  cards: Flashcard[]
  tags: FlashcardTag[]
  libraryActions?: boolean
  showImport?: boolean
  importReviewSetId?: string
  bulkActions?: FlashcardBulkAction[]
  bulkActionHandler?: (
    action: FlashcardBulkRecordAction,
    cardIds: string[],
    tagIds: string[],
  ) => Promise<unknown>
  assignImageHandler?: (cardId: string, imageId: number) => Promise<unknown>
  selectable?: boolean
  interactive?: boolean
  canAdd?: boolean
  addLabel?: string
  addAriaLabel?: string
  emptyTitle?: string
  emptyDescription?: string
  firstCardLabel?: string
}>(), {
  libraryActions: false,
  showImport: false,
  importReviewSetId: '',
  selectable: false,
  interactive: true,
  canAdd: true,
  addLabel: 'Add',
  addAriaLabel: 'Add a new flashcard',
  emptyTitle: 'Your card library is empty',
  emptyDescription: 'Add a prompt and answer, then keep entering cards without closing the form.',
  firstCardLabel: 'Add your first card',
})

const emit = defineEmits<{
  'add-card': []
  'open-card': [card: Flashcard]
  'update:filteredCount': [count: number]
}>()

const store = useFlashcardStore()
const selectedTags = ref<string[]>([])
const selectedCardIds = ref<string[]>([])
const bulkError = ref('')
const bulkSaving = ref(false)
const bulkMenuOpen = ref(false)
const bulkImageDialogOpen = ref(false)
const bulkTagSheetOpen = ref(false)
const bulkTagAction = ref<FlashcardBulkTagAction>('add_tags')
const bulkTagIds = ref<string[]>([])
const clearTagsDialog = ref(false)
const deleteCardsDialog = ref(false)

const filteredCards = computed(() => props.cards.filter(card => cardMatchesTags(card, selectedTags.value)))
const availableBulkMenuItems = computed(() => {
  const actions = props.libraryActions
    ? FLASHCARD_BULK_MENU_ITEMS.map(item => item.action)
    : props.bulkActions || []
  return FLASHCARD_BULK_MENU_ITEMS.filter(item => actions.includes(item.action))
})
const hasBulkActions = computed(() => availableBulkMenuItems.value.length > 0)
const hasActions = computed(() => props.libraryActions || props.showImport || hasBulkActions.value || props.canAdd)
const actionCount = computed(() => (
  Number(props.libraryActions)
  + Number(props.libraryActions || props.showImport)
  + Number(hasBulkActions.value)
  + Number(props.canAdd)
))
const importRoute = computed(() => ({
  name: 'flashcard-import',
  query: props.importReviewSetId ? { reviewSetId: props.importReviewSetId } : undefined,
}))
const selectedCards = computed(() => {
  const selected = new Set(selectedCardIds.value)
  return props.cards.filter(card => selected.has(card.id))
})
const selectedCardsHaveTags = computed(() => selectedCards.value.some(card => card.tags.length > 0))
const bulkRemovableTags = computed(() => {
  const assigned = new Set(selectedCards.value.flatMap(card => card.tags))
  return props.tags.filter(tag => assigned.has(tag.id))
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

watch(filteredCards, cards => {
  emit('update:filteredCount', cards.length)
}, { immediate: true })

watch(() => props.tags, (tags) => {
  selectedTags.value = selectedTags.value.filter(id => tags.some(tag => tag.id === id))
}, { deep: true, immediate: true })

watch(selectedTags, () => {
  selectedCardIds.value = []
}, { deep: true })

watch(selectedCardIds, () => {
  bulkError.value = ''
}, { deep: true })

watch(() => props.cards.map(card => card.id), (ids) => {
  const existing = new Set(ids)
  selectedCardIds.value = selectedCardIds.value.filter(id => existing.has(id))
}, { immediate: true })

function openBulkTagAction(action: FlashcardBulkTagAction) {
  if (!selectedCardIds.value.length) return
  bulkTagAction.value = action
  bulkTagIds.value = []
  bulkError.value = ''
  bulkTagSheetOpen.value = true
}

function chooseBulkAction(action: FlashcardBulkAction) {
  bulkMenuOpen.value = false
  if (action === 'assign_images') {
    bulkError.value = ''
    bulkImageDialogOpen.value = true
    return
  }
  if (action === 'add_tags' || action === 'set_tags' || action === 'remove_tags') {
    openBulkTagAction(action)
    return
  }
  if (action === 'clear_tags') clearTagsDialog.value = true
  else deleteCardsDialog.value = true
}

function completeBulkImageAssignment() {
  selectedCardIds.value = []
}

async function runBulkAction(action: FlashcardBulkRecordAction, tagIds: string[] = []) {
  const cardIds = [...selectedCardIds.value]
  if (!cardIds.length) return false
  bulkError.value = ''
  bulkSaving.value = true
  try {
    await (props.bulkActionHandler || store.bulkUpdateCards)(action, cardIds, tagIds)
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
</script>

<template>
  <div class="flashcard-cards-manager">
    <div class="card-filters mb-3">
      <v-autocomplete
        v-model="selectedTags"
        :items="tags"
        item-title="name"
        item-value="id"
        label="Filter by tags"
        variant="outlined"
        density="comfortable"
        rounded="lg"
        hide-details="auto"
        multiple
        chips
        closable-chips
        clearable
        autocomplete="off"
        no-data-text="No matching tags"
        prepend-inner-icon="mdi-filter-variant"
        :disabled="!tags.length"
      />
      <div
        v-if="hasActions"
        class="card-filter-actions"
        :class="`card-filter-actions--${actionCount}`"
      >
        <template v-if="libraryActions">
          <v-btn
            class="card-filter-action"
            variant="tonal"
            aria-label="Manage flashcard tags"
            :to="{ name: 'flashcard-tags' }"
          >
            <span class="card-filter-action__content">
              <v-icon icon="mdi-tag-multiple-outline" />
              <span class="card-filter-action__label">Tags</span>
            </span>
          </v-btn>
        </template>
        <v-btn
          v-if="libraryActions || showImport"
          class="card-filter-action"
          variant="tonal"
          aria-label="Import flashcards"
          :to="importRoute"
        >
          <span class="card-filter-action__content">
            <v-icon icon="mdi-file-import-outline" />
            <span class="card-filter-action__label">Import</span>
          </span>
        </v-btn>
        <v-menu
          v-if="hasBulkActions"
          v-model="bulkMenuOpen"
          location="bottom end"
          transition="slide-y-transition"
        >
          <template #activator="{ props: activatorProps }">
            <v-btn
              v-bind="activatorProps"
              class="card-filter-action"
              variant="tonal"
              :disabled="!selectedCardIds.length || bulkSaving"
              :aria-label="selectedCardIds.length ? `Bulk actions for ${selectedCardIds.length} selected cards` : 'Select cards to use bulk actions'"
            >
              <span class="card-filter-action__content">
                <v-badge
                  :model-value="selectedCardIds.length > 0"
                  :content="selectedCardIds.length"
                  color="secondary"
                >
                  <v-icon icon="mdi-select-multiple" />
                </v-badge>
                <span class="card-filter-action__label">Bulk</span>
              </span>
            </v-btn>
          </template>

          <v-list class="bulk-menu-list" density="compact" rounded="lg">
            <v-list-subheader>
              {{ selectedCardIds.length }} {{ selectedCardIds.length === 1 ? 'card' : 'cards' }} selected
            </v-list-subheader>
            <template v-for="item in availableBulkMenuItems" :key="item.action">
              <v-divider v-if="item.divider" class="my-1" />
              <v-list-item
                :prepend-icon="item.icon"
                :title="item.title"
                :base-color="item.color"
                :disabled="bulkSaving || ('requiresTags' in item && item.requiresTags && !selectedCardsHaveTags)"
                @click="chooseBulkAction(item.action)"
              />
            </template>
          </v-list>
        </v-menu>
        <v-btn
          v-if="canAdd"
          class="card-filter-action"
          variant="flat"
          color="secondary"
          :aria-label="addAriaLabel"
          @click="emit('add-card')"
        >
          <span class="card-filter-action__content">
            <v-icon icon="mdi-plus" />
            <span class="card-filter-action__label">{{ addLabel }}</span>
          </span>
        </v-btn>
      </div>
    </div>

    <v-alert v-if="bulkError" type="error" variant="tonal" density="compact" class="mb-3">
      {{ bulkError }}
    </v-alert>

    <FlashcardCardsTable
      v-if="filteredCards.length"
      v-model="selectedCardIds"
      :cards="filteredCards"
      :tags="tags"
      :selectable="selectable"
      :interactive="interactive"
      @open-card="emit('open-card', $event)"
    />

    <v-card v-else class="surface-card pa-8 text-center">
      <v-icon icon="mdi-cards-outline" size="44" color="secondary" />
      <h3 class="text-h6 font-weight-black mt-3">
        {{ cards.length ? 'No cards match these tags' : emptyTitle }}
      </h3>
      <p class="text-body-2 muted mt-2 mb-5">
        {{ cards.length ? 'Clear a filter or choose another tag.' : emptyDescription }}
      </p>
      <v-btn v-if="!cards.length && canAdd" color="secondary" @click="emit('add-card')">
        {{ firstCardLabel }}
      </v-btn>
      <v-btn v-else-if="cards.length" variant="tonal" @click="selectedTags = []">Clear filters</v-btn>
    </v-card>

    <template v-if="hasBulkActions">
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

      <FlashcardBulkImageAssignmentDialog
        v-model="bulkImageDialogOpen"
        :cards="selectedCards"
        :assign-image="assignImageHandler"
        @complete="completeBulkImageAssignment"
      />

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
    </template>
  </div>
</template>

<style scoped>
.card-filters { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: .75rem; }
.card-filter-actions { display: flex; align-items: stretch; gap: .25rem; }
.card-filter-action { min-width: 4rem; min-height: 3.75rem; height: auto !important; padding: .125rem .375rem !important; text-transform: none; }
.card-filter-action__content { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; gap: .2rem; }
.card-filter-action__label { margin-top: .25rem; overflow: hidden; max-width: 100%; font-size: .64rem; font-weight: 800; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.bulk-menu-list { min-width: 14rem; }
.bulk-tag-actions { display: flex; justify-content: flex-end; gap: .5rem; }
.bulk-tag-actions > .v-btn { min-width: 6rem; min-height: 2.75rem; }

@media (max-width: 31.25rem) {
  .card-filters { grid-template-columns: minmax(0, 1fr); }
  .card-filter-actions { display: grid; grid-template-columns: minmax(0, 1fr); }
  .card-filter-actions--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-filter-actions--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .card-filter-actions--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .card-filter-action { width: 100%; }
}
</style>
