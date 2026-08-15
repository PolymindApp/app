<script setup lang="ts">
import { computed } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import { flashcardReviewSessionMenuItems } from '@/services/flashcards'
import type { FlashcardContextAction } from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: boolean
  busy?: boolean
  canManageCard?: boolean
  canAddCard?: boolean
  canEjectCard?: boolean
  showUndoEject?: boolean
  canUndoEject?: boolean
  canToggleTts?: boolean
  ttsPaused?: boolean
}>(), {
  busy: false,
  canManageCard: true,
  canAddCard: true,
  canEjectCard: true,
  showUndoEject: false,
  canUndoEject: false,
  canToggleTts: false,
  ttsPaused: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  action: [action: FlashcardContextAction]
}>()

function select(action: FlashcardContextAction) {
  emit('update:modelValue', false)
  emit('action', action)
}

const items = computed(() => flashcardReviewSessionMenuItems({
  showUndoEject: props.showUndoEject,
  showTtsToggle: props.canToggleTts,
  ttsPaused: props.ttsPaused,
}))

function itemDisabled(permission?: 'add' | 'manage' | 'eject' | 'undo_eject') {
  if (props.busy) return true
  if (permission === 'add') return !props.canAddCard
  if (permission === 'manage') return !props.canManageCard
  if (permission === 'eject') return !props.canEjectCard
  if (permission === 'undo_eject') return !props.canUndoEject
  return false
}
</script>

<template>
  <ActionBottomSheet
    :model-value="props.modelValue"
    title="Current context"
    aria-label="Current flashcard actions"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-for="item in items" :key="item.action">
      <v-divider v-if="'divider' in item && item.divider" class="my-1" />
      <v-list-item
        :title="item.title"
        :prepend-icon="item.icon"
        :base-color="'color' in item ? item.color : undefined"
        :disabled="itemDisabled('permission' in item ? item.permission : undefined)"
        @click="select(item.action)"
      />
    </template>
  </ActionBottomSheet>
</template>
