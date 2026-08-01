<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  min: number
  max: number
  step?: number
  color?: string
  valueLabel?: string | number
  minLabel?: string | number
  maxLabel?: string | number
  ariaLabel?: string
  disabled?: boolean
}>(), {
  step: 1,
  color: 'secondary',
  valueLabel: undefined,
  minLabel: undefined,
  maxLabel: undefined,
  ariaLabel: undefined,
  disabled: false,
})

const model = defineModel<number>({ required: true })
const emit = defineEmits<{
  start: []
  end: []
}>()

const displayedValue = computed(() => props.valueLabel ?? model.value)
const displayedMinimum = computed(() => props.minLabel ?? props.min)
const displayedMaximum = computed(() => props.maxLabel ?? props.max)
</script>

<template>
  <div class="labeled-slider">
    <div class="labeled-slider__heading">
      <span>{{ title }}</span>
      <strong aria-live="polite">{{ displayedValue }}</strong>
    </div>
    <v-slider
      v-model="model"
      :min="min"
      :max="max"
      :step="step"
      :color="color"
      :disabled="disabled"
      :aria-label="ariaLabel || title"
      hide-details
      @start="emit('start')"
      @end="emit('end')"
    />
    <div class="labeled-slider__range" aria-hidden="true">
      <span>{{ displayedMinimum }}</span>
      <span>{{ displayedMaximum }}</span>
    </div>
  </div>
</template>

<style scoped>
.labeled-slider__heading {
  display: flex;
  margin-bottom: .25rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: .75rem;
  font-weight: 800;
}

.labeled-slider__heading strong {
  display: grid;
  min-width: 2rem;
  height: 2rem;
  padding: 0 .5rem;
  place-items: center;
  border-radius: 10px;
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
  font-size: .8rem;
  font-variant-numeric: tabular-nums;
}

.labeled-slider__range {
  display: flex;
  margin-top: -.2rem;
  padding: 0 .5rem;
  justify-content: space-between;
  color: rgb(var(--v-theme-on-surface) / .5);
  font-size: .7rem;
  font-weight: 700;
}
</style>
