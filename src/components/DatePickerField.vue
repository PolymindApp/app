<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { format, isValid, parseISO } from 'date-fns'

withDefaults(defineProps<{
  label: string
  clearable?: boolean
  min?: string
  max?: string
}>(), {
  clearable: false,
  min: undefined,
  max: undefined,
})

const model = defineModel<string | undefined>()
const menuOpen = ref(false)
const pickerDate = ref<Date>()

const displayDate = computed(() => {
  const date = parseDate(model.value)
  return date ? format(date, 'MMM d, yyyy') : ''
})

watch(menuOpen, (open) => {
  if (open) pickerDate.value = parseDate(model.value)
})

function parseDate(value?: string) {
  if (!value) return undefined
  const date = parseISO(value)
  return isValid(date) ? date : undefined
}

function selectDate(value: unknown) {
  const selected = Array.isArray(value) ? value[0] : value
  const date = selected instanceof Date
    ? selected
    : typeof selected === 'string'
      ? parseDate(selected)
      : undefined

  if (!date || !isValid(date)) return
  model.value = format(date, 'yyyy-MM-dd')
  pickerDate.value = date
  menuOpen.value = false
}

function clearDate() {
  model.value = undefined
  pickerDate.value = undefined
  menuOpen.value = false
}
</script>

<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="bottom start"
    origin="top start"
    :offset="8"
  >
    <template #activator="{ props: activatorProps }">
      <v-text-field
        v-bind="activatorProps"
        :model-value="displayDate"
        :label="label"
        prepend-inner-icon="mdi-calendar-outline"
        readonly
        :clearable="clearable"
        @click:clear.stop="clearDate"
      />
    </template>

    <v-date-picker
      :model-value="pickerDate"
      :min="min"
      :max="max"
      color="secondary"
      first-day-of-week="1"
      show-adjacent-months
      width="360"
      max-width="calc(100vw - 24px)"
      @update:model-value="selectDate"
    />
  </v-menu>
</template>
