<script setup lang="ts">
import { computed } from 'vue'
import { flashcardTextFontSize } from '@/services/flashcards'

const props = withDefaults(defineProps<{
  back: string
  note?: string
  noteBeforeBack?: boolean
  density?: 'full' | 'compact'
}>(), {
  note: '',
  noteBeforeBack: false,
  density: 'full',
})

const parts = computed<Array<{ kind: 'back' | 'note'; value: string }>>(() => {
  const back = { kind: 'back' as const, value: props.back }
  if (!props.note) return [back]
  const note = { kind: 'note' as const, value: props.note }
  return props.noteBeforeBack ? [note, back] : [back, note]
})
</script>

<template>
  <span :class="['flashcard-response-text', `flashcard-response-text--${density}`]">
    <template v-for="part in parts" :key="part.kind">
      <strong
        v-if="part.kind === 'back'"
        class="flashcard-response-text__back text-secondary"
        data-response-part="back"
        :style="{ fontSize: flashcardTextFontSize(part.value, 'face', density) }"
      >
        {{ part.value }}
      </strong>
      <span
        v-else
        class="flashcard-response-text__note"
        data-response-part="note"
        :style="{ fontSize: flashcardTextFontSize(part.value, 'note', density) }"
      >
        {{ part.value }}
      </span>
    </template>
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

.flashcard-response-text__back {
  max-width: 34rem;
  overflow-wrap: anywhere;
  font-weight: 850;
  line-height: 1.35;
  white-space: pre-wrap;
}

.flashcard-response-text__note {
  max-width: 32rem;
  color: rgba(var(--v-theme-on-surface), .6);
  font-weight: 650;
  line-height: 1.5;
  white-space: pre-wrap;
}

.flashcard-response-text--compact {
  gap: .65rem;
}

.flashcard-response-text--compact .flashcard-response-text__back {
  font-weight: 700;
  line-height: 1.3;
}

.flashcard-response-text--compact .flashcard-response-text__note {
  color: rgba(var(--v-theme-on-surface), .58);
  line-height: 1.45;
}
</style>
