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
  log: [tracker: TrackingTracker]
  actions: [tracker: TrackingTracker]
  entry: [entry: TrackingEntry]
}>()
const vRipple = Ripple
</script>

<template>
  <v-card class="tracker-card surface-card">
    <div class="tracker-card__accent" :style="{ background: tracker.color }" />
    <div class="tracker-card__header">
      <button
        v-ripple
        type="button"
        class="tracker-card__log"
        :aria-label="`Log ${tracker.name}`"
        @click="emit('log', tracker)"
      >
        <span class="tracker-card__icon" :style="{ color: tracker.color }">
          <v-icon :icon="tracker.icon" />
        </span>
        <span class="min-width-0 flex-grow-1">
          <strong class="d-block text-truncate">{{ tracker.name }}</strong>
          <span class="tracker-card__description">
            {{ tracker.description || 'No description added.' }}
          </span>
        </span>
      </button>
      <v-btn
        icon="mdi-dots-horizontal"
        variant="text"
        size="small"
        class="tracker-card__menu"
        :aria-label="`Open ${tracker.name} actions`"
        @touchstart.stop
        @click.stop="emit('actions', tracker)"
      />
    </div>

    <template v-if="entries.length">
      <v-divider />
      <div class="tracker-entry-list" :aria-label="`${tracker.name} logs`">
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
    </template>
    <div v-else-if="tracker.kind === 'event'" class="tracker-event-absence">
      <v-icon icon="mdi-minus-circle-outline" size="17" />
      <span>Not occurred</span>
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
  border-radius: .75rem;
}

.tracker-card__log {
  display: flex;
  overflow: hidden;
  min-width: 0;
  min-height: 4.375rem;
  flex: 1 1 auto;
  align-items: center;
  gap: .85rem;
  padding: 1rem .35rem 1rem 1.2rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tracker-card__log:focus-visible,
.tracker-card__menu:focus-visible,
.tracker-entry:focus-visible {
  outline: .125rem solid rgba(var(--v-theme-secondary), .72);
  outline-offset: -.1875rem;
}

.tracker-card__menu {
  width: 2.75rem;
  min-width: 2.75rem;
  height: 2.75rem;
  margin-right: .5rem;
  flex: 0 0 auto;
  color: rgba(var(--v-theme-on-surface), .72);
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
  display: block;
  margin-top: .2rem;
  color: rgba(var(--v-theme-on-surface), .58);
  font-size: .72rem;
  line-height: 1.45;
}

.tracker-entry-list {
  display: grid;
  gap: .25rem;
  padding: .35rem .55rem .55rem .75rem;
}

.tracker-event-absence {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  gap: .5rem;
  padding: .65rem 1.2rem;
  border-top: 1px solid rgb(var(--v-theme-on-surface) / .08);
  color: rgb(var(--v-theme-on-surface) / .52);
  font-size: .72rem;
  font-weight: 800;
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
