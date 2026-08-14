<script setup lang="ts">
import { useDisplay } from 'vuetify'
import AppDialog from '@/components/AppDialog.vue'
import ImageLibrarySearchPanel from '@/components/ImageLibrarySearchPanel.vue'
import type { ImageLibraryAsset } from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: boolean
  initialQuery?: string
  selectedImageId?: number
}>(), {
  initialQuery: '',
  selectedImageId: 0,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  select: [image: ImageLibraryAsset]
}>()

const { smAndDown } = useDisplay()

function close() {
  emit('update:modelValue', false)
}

function select(image: ImageLibraryAsset) {
  emit('select', image)
  close()
}
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    :fullscreen="smAndDown"
    max-width="64rem"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="image-library-picker">
      <header class="image-library-picker__header">
        <div class="min-width-0">
          <h2 class="text-h6 font-weight-black">Choose a library image</h2>
          <p class="image-library-picker__subtitle">Search common words in your language.</p>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Close image library"
          @click="close"
        />
      </header>

      <v-divider />

      <v-card-text class="image-library-picker__body">
        <ImageLibrarySearchPanel
          :active="modelValue"
          :initial-query="initialQuery"
          :selected-image-id="selectedImageId"
          focus-on-open
          @select="select"
        />
      </v-card-text>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.image-library-picker { max-height: min(54rem, calc(100dvh - 2rem)); }
.image-library-picker__header { display: flex; align-items: center; justify-content: space-between; min-height: 4rem; padding: .75rem 1rem .75rem 1.25rem; gap: 1rem; }
.image-library-picker__subtitle { margin-top: .1rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .75rem; }
.image-library-picker__body { padding: 1rem 1.25rem 1.5rem; }

@media (max-width: 37.5rem) {
  .image-library-picker { max-height: 100dvh; padding-bottom: max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)); }
  .image-library-picker__header { padding-top: max(.75rem, env(safe-area-inset-top, 0rem)); }
  .image-library-picker__body { padding: .75rem .75rem 1.25rem; }
}
</style>
