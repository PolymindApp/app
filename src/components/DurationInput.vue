<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ modelValue: number; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const minutes = computed({
  get: () => Math.floor(props.modelValue / 60),
  set: (value: number) => emit('update:modelValue', Math.max(0, Number(value || 0) * 60 + (props.modelValue % 60))),
})
const seconds = computed({
  get: () => props.modelValue % 60,
  set: (value: number) => emit('update:modelValue', Math.max(0, Math.floor(props.modelValue / 60) * 60 + Number(value || 0))),
})
</script>

<template>
  <fieldset class="duration-input">
    <legend>{{ label }}</legend>
    <div>
      <v-number-input v-model="minutes" label="Minutes" :min="0" :step="1" />
      <v-number-input v-model="seconds" label="Seconds" :min="0" :max="59" :step="1" />
    </div>
  </fieldset>
</template>

<style scoped>
.duration-input { min-width: 0; margin: 0; padding: 0; border: 0; }
.duration-input legend { margin-bottom: .5rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 800; }
.duration-input > div { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
</style>
