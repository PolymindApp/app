<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: string
  label: string
  customLabel?: string
}>(), {
  customLabel: 'Choose a custom color',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const colors = ['#C7F464', '#8FB8FF', '#FFB86B', '#D4A5FF', '#79C174', '#FF776B']

function updateCustomColor(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <fieldset class="color-picker">
    <legend>{{ label }}</legend>
    <div class="color-picker__options">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        class="color-picker__swatch"
        :class="{ 'color-picker__swatch--selected': modelValue === color }"
        :style="{ background: color }"
        :aria-label="`Use color ${color}`"
        :aria-pressed="modelValue === color"
        @click="emit('update:modelValue', color)"
      >
        <v-icon v-if="modelValue === color" icon="mdi-check-bold" size="16" />
      </button>

      <label class="color-picker__custom" :aria-label="customLabel">
        <input :value="modelValue" type="color" @input="updateCustomColor" />
        <v-icon icon="mdi-eyedropper-variant" size="18" />
      </label>
    </div>
  </fieldset>
</template>

<style scoped>
.color-picker {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.color-picker > legend {
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: .75rem;
  font-weight: 750;
}

.color-picker__options {
  display: flex;
  margin-top: .5rem;
  flex-wrap: wrap;
  align-items: center;
  gap: .55rem;
}

.color-picker__swatch,
.color-picker__custom {
  display: grid;
  min-width: 38px;
  height: 38px;
  flex: 1 1 38px;
  place-items: center;
  border: 2px solid transparent;
  border-radius: 12px;
  color: #17200f;
  cursor: pointer;
}

.color-picker__swatch--selected {
  border-color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 0 0 2px rgb(var(--v-theme-background));
}

.color-picker__custom {
  position: relative;
  overflow: hidden;
  border-color: rgb(var(--v-theme-on-surface) / .18);
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface));
}

.color-picker__custom input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

.color-picker__custom .v-icon {
  pointer-events: none;
}
</style>
