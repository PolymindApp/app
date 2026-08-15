<script setup lang="ts">
withDefaults(defineProps<{
  chartOnly?: boolean
  compact?: boolean
}>(), {
  chartOnly: false,
  compact: false,
})
</script>

<template>
  <v-skeleton-loader
    :type="chartOnly ? 'image' : 'image, text@2'"
    color="transparent"
    loading-text="Loading chart"
    :class="['tracking-chart-skeleton', { 'tracking-chart-skeleton--compact': compact }]"
  />
</template>

<style scoped>
.tracking-chart-skeleton { background: transparent; }
.tracking-chart-skeleton :deep(.v-skeleton-loader__image) { height: 18rem; border-radius: .75rem; }
.tracking-chart-skeleton--compact :deep(.v-skeleton-loader__image) { height: 7.8125rem; }
.tracking-chart-skeleton :deep(.v-skeleton-loader__text) { margin-inline: 0; }

@media (prefers-reduced-motion: reduce) {
  .tracking-chart-skeleton :deep(.v-skeleton-loader__bone::after) { animation: none; }
}
</style>
