<script setup lang="ts">
import { computed } from 'vue'
import { INTERVAL_TYPE_PRESENTATION } from '@/services/intervalTypes'
import type { IntervalStepKind } from '@/types/domain'

const props = withDefaults(defineProps<{
  kind: IntervalStepKind
  size?: string
  animated?: boolean
}>(), {
  size: '1.25rem',
  animated: false,
})

const presentation = computed(() => INTERVAL_TYPE_PRESENTATION[props.kind])
</script>

<template>
  <span
    class="interval-type-icon"
    :class="animated ? ['interval-type-icon--animated', `interval-type-icon--${presentation.animation}`] : undefined"
    :style="{
      '--interval-type-color': presentation.color,
      '--interval-type-size': size,
    }"
    aria-hidden="true"
  >
    <span class="interval-type-icon__base">
      <v-icon :icon="presentation.icon" />
    </span>
    <span
      v-if="animated && presentation.animation === 'focus'"
      class="interval-type-icon__echo"
    >
      <v-icon :icon="presentation.icon" />
    </span>
  </span>
</template>

<style scoped>
.interval-type-icon {
  display: inline-grid;
  width: var(--interval-type-size);
  height: var(--interval-type-size);
  flex: 0 0 var(--interval-type-size);
  place-items: center;
  color: var(--interval-type-color);
  font-size: var(--interval-type-size);
  line-height: 1;
}

.interval-type-icon__base,
.interval-type-icon__echo {
  display: inline-grid;
  width: 1em;
  height: 1em;
  grid-area: 1 / 1;
  place-items: center;
  transform-origin: center center;
}

.interval-type-icon :deep(.v-icon) {
  width: 1em;
  height: 1em;
  color: inherit;
  font-size: inherit;
}

.interval-type-icon--animated > .interval-type-icon__base,
.interval-type-icon--animated > .interval-type-icon__echo { will-change: transform, opacity; }

.interval-type-icon--pulse > .interval-type-icon__base {
  animation: interval-heart-pulse 1.35s ease-in-out infinite;
}

.interval-type-icon--charge > .interval-type-icon__base {
  animation: interval-charge 1.8s cubic-bezier(.22, 1, .36, 1) infinite;
}

.interval-type-icon--breathe > .interval-type-icon__base {
  animation: interval-breathe 2.8s ease-in-out infinite;
}

.interval-type-icon--turn > .interval-type-icon__base {
  animation: interval-hourglass-turn 3.2s cubic-bezier(.22, 1, .36, 1) infinite;
}

.interval-type-icon--focus > .interval-type-icon__base {
  animation: interval-focus-base 2.4s ease-in-out infinite;
}

.interval-type-icon--focus > .interval-type-icon__echo {
  animation: interval-focus-echo 2.4s cubic-bezier(.22, 1, .36, 1) infinite;
}

.interval-type-icon--confirm > .interval-type-icon__base {
  animation: interval-confirm 2.2s cubic-bezier(.22, 1, .36, 1) infinite;
}

.interval-type-icon--tune > .interval-type-icon__base {
  animation: interval-tune 2.4s ease-in-out infinite;
}

@keyframes interval-heart-pulse {
  0%, 36%, 100% { transform: scale(1); }
  12% { transform: scale(1.18); }
  22% { transform: scale(.98); }
  29% { transform: scale(1.1); }
}

@keyframes interval-charge {
  0%, 60%, 100% { transform: translateY(.08em) scale(.94); opacity: .72; }
  12% { transform: translateY(-.08em) scale(1.14); opacity: 1; filter: drop-shadow(0 0 .22em currentColor); }
  24% { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes interval-breathe {
  0%, 100% { transform: translateY(.04em) scale(.94); opacity: .68; }
  50% { transform: translateY(-.04em) scale(1.04); opacity: 1; }
}

@keyframes interval-hourglass-turn {
  0%, 32% { transform: rotate(0); }
  44%, 76% { transform: rotate(180deg); }
  88%, 100% { transform: rotate(360deg); }
}

@keyframes interval-focus-base {
  0%, 100% { transform: scale(.94); opacity: .8; }
  42%, 58% { transform: scale(1); opacity: 1; }
}

@keyframes interval-focus-echo {
  0% { transform: scale(1.65); opacity: 0; }
  18% { opacity: .36; }
  52% { transform: scale(1); opacity: .58; }
  72%, 100% { transform: scale(1); opacity: 0; }
}

@keyframes interval-confirm {
  0%, 62%, 100% { transform: scale(1) rotate(0); }
  10% { transform: scale(.78) rotate(-8deg); opacity: .7; }
  24% { transform: scale(1.12) rotate(3deg); opacity: 1; }
  34% { transform: scale(1) rotate(0); }
}

@keyframes interval-tune {
  0%, 100% { transform: translateX(-.08em); }
  50% { transform: translateX(.08em); }
}

@media (prefers-reduced-motion: reduce) {
  .interval-type-icon__base,
  .interval-type-icon__echo {
    animation: none !important;
    filter: none !important;
    transform: none !important;
  }

  .interval-type-icon__echo {
    display: none;
  }
}
</style>
