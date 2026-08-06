<script setup lang="ts">
import { computed } from 'vue'
import { formatNumber } from '@/services/tracking'

const props = withDefaults(defineProps<{
  value: number
  max?: number
  color?: string
  label?: string
}>(), {
  max: 5,
  color: 'secondary',
  label: 'Rating',
})

const maximum = computed(() => Math.max(1, props.max))
const progress = computed(() => Math.max(0, Math.min(100, props.value / maximum.value * 100)))
const valueLabel = computed(() => `${formatNumber(props.value)} / ${formatNumber(maximum.value)}`)
const accessibleLabel = computed(() =>
  `${props.label}: ${formatNumber(props.value)} out of ${formatNumber(maximum.value)}`,
)
</script>

<template>
  <div class="tracking-rating-value">
    <v-progress-linear
      :model-value="progress"
      :color="color"
      bg-color="surface-variant"
      :bg-opacity="1"
      :height="7"
      rounded
      :aria-label="accessibleLabel"
      :aria-valuetext="accessibleLabel"
    />
    <span>{{ valueLabel }}</span>
  </div>
</template>

<style scoped>
.tracking-rating-value {
  display: grid;
  width: min(7.5rem, 38vw);
  min-width: 6rem;
  flex: 0 0 auto;
  grid-template-columns: minmax(2.75rem, 1fr) auto;
  align-items: center;
  gap: .45rem;
}

.tracking-rating-value span {
  color: rgb(var(--v-theme-on-surface) / .72);
  font-size: .625rem;
  font-weight: 850;
  white-space: nowrap;
}
</style>
