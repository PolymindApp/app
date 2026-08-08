<script setup lang="ts">
import { computed } from 'vue'
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isSameWeek,
  isSameYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns'

type NavigationType = 'day' | 'week' | 'month' | 'year'

const props = withDefaults(defineProps<{
  type?: NavigationType
}>(), {
  type: 'week',
})
const selectedDate = defineModel<Date>({ required: true })
const emit = defineEmits<{
  navigate: [direction: 'previous' | 'next']
}>()

const normalizedDate = computed(() => normalizeDate(selectedDate.value))
const periodLabel = computed(() => {
  const start = normalizedDate.value
  if (props.type === 'day') return format(start, 'EEEE, MMMM d, yyyy')
  if (props.type === 'month') return format(start, 'MMMM yyyy')
  if (props.type === 'year') return format(start, 'yyyy')

  const end = endOfWeek(start, { weekStartsOn: 1 })
  return start.getMonth() === end.getMonth()
    ? `${format(start, 'MMM d')} – ${format(end, 'd')}`
    : `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`
})
const isCurrentPeriod = computed(() => isSamePeriod(normalizedDate.value, new Date()))
const periodName = computed(() => props.type)

function normalizeDate(date: Date) {
  if (props.type === 'day') return startOfDay(date)
  if (props.type === 'month') return startOfMonth(date)
  if (props.type === 'year') return startOfYear(date)
  return startOfWeek(date, { weekStartsOn: 1 })
}

function addPeriod(date: Date, amount: -1 | 1) {
  if (props.type === 'day') return addDays(date, amount)
  if (props.type === 'month') return addMonths(date, amount)
  if (props.type === 'year') return addYears(date, amount)
  return addWeeks(date, amount)
}

function isSamePeriod(left: Date, right: Date) {
  if (props.type === 'day') return isSameDay(left, right)
  if (props.type === 'month') return isSameMonth(left, right)
  if (props.type === 'year') return isSameYear(left, right)
  return isSameWeek(left, right, { weekStartsOn: 1 })
}

function movePeriod(amount: -1 | 1) {
  emit('navigate', amount < 0 ? 'previous' : 'next')
  selectedDate.value = addPeriod(normalizedDate.value, amount)
}

function goToCurrentPeriod() {
  const today = new Date()
  emit('navigate', normalizedDate.value > today ? 'previous' : 'next')
  selectedDate.value = normalizeDate(today)
}
</script>

<template>
  <div class="week-navigator">
    <v-btn
      icon="mdi-chevron-left"
      variant="text"
      size="small"
      :aria-label="`Previous ${periodName}`"
      @click="movePeriod(-1)"
    />
    <button
      class="week-navigator__label"
      :disabled="isCurrentPeriod"
      @click="goToCurrentPeriod"
    >
      <strong>{{ periodLabel }}</strong>
      <span>{{ isCurrentPeriod ? `Current ${periodName}` : `Back to current ${periodName}` }}</span>
    </button>
    <v-btn
      icon="mdi-chevron-right"
      variant="text"
      size="small"
      :aria-label="`Next ${periodName}`"
      @click="movePeriod(1)"
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
