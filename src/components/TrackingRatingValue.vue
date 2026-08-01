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

const length = computed(() => Math.max(1, Math.round(props.max)))
const accessibleLabel = computed(() =>
  `${props.label}: ${formatNumber(props.value)} out of ${length.value}`,
)
</script>

<template>
  <v-rating
    class="tracking-rating-value"
    :model-value="value"
    :length="length"
    :active-color="color"
    color="surface-variant"
    density="compact"
    size="x-small"
    half-increments
    readonly
    :aria-label="accessibleLabel"
  />
</template>

<style scoped>
.tracking-rating-value { display: inline-flex; width: max-content; flex: 0 0 auto; }
</style>
