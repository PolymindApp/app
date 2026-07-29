<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { addDays, addWeeks, endOfWeek, format, isSameDay, isSameWeek, startOfWeek } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useDisplay } from 'vuetify'
import TaskCard from '@/components/TaskCard.vue'
import { useTaskStore } from '@/stores/tasks'
import type { TaskProgress } from '@/types/domain'

const store = useTaskStore()
const { smAndUp } = useDisplay()
const { selectedDate, selectedProgress, completionRate, loading, error } = storeToRefs(store)
const busy = ref(false)
const exactDialog = ref(false)
const exactProgress = ref<TaskProgress>()
const exactAmountInput = ref('')
const exactAction = ref<'add' | 'subtract' | 'set'>()
const reviewSheet = ref(false)
const weekDirection = ref<'previous' | 'next'>('next')
const visibleWeekStart = ref(startOfWeek(selectedDate.value, { weekStartsOn: 1 }))
const exactAmount = computed(() => {
  if (!exactAmountInput.value || exactAmountInput.value === '.') return null
  const value = Number(exactAmountInput.value)
  return Number.isFinite(value) ? value : null
})
const keypadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'] as const

const days = computed(() => Array.from({ length: 7 }, (_, index) => {
  const date = addDays(visibleWeekStart.value, index)
  return { date, day: format(date, 'EEE').slice(0, 2), number: format(date, 'd') }
}))
const weekLabel = computed(() => {
  const start = visibleWeekStart.value
  const end = endOfWeek(start, { weekStartsOn: 1 })
  return start.getMonth() === end.getMonth()
    ? `${format(start, 'MMM d')} – ${format(end, 'd')}`
    : `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`
})
const isCurrentWeek = computed(() => isSameWeek(visibleWeekStart.value, new Date(), { weekStartsOn: 1 }))

const required = computed(() => selectedProgress.value.filter((item) => item.task.mandatory))
const optional = computed(() => selectedProgress.value.filter((item) => !item.task.mandatory))
const reviewItems = computed(() =>
  selectedProgress.value.filter((item) => item.task.reviewWhenMissed && item.status === 'pending' && !item.complete),
)
const doneCount = computed(() => selectedProgress.value.filter((item) => item.complete).length)
onMounted(async () => {
  try { await store.load() } catch { /* Error state is displayed in the view. */ }
})

async function run(action: () => Promise<void>) {
  busy.value = true
  try { await action() } finally { busy.value = false }
}

async function resolveReview(item: TaskProgress, status: 'missed' | 'carried') {
  await run(() => store.setStatus(item, status))
  reviewSheet.value = false
}

function moveWeek(amount: number) {
  weekDirection.value = amount < 0 ? 'previous' : 'next'
  visibleWeekStart.value = addWeeks(visibleWeekStart.value, amount)
}

function goToCurrentWeek() {
  weekDirection.value = visibleWeekStart.value > new Date() ? 'previous' : 'next'
  visibleWeekStart.value = startOfWeek(new Date(), { weekStartsOn: 1 })
}

function openExact(progress: TaskProgress) {
  exactProgress.value = progress
  exactAmountInput.value = ''
  exactAction.value = undefined
  exactDialog.value = true
}

function pressKeypad(key: typeof keypadKeys[number]) {
  if (key === 'backspace') {
    exactAmountInput.value = exactAmountInput.value.slice(0, -1)
    return
  }
  if (key === '.') {
    if (!exactAmountInput.value.includes('.')) exactAmountInput.value = `${exactAmountInput.value || '0'}.`
    return
  }
  if (exactAmountInput.value.length >= 10) return
  exactAmountInput.value = exactAmountInput.value === '0' ? key : `${exactAmountInput.value}${key}`
}

async function submitExact(mode: 'add' | 'subtract' | 'set') {
  if (!exactProgress.value || exactAmount.value === null) return
  exactAction.value = mode
  const amount = mode === 'set'
    ? exactAmount.value - exactProgress.value.value
    : mode === 'subtract'
      ? -exactAmount.value
      : exactAmount.value
  try {
    await run(() => store.addEntry(exactProgress.value!, amount, mode === 'add' ? undefined : 'adjustment'))
    exactDialog.value = false
  } finally {
    exactAction.value = undefined
  }
}
</script>

<template>
  <main class="app-page today-page">
    <div class="week-nav mb-3">
      <v-btn
        icon="mdi-chevron-left"
        variant="text"
        size="small"
        aria-label="Previous week"
        @click="moveWeek(-1)"
      />
      <button class="week-nav__label" :disabled="isCurrentWeek" @click="goToCurrentWeek">
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

    <div class="date-strip-window mb-5">
      <transition :name="`week-${weekDirection}`">
        <div :key="visibleWeekStart.toISOString()" class="date-strip" role="list" aria-label="Choose a date">
          <button
            v-for="day in days"
            :key="day.date.toISOString()"
            class="date-chip"
            :class="{ 'date-chip--active': isSameDay(selectedDate, day.date) }"
            @click="selectedDate = day.date"
          >
            <span>{{ day.day }}</span>
            <strong>{{ day.number }}</strong>
            <i v-if="isSameDay(new Date(), day.date)" />
          </button>
        </div>
      </transition>
    </div>

    <v-card class="score-card pa-5" color="surface">
      <div class="score-pattern" />
      <div class="position-relative d-flex align-center justify-space-between ga-4">
        <div>
          <div class="d-flex align-end ga-2 mt-2">
            <span class="score-number">{{ completionRate }}</span><span class="score-percent">%</span>
          </div>
          <p class="text-caption text-medium-emphasis mt-1">
            {{ doneCount }} of {{ selectedProgress.length }} scheduled reps complete
          </p>
        </div>
        <v-progress-circular
          :model-value="completionRate"
          color="secondary"
          bg-color="#363A35"
          :size="92"
          :width="10"
        >
          <v-icon :icon="completionRate === 100 ? 'mdi-trophy' : 'mdi-arrow-top-right-thick'" color="secondary" size="30" />
        </v-progress-circular>
      </div>
      <v-btn
        v-if="reviewItems.length"
        size="small"
        variant="tonal"
        color="secondary"
        class="mt-5"
        prepend-icon="mdi-clipboard-check-outline"
        @click="reviewSheet = true"
      >
        Review {{ reviewItems.length }} open
      </v-btn>
    </v-card>

    <v-alert v-if="error" type="error" variant="tonal" class="mt-4">
      {{ error }}
      <template #append><v-btn size="small" variant="text" @click="store.load">Retry</v-btn></template>
    </v-alert>

    <template v-if="selectedProgress.length">
      <section v-if="required.length">
        <div class="section-heading"><h2>Required work</h2><span class="text-caption muted">{{ required.filter(i => i.complete).length }}/{{ required.length }}</span></div>
        <div class="task-stack">
          <TaskCard
            v-for="item in required"
            :key="`${item.task.id}-${item.programStep?.id || ''}`"
            :progress="item"
            :busy="busy"
            @toggle="run(() => store.toggleComplete($event))"
            @seal="run(() => store.setDailyTotalSealed($event))"
            @add="(progress, amount) => run(() => store.addEntry(progress, amount))"
            @exact="openExact"
          />
        </div>
      </section>

      <section v-if="optional.length">
        <div class="section-heading"><h2>Extra credit</h2><span class="text-caption muted">Optional</span></div>
        <div class="task-stack">
          <TaskCard
            v-for="item in optional"
            :key="`${item.task.id}-${item.programStep?.id || ''}`"
            :progress="item"
            :busy="busy"
            @toggle="run(() => store.toggleComplete($event))"
            @seal="run(() => store.setDailyTotalSealed($event))"
            @add="(progress, amount) => run(() => store.addEntry(progress, amount))"
            @exact="openExact"
          />
        </div>
      </section>
    </template>

    <v-card v-else-if="!loading" class="surface-card empty-card pa-8 mt-6 text-center">
      <div class="empty-icon mx-auto mb-4"><v-icon icon="mdi-arm-flex-outline" size="32" /></div>
      <h2 class="text-h6 font-weight-black">No reps scheduled</h2>
      <p class="text-body-2 muted mt-2 mb-5">Build your first routine and it will show up here.</p>
      <v-btn color="secondary" append-icon="mdi-plus" to="/tasks/new">Create a task</v-btn>
    </v-card>

    <v-dialog v-model="exactDialog" max-width="440">
      <v-card class="pa-5">
        <div class="d-flex align-center justify-space-between mb-5">
          <h2 class="text-h6 font-weight-black">{{ exactProgress?.programStep?.name || exactProgress?.task.name }}</h2>
          <v-btn icon="mdi-close" variant="text" @click="exactDialog = false" />
        </div>
        <div class="amount-entry mb-4">
          <v-text-field
            v-if="smAndUp"
            v-model="exactAmountInput"
            label="Amount"
            type="number"
            inputmode="decimal"
            autofocus
          />
          <div v-else class="amount-keypad">
            <output class="amount-keypad__display" aria-live="polite">
              {{ exactAmountInput || '0' }}
            </output>
            <div class="amount-keypad__keys">
              <v-btn
                v-for="key in keypadKeys"
                :key="key"
                size="large"
                variant="tonal"
                :aria-label="key === 'backspace' ? 'Delete last digit' : key === '.' ? 'Decimal point' : key"
                :disabled="key === '.' && exactAmountInput.includes('.')"
                @click="pressKeypad(key)"
              >
                <v-icon v-if="key === 'backspace'" icon="mdi-backspace-outline" />
                <template v-else>{{ key }}</template>
              </v-btn>
            </div>
          </div>
        </div>
        <div class="exact-actions">
          <v-btn
            block
            size="large"
            class="exact-action exact-action--add"
            color="secondary"
            aria-label="Add"
            :loading="busy && exactAction === 'add'"
            :disabled="exactAmount === null || (busy && exactAction !== 'add')"
            @click="submitExact('add')"
          >
            Add
          </v-btn>
          <v-btn
            block
            size="large"
            class="exact-action exact-action--subtract"
            variant="tonal"
            color="error"
            aria-label="Subtract"
            :loading="busy && exactAction === 'subtract'"
            :disabled="exactAmount === null || (busy && exactAction !== 'subtract')"
            @click="submitExact('subtract')"
          >
              Subtract
            <!-- <v-icon icon="mdi-minus" /> -->
          </v-btn>
          <v-btn
            block
            size="large"
            class="exact-action exact-action--set"
            variant="tonal"
            :loading="busy && exactAction === 'set'"
            :disabled="exactAmount === null || (busy && exactAction !== 'set')"
            @click="submitExact('set')"
          >
            Set
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-bottom-sheet v-model="reviewSheet">
      <v-card class="pa-5 safe-bottom" rounded="t-xl">
        <h2 class="text-h5 font-weight-black mb-5">Resolve open work</h2>
        <div v-for="item in reviewItems" :key="`${item.task.id}-${item.programStep?.id || ''}`" class="review-row py-3">
          <div class="flex-grow-1"><strong>{{ item.programStep?.name || item.task.name }}</strong><p class="text-caption muted">Choose how this attempt ends.</p></div>
          <div class="review-actions">
            <v-btn
              size="large"
              variant="tonal"
              color="error"
              prepend-icon="mdi-close-circle-outline"
              :disabled="busy"
              @click="resolveReview(item, 'missed')"
            >
              Mark missed
            </v-btn>
            <v-btn
              size="large"
              variant="tonal"
              prepend-icon="mdi-arrow-right-bold"
              :disabled="busy"
              @click="resolveReview(item, 'carried')"
            >
              Carry forward
            </v-btn>
            <v-btn
              v-if="item.programStep"
              size="large"
              variant="tonal"
              prepend-icon="mdi-calendar-arrow-right"
              :disabled="busy"
              @click="run(() => store.shiftProgram(item))"
            >
              Shift program
            </v-btn>
          </div>
        </div>
      </v-card>
    </v-bottom-sheet>
  </main>
</template>

<style scoped>
.week-nav {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: .5rem;
}

.week-nav__label {
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

.week-nav__label:disabled {
  cursor: default;
}

.week-nav__label strong {
  font-size: .82rem;
}

.week-nav__label span {
  margin-top: 1px;
  color: rgb(var(--v-theme-on-background) / .48);
  font-size: .62rem;
}

.date-strip {
  display: grid;
  grid-template-columns: repeat(7, minmax(42px, 1fr));
  gap: .35rem;
}

.date-strip-window {
  position: relative;
  min-height: 62px;
  overflow-x: hidden;
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
  min-height: 62px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: #737872;
  cursor: pointer;
}

.date-chip span { font-size: .64rem; font-weight: 800; text-transform: uppercase; }
.date-chip strong { margin-top: 2px; font-size: 1rem; }
.date-chip i { position: absolute; bottom: 5px; width: 4px; height: 4px; border-radius: 50%; background: #c7f464; }
.date-chip--active { background: #c7f464; color: #17200f; box-shadow: 0 8px 20px rgba(199,244,100,.16); }

.score-card { position: relative; overflow: hidden; }
.score-pattern { position: absolute; top: -70px; right: -40px; width: 220px; height: 220px; border: 35px solid rgba(199,244,100,.07); border-radius: 50%; }
.score-number { font-family: Impact, "Arial Narrow", sans-serif; font-size: 3.2rem; line-height: .9; letter-spacing: -.03em; }
.score-percent { color: #c7f464; font-size: 1.2rem; font-weight: 900; }
.task-stack { display: grid; gap: .7rem; }
.empty-icon { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 20px; background: #c7f464; color: #17200f; }
.amount-keypad { display: grid; gap: 1rem; }
.amount-keypad__display { display: flex; min-height: 72px; align-items: center; justify-content: flex-end; padding: .75rem 1rem; border: 1px solid rgb(var(--v-theme-on-surface) / .16); border-radius: 16px; background: rgb(var(--v-theme-surface-variant)); font-size: 2rem; font-weight: 900; line-height: 1; }
.amount-keypad__keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .65rem; }
.amount-keypad__keys .v-btn { min-width: 0; height: 54px; font-size: 1.05rem; font-weight: 850; }
.exact-actions {
  display: grid;
  grid-template:
    "set add" 44px
    "subtract add" 44px
    / minmax(0, 1fr) minmax(0, 1fr);
  gap: .5rem;
}
.exact-action { height: 100% !important; }
.exact-action--subtract { grid-area: subtract; }
.exact-action--add { grid-area: add; }
.exact-action--set { grid-area: set; }
.review-row { display: flex; flex-direction: column; align-items: stretch; gap: 1rem; border-top: 1px solid rgba(255,255,255,.08); }
.review-actions { display: grid; gap: .5rem; }
.review-actions .v-btn { width: 100%; }

@media (min-width: 700px) {
  .task-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .review-actions { grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .week-next-enter-from,
  .week-next-leave-to,
  .week-previous-enter-from,
  .week-previous-leave-to {
    transform: none;
  }
}
</style>
