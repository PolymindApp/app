<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { addDays, addWeeks, format, isSameDay, isSameWeek, startOfWeek } from 'date-fns'
import WeekNavigator from '@/components/WeekNavigator.vue'

const selectedDate = defineModel<Date>({ required: true })
const displayedWeekStart = defineModel<Date>('weekStart')
const weekDirection = ref<'previous' | 'next'>('next')
const visibleWeekStart = ref(startOfWeek(selectedDate.value, { weekStartsOn: 1 }))
let weekTouchStart: { x: number; y: number } | undefined
let suppressDateClick = false
let suppressDateClickTimer: number | undefined

const days = computed(() => Array.from({ length: 7 }, (_, index) => {
  const date = addDays(visibleWeekStart.value, index)
  return {
    date,
    day: format(date, 'EEE').slice(0, 2),
    number: format(date, 'd'),
    label: format(date, 'EEEE, MMMM d, yyyy'),
  }
}))

watch(selectedDate, (date) => {
  if (isSameWeek(date, visibleWeekStart.value, { weekStartsOn: 1 })) return
  weekDirection.value = date < visibleWeekStart.value ? 'previous' : 'next'
  visibleWeekStart.value = startOfWeek(date, { weekStartsOn: 1 })
})

watch(visibleWeekStart, (date) => {
  const normalized = startOfWeek(date, { weekStartsOn: 1 })
  if (displayedWeekStart.value?.getTime() !== normalized.getTime()) displayedWeekStart.value = normalized
}, { immediate: true })

watch(displayedWeekStart, (date) => {
  if (!date) return
  const normalized = startOfWeek(date, { weekStartsOn: 1 })
  if (visibleWeekStart.value.getTime() === normalized.getTime()) return
  weekDirection.value = normalized < visibleWeekStart.value ? 'previous' : 'next'
  visibleWeekStart.value = normalized
})

onBeforeUnmount(() => {
  if (suppressDateClickTimer) window.clearTimeout(suppressDateClickTimer)
})

function setWeekDirection(direction: 'previous' | 'next') {
  weekDirection.value = direction
}

function moveWeek(amount: -1 | 1) {
  weekDirection.value = amount < 0 ? 'previous' : 'next'
  visibleWeekStart.value = addWeeks(visibleWeekStart.value, amount)
}

function beginWeekSwipe(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (touch) weekTouchStart = { x: touch.clientX, y: touch.clientY }
}

function cancelWeekSwipe() {
  weekTouchStart = undefined
}

function endWeekSwipe(event: TouchEvent) {
  const touch = event.changedTouches[0]
  if (!weekTouchStart || !touch) return
  const horizontalDistance = touch.clientX - weekTouchStart.x
  const verticalDistance = touch.clientY - weekTouchStart.y
  weekTouchStart = undefined
  if (Math.abs(horizontalDistance) < 50 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance) * 1.2) return

  suppressDateClick = true
  if (suppressDateClickTimer) window.clearTimeout(suppressDateClickTimer)
  suppressDateClickTimer = window.setTimeout(() => {
    suppressDateClick = false
    suppressDateClickTimer = undefined
  }, 350)
  moveWeek(horizontalDistance < 0 ? 1 : -1)
}

function selectDate(date: Date) {
  if (!suppressDateClick) selectedDate.value = date
}
</script>

<template>
  <div class="week-date-navigator">
    <WeekNavigator
      v-model="visibleWeekStart"
      class="mb-3"
      @navigate="setWeekDirection"
    />

    <div
      class="date-strip-window"
      @touchstart.passive="beginWeekSwipe"
      @touchend.passive="endWeekSwipe"
      @touchcancel="cancelWeekSwipe"
    >
      <transition :name="`week-${weekDirection}`">
        <div
          :key="visibleWeekStart.toISOString()"
          class="date-strip"
          role="list"
          aria-label="Choose a date"
        >
          <button
            v-for="day in days"
            :key="day.date.toISOString()"
            class="date-chip"
            :class="{ 'date-chip--active': isSameDay(selectedDate, day.date) }"
            type="button"
            :aria-label="day.label"
            :aria-pressed="isSameDay(selectedDate, day.date)"
            @click="selectDate(day.date)"
          >
            <span>{{ day.day }}</span>
            <strong>{{ day.number }}</strong>
            <i v-if="isSameDay(new Date(), day.date)" aria-hidden="true" />
          </button>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.date-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(2.625rem, 1fr));
  gap: .35rem;
}

.date-strip-window {
  position: relative;
  min-height: 3.875rem;
  overflow-x: hidden;
  touch-action: pan-y;
}

.week-next-enter-active,
.week-next-leave-active,
.week-previous-enter-active,
.week-previous-leave-active {
  transition: transform 180ms cubic-bezier(.22, 1, .36, 1);
}

.week-next-leave-active,
.week-previous-leave-active {
  position: absolute;
  inset: 0;
  width: 100%;
}

.week-next-enter-from,
.week-previous-leave-to {
  transform: translateX(100%);
}

.week-next-leave-to,
.week-previous-enter-from {
  transform: translateX(-100%);
}

.date-chip {
  position: relative;
  display: flex;
  min-height: 3.875rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 1rem;
  background: transparent;
  color: rgba(var(--v-theme-on-background), .46);
  cursor: pointer;
}

.date-chip span { font-size: .64rem; font-weight: 800; text-transform: uppercase; }
.date-chip strong { margin-top: .125rem; font-size: 1rem; }
.date-chip i { position: absolute; bottom: .3125rem; width: .25rem; height: .25rem; border-radius: 50%; background: rgb(var(--v-theme-secondary)); }
.date-chip--active { background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); box-shadow: 0 .5rem 1.25rem rgba(var(--v-theme-secondary), .16); }

@media (prefers-reduced-motion: reduce) {
  .week-next-enter-from,
  .week-next-leave-to,
  .week-previous-enter-from,
  .week-previous-leave-to {
    transform: none;
  }
}
</style>
