<script setup lang="ts">
import { computed } from 'vue'
import { reviewSortTitle } from '@/services/flashcards'
import type { FlashcardReviewSet } from '@/types/domain'

const props = defineProps<{
  reviewSets: FlashcardReviewSet[]
  allowCreate?: boolean
}>()

const model = defineModel<string | undefined>({ default: undefined })

const reviewSetItems = computed(() => props.reviewSets.map(reviewSet => {
  const cardCount = reviewSet.matchingCardCount
  return {
    title: reviewSet.name,
    value: reviewSet.id,
    subtitle: `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`,
    props: { disabled: cardCount === 0 },
  }
}))
const selectedReviewSet = computed(() => props.reviewSets.find(
  reviewSet => reviewSet.id === model.value,
))
const selectedReviewCardCount = computed(() => selectedReviewSet.value?.matchingCardCount || 0)
const selectedReviewTiming = computed(() => {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet || reviewSet.mode !== 'passive') return '5s front · 5s back'
  return `${reviewSet.frontSeconds}s front · ${reviewSet.backSeconds}s back`
})
</script>

<template>
  <v-card class="surface-card pa-5">
    <div class="review-attachment-heading mb-4">
      <span class="review-attachment-heading__icon">
        <v-icon icon="mdi-cards-outline" size="1.5rem" />
      </span>
      <div class="min-width-0">
        <h2 class="text-body-1 font-weight-black">Review cards</h2>
        <p class="text-caption muted mt-1">Optionally cycle through a Review set throughout this interval.</p>
      </div>
    </div>

    <template v-if="reviewSets.length">
      <v-select
        v-model="model"
        :items="reviewSetItems"
        item-title="title"
        item-value="value"
        label="Review set (optional)"
        prepend-inner-icon="mdi-cards-playing-outline"
        clearable
        autocomplete="off"
        :rules="[
          value => !value || selectedReviewCardCount > 0 || 'Choose a Review set with at least one matching card',
        ]"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item
            v-bind="itemProps"
            prepend-icon="mdi-cards-outline"
            :title="item.raw.title"
            :subtitle="item.raw.subtitle"
          />
        </template>
      </v-select>

      <v-expand-transition>
        <div v-if="selectedReviewSet">
          <div class="review-attachment-summary mt-4">
            <div class="review-attachment-summary__chips">
              <v-chip size="small" variant="tonal" prepend-icon="mdi-infinity">Repeating passive</v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-cards-outline">
                {{ selectedReviewCardCount }} {{ selectedReviewCardCount === 1 ? 'card' : 'cards' }}
              </v-chip>
              <v-chip size="small" variant="tonal" prepend-icon="mdi-timer-outline">{{ selectedReviewTiming }}</v-chip>
              <v-chip
                v-if="selectedReviewSet.speechEnabled"
                size="small"
                variant="tonal"
                prepend-icon="mdi-account-voice"
              >
                Read aloud
              </v-chip>
            </div>
            <p class="text-caption muted mt-3">
              {{ reviewSortTitle(selectedReviewSet.sortMode) }} order.
              {{ selectedReviewSet.mode === 'manual'
                ? 'This Manual set will use 5 seconds for the front and 5 seconds for the back.'
                : 'Its Passive timing will be used.' }}
            </p>
          </div>
        </div>
      </v-expand-transition>
    </template>

    <div v-else class="review-attachment-empty">
      <p class="text-body-2 muted">Create a Review set before attaching cards to an interval.</p>
      <v-btn
        v-if="allowCreate"
        variant="tonal"
        color="secondary"
        prepend-icon="mdi-plus"
        :to="{ name: 'flashcard-review-set-new' }"
      >
        Create Review set
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.review-attachment-heading { display: flex; align-items: center; gap: .75rem; }
.review-attachment-heading__icon { display: grid; width: 2.75rem; height: 2.75rem; flex: 0 0 auto; place-items: center; border-radius: .875rem; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.review-attachment-summary { padding: .875rem; border: .0625rem solid rgb(var(--v-theme-on-surface) / .08); border-radius: 1rem; background: rgb(var(--v-theme-surface-variant) / .32); }
.review-attachment-summary__chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.review-attachment-empty { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }

@media (max-width: 32rem) {
  .review-attachment-empty { align-items: stretch; flex-direction: column; }
}
</style>
