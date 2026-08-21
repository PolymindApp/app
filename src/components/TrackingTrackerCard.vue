<script setup lang="ts">
import { computed } from 'vue'
import { Ripple } from 'vuetify/directives'
import type { TrackingTracker } from '@/types/domain'

const props = defineProps<{
  tracker: TrackingTracker
}>()

const emit = defineEmits<{
  actions: [tracker: TrackingTracker]
}>()
const vRipple = Ripple

const cardInk = computed(() => {
  const hex = props.tracker.color.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return '#17200F'

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 150 ? '#17200F' : '#FFFFFF'
})
</script>

<template>
  <v-card
    class="tracker-card surface-card"
    :class="{ 'tracker-card--paused': !tracker.active }"
    :style="{ '--tracker-color': tracker.color, '--tracker-ink': cardInk }"
  >
    <button
      v-ripple
      type="button"
      class="tracker-card__action"
      :aria-label="`Open ${tracker.name} actions`"
      @click="emit('actions', tracker)"
    >
      <span class="tracker-card__header">
        <v-icon :icon="tracker.icon" size="32" />
      </span>
      <span class="tracker-card__content">
        <strong class="tracker-card__title">{{ tracker.name }}</strong>
        <span
          v-if="!tracker.active"
          class="tracker-card__status"
        >
          Paused
        </span>
      </span>
    </button>
  </v-card>
</template>

<style scoped>
.tracker-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
}

.tracker-card__action {
  display: flex;
  width: 100%;
  min-height: 8.25rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  flex-direction: column;
  font: inherit;
  text-align: center;
  cursor: pointer;
}

.tracker-card__action:focus-visible {
  outline: .125rem solid currentColor;
  outline-offset: -.1875rem;
}

.tracker-card__header {
  position: relative;
  display: grid;
  width: 100%;
  min-height: 5rem;
  place-items: center;
  background: var(--tracker-color);
  color: var(--tracker-ink);
}

.tracker-card--paused .tracker-card__header {
  background: color-mix(in srgb, var(--tracker-color) 28%, rgb(var(--v-theme-surface-variant)));
  color: rgb(var(--v-theme-on-surface) / .62);
}

.tracker-card__content {
  display: flex;
  width: 100%;
  min-height: 3.25rem;
  padding: .7rem .8rem .75rem;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  flex-direction: column;
}

.tracker-card__title {
  display: -webkit-box;
  width: 100%;
  overflow: hidden;
  font-size: .82rem;
  font-weight: 900;
  line-height: 1.2;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.tracker-card__status {
  margin-top: .35rem;
  padding: .18rem .45rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--tracker-color) 18%, transparent);
  color: color-mix(in srgb, var(--tracker-color) 68%, rgb(var(--v-theme-on-surface)));
  font-size: .57rem;
  font-weight: 850;
  letter-spacing: .07em;
  line-height: 1.2;
  text-transform: uppercase;
}

</style>
