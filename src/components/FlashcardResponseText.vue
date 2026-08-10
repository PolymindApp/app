<script setup lang="ts">
import { computed } from 'vue'
import { flashcardTextFontSize } from '@/services/flashcards'

const props = withDefaults(defineProps<{
  back: string
  note?: string
  noteBeforeBack?: boolean
  density?: 'full' | 'compact'
  reserveNoteSpace?: boolean
}>(), {
  note: '',
  noteBeforeBack: false,
  density: 'full',
  reserveNoteSpace: false,
})

type ResponsePart = {
  kind: 'back' | 'note'
  presentation: 'primary' | 'supporting'
  value: string
  placeholder?: boolean
}

const parts = computed<ResponsePart[]>(() => {
  const back = { kind: 'back' as const, value: props.back }
  if (!props.note && !props.reserveNoteSpace) return [{ ...back, presentation: 'primary' }]
  const note = {
    kind: 'note' as const,
    value: props.note,
    placeholder: !props.note,
  }
  return props.noteBeforeBack
    ? [
        { ...note, presentation: 'primary' },
        { ...back, presentation: 'supporting' },
      ]
    : [
        { ...back, presentation: 'primary' },
        { ...note, presentation: 'supporting' },
      ]
})
</script>

<template>
  <span :class="['flashcard-response-text', `flashcard-response-text--${density}`]">
    <component
      :is="part.presentation === 'primary' ? 'strong' : 'span'"
      v-for="part in parts"
      :key="part.kind"
      :class="[
        'flashcard-response-text__part',
        `flashcard-response-text__${part.presentation}`,
        {
          'flashcard-response-text__placeholder': part.placeholder,
          'text-secondary': part.presentation === 'primary',
        },
      ]"
      :aria-hidden="part.placeholder ? 'true' : undefined"
      :data-response-part="part.kind"
      :data-response-presentation="part.presentation"
      :style="{
        fontSize: flashcardTextFontSize(
          part.value,
          part.presentation === 'primary' ? 'face' : 'note',
          density,
        ),
      }"
    >
      {{ part.value }}
    </component>
  </span>
</template>

<style scoped>
.flashcard-response-text {
  display: flex;
  max-width: 100%;
  align-items: center;
  flex-direction: column;
  gap: .45rem;
}

.flashcard-response-text__part {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.flashcard-response-text__placeholder {
  visibility: hidden;
}

.flashcard-response-text__placeholder::before {
  content: '\00a0';
}

.flashcard-response-text__primary {
  max-width: 34rem;
  font-weight: 850;
  line-height: 1.35;
}

.flashcard-response-text__supporting {
  max-width: 32rem;
  color: rgba(var(--v-theme-on-surface), .6);
  font-weight: 650;
  line-height: 1.5;
}

.flashcard-response-text--compact {
  gap: .65rem;
}

.flashcard-response-text--compact .flashcard-response-text__primary {
  font-weight: 700;
  line-height: 1.3;
}

.flashcard-response-text--compact .flashcard-response-text__supporting {
  color: rgba(var(--v-theme-on-surface), .58);
  line-height: 1.45;
}
</style>
