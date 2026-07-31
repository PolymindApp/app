<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: number[]
  unit?: string
}>(), {
  unit: '',
})

const emit = defineEmits<{
  'update:modelValue': [amounts: number[]]
}>()

const amount = ref<number | null>(null)

function addAmount() {
  const value = Number(amount.value)
  if (!Number.isFinite(value) || value <= 0) return
  if (!props.modelValue.includes(value)) {
    emit('update:modelValue', [...props.modelValue, value])
  }
  amount.value = null
}

function removeAmount(value: number) {
  emit('update:modelValue', props.modelValue.filter((amount) => amount !== value))
}
</script>

<template>
  <div class="quick-editor">
    <label class="quick-editor__label">Quick-add buttons</label>
    <div class="quick-editor__input mt-2">
      <v-number-input
        v-model="amount"
        label="New amount"
        :min="0"
        :precision="null"
        hide-details
        @keydown.enter.prevent="addAmount"
      />
      <v-btn
        icon="mdi-plus"
        color="secondary"
        aria-label="Add quick amount"
        :disabled="!amount || amount <= 0"
        @click="addAmount"
      />
    </div>

    <div v-if="modelValue.length" class="quick-editor__chips mt-3">
      <v-chip
        v-for="value in modelValue"
        :key="value"
        closable
        color="secondary"
        variant="tonal"
        @click:close="removeAmount(value)"
      >
        +{{ value }}{{ unit ? ` ${unit}` : '' }}
      </v-chip>
    </div>
    <p v-else class="text-caption muted mt-3">
      No quick buttons. Exact entry will still be available.
    </p>
  </div>
</template>

<style scoped>
.quick-editor__label {
  color: rgb(var(--v-theme-on-surface) / .68);
  font-size: .75rem;
  font-weight: 750;
}

.quick-editor__input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  align-items: center;
  gap: .6rem;
}

.quick-editor__chips {
  display: flex;
  flex-wrap: wrap;
  gap: .4rem;
}
</style>
