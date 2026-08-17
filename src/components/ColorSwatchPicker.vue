<script setup lang="ts">
import { computed, ref } from 'vue'
import AppDialog from '@/components/AppDialog.vue'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  modelValue: string
  label?: string
  customLabel?: string
}>(), {
  customLabel: 'Choose a custom color',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const colors = [
  '#C7F464',
  '#8FB8FF',
  '#FFB86B',
  '#D4A5FF',
  '#79C174',
  '#FF776B',
  '#66D9C8',
  '#F0D264',
  '#FF8FA3',
  '#7E9CFF',
  '#5CC8FF',
  '#F4B8E4',
]
const customColorDialog = ref(false)
const draftColor = ref(props.modelValue)

const isCustomColor = computed(() => (
  !colors.some(color => color.toLowerCase() === props.modelValue.toLowerCase())
))

const customIconColor = computed(() => {
  const hex = props.modelValue.match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return '#17200F'

  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance > 150 ? '#17200F' : '#FFFFFF'
})

function isSelected(color: string) {
  return props.modelValue.toLowerCase() === color.toLowerCase()
}

function openCustomColorPicker() {
  draftColor.value = props.modelValue
  customColorDialog.value = true
}

function applyCustomColor() {
  if (/^#[0-9a-f]{6}$/i.test(draftColor.value)) {
    emit('update:modelValue', draftColor.value.toUpperCase())
  }

  customColorDialog.value = false
}
</script>

<template>
  <fieldset class="color-picker" v-bind="$attrs">
    <legend v-if="label">{{ label }}</legend>
    <div class="color-picker__options">
      <button
        v-for="color in colors"
        :key="color"
        type="button"
        class="color-picker__swatch"
        :class="{ 'color-picker__swatch--selected': isSelected(color) }"
        :style="{ background: color }"
        :aria-label="`Use color ${color}`"
        :aria-pressed="isSelected(color)"
        @click="emit('update:modelValue', color)"
      >
        <v-icon v-if="isSelected(color)" icon="mdi-check-bold" size="16" />
      </button>

      <button
        type="button"
        class="color-picker__custom"
        :class="{ 'color-picker__custom--selected': isCustomColor }"
        :style="isCustomColor
          ? { backgroundColor: modelValue, color: customIconColor }
          : undefined"
        :aria-label="customLabel"
        :aria-pressed="isCustomColor"
        @click="openCustomColorPicker"
      >
        <v-icon icon="mdi-eyedropper-variant" size="18" />
      </button>
    </div>
  </fieldset>

  <AppDialog
    v-model="customColorDialog"
    :aria-label="customLabel"
    max-width="390"
  >
    <v-card class="color-picker__dialog" rounded="xl">
      <v-card-title>{{ customLabel }}</v-card-title>

      <v-card-text>
        <v-color-picker
          v-model="draftColor"
          class="color-picker__vuetify"
          mode="hex"
          :modes="['hex']"
          hide-inputs
          width="100%"
        />
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="customColorDialog = false">
          Cancel
        </v-btn>
        <v-btn color="secondary" variant="flat" size="large" @click="applyCustomColor">
          Apply
        </v-btn>
      </v-card-actions>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.color-picker {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.color-picker > legend {
  color: rgba(var(--v-theme-on-surface), .68);
  font-size: .75rem;
  font-weight: 750;
}

.color-picker__options {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  align-items: center;
  gap: .55rem;
}

.color-picker > legend + .color-picker__options {
  margin-top: .5rem;
}

.color-picker__swatch,
.color-picker__custom {
  display: grid;
  width: 100%;
  min-width: 0;
  height: 2.75rem;
  place-items: center;
  border: .125rem solid transparent;
  border-radius: .75rem;
  color: #17200f;
  cursor: pointer;
}

.color-picker__swatch--selected,
.color-picker__custom--selected {
  border-color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 0 0 2px rgb(var(--v-theme-background));
}

.color-picker__custom {
  grid-column: 1 / -1;
  border-color: rgba(var(--v-theme-on-surface), .18);
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface));
}

.color-picker__dialog {
  padding: .5rem;
}

.color-picker__vuetify {
  max-width: none;
}
</style>
