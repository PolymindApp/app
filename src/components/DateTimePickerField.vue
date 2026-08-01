<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { format, isValid, parseISO } from 'date-fns'

defineProps<{
  label: string
}>()

const model = defineModel<string>()
const dialogOpen = ref(false)
const activePicker = ref<'date' | 'time'>('date')
const pickerDate = ref<Date>()
const pickerTime = ref<string | null>(null)

const displayDateTime = computed(() => {
  const date = parseDateTime(model.value)
  return date ? format(date, 'MMM d, yyyy · h:mm a') : ''
})

const canConfirm = computed(() => Boolean(pickerDate.value && pickerTime.value))

watch(dialogOpen, (open) => {
  if (!open) return
  const date = parseDateTime(model.value) || new Date()
  pickerDate.value = date
  pickerTime.value = format(date, 'HH:mm')
  activePicker.value = 'date'
})

function parseDateTime(value?: string) {
  if (!value) return undefined
  const date = parseISO(value)
  return isValid(date) ? date : undefined
}

function selectDate(value: unknown) {
  const selected = Array.isArray(value) ? value[0] : value
  const date = selected instanceof Date
    ? selected
    : typeof selected === 'string'
      ? parseDateTime(selected)
      : undefined

  if (!date || !isValid(date)) return
  pickerDate.value = date
  activePicker.value = 'time'
}

function confirmDateTime() {
  if (!pickerDate.value || !pickerTime.value) return
  const [hours, minutes] = pickerTime.value.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return

  const date = new Date(pickerDate.value)
  date.setHours(hours, minutes, 0, 0)
  model.value = format(date, "yyyy-MM-dd'T'HH:mm")
  dialogOpen.value = false
}
</script>

<template>
  <v-dialog v-model="dialogOpen" max-width="22.5rem">
    <template #activator="{ props: activatorProps }">
      <v-text-field
        v-bind="activatorProps"
        :model-value="displayDateTime"
        :label="label"
        prepend-inner-icon="mdi-calendar-clock-outline"
        readonly
      />
    </template>

    <v-card class="overflow-hidden" rounded="xl">
      <v-tabs v-model="activePicker" color="secondary" grow>
        <v-tab value="date" prepend-icon="mdi-calendar-outline">Date</v-tab>
        <v-tab value="time" prepend-icon="mdi-clock-outline">Time</v-tab>
      </v-tabs>

      <v-divider />

      <v-window v-model="activePicker">
        <v-window-item value="date">
          <v-date-picker
            :model-value="pickerDate"
            color="secondary"
            first-day-of-week="1"
            show-adjacent-months
            width="100%"
            @update:model-value="selectDate"
          />
        </v-window-item>

        <v-window-item value="time">
          <v-time-picker
            v-model="pickerTime"
            color="secondary"
            format="ampm"
            scrollable
            width="100%"
          />
        </v-window-item>
      </v-window>

      <v-divider />

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialogOpen = false">Cancel</v-btn>
        <v-btn color="secondary" variant="flat" :disabled="!canConfirm" @click="confirmDateTime">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
