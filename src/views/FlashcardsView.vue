<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format, isSameWeek, startOfWeek } from 'date-fns'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import WeekNavigator from '@/components/WeekNavigator.vue'
import { flashcardReviewProgressPercent } from '@/services/flashcardHistory'
import { formatReviewDuration, reviewSortTitle, sessionAccuracy } from '@/services/flashcards'
import { groupSessionsByDate } from '@/services/sessionHistory'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardReviewSession, FlashcardReviewSet } from '@/types/domain'

const router = useRouter()
const store = useFlashcardStore()
const startError = ref('')
const reviewSetActionsOpen = ref(false)
const selectedReviewSet = ref<FlashcardReviewSet>()
const recentWeekStart = ref(startOfWeek(new Date(), { weekStartsOn: 1 }))

const recentReviewsForWeek = computed(() => store.sessions.filter(session =>
  (session.status === 'completed' || session.status === 'ended')
  && isSameWeek(new Date(session.startedAt), recentWeekStart.value, { weekStartsOn: 1 }),
))
const recentReviewGroups = computed(() => groupSessionsByDate(recentReviewsForWeek.value))
const recentWeekIsCurrent = computed(() =>
  isSameWeek(recentWeekStart.value, new Date(), { weekStartsOn: 1 }),
)

onMounted(() => {
  store.load().catch(() => undefined)
})

function tagName(id: string) {
  return store.tags.find(tag => tag.id === id)?.name || 'Removed tag'
}

function reviewSetCardCount(reviewSet: FlashcardReviewSet) {
  return Math.min(store.matchingCards(reviewSet.tags).length, reviewSet.maxCards)
}

function recentReviewColor(session: FlashcardReviewSession) {
  return session.status === 'completed' ? 'success' : 'warning'
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
      <div class="section-heading mt-0">
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
            <div class="min-width-0">
              <h3 class="text-body-1 font-weight-black text-truncate">{{ reviewSet.name }}</h3>
              <div class="review-set__meta mt-2">
                <span v-if="!reviewSet.tags.length" class="review-set__meta-item">
                  <v-icon icon="mdi-cards-outline" size="small" />
                  <span>All cards</span>
                </span>
                <span class="review-set__meta-item">
                  <v-icon
                    :icon="reviewSet.mode === 'passive' ? 'mdi-play-speed' : 'mdi-gesture-tap'"
                    size="small"
                  />
                  <span>{{ reviewSet.mode === 'passive' ? 'Passive' : 'Manual' }}</span>
                </span>
                <span v-if="reviewSet.speechEnabled" class="review-set__meta-item review-set__meta-item--active">
                  <v-icon icon="mdi-volume-high" size="small" />
                  <span>Speech</span>
                </span>
                <span v-if="reviewSet.indefinite" class="review-set__meta-item review-set__meta-item--active">
                  <v-icon icon="mdi-infinity" size="small" />
                  <span>Indefinite</span>
                </span>
                <span class="review-set__meta-item">
                  <v-icon icon="mdi-sort-variant" size="small" />
                  <span>{{ reviewSortTitle(reviewSet.sortMode) }}</span>
                </span>
                <span class="review-set__meta-item">
                  <v-icon icon="mdi-card-multiple-outline" size="small" />
                  <span>{{ reviewSetCardCount(reviewSet) }} cards/session</span>
                </span>
                <span
                  v-for="tag in reviewSet.tags"
                  :key="tag"
                  class="review-set__meta-item"
                >
                  <v-icon icon="mdi-tag-outline" size="small" />
                  <span>{{ tagName(tag) }}</span>
                </span>
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
      <v-btn
        block
        size="large"
        class="mt-4"
        variant="outlined"
        color="secondary"
        prepend-icon="mdi-card-multiple-outline"
        :to="{ name: 'flashcard-cards' }"
      >
        Manage cards
      </v-btn>
    </section>

    <section>
      <div class="section-heading">
        <h2>Recent reviews</h2>
        <span class="text-caption muted">{{ recentReviewsForWeek.length }}</span>
      </div>
      <WeekNavigator v-model="recentWeekStart" class="mb-3" />
      <transition name="review-history-content" mode="out-in">
        <v-card
          v-if="recentReviewsForWeek.length"
          :key="recentWeekStart.toISOString()"
          class="surface-card pa-2"
        >
          <section
            v-for="(group, groupIndex) in recentReviewGroups"
            :key="group.key"
            class="recent-review-group"
          >
            <v-divider v-if="groupIndex" />
            <div class="recent-review-group__heading px-4 pt-3 pb-1">
              <h3>{{ group.label }}</h3>
              <span>{{ group.sessions.length }}</span>
            </div>
            <v-list bg-color="transparent">
              <v-list-item
                v-for="session in group.sessions"
                :key="session.id"
                class="recent-review-item"
                :title="session.name"
              >
                <template #prepend>
                  <v-icon
                    :icon="session.status === 'completed' ? 'mdi-check-circle-outline' : 'mdi-stop-circle-outline'"
                    :color="recentReviewColor(session)"
                  />
                </template>
                <span class="recent-review-meta">
                  {{ format(new Date(session.startedAt), 'h:mm a') }} · {{ session.mode === 'passive' ? 'Passive' : 'Manual' }}
                </span>
                <div class="recent-review-progress">
                  <v-progress-linear
                    :model-value="flashcardReviewProgressPercent(session)"
                    :color="recentReviewColor(session)"
                    bg-color="surface-variant"
                    height="4"
                    rounded
                    :aria-label="`${session.name}: ${flashcardReviewProgressPercent(session)}% accomplished`"
                  />
                </div>
                <div class="recent-review-stats">
                  <span v-if="session.mode === 'passive'">{{ session.viewedCount }} viewed</span>
                  <template v-else>
                    <span>{{ session.successCount }} success</span>
                    <span>{{ session.errorCount }} error</span>
                  </template>
                  <span v-if="sessionAccuracy(session) !== undefined">{{ sessionAccuracy(session) }}% accuracy</span>
                  <span v-if="session.ejectedCount">{{ session.ejectedCount }} ejected</span>
                </div>
                <template #append>
                  <strong class="recent-review-time text-caption">{{ formatReviewDuration(session.elapsedSeconds) }}</strong>
                </template>
              </v-list-item>
            </v-list>
          </section>
        </v-card>
        <v-card
          v-else-if="store.loaded"
          :key="`empty-${recentWeekStart.toISOString()}`"
          class="surface-card pa-7 text-center"
        >
          <p class="text-body-2 muted">
            {{ recentWeekIsCurrent ? 'Finished reviews will appear here.' : 'No finished reviews this week.' }}
          </p>
        </v-card>
      </transition>
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

  </main>
</template>

<style scoped>
.review-set-list { display: grid; gap: .75rem; }
.review-set { overflow: hidden; cursor: pointer; }
.review-set:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.review-set__main { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) 1.5rem; align-items: center; gap: .85rem; }
.review-set__meta { display: flex; flex-wrap: wrap; gap: .35rem .75rem; color: rgba(var(--v-theme-on-surface), .6); font-size: .7rem; font-weight: 800; line-height: 1.35; }
.review-set__meta-item { display: inline-flex; min-width: 0; align-items: center; gap: .25rem; }
.review-set__meta-item :deep(.v-icon) { flex: 0 0 auto; opacity: .8; }
.review-set__meta-item--active { color: rgb(var(--v-theme-secondary)); }
.review-history-content-enter-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.review-history-content-enter-from { opacity: 0; transform: translateY(.75rem); }
.recent-review-group__heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.recent-review-group__heading h3 { font-size: .75rem; font-weight: 900; letter-spacing: .04em; }
.recent-review-group__heading span { color: rgba(var(--v-theme-on-surface), .54); font-size: .68rem; font-weight: 800; }
.recent-review-meta { display: block; margin-top: .25rem; overflow: hidden; color: rgba(var(--v-theme-on-surface), .62); font-size: .875rem; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.recent-review-progress { margin-top: .45rem; }
.recent-review-stats { display: flex; flex-wrap: wrap; gap: .3rem .65rem; margin-top: .45rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .7rem; }
.recent-review-time { display: block; width: 3.5rem; font-variant-numeric: tabular-nums; text-align: end; }
.active-review { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.active-review > div { display: flex; flex-direction: column; }
.active-review__label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-review__name { font-size: 1.35rem; }
@media (max-width: 59.9375rem) {
  .flashcards-page--active { padding-bottom: calc(7rem + var(--page-safe-area-bottom)); }
  .active-review { position: fixed; z-index: 20; right: 0; bottom: calc(4.5rem + env(safe-area-inset-bottom)); left: 0; border-radius: 0 !important; box-shadow: 0 -.75rem 1.875rem rgba(0, 0, 0, .28) !important; }
}
</style>
