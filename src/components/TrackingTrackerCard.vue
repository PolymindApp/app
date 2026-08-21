<script setup lang="ts">
import { Ripple } from 'vuetify/directives'
import type { TrackingEntry, TrackingTracker } from '@/types/domain'

defineProps<{
  tracker: TrackingTracker
  entries: TrackingEntry[]
}>()

const emit = defineEmits<{
  log: [tracker: TrackingTracker]
  actions: [tracker: TrackingTracker]
}>()
const vRipple = Ripple
</script>

<template>
  <v-card class="tracker-card surface-card" :class="{ 'tracker-card--paused': !tracker.active }">
    <div class="tracker-card__accent" :style="{ background: tracker.color }" />
    <div class="tracker-card__header">
      <button
        v-ripple
        type="button"
        class="tracker-card__log"
        :disabled="!tracker.active"
        :aria-label="tracker.active ? `Log ${tracker.name}` : `${tracker.name} is paused`"
        @click="emit('log', tracker)"
      >
        <span class="tracker-card__icon" :style="tracker.active ? { color: tracker.color } : undefined">
          <v-icon :icon="tracker.active ? tracker.icon : 'mdi-pause'" />
        </span>
        <span class="min-width-0 flex-grow-1">
          <strong class="d-block text-truncate">{{ tracker.name }}</strong>
          <v-expand-transition>
            <span v-if="!tracker.active" class="tracker-card__status-expand">
              <span class="tracker-card__status">Paused</span>
            </span>
          </v-expand-transition>
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

    <div v-if="tracker.active && tracker.kind === 'event' && !entries.length" class="tracker-event-absence">
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
.tracker-card__menu:focus-visible {
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

.tracker-card--paused .tracker-card__icon {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: .875rem;
  background: rgba(var(--v-theme-on-surface), .14);
}

.tracker-card--paused .tracker-card__icon :deep(.v-icon) {
  color: rgb(var(--v-theme-on-surface));
}

.tracker-card__status {
  display: table;
  max-width: 8rem;
  overflow: hidden;
  margin-top: .2rem;
  padding: .1875rem .4375rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: .57rem;
  font-weight: 850;
  letter-spacing: .07em;
  line-height: 1.2;
  text-transform: uppercase;
  white-space: nowrap;
}

.tracker-card__status-expand {
  display: block;
}

.tracker-card--paused .tracker-card__log {
  cursor: default;
}

.tracker-card__description {
  display: block;
  margin-top: .2rem;
  color: rgba(var(--v-theme-on-surface), .58);
  font-size: .72rem;
  line-height: 1.45;
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

.min-width-0 {
  min-width: 0;
}
</style>
