<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SquareImageUpload from '@/components/SquareImageUpload.vue'
import type { SquareImageSourceValue } from '@/types/domain'

const props = defineProps<{
  modelValue: SquareImageSourceValue
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SquareImageSourceValue]
  error: [message: string]
}>()

const imageUpload = ref<InstanceType<typeof SquareImageUpload>>()
const uploadPreviewUrl = ref('')
const previewFailed = ref(false)
const previewUrl = computed(() => uploadPreviewUrl.value || props.modelValue.existingUrl)

watch(() => props.modelValue.upload, (upload) => {
  releaseUploadPreview()
  if (upload) uploadPreviewUrl.value = URL.createObjectURL(upload)
  previewFailed.value = false
}, { immediate: true })

onBeforeUnmount(releaseUploadPreview)

function useUpload(upload: Blob) {
  emit('update:modelValue', {
    ...props.modelValue,
    source: 'upload',
    upload,
  })
}

function removeImage() {
  emit('update:modelValue', {
    ...props.modelValue,
    source: 'none',
    upload: undefined,
  })
}

function releaseUploadPreview() {
  if (uploadPreviewUrl.value) URL.revokeObjectURL(uploadPreviewUrl.value)
  uploadPreviewUrl.value = ''
}
</script>

<template>
  <section class="journal-image-field">
    <SquareImageUpload
      ref="imageUpload"
      subject="reflection"
      title="Adjust reflection image"
      description="Move and resize the image. It will be saved as a 512 × 512 square."
      save-label="Use image"
      :output-size="512"
      :loading="loading"
      @upload="useUpload"
      @error="emit('error', $event)"
    />

    <div>
      <strong class="journal-image-field__title">Image</strong>
      <p class="journal-image-field__hint">Optional · uploads are cropped to 512 × 512</p>
    </div>

    <div class="journal-image-field__actions mt-3">
      <v-btn
        variant="tonal"
        color="secondary"
        prepend-icon="mdi-image-plus-outline"
        :disabled="loading"
        @click="imageUpload?.choose()"
      >
        {{ previewUrl && modelValue.source !== 'none' ? 'Replace image' : 'Choose image' }}
      </v-btn>
      <v-btn
        v-if="previewUrl && modelValue.source !== 'none'"
        variant="text"
        color="error"
        prepend-icon="mdi-image-remove-outline"
        :disabled="loading"
        @click="removeImage"
      >
        Remove
      </v-btn>
    </div>

    <v-expand-transition>
      <div
        v-if="previewUrl && modelValue.source !== 'none' && !previewFailed"
        class="journal-image-field__preview mt-4"
      >
        <v-img
          :src="previewUrl"
          alt="Reflection image preview"
          width="512"
          max-width="100%"
          aspect-ratio="1"
          contain
          @error="previewFailed = true"
        />
      </div>
    </v-expand-transition>

    <v-alert
      v-if="previewFailed && modelValue.source !== 'none'"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-4"
    >
      This image could not be previewed. Choose another upload.
    </v-alert>
  </section>
</template>

<style scoped>
.journal-image-field { min-width: 0; max-width: 100%; padding-top: .25rem; }
.journal-image-field__title { font-size: .82rem; font-weight: 850; }
.journal-image-field__hint { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
.journal-image-field__actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.journal-image-field__preview { display: grid; width: 100%; max-width: 100%; overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1rem; place-items: center; background: rgba(var(--v-theme-on-surface), .04); }
.journal-image-field__preview :deep(img) { max-width: 100%; }
</style>
