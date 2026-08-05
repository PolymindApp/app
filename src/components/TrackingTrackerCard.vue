<script setup lang="ts">
import { format } from 'date-fns'
import { Ripple } from 'vuetify/directives'
import TrackingRatingValue from '@/components/TrackingRatingValue.vue'
import { formatTrackingValue } from '@/services/tracking'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

defineProps<{
  tracker: TrackingTracker
  entries: TrackingEntry[]
}>()

const emit = defineEmits<{
  actions: [tracker: TrackingTracker]
  entry: [entry: TrackingEntry]
}>()
const vRipple = Ripple
</script>

<template>
  <v-card class="tracker-card surface-card">
    <div class="tracker-card__accent" :style="{ background: tracker.color }" />
    <div
      v-ripple
      class="tracker-card__header"
      role="button"
      tabindex="0"
      :aria-label="`Open ${tracker.name} actions`"
      @click="emit('actions', tracker)"
      @keydown.enter="emit('actions', tracker)"
      @keydown.space.prevent="emit('actions', tracker)"
    >
      <div class="tracker-card__icon" :style="{ color: tracker.color }">
        <v-icon :icon="tracker.icon" />
      </div>
      <div class="min-width-0 flex-grow-1">
        <strong class="d-block text-truncate">{{ tracker.name }}</strong>
        <p class="tracker-card__description">
          {{ tracker.description || 'No description added.' }}
        </p>
      </div>
    </div>

    <div v-if="entries.length" class="tracker-entry-list" :aria-label="`${tracker.name} logs`">
      <button
        v-for="entry in entries"
        :key="entry.id"
        v-ripple
        type="button"
        class="tracker-entry"
        :aria-label="`Edit ${tracker.name} log from ${format(new Date(entry.occurredAt), 'h:mm a')}`"
        @touchstart.stop
        @click.stop="emit('entry', entry)"
      >
        <span class="tracker-entry__time">{{ format(new Date(entry.occurredAt), 'h:mm a') }}</span>
        <TrackingRatingValue
          v-if="tracker.kind === 'rating'"
          :value="entry.value"
          :max="tracker.scaleMax"
          :color="tracker.color"
          :label="tracker.name"
        />
        <strong v-else class="tracker-entry__value">
          {{ formatTrackingValue(tracker, entry.value) }}
        </strong>
        <span v-if="entry.note" class="tracker-entry__note">{{ entry.note }}</span>
      </button>
    </div>
  </v-card>
</template>

<style scoped>
.tracker-card {
  position: relative;
  overflow: hidden;
}

.tracker-card__accent {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  left: 0;
  width: 4px;
}

.tracker-card__header {
  position: relative;
  display: flex;
  overflow: hidden;
  min-height: 4.375rem;
  align-items: center;
  gap: .85rem;
  padding: 1rem 1rem 1rem 1.2rem;
  border-radius: .75rem;
  cursor: pointer;
}

.tracker-card__header:focus-visible,
.tracker-entry:focus-visible {
  outline: .125rem solid rgba(var(--v-theme-secondary), .72);
  outline-offset: -.1875rem;
}

.tracker-card__icon {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 12px;
  background: currentColor;
}

.tracker-card__icon :deep(.v-icon) {
  color: rgb(var(--v-theme-background));
}

.tracker-card__description {
  margin-top: .2rem;
  color: rgba(var(--v-theme-on-surface), .58);
  font-size: .72rem;
  line-height: 1.45;
}

.tracker-entry-list {
  display: grid;
  gap: .25rem;
  padding: .35rem .55rem .55rem .75rem;
  border-top: 1px solid rgb(var(--v-theme-on-surface) / .08);
}

.tracker-entry {
  position: relative;
  display: grid;
  overflow: hidden;
  width: 100%;
  min-height: 2.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: .2rem .75rem;
  padding: .5rem .65rem;
  border: 0;
  border-radius: .75rem;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tracker-entry:active {
  background: rgb(var(--v-theme-on-surface) / .06);
}

.tracker-entry__time {
  color: rgb(var(--v-theme-on-surface) / .72);
  font-size: .72rem;
  font-weight: 850;
}

.tracker-entry__note {
  grid-column: 1 / -1;
  min-width: 0;
  color: rgb(var(--v-theme-on-surface) / .5);
  font-size: .7rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.tracker-entry__value {
  color: rgb(var(--v-theme-on-surface));
  font-size: .75rem;
  white-space: nowrap;
}

.min-width-0 {
  min-width: 0;
}
</style>
