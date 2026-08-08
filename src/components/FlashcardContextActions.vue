<script setup lang="ts">
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'

export type FlashcardContextAction =
  | 'previous'
  | 'toggle-pause'
  | 'next'
  | 'add'
  | 'edit'
  | 'remove'
  | 'settings'

const props = withDefaults(defineProps<{
  modelValue: boolean
  paused?: boolean
  busy?: boolean
  canPrevious?: boolean
  canNext?: boolean
  canManageCard?: boolean
  canAddCard?: boolean
}>(), {
  paused: false,
  busy: false,
  canPrevious: true,
  canNext: true,
  canManageCard: true,
  canAddCard: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  action: [action: FlashcardContextAction]
}>()

function select(action: FlashcardContextAction) {
  emit('update:modelValue', false)
  emit('action', action)
}
</script>

<template>
  <ActionBottomSheet
    :model-value="props.modelValue"
    title="Current context"
    aria-label="Current flashcard and interval actions"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #content>
      <div class="flashcard-context-navigation" aria-label="Playback navigation">
        <div>
          <v-btn
            icon="mdi-skip-previous"
            variant="tonal"
            aria-label="Previous"
            :disabled="busy || !canPrevious"
            @click="select('previous')"
          />
          <span>Previous</span>
        </div>
        <div>
          <v-btn
            :icon="paused ? 'mdi-play' : 'mdi-pause'"
            color="secondary"
            :aria-label="paused ? 'Resume' : 'Pause'"
            :disabled="busy"
            @click="select('toggle-pause')"
          />
          <span>{{ paused ? 'Resume' : 'Pause' }}</span>
        </div>
        <div>
          <v-btn
            icon="mdi-skip-next"
            variant="tonal"
            aria-label="Next"
            :disabled="busy || !canNext"
            @click="select('next')"
          />
          <span>Next</span>
        </div>
      </div>
    </template>

    <v-list-item
      title="Add card"
      prepend-icon="mdi-card-plus-outline"
      :disabled="busy || !canAddCard"
      @click="select('add')"
    />
    <v-list-item
      title="Edit card"
      prepend-icon="mdi-pencil-outline"
      :disabled="busy || !canManageCard"
      @click="select('edit')"
    />
    <v-list-item
      title="Remove card"
      prepend-icon="mdi-delete-outline"
      base-color="error"
      :disabled="busy || !canManageCard"
      @click="select('remove')"
    />
    <v-divider class="my-1" />
    <v-list-item
      title="Settings"
      prepend-icon="mdi-tune-variant"
      :disabled="busy"
      @click="select('settings')"
    />
  </ActionBottomSheet>
</template>

<style scoped>
.flashcard-context-navigation {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  justify-items: center;
  gap: 1rem;
}

.flashcard-context-navigation :deep(.v-btn) {
  width: 3.25rem;
  height: 3.25rem;
}

.flashcard-context-navigation > div {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: .4rem;
  color: rgba(var(--v-theme-on-surface), .64);
  font-size: .7rem;
  font-weight: 800;
}
</style>
