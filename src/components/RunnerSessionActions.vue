<script setup lang="ts">
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import type { RunnerSessionAction, RunnerSessionMenuItem } from '@/types/domain'

const props = defineProps<{
  modelValue: boolean
  title: string
  ariaLabel: string
  items: RunnerSessionMenuItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  action: [action: RunnerSessionAction]
}>()

function select(item: RunnerSessionMenuItem) {
  if (item.disabled) return
  emit('update:modelValue', false)
  emit('action', item.action)
}
</script>

<template>
  <ActionBottomSheet
    :model-value="props.modelValue"
    :title="props.title"
    :aria-label="props.ariaLabel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-for="item in props.items" :key="item.action">
      <v-divider v-if="item.divider" class="my-1" />
      <v-list-item
        :title="item.title"
        :prepend-icon="item.icon"
        :base-color="item.color"
        :active="item.active"
        :active-color="item.active ? 'secondary' : undefined"
        :disabled="item.disabled"
        :aria-pressed="item.toggle ? item.active : undefined"
        rounded="lg"
        @click="select(item)"
      >
        <template v-if="item.toggle" #append>
          <v-icon
            :icon="item.active ? 'mdi-check-circle' : 'mdi-circle-outline'"
            :color="item.active ? 'secondary' : undefined"
            size="20"
          />
        </template>
      </v-list-item>
    </template>
  </ActionBottomSheet>
</template>
