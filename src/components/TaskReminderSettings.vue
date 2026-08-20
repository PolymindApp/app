<script setup lang="ts">
import { computed, ref } from 'vue'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'
import {
  checkTaskReminderCapabilities,
  openTaskReminderCapabilitySettings,
} from '@/services/taskReminders'
import type { TaskReminderCapability, TaskReminderCapabilityIssue } from '@/services/taskReminders'

const props = defineProps<{
  enabled: boolean
  times: string[]
  available: boolean
}>()
const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:times': [value: string[]]
}>()
const capabilityIssues = ref<TaskReminderCapabilityIssue[]>([])
const checkingCapabilities = ref(false)
const openingCapability = ref<TaskReminderCapability>()
let capabilityCheckVersion = 0

async function checkCapabilities() {
  if (!props.available) return
  const version = ++capabilityCheckVersion
  checkingCapabilities.value = true
  try {
    const issues = await checkTaskReminderCapabilities()
    if (version === capabilityCheckVersion) capabilityIssues.value = issues
  } catch {
    if (version === capabilityCheckVersion) capabilityIssues.value = []
  } finally {
    if (version === capabilityCheckVersion) checkingCapabilities.value = false
  }
}

async function openCapabilitySettings(capability: TaskReminderCapability) {
  openingCapability.value = capability
  try {
    await openTaskReminderCapabilitySettings(capability)
  } finally {
    openingCapability.value = undefined
    await checkCapabilities()
  }
}

const enabledModel = computed({
  get: () => props.enabled,
  set: (enabled: boolean) => {
    if (enabled && !props.times.length) emit('update:times', ['20:00'])
    emit('update:enabled', enabled)
    if (enabled) void checkCapabilities()
    else capabilityIssues.value = []
  },
})

function updateTime(index: number, value: number | string) {
  const times = [...props.times]
  times[index] = String(value)
  emit('update:times', times)
  void checkCapabilities()
}

function addTime() {
  const used = new Set(props.times)
  const previous = props.times.at(-1) || '19:00'
  const [previousHour = 19, previousMinute = 0] = previous.split(':').map(Number)
  const previousTotal = previousHour * 60 + previousMinute
  for (let offset = 60; offset <= 24 * 60; offset += 60) {
    const total = (previousTotal + offset) % (24 * 60)
    const candidate = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    if (!used.has(candidate)) {
      emit('update:times', [...props.times, candidate])
      void checkCapabilities()
      return
    }
  }
}

function removeTime(index: number) {
  if (props.times.length <= 1) return
  emit('update:times', props.times.filter((_time, timeIndex) => timeIndex !== index))
}
</script>

<template>
  <v-card class="surface-card pa-5 mb-4">
    <div class="setting-row">
      <div>
        <h2 class="section-title">Daily reminders</h2>
        <p class="field-help mt-1">Get one or more notifications at set times each day.</p>
      </div>
      <v-switch
        v-model="enabledModel"
        color="secondary"
        hide-details="auto"
        inset
        :disabled="!available"
        aria-label="Daily reminders"
      />
    </div>

    <v-alert v-if="!available" type="info" variant="tonal" density="compact" class="mt-4">
      Reminders are available in the Android app and supported desktop browsers.
    </v-alert>

    <v-expand-transition>
      <div v-if="enabled && available" class="reminder-list mt-4">
        <v-alert
          v-if="capabilityIssues.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="reminder-capabilities"
        >
          <strong>Reminder setup needs attention</strong>
          <div
            v-for="issue in capabilityIssues"
            :key="issue.code"
            class="reminder-capability mt-3"
          >
            <span>{{ issue.message }}</span>
            <v-btn
              size="small"
              variant="tonal"
              :loading="openingCapability === issue.code"
              :disabled="checkingCapabilities || Boolean(openingCapability)"
              @click="openCapabilitySettings(issue.code)"
            >
              {{ issue.action }}
            </v-btn>
          </div>
        </v-alert>
        <div v-for="(time, index) in times" :key="index" class="reminder-time">
          <div class="d-flex align-center justify-space-between">
            <strong>Notification {{ index + 1 }}</strong>
            <v-btn
              v-if="times.length > 1"
              icon="mdi-close"
              size="small"
              variant="text"
              :aria-label="`Remove notification ${index + 1}`"
              @click="removeTime(index)"
            />
          </div>
          <TimerWheelPicker
            :model-value="time"
            mode="time"
            @update:model-value="updateTime(index, $event)"
          />
        </div>
        <v-btn variant="tonal" prepend-icon="mdi-plus" @click="addTime">
          Add notification
        </v-btn>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<style scoped>
.section-title { font-size: .78rem; font-weight: 900; letter-spacing: .09em; text-transform: uppercase; }
.field-help { color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; line-height: 1.5; }
.setting-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.reminder-list { display: grid; gap: 1rem; }
.reminder-capability { display: grid; gap: .5rem; }
.reminder-capability .v-btn { justify-self: start; }
.reminder-time { display: grid; gap: .5rem; padding: 1rem; border: 1px solid rgb(var(--v-theme-on-surface) / .08); border-radius: 1rem; background: rgb(var(--v-theme-background) / .5); }
</style>
