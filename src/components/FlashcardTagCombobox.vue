<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TagSelectionChip from '@/components/TagSelectionChip.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardTag } from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: string[]
  label?: string
  hint?: string
  disabled?: boolean
}>(), {
  label: 'Tags',
  hint: 'Select existing tags or type a new one',
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const store = useFlashcardStore()
const selection = ref<Array<FlashcardTag | string>>([])
const saving = ref(false)
const error = ref('')

const items = computed(() => store.tags)

watch(
  [() => props.modelValue, () => store.tags],
  ([ids]) => {
    const next = ids
      .map(id => store.tags.find(tag => tag.id === id))
      .filter((tag): tag is FlashcardTag => Boolean(tag))
    const currentIds = selection.value
      .filter((item): item is FlashcardTag => typeof item !== 'string')
      .map(tag => tag.id)
    if (next.map(tag => tag.id).join('|') !== currentIds.join('|')) selection.value = next
  },
  { immediate: true, deep: true },
)

async function updateSelection(value: Array<FlashcardTag | string>) {
  selection.value = value
  saving.value = true
  error.value = ''
  try {
    const resolved: FlashcardTag[] = []
    for (const item of value) {
      const tag = typeof item === 'string' ? await store.createTag(item) : item
      if (!resolved.some(existing => existing.id === tag.id)) resolved.push(tag)
    }
    selection.value = resolved
    emit('update:modelValue', resolved.map(tag => tag.id))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this tag.'
    selection.value = props.modelValue
      .map(id => store.tags.find(tag => tag.id === id))
      .filter((tag): tag is FlashcardTag => Boolean(tag))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-combobox
    :model-value="selection"
    :items="items"
    :label="label"
    :hint="error || hint"
    :error="Boolean(error)"
    persistent-hint
    item-title="name"
    item-value="id"
    return-object
    multiple
    chips
    closable-chips
    autocomplete="off"
    :loading="saving"
    :disabled="disabled || saving"
    @update:model-value="updateSelection"
  >
    <template #chip="{ props: chipProps, item }">
      <TagSelectionChip
        :chip-props="chipProps"
        :label="typeof item.raw === 'string' ? item.raw : item.raw.name"
      />
    </template>
    <template #item="{ props: itemProps, item }">
      <v-list-item v-bind="itemProps" prepend-icon="mdi-tag-outline" :title="item.raw.name" />
    </template>
    <template #no-data>
      <v-list-item prepend-icon="mdi-tag-plus-outline" title="Type a name and press Enter" />
    </template>
  </v-combobox>
</template>
