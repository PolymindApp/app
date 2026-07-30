<script setup lang="ts">
import { computed } from 'vue'
import { addWeeks, endOfWeek, format, isSameWeek, startOfWeek } from 'date-fns'

const weekStart = defineModel<Date>({ required: true })
const emit = defineEmits<{
  navigate: [direction: 'previous' | 'next']
}>()

const normalizedWeekStart = computed(() =>
  startOfWeek(weekStart.value, { weekStartsOn: 1 }),
)
const weekLabel = computed(() => {
  const start = normalizedWeekStart.value
  const end = endOfWeek(start, { weekStartsOn: 1 })
  return start.getMonth() === end.getMonth()
    ? `${format(start, 'MMM d')} – ${format(end, 'd')}`
    : `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`
})
const isCurrentWeek = computed(() =>
  isSameWeek(normalizedWeekStart.value, new Date(), { weekStartsOn: 1 }),
)

function moveWeek(amount: -1 | 1) {
  emit('navigate', amount < 0 ? 'previous' : 'next')
  weekStart.value = addWeeks(normalizedWeekStart.value, amount)
}

function goToCurrentWeek() {
  const today = new Date()
  emit('navigate', normalizedWeekStart.value > today ? 'previous' : 'next')
  weekStart.value = startOfWeek(today, { weekStartsOn: 1 })
}
</script>

<template>
  <div class="week-navigator">
    <v-btn
      icon="mdi-chevron-left"
      variant="text"
      size="small"
      aria-label="Previous week"
      @click="moveWeek(-1)"
    />
    <button
      class="week-navigator__label"
      :disabled="isCurrentWeek"
      @click="goToCurrentWeek"
    >
      <strong>{{ weekLabel }}</strong>
      <span>{{ isCurrentWeek ? 'Current week' : 'Back to current week' }}</span>
    </button>
    <v-btn
      icon="mdi-chevron-right"
      variant="text"
      size="small"
      aria-label="Next week"
      @click="moveWeek(1)"
    />
  </div>
</template>

<style scoped>
.week-navigator {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: .5rem;
}

.week-navigator__label {
  display: flex;
  min-height: 44px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-background));
  cursor: pointer;
}

.week-navigator__label:disabled {
  cursor: default;
}

.week-navigator__label strong {
  font-size: .82rem;
}

.week-navigator__label span {
  margin-top: 1px;
  color: rgb(var(--v-theme-on-background) / .48);
  font-size: .62rem;
}
</style>
