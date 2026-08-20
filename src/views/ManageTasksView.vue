<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { format } from 'date-fns'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { nextScheduledDates } from '@/services/schedule'
import { TASK_TYPE_PRESENTATION } from '@/services/taskTypes'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useTaskStore } from '@/stores/tasks'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import type { Task } from '@/types/domain'

const store = useTaskStore()
const intervalStore = useIntervalStore()
const flashcardStore = useFlashcardStore()
const router = useRouter()
const { tasks, steps, loading, error } = storeToRefs(store)
const filter = ref<'active' | 'paused'>('active')
const pendingStatusTask = ref<Task>()
const statusDialog = ref(false)
const updatingStatus = ref(false)
const reorderingTasks = ref(false)
const statusDirection = ref<'forward' | 'back'>('forward')

watch(filter, (status, previousStatus) => {
  statusDirection.value = status === 'paused' && previousStatus === 'active' ? 'forward' : 'back'
})

const visibleTasks = computed(() => tasks.value.filter((task) =>
  !task.archived && task.active === (filter.value === 'active'),
))

onMounted(() => {
  if (!tasks.value.length) store.load().catch(() => undefined)
  if (!intervalStore.loaded) intervalStore.load().catch(() => undefined)
  if (!flashcardStore.loaded) flashcardStore.load().catch(() => undefined)
})

function attachedIntervalName(task: Task) {
  return intervalStore.templates.find((item) => item.id === task.intervalTemplate)?.name || 'Attached interval'
}

function attachedReviewSetName(task: Task) {
  return flashcardStore.reviewSets.find(item => item.id === task.flashcardReviewSet)?.name || 'Attached Review set'
}

function scheduleLabel(task: Task) {
  if (task.type === 'program') return `${task.cycleLength}-day ${task.programRepeat ? 'repeating' : 'one-off'} cycle`
  if (task.recurrenceType === 'daily') return 'Every day'
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const days = task.weekdays.map((day) => dayNames[day]).join(', ')
  return task.recurrenceType === 'interval_weeks' ? `${days} · every ${task.intervalWeeks} weeks` : days
}

function nextLabel(task: Task) {
  const next = nextScheduledDates(task, 1)[0]
  return next ? format(next, 'EEE, MMM d') : 'No upcoming dates'
}

function requestStatusChange(task: Task) {
  pendingStatusTask.value = task
  statusDialog.value = true
}

async function reorderVisibleTasks(result: LongPressDragResult) {
  reorderingTasks.value = true
  try {
    await store.reorderTasks(result.orderedIds)
  } catch {
    // The store restores the previous order and exposes the save error.
  } finally {
    reorderingTasks.value = false
  }
}

async function confirmStatusChange() {
  if (!pendingStatusTask.value) return
  updatingStatus.value = true
  try {
    await store.toggleTaskActive(pendingStatusTask.value)
    statusDialog.value = false
    pendingStatusTask.value = undefined
  } finally {
    updatingStatus.value = false
  }
}
</script>

<template>
  <main class="app-page manage-tasks-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
      {{ error }}
      <template #append>
        <v-btn size="small" variant="text" @click="store.load">Retry</v-btn>
      </template>
    </v-alert>

    <div class="manage-controls mb-4">
      <v-tabs v-model="filter" color="secondary" density="comfortable" class="manage-status-tabs">
        <v-tab value="active">Active</v-tab>
        <v-tab value="paused">Paused</v-tab>
      </v-tabs>
      <span class="text-caption muted">{{ visibleTasks.length }} total</span>
      <v-btn
        icon="mdi-plus"
        color="secondary"
        aria-label="Create task"
        to="/tasks/new"
      />
    </div>

    <div class="manage-status-stage">
      <transition :name="`manage-slide-${statusDirection}`">
        <div :key="filter" class="manage-status-content">
          <div v-if="visibleTasks.length" class="manage-list">
            <v-card
              v-for="task in visibleTasks"
              :key="task.id"
              v-long-press-drag="{
                id: task.id,
                group: `manage-tasks-${filter}`,
                disabled: visibleTasks.length < 2 || updatingStatus || reorderingTasks,
                onDrop: reorderVisibleTasks,
              }"
              class="manage-card surface-card pa-4"
              @click="router.push(`/tasks/${task.id}`)"
            >
              <div class="d-flex align-start ga-3">
                <div class="type-icon" :style="{ background: task.color || TASK_TYPE_PRESENTATION[task.type].color }">
                  <v-icon :icon="TASK_TYPE_PRESENTATION[task.type].icon" size="21" />
                </div>
                <div class="flex-grow-1 min-width-0">
                  <div class="d-flex align-center ga-2">
                    <h2 class="text-body-1 font-weight-black text-truncate">{{ task.name }}</h2>
                    <v-icon v-if="task.mandatory" icon="mdi-shield-check" color="primary" size="15" />
                  </div>
                  <p class="text-caption muted mt-1">{{ TASK_TYPE_PRESENTATION[task.type].title }} · {{ scheduleLabel(task) }}</p>
                  <div v-if="task.type === 'program'" class="step-preview mt-3">
                    <span
                      v-for="step in steps.filter(item => item.active && item.task === task.id).slice(0, 4)"
                      :key="step.id"
                    >
                      {{ step.name }}
                    </span>
                  </div>
                  <p v-else-if="task.type === 'interval'" class="target-copy mt-3">
                    <v-icon icon="mdi-timer-play-outline" size="15" class="mr-1" />
                    {{ attachedIntervalName(task) }}
                  </p>
                  <p v-else-if="task.type === 'flashcards'" class="target-copy mt-3">
                    <v-icon icon="mdi-cards-playing-outline" size="15" class="mr-1" />
                    {{ attachedReviewSetName(task) }}
                  </p>
                  <p v-else-if="task.targetValue" class="target-copy mt-3">
                    Target: <strong>{{ task.targetValue }} {{ task.customUnit || task.unit }}</strong>
                    <span v-if="task.goalPeriod === 'week'"> / week</span>
                  </p>
                </div>
                <v-btn
                  :icon="task.active ? 'mdi-pause' : 'mdi-play'"
                  :color="task.active ? undefined : 'secondary'"
                  variant="tonal"
                  size="small"
                  :aria-label="task.active ? `Pause ${task.name}` : `Activate ${task.name}`"
                  @touchstart.stop
                  @click.stop="requestStatusChange(task)"
                />
              </div>
              <v-divider class="my-3" />
              <div class="text-caption">
                <span class="muted">
                  <v-icon icon="mdi-calendar-blank-outline" size="15" class="mr-1" />
                  Next: {{ nextLabel(task) }}
                </span>
              </div>
            </v-card>
          </div>

          <v-card v-else-if="!loading" class="surface-card pa-8 text-center">
            <v-icon :icon="filter === 'active' ? 'mdi-clipboard-plus-outline' : 'mdi-pause-circle-outline'" size="42" class="mb-3" />
            <h2 class="text-h6 font-weight-black">
              {{ filter === 'active' ? 'Build your first routine' : 'Nothing paused' }}
            </h2>
            <p class="text-body-2 muted mt-2 mb-5">
              {{ filter === 'active' ? 'Choose a task style and make it yours.' : 'Paused tasks will wait here without losing history.' }}
            </p>
            <v-btn
              v-if="filter === 'active'"
              color="secondary"
              to="/tasks/new"
            >
              Create task
            </v-btn>
          </v-card>
        </div>
      </transition>
    </div>

    <ConfirmDialog
      v-model="statusDialog"
      :title="pendingStatusTask?.active ? 'Pause this task?' : 'Activate this task?'"
      :message="pendingStatusTask?.active
        ? `${pendingStatusTask?.name || 'This task'} will stop appearing in your schedule until you activate it again. Its history will be preserved.`
        : `${pendingStatusTask?.name || 'This task'} will return to its schedule based on its recurrence settings.`"
      :confirm-text="pendingStatusTask?.active ? 'Pause task' : 'Activate task'"
      :confirm-color="pendingStatusTask?.active ? 'warning' : 'secondary'"
      :icon="pendingStatusTask?.active ? 'mdi-pause' : 'mdi-play'"
      :loading="updatingStatus"
      @confirm="confirmStatusChange"
    />
  </main>
</template>

<style scoped>
.manage-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: .75rem;
}

.manage-status-tabs {
  width: auto;
  min-width: 0;
}

.manage-status-stage {
  display: grid;
  width: 100%;
  min-width: 0;
  overflow-x: clip;
}

.manage-status-content {
  width: 100%;
  min-width: 0;
  grid-area: 1 / 1;
}

.manage-slide-forward-enter-active,
.manage-slide-forward-leave-active,
.manage-slide-back-enter-active,
.manage-slide-back-leave-active {
  transition:
    opacity 240ms ease,
    transform 240ms cubic-bezier(.22, 1, .36, 1);
}

.manage-slide-forward-leave-active,
.manage-slide-back-leave-active {
  pointer-events: none;
}

.manage-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(1.5rem);
}

.manage-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(-1rem);
}

.manage-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-1.5rem);
}

.manage-slide-back-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}

.type-icon {
  display: grid;
  width: 39px;
  height: 39px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 13px;
  color: #191c19;
}

.manage-list {
  display: grid;
  gap: .75rem;
}

.manage-card {
  cursor: pointer;
  transition: box-shadow .18s ease;
}

.manage-card:hover {
  box-shadow: 0 16px 34px rgba(0, 0, 0, .32) !important;
}

.step-preview {
  display: flex;
  gap: .35rem;
  overflow: hidden;
}

.step-preview span {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: .62rem;
  white-space: nowrap;
}

.target-copy {
  color: rgb(var(--v-theme-on-surface) / .6);
  font-size: .73rem;
}

@media (min-width: 700px) {
  .manage-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .manage-controls {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .manage-controls > .muted {
    display: none;
  }
}
</style>
