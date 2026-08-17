<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { format, isSameWeek, startOfWeek } from 'date-fns'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import WeekNavigator from '@/components/WeekNavigator.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { flashcardReviewHistoryItems } from '@/services/flashcardHistory'
import { formatReviewDuration, reviewSetCardCount, reviewSortTitle } from '@/services/flashcards'
import { FLASHCARD_REVIEW_SET_ACTIONS } from '@/services/flashcardReviewSetActions'
import { groupSessionsByDate } from '@/services/sessionHistory'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import type {
  FlashcardReviewHistoryItem,
  FlashcardReviewSet,
  FlashcardReviewSetAction,
} from '@/types/domain'

const router = useRouter()
const store = useFlashcardStore()
const intervalStore = useIntervalStore()
const startError = ref('')
const reviewSetActionsOpen = ref(false)
const selectedReviewSet = ref<FlashcardReviewSet>()
const copyDialog = ref(false)
const leaveDialog = ref(false)
const working = ref(false)
const reorderingReviewSets = ref(false)
const notice = ref('')
const recentWeekStart = ref(startOfWeek(new Date(), { weekStartsOn: 1 }))
const expandedRecentReviewDays = ref(new Set([format(new Date(), 'yyyy-MM-dd')]))
const ownedReviewSets = computed(() => store.reviewSets.filter(set => set.accessRole === 'owner'))
const sharedReviewSets = computed(() => store.reviewSets.filter(set => set.accessRole !== 'owner'))
const selectedActions = computed(() => selectedReviewSet.value
  ? FLASHCARD_REVIEW_SET_ACTIONS[selectedReviewSet.value.accessRole]
      .filter(item => item.action !== 'review')
  : [])

const reviewHistory = computed(() => flashcardReviewHistoryItems(store.sessions, intervalStore.sessions))
const recentReviewsForWeek = computed(() => reviewHistory.value.filter(session =>
  isSameWeek(new Date(session.startedAt), recentWeekStart.value, { weekStartsOn: 1 }),
))
const recentReviewGroups = computed(() => groupSessionsByDate(recentReviewsForWeek.value))
const recentWeekIsCurrent = computed(() =>
  isSameWeek(recentWeekStart.value, new Date(), { weekStartsOn: 1 }),
)

onMounted(() => {
  Promise.all([
    store.load(),
    intervalStore.load({ reconcileActiveSession: false }),
  ]).catch(() => undefined)
})

function tagName(reviewSet: FlashcardReviewSet, id: string) {
  return reviewSet.tagDetails.find(tag => tag.id === id)?.name
    || store.tags.find(tag => tag.id === id)?.name
    || 'Removed tag'
}

function recentReviewColor(session: FlashcardReviewHistoryItem) {
  return session.status === 'completed' ? 'success' : 'warning'
}

function isRecentReviewDayExpanded(dayKey: string) {
  return expandedRecentReviewDays.value.has(dayKey)
}

function toggleRecentReviewDay(dayKey: string) {
  const nextExpandedDays = new Set(expandedRecentReviewDays.value)
  if (nextExpandedDays.has(dayKey)) nextExpandedDays.delete(dayKey)
  else nextExpandedDays.add(dayKey)
  expandedRecentReviewDays.value = nextExpandedDays
}

function openReviewSetActions(reviewSet: FlashcardReviewSet) {
  selectedReviewSet.value = reviewSet
  reviewSetActionsOpen.value = true
}

async function runReviewSetAction(action: FlashcardReviewSetAction) {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet) return
  reviewSetActionsOpen.value = false
  if (action === 'review') return openReviewSet(reviewSet)
  if (action === 'edit' || action === 'settings') {
    return router.push({ name: 'flashcard-review-set-edit', params: { id: reviewSet.id } })
  }
  if (action === 'cards') {
    return router.push({ name: 'flashcard-review-set-cards', params: { id: reviewSet.id } })
  }
  if (action === 'share') {
    return router.push({ name: 'flashcard-review-set-share', params: { id: reviewSet.id } })
  }
  if (action === 'copy') copyDialog.value = true
  else if (action === 'leave') leaveDialog.value = true
}

async function copySelectedSet() {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet) return
  working.value = true
  startError.value = ''
  try {
    const copied = await store.copyReviewSet(reviewSet.id)
    notice.value = `${copied.name} was added to your Review sets.`
    copyDialog.value = false
  } catch (cause) {
    startError.value = cause instanceof Error ? cause.message : 'Could not copy this Review set.'
    copyDialog.value = false
  } finally {
    working.value = false
  }
}

async function leaveSelectedSet() {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet?.shareId) return
  working.value = true
  startError.value = ''
  try {
    await store.removeReviewSetShare(reviewSet.shareId, reviewSet.id)
    leaveDialog.value = false
    selectedReviewSet.value = undefined
  } catch (cause) {
    startError.value = cause instanceof Error ? cause.message : 'Could not leave this Review set.'
    leaveDialog.value = false
  } finally {
    working.value = false
  }
}

async function openReviewSet(reviewSet: FlashcardReviewSet) {
  startError.value = ''
  try {
    const active = store.activeSession
    if (active) {
      await router.push({
        name: 'flashcard-review-runner',
        params: { sessionId: active.id },
        query: { autoplay: '1' },
      })
      return
    }
    await router.push({
      name: 'flashcard-review-set-runner',
      params: { reviewSetId: reviewSet.id },
    })
  } catch (cause) {
    startError.value = cause instanceof Error ? cause.message : 'Could not open this review.'
  }
}

async function reorderReviewSets(result: LongPressDragResult) {
  const reviewSetsById = new Map(
    ownedReviewSets.value.map(reviewSet => [reviewSet.id, reviewSet]),
  )
  const ordered = result.orderedIds
    .map(id => reviewSetsById.get(id))
    .filter((reviewSet): reviewSet is FlashcardReviewSet => Boolean(reviewSet))
  if (ordered.length !== ownedReviewSets.value.length) return

  reorderingReviewSets.value = true
  try {
    await store.reorderReviewSets(ordered)
  } catch {
    // The store restores the previous order and exposes the save error.
  } finally {
    reorderingReviewSets.value = false
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
    <v-alert v-if="notice" type="success" variant="tonal" closable class="mb-4" @click:close="notice = ''">
      {{ notice }}
    </v-alert>

    <div class="flashcards-action-stack page-action-area page-action-area--route-slide">
      <section class="card-library-action-bar">
        <div
          class="card-library-summary"
          aria-labelledby="card-library-summary-title"
        >
          <div class="card-library-summary__details">
            <div class="card-library-summary__icon" aria-hidden="true">
              <v-icon icon="mdi-card-multiple-outline" size="28" />
            </div>
            <div>
              <h2 id="card-library-summary-title">Card library</h2>
              <p class="card-library-summary__stat">
                <strong>{{ store.cards.length }}</strong>
                <span>{{ store.cards.length === 1 ? 'card' : 'cards' }}</span>
              </p>
            </div>
          </div>
          <div class="card-library-summary__actions">
            <v-btn
              color="secondary"
              prepend-icon="mdi-card-plus-outline"
              :to="{ name: 'flashcard-new' }"
            >
              Add new
            </v-btn>
            <v-btn
              variant="tonal"
              prepend-icon="mdi-card-multiple-outline"
              :to="{ name: 'flashcard-cards' }"
            >
              Manage
            </v-btn>
          </div>
        </div>
      </section>

      <v-card
        v-if="store.activeSession"
        class="active-review pa-5"
        color="secondary"
      >
        <div class="active-review__inner">
          <div class="min-width-0">
            <span class="active-review__label">{{ store.activeSession.status === 'paused' ? 'Paused' : 'In progress' }}</span>
            <strong class="active-review__name text-truncate">{{ store.activeSession.name }}</strong>
          </div>
          <v-btn
            color="primary"
            size="large"
            append-icon="mdi-arrow-right"
            :to="{
              name: 'flashcard-review-runner',
              params: { sessionId: store.activeSession.id },
              query: { autoplay: '1' },
            }"
          >
            Resume
          </v-btn>
        </div>
      </v-card>
    </div>

        <section>
      <div class="section-heading mt-0">
        <h2>Your Review sets</h2>
        <v-btn
          size="small"
          variant="text"
          prepend-icon="mdi-plus"
          :to="{ name: 'flashcard-review-set-new' }"
        >
          New
        </v-btn>
      </div>

      <div v-if="ownedReviewSets.length" class="review-set-list">
        <v-card
          v-for="reviewSet in ownedReviewSets"
          :key="reviewSet.id"
          v-long-press-drag="{
            id: reviewSet.id,
            group: 'owned-review-sets',
            disabled: ownedReviewSets.length < 2 || reorderingReviewSets,
            onDrop: reorderReviewSets,
          }"
          ripple
          class="review-set surface-card pa-4"
          role="button"
          tabindex="0"
          :aria-label="`Review ${reviewSet.name}`"
          @click="openReviewSet(reviewSet)"
          @keydown.enter="openReviewSet(reviewSet)"
          @keydown.space.prevent="openReviewSet(reviewSet)"
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
                  <span>{{ tagName(reviewSet, tag) }}</span>
                </span>
              </div>
            </div>
            <div
              class="review-set__actions"
              @pointerdown.stop
              @pointerup.stop
              @touchstart.stop
              @click.stop
              @keydown.stop
            >
              <v-btn
                class="review-set__menu-button"
                icon="mdi-dots-horizontal"
                variant="text"
                size="small"
                :aria-label="`More actions for ${reviewSet.name}`"
                @click="openReviewSetActions(reviewSet)"
              />
            </div>
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

        <section v-if="sharedReviewSets.length">
      <div class="section-heading">
        <h2>Shared with you</h2>
        <span class="text-caption muted">{{ sharedReviewSets.length }}</span>
      </div>
      <div class="review-set-list">
        <v-card
          v-for="reviewSet in sharedReviewSets"
          :key="reviewSet.id"
          ripple
          class="review-set surface-card pa-4"
          role="button"
          tabindex="0"
          :aria-label="`Review ${reviewSet.name}`"
          @click="openReviewSet(reviewSet)"
          @keydown.enter="openReviewSet(reviewSet)"
          @keydown.space.prevent="openReviewSet(reviewSet)"
        >
          <div class="review-set__main">
            <div class="min-width-0">
              <div class="shared-review-set__heading">
                <h3 class="text-body-1 font-weight-black text-truncate">{{ reviewSet.name }}</h3>
                <v-chip size="x-small" :color="reviewSet.accessRole === 'editor' ? 'secondary' : undefined">
                  {{ reviewSet.accessRole === 'editor' ? 'Editor' : 'Read only' }}
                </v-chip>
              </div>
              <p class="shared-review-set__owner mt-1">
                <v-icon icon="mdi-account-outline" size="x-small" />
                Shared by {{ reviewSet.ownerName || 'another account' }}
              </p>
              <div class="review-set__meta mt-2">
                <span v-if="!reviewSet.tags.length" class="review-set__meta-item">
                  <v-icon icon="mdi-cards-outline" size="small" />
                  <span>All owner cards</span>
                </span>
                <span class="review-set__meta-item">
                  <v-icon :icon="reviewSet.mode === 'passive' ? 'mdi-play-speed' : 'mdi-gesture-tap'" size="small" />
                  <span>{{ reviewSet.mode === 'passive' ? 'Passive' : 'Manual' }}</span>
                </span>
                <span class="review-set__meta-item">
                  <v-icon icon="mdi-card-multiple-outline" size="small" />
                  <span>{{ reviewSetCardCount(reviewSet) }} cards/session</span>
                </span>
                <span v-for="tag in reviewSet.tags" :key="tag" class="review-set__meta-item">
                  <v-icon icon="mdi-tag-outline" size="small" />
                  <span>{{ tagName(reviewSet, tag) }}</span>
                </span>
              </div>
            </div>
            <div
              class="review-set__actions"
              @pointerdown.stop
              @pointerup.stop
              @touchstart.stop
              @click.stop
              @keydown.stop
            >
              <v-btn
                class="review-set__menu-button"
                icon="mdi-dots-horizontal"
                variant="text"
                size="small"
                :aria-label="`More actions for ${reviewSet.name}`"
                @click="openReviewSetActions(reviewSet)"
              />
            </div>
          </div>
        </v-card>
      </div>
        </section>
        <section>
      <div class="section-heading">
        <h2>Recent reviews</h2>
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
            <v-btn
              block
              variant="text"
              class="recent-review-group__heading px-4"
              :aria-expanded="isRecentReviewDayExpanded(group.key)"
              :aria-controls="`recent-reviews-${group.key}`"
              @click="toggleRecentReviewDay(group.key)"
            >
              <h3>{{ group.label }}</h3>
              <span class="recent-review-group__count">{{ group.sessions.length }}</span>
              <v-icon
                :icon="isRecentReviewDayExpanded(group.key) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                size="small"
              />
            </v-btn>
            <v-expand-transition>
              <div
                v-show="isRecentReviewDayExpanded(group.key)"
                :id="`recent-reviews-${group.key}`"
              >
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
                      {{ format(new Date(session.startedAt), 'h:mm a') }} · {{ session.sourceLabel }}
                    </span>
                    <div class="recent-review-progress">
                      <v-progress-linear
                        :model-value="session.progressPercent"
                        :color="recentReviewColor(session)"
                        bg-color="white"
                        :bg-opacity="0.14"
                        height="4"
                        rounded
                        :aria-label="`${session.name}: ${session.progressPercent}% accomplished`"
                      />
                    </div>
                    <div v-if="session.source === 'flashcards'" class="recent-review-stats">
                      <span v-if="session.sourceLabel === 'Passive'">{{ session.viewedCount }} viewed</span>
                      <template v-else>
                        <span>{{ session.successCount }} success</span>
                        <span>{{ session.errorCount }} error</span>
                      </template>
                      <span v-if="session.accuracy !== undefined">{{ session.accuracy }}% accuracy</span>
                      <span v-if="session.ejectedCount">{{ session.ejectedCount }} ejected</span>
                    </div>
                    <template #append>
                      <strong class="recent-review-time text-caption">{{ formatReviewDuration(session.elapsedSeconds) }}</strong>
                    </template>
                  </v-list-item>
                </v-list>
              </div>
            </v-expand-transition>
          </section>
        </v-card>
        <v-card
          v-else-if="store.loaded && intervalStore.loaded"
          :key="`empty-${recentWeekStart.toISOString()}`"
          class="surface-card pa-7 text-center"
        >
          <p class="text-body-2 muted">
            {{ recentWeekIsCurrent ? 'Finished reviews will appear here.' : 'No finished reviews this week.' }}
          </p>
        </v-card>
      </transition>
        </section>

    <ActionBottomSheet
      v-model="reviewSetActionsOpen"
      :title="selectedReviewSet?.name || 'Review set actions'"
      hide-title
      :aria-label="selectedReviewSet ? `${selectedReviewSet.name} management actions` : 'Review set actions'"
    >
      <template v-if="selectedReviewSet">
        <template v-for="item in selectedActions" :key="item.action">
          <v-divider v-if="item.divider" class="my-1" />
          <v-list-item
            :prepend-icon="item.icon"
            :title="item.title"
            :base-color="item.color"
            rounded="lg"
            :disabled="working"
            @click="runReviewSetAction(item.action)"
          />
        </template>
      </template>
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="copyDialog"
      title="Make an independent copy?"
      :message="`All ${selectedReviewSet?.matchingCardCount || 0} currently matching cards and your review settings will be copied. The live shared set will remain available.`"
      confirm-text="Make a copy"
      confirm-color="secondary"
      icon="mdi-content-copy"
      :loading="working"
      @confirm="copySelectedSet"
    />

    <ConfirmDialog
      v-model="leaveDialog"
      title="Leave this shared Review set?"
      message="It will be detached from your tasks and intervals. Your completed review history will stay."
      confirm-text="Leave shared set"
      icon="mdi-exit-to-app"
      :loading="working"
      @confirm="leaveSelectedSet"
    />

  </main>
</template>

<style scoped>
.flashcards-page:not(.flashcards-page--active) { padding-bottom: calc(8.5rem + var(--page-safe-area-bottom)); }
.flashcards-page--active { padding-bottom: calc(13rem + var(--page-safe-area-bottom)); }
.flashcards-action-stack { position: fixed; z-index: 20; right: 0; bottom: calc(4.5rem + env(safe-area-inset-bottom)); left: 0; display: flex; flex-direction: column; }
.card-library-action-bar { padding: .75rem 1rem; border-top: .0625rem solid rgba(var(--v-theme-on-surface), .08); background: rgb(var(--v-theme-background)); }
.card-library-summary { display: flex; width: 100%; max-width: 868px; margin: 0 auto; align-items: center; justify-content: space-between; gap: 1.5rem; background: transparent !important; }
.card-library-summary__details { display: flex; min-width: 0; align-items: center; gap: 1rem; }
.card-library-summary__icon { display: grid; width: 3.25rem; height: 3.25rem; flex: 0 0 auto; place-items: center; border-radius: 1rem; background: rgba(var(--v-theme-secondary), .14); color: rgb(var(--v-theme-secondary)); }
.card-library-summary h2 { font-size: .82rem; font-weight: 900; }
.card-library-summary__stat { display: flex; align-items: baseline; gap: .4rem; margin-top: .15rem; }
.card-library-summary__stat strong { font-family: Impact, "Arial Narrow", sans-serif; font-size: 2rem; letter-spacing: -.03em; line-height: 1; }
.card-library-summary__stat span { color: rgba(var(--v-theme-on-surface), .56); font-size: .72rem; font-weight: 800; }
.card-library-summary__actions { display: grid; width: 8.5rem; flex: 0 0 8.5rem; grid-template-columns: minmax(0, 1fr); gap: .5rem; }
.card-library-summary__actions :deep(.v-btn) { width: 100%; }
.review-set-list { display: grid; gap: .75rem; }
.review-set { overflow: hidden; cursor: pointer; }
.review-set:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: .1875rem; }
.review-set__main { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) 2.75rem; align-items: center; gap: .85rem; }
.review-set__actions { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; }
.review-set__menu-button { width: 2.75rem; height: 2.75rem; }
.review-set__meta { display: flex; flex-wrap: wrap; gap: .35rem .75rem; color: rgba(var(--v-theme-on-surface), .6); font-size: .7rem; font-weight: 800; line-height: 1.35; }
.review-set__meta-item { display: inline-flex; min-width: 0; align-items: center; gap: .25rem; }
.review-set__meta-item :deep(.v-icon) { flex: 0 0 auto; opacity: .8; }
.review-set__meta-item--active { color: rgb(var(--v-theme-secondary)); }
.shared-review-set__heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: .75rem; }
.shared-review-set__heading h3 { min-width: 0; }
.shared-review-set__owner { display: flex; align-items: center; gap: .25rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; font-weight: 800; }
.review-history-content-enter-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.review-history-content-enter-from { opacity: 0; transform: translateY(.75rem); }
.recent-review-group__heading { min-height: 2.75rem; }
.recent-review-group__heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.recent-review-group__heading h3 { font-size: .75rem; font-weight: 900; letter-spacing: .04em; }
.recent-review-group__count { margin-left: auto; color: rgba(var(--v-theme-on-surface), .54); font-size: .68rem; font-weight: 800; }
.recent-review-meta { display: block; margin-top: .25rem; overflow: hidden; color: rgba(var(--v-theme-on-surface), .62); font-size: .875rem; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.recent-review-progress { margin-top: .45rem; }
.recent-review-stats { display: flex; flex-wrap: wrap; gap: .3rem .65rem; margin-top: .45rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .7rem; }
.recent-review-time { display: block; width: 3.5rem; font-variant-numeric: tabular-nums; text-align: end; }
.active-review { border-radius: 0 !important; color: rgb(var(--v-theme-on-secondary)); box-shadow: 0 -.75rem 1.875rem rgba(0, 0, 0, .28) !important; }
.active-review__inner { display: flex; width: 100%; max-width: 54.25rem; margin: 0 auto; align-items: center; justify-content: space-between; gap: 1rem; }
.active-review__inner > div { display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; }
.active-review__label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-review__name { width: 100%; font-size: 1.35rem; }
@media (min-width: 60rem) {
  .flashcards-page:not(.flashcards-page--active) { padding-bottom: calc(7rem + var(--page-safe-area-bottom)); }
  .flashcards-page--active { padding-bottom: calc(13.5rem + var(--page-safe-area-bottom)); }
  .flashcards-action-stack { bottom: 0; left: 17rem; }
}
</style>
