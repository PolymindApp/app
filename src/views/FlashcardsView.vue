<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { Ripple } from 'vuetify/directives'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FlashcardEditorDialog from '@/components/FlashcardEditorDialog.vue'
import {
  cardMatchesTags,
  formatReviewDuration,
  reviewSortTitle,
  sessionAccuracy,
} from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard, FlashcardReviewSet, FlashcardTag } from '@/types/domain'

const router = useRouter()
const { xs } = useDisplay()
const store = useFlashcardStore()
const selectedTags = ref<string[]>([])
const cardDialog = ref(false)
const editingCard = ref<Flashcard>()
const tagManager = ref(false)
const tagNames = reactive<Record<string, string>>({})
const tagSaving = ref('')
const tagError = ref('')
const deleteTagDialog = ref(false)
const deletingTag = ref<FlashcardTag>()
const startError = ref('')
const reviewSetActionsOpen = ref(false)
const selectedReviewSet = ref<FlashcardReviewSet>()
const vRipple = Ripple

const filteredCards = computed(() => store.cards.filter(card => cardMatchesTags(card, selectedTags.value)))
const sessionGroups = computed(() => {
  const groups = new Map<string, typeof store.recentSessions>()
  for (const session of store.recentSessions) {
    const key = format(new Date(session.startedAt), 'yyyy-MM-dd')
    const list = groups.get(key) || []
    list.push(session)
    groups.set(key, list)
  }
  return [...groups.entries()].map(([key, sessions]) => ({
    key,
    label: format(new Date(`${key}T12:00:00`), 'EEEE, MMMM d'),
    sessions,
  }))
})

watch(() => store.tags, (tags) => {
  for (const tag of tags) tagNames[tag.id] = tag.name
  selectedTags.value = selectedTags.value.filter(id => tags.some(tag => tag.id === id))
}, { deep: true, immediate: true })

onMounted(() => {
  store.load().catch(() => undefined)
})

function openNewCard() {
  editingCard.value = undefined
  cardDialog.value = true
}

function openCard(card: Flashcard) {
  editingCard.value = card
  cardDialog.value = true
}

function tagName(id: string) {
  return store.tags.find(tag => tag.id === id)?.name || 'Removed tag'
}

function reviewSetTags(reviewSet: FlashcardReviewSet) {
  return reviewSet.tags.length ? reviewSet.tags.map(tagName).join(', ') : 'All cards'
}

function reviewSetCardCount(reviewSet: FlashcardReviewSet) {
  return store.matchingCards(reviewSet.tags).length
}

function cardTagNames(card: Flashcard) {
  return card.tags.length ? card.tags.map(tagName).join(', ') : 'No tags'
}

function openReviewSetActions(reviewSet: FlashcardReviewSet) {
  selectedReviewSet.value = reviewSet
  reviewSetActionsOpen.value = true
}

async function reviewSelectedSet() {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet) return
  reviewSetActionsOpen.value = false
  await startReview(reviewSet)
}

function editSelectedSet() {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet) return
  reviewSetActionsOpen.value = false
  return router.push({ name: 'flashcard-review-set-edit', params: { id: reviewSet.id } })
}

async function startReview(reviewSet: FlashcardReviewSet) {
  startError.value = ''
  try {
    const active = store.activeSession
    if (active) {
      await router.push({ name: 'flashcard-review-runner', params: { sessionId: active.id } })
      return
    }
    const session = await store.startReview(reviewSet.id)
    await router.push({ name: 'flashcard-review-runner', params: { sessionId: session.id } })
  } catch (cause) {
    startError.value = cause instanceof Error ? cause.message : 'Could not start this review.'
  }
}

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
  <main class="app-page flashcards-page" :class="{ 'flashcards-page--active': store.activeSession }">
    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">
      {{ store.error }}
      <template #append>
        <v-btn size="small" variant="text" @click="store.load">Retry</v-btn>
      </template>
    </v-alert>
    <v-alert v-if="startError" type="error" variant="tonal" class="mb-4">{{ startError }}</v-alert>

    <section>
      <div class="section-heading">
        <h2>Review sets</h2>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-plus"
          :to="{ name: 'flashcard-review-set-new' }"
        >
          New
        </v-btn>
      </div>

      <div v-if="store.reviewSets.length" class="review-set-list">
        <v-card
          v-for="reviewSet in store.reviewSets"
          :key="reviewSet.id"
          ripple
          class="review-set surface-card pa-4"
          role="button"
          tabindex="0"
          :aria-label="`Open ${reviewSet.name} review or edit actions`"
          @click="openReviewSetActions(reviewSet)"
          @keydown.enter="openReviewSetActions(reviewSet)"
          @keydown.space.prevent="openReviewSetActions(reviewSet)"
        >
          <div class="review-set__main">
            <div class="review-set__icon"><v-icon icon="mdi-cards-playing-outline" size="25" /></div>
            <div class="min-width-0">
              <h3 class="text-body-1 font-weight-black text-truncate">{{ reviewSet.name }}</h3>
              <p class="text-caption muted mt-1 text-truncate">{{ reviewSetTags(reviewSet) }}</p>
              <div class="review-set__meta mt-2">
                <span>{{ reviewSet.mode === 'passive' ? 'Passive' : 'Manual' }}</span>
                <span v-if="reviewSet.speechEnabled" class="review-set__speech">
                  <v-icon icon="mdi-volume-high" size="12" /> Speech
                </span>
                <span>{{ reviewSortTitle(reviewSet.sortMode) }}</span>
                <span>{{ reviewSetCardCount(reviewSet) }} cards</span>
              </div>
            </div>
            <v-icon icon="mdi-chevron-right" color="medium-emphasis" />
          </div>
        </v-card>
      </div>
      <v-card v-else-if="store.loaded" class="surface-card pa-7 text-center">
        <v-icon icon="mdi-cards-playing-outline" size="40" color="secondary" />
        <h3 class="text-h6 font-weight-black mt-3">Build your first Review set</h3>
        <p class="text-body-2 muted mt-2 mb-5">Choose which tags to review and how the cards should move.</p>
        <v-btn color="secondary" :to="{ name: 'flashcard-review-set-new' }">Create Review set</v-btn>
      </v-card>
    </section>

    <section>
      <div class="section-heading">
        <h2>Your cards</h2>
        <span class="text-caption muted">{{ filteredCards.length }} of {{ store.cards.length }}</span>
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
          prepend-inner-icon="mdi-filter-variant"
          :disabled="!store.tags.length"
        />
        <v-btn
          icon="mdi-tag-edit-outline"
          variant="tonal"
          aria-label="Manage flashcard tags"
          :disabled="!store.tags.length"
          @click="tagManager = true"
        />
      </div>

      <v-table v-if="filteredCards.length" density="compact" class="card-library-table surface-card">
        <thead>
          <tr>
            <th scope="col">Front</th>
            <th scope="col">Back</th>
            <th scope="col">Tags</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="card in filteredCards"
            :key="card.id"
            v-ripple
            tabindex="0"
            :aria-label="`Edit card: ${card.front}`"
            @click="openCard(card)"
            @keydown.enter="openCard(card)"
            @keydown.space.prevent="openCard(card)"
          >
            <td>
              <strong class="flashcard-table__text">{{ card.front }}</strong>
            </td>
            <td>
              <span class="flashcard-table__text flashcard-table__back">{{ card.back }}</span>
            </td>
            <td>
              <span class="flashcard-table__text flashcard-table__tags" :title="cardTagNames(card)">
                {{ cardTagNames(card) }}
              </span>
            </td>
          </tr>
        </tbody>
      </v-table>

      <v-card v-else-if="store.loaded" class="surface-card pa-8 text-center">
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

      <v-btn
        v-if="store.cards.length"
        block
        size="large"
        color="secondary"
        prepend-icon="mdi-card-plus-outline"
        class="mt-4"
        @click="openNewCard"
      >
        Add cards
      </v-btn>
    </section>

    <section>
      <div class="section-heading">
        <h2>Recent reviews</h2>
        <span class="text-caption muted">{{ store.recentSessions.length }}</span>
      </div>
      <v-card v-if="sessionGroups.length" class="surface-card pa-2">
        <section v-for="(group, index) in sessionGroups" :key="group.key">
          <v-divider v-if="index" />
          <div class="history-group-heading px-4 pt-3 pb-1">
            <h3>{{ group.label }}</h3>
            <span>{{ group.sessions.length }}</span>
          </div>
          <v-list bg-color="transparent">
            <v-list-item v-for="session in group.sessions" :key="session.id" :title="session.name">
              <template #prepend>
                <v-icon
                  :icon="session.status === 'completed' ? 'mdi-check-circle-outline' : 'mdi-stop-circle-outline'"
                  :color="session.status === 'completed' ? 'success' : 'warning'"
                />
              </template>
              <div class="review-history-meta">
                <span>{{ format(new Date(session.startedAt), 'h:mm a') }}</span>
                <span>{{ session.mode === 'passive' ? `${session.viewedCount} viewed` : `${session.successCount} success · ${session.errorCount} error` }}</span>
                <span v-if="sessionAccuracy(session) !== undefined">{{ sessionAccuracy(session) }}% accuracy</span>
                <span v-if="session.ejectedCount">{{ session.ejectedCount }} ejected</span>
              </div>
              <template #append>
                <strong class="text-caption">{{ formatReviewDuration(session.elapsedSeconds) }}</strong>
              </template>
            </v-list-item>
          </v-list>
        </section>
      </v-card>
      <v-card v-else-if="store.loaded" class="surface-card pa-7 text-center">
        <p class="text-body-2 muted">Finished and ended reviews will appear here.</p>
      </v-card>
    </section>

    <v-card
      v-if="store.activeSession"
      class="active-review page-action-area pa-5 mt-6"
      color="secondary"
    >
      <div class="min-width-0">
        <span class="active-review__label">{{ store.activeSession.status === 'paused' ? 'Paused' : 'In progress' }}</span>
        <strong class="active-review__name text-truncate">{{ store.activeSession.name }}</strong>
      </div>
      <v-btn
        color="primary"
        size="large"
        append-icon="mdi-arrow-right"
        :to="{ name: 'flashcard-review-runner', params: { sessionId: store.activeSession.id } }"
      >
        Resume
      </v-btn>
    </v-card>

    <FlashcardEditorDialog
      v-model="cardDialog"
      :card="editingCard"
      @saved="editingCard = undefined"
      @deleted="editingCard = undefined"
    />

    <ActionBottomSheet
      v-model="reviewSetActionsOpen"
      :title="selectedReviewSet?.name || 'Review set actions'"
      hide-title
      :aria-label="selectedReviewSet ? `${selectedReviewSet.name} review or edit actions` : 'Review set actions'"
    >
      <template v-if="selectedReviewSet">
        <v-list-item
          prepend-icon="mdi-play"
          title="Review"
          rounded="lg"
          :disabled="reviewSetCardCount(selectedReviewSet) === 0"
          @click="reviewSelectedSet"
        />
        <v-list-item
          prepend-icon="mdi-pencil-outline"
          title="Edit"
          rounded="lg"
          @click="editSelectedSet"
        />
      </template>
    </ActionBottomSheet>

    <v-dialog v-model="tagManager" :fullscreen="xs" max-width="34rem" scrollable>
      <v-card :rounded="xs ? '0' : 'xl'" class="tag-manager">
        <div class="tag-manager__header px-5 py-4">
          <div>
            <h2 class="text-h6 font-weight-black">Manage tags</h2>
            <p class="text-caption muted mt-1">Renaming updates every card and Review set.</p>
          </div>
          <v-btn icon="mdi-close" variant="text" aria-label="Close tag manager" @click="tagManager = false" />
        </div>
        <v-divider />
        <v-card-text class="pa-5">
          <v-alert v-if="tagError" type="error" variant="tonal" class="mb-4">{{ tagError }}</v-alert>
          <div class="tag-manager__list">
            <div v-for="tag in store.tags" :key="tag.id" class="tag-manager__row">
              <v-text-field
                v-model="tagNames[tag.id]"
                label="Tag name"
                maxlength="50"
                autocomplete="off"
                prepend-inner-icon="mdi-tag-outline"
                :disabled="tagSaving === tag.id"
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
                @click="deletingTag = tag; deleteTagDialog = true"
              />
            </div>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

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
.review-set-list,
.tag-manager__list { display: grid; gap: .75rem; }
.review-set { overflow: hidden; cursor: pointer; }
.review-set:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.review-set__main { display: grid; min-width: 0; grid-template-columns: 3rem minmax(0, 1fr) 1.5rem; align-items: center; gap: .85rem; }
.review-set__icon { display: grid; width: 3rem; height: 3rem; place-items: center; border-radius: 1rem; background: rgba(var(--v-theme-secondary), .14); color: rgb(var(--v-theme-secondary)); }
.review-set__meta { display: flex; flex-wrap: wrap; gap: .35rem; }
.review-set__meta span { padding: .2rem .45rem; border-radius: 999rem; background: rgba(var(--v-theme-on-surface), .07); color: rgba(var(--v-theme-on-surface), .64); font-size: .64rem; font-weight: 800; }
.review-set__meta .review-set__speech { display: inline-flex; align-items: center; gap: .2rem; color: rgb(var(--v-theme-secondary)); }
.card-filters { display: grid; grid-template-columns: minmax(0, 1fr) 2.75rem; align-items: start; gap: .75rem; }
.card-filters > .v-btn { min-width: 2.75rem; min-height: 2.75rem; }
.card-library-table { overflow: hidden; border-radius: 1rem; }
.card-library-table :deep(.v-table__wrapper) { overflow-x: hidden; }
.card-library-table :deep(table) { table-layout: fixed; }
.card-library-table th { height: 2.25rem !important; padding: 0 .75rem !important; color: rgba(var(--v-theme-on-surface), .52); font-size: .64rem !important; font-weight: 900 !important; letter-spacing: .08em; text-transform: uppercase; }
.card-library-table th:nth-child(1),
.card-library-table th:nth-child(2) { width: 36%; }
.card-library-table th:nth-child(3) { width: 28%; }
.card-library-table td { height: 3.25rem !important; padding: .45rem .75rem !important; vertical-align: middle; }
.card-library-table tbody tr { position: relative; overflow: hidden; cursor: pointer; transition: background-color 160ms ease; }
.card-library-table tbody tr:hover { background: rgba(var(--v-theme-on-surface), .045); }
.card-library-table tbody tr:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.125rem; }
.flashcard-table__text { display: -webkit-box; overflow: hidden; overflow-wrap: anywhere; font-size: .78rem; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.flashcard-table__back { color: rgba(var(--v-theme-on-surface), .72); }
.flashcard-table__tags { color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
.history-group-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.history-group-heading h3 { font-size: .75rem; font-weight: 900; }
.history-group-heading span { color: rgba(var(--v-theme-on-surface), .54); font-size: .68rem; font-weight: 800; }
.review-history-meta { display: flex; flex-wrap: wrap; gap: .3rem .65rem; margin-top: .25rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .7rem; }
.active-review { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.active-review > div { display: flex; flex-direction: column; }
.active-review__label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-review__name { font-size: 1.35rem; }
.tag-manager { max-height: min(45rem, 94dvh); }
.tag-manager__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.tag-manager__row { display: grid; grid-template-columns: minmax(0, 1fr) 2.75rem 2.75rem; align-items: start; gap: .5rem; }
@media (max-width: 59.9375rem) {
  .flashcards-page--active { padding-bottom: calc(7rem + var(--page-safe-area-bottom)); }
  .active-review { position: fixed; z-index: 20; right: 0; bottom: calc(4.5rem + env(safe-area-inset-bottom)); left: 0; border-radius: 0 !important; box-shadow: 0 -.75rem 1.875rem rgba(0, 0, 0, .28) !important; }
}
@media (max-width: 31.25rem) {
  .card-library-table th,
  .card-library-table td { padding-right: .5rem !important; padding-left: .5rem !important; }
  .tag-manager { min-height: 100dvh; max-height: 100dvh; padding-top: max(env(safe-area-inset-top), var(--safe-area-inset-top, 0rem)); padding-bottom: max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0rem)); }
}
</style>
