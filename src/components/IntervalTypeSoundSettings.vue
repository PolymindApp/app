<script setup lang="ts">
import IntervalTypeIcon from '@/components/IntervalTypeIcon.vue'
import {
  INTERVAL_CUE_SOUND_OPTIONS,
  INTERVAL_STEP_TYPES,
} from '@/services/intervalTypes'
import type {
  IntervalCueSound,
  IntervalStepKind,
  IntervalTypeSoundSettings,
} from '@/types/domain'

defineProps<{
  modelValue: IntervalTypeSoundSettings
  disabled?: boolean
  previewing?: IntervalStepKind
}>()

const emit = defineEmits<{
  change: [kind: IntervalStepKind, sound: IntervalCueSound]
  preview: [kind: IntervalStepKind, sound: IntervalCueSound]
}>()

function changeSound(kind: IntervalStepKind, value: unknown) {
  const sound = INTERVAL_CUE_SOUND_OPTIONS.find(option => option.value === value)?.value
  if (sound) emit('change', kind, sound)
}
</script>

<template>
  <div class="interval-sound-list">
    <div
      v-for="type in INTERVAL_STEP_TYPES"
      :key="type.value"
      class="interval-sound-item"
    >
      <IntervalTypeIcon :kind="type.value" size="2rem" />
      <strong>{{ type.title }}</strong>
      <div class="interval-sound-item__controls">
        <v-select
          :model-value="modelValue[type.value]"
          :items="INTERVAL_CUE_SOUND_OPTIONS"
          :label="`${type.title} sound`"
          density="compact"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="changeSound(type.value, $event)"
        />
        <v-btn
          icon="mdi-volume-high"
          variant="tonal"
          color="secondary"
          :aria-label="`Preview ${type.title} sound`"
          :loading="previewing === type.value"
          :disabled="disabled || modelValue[type.value] === 'none'"
          @touchstart.stop
          @click.stop="emit('preview', type.value, modelValue[type.value])"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.interval-sound-list {
  display: grid;
  gap: .75rem;
  margin-top: 1.25rem;
}

.interval-sound-item {
  display: grid;
  min-width: 0;
  padding: .75rem;
  grid-template-columns: 2rem minmax(0, 1fr) minmax(14rem, 18rem);
  align-items: center;
  gap: .75rem;
  border: .0625rem solid rgba(var(--v-theme-on-surface), .1);
  border-radius: 1rem;
  background: rgba(var(--v-theme-surface-variant), .28);
}

.interval-sound-item > strong {
  min-width: 0;
  font-size: .84rem;
}

.interval-sound-item__controls {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 2.75rem;
  align-items: center;
  gap: .5rem;
}

.interval-sound-item__controls :deep(.v-btn) {
  width: 2.75rem;
  height: 2.75rem;
}

@media (max-width: 37.5rem) {
  .interval-sound-item {
    grid-template-columns: 2rem minmax(0, 1fr);
  }

  .interval-sound-item__controls {
    grid-column: 1 / -1;
  }
}
</style>
