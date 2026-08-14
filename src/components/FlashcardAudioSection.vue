<script setup lang="ts">
import FlashcardAudioField from '@/components/FlashcardAudioField.vue'
import type { FlashcardAudioValue } from '@/types/domain'

defineProps<{
  front: FlashcardAudioValue
  back: FlashcardAudioValue
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:front': [value: FlashcardAudioValue]
  'update:back': [value: FlashcardAudioValue]
  'recording-change': [side: 'front' | 'back', recording: boolean]
  error: [message: string]
}>()
</script>

<template>
  <section class="flashcard-audio-section">
    <div>
      <strong class="flashcard-audio-section__title">Recorded audio</strong>
      <p class="flashcard-audio-section__hint">
        Optional · each face recording plays instead of text-to-speech
      </p>
    </div>
    <v-row dense>
      <v-col cols="12" md="6">
        <FlashcardAudioField
          :model-value="front"
          label="Front audio"
          :disabled="disabled"
          @update:model-value="emit('update:front', $event)"
          @recording-change="emit('recording-change', 'front', $event)"
          @error="emit('error', $event)"
        />
      </v-col>
      <v-col cols="12" md="6">
        <FlashcardAudioField
          :model-value="back"
          label="Back audio"
          :disabled="disabled"
          @update:model-value="emit('update:back', $event)"
          @recording-change="emit('recording-change', 'back', $event)"
          @error="emit('error', $event)"
        />
      </v-col>
    </v-row>
  </section>
</template>

<style scoped>
.flashcard-audio-section { display: grid; gap: .5rem; padding-top: .25rem; }
.flashcard-audio-section__title { font-size: .82rem; font-weight: 850; }
.flashcard-audio-section__hint { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
</style>
