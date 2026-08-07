<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SquareImageUpload from '@/components/SquareImageUpload.vue'
import { squareImageSourceIsValid } from '@/services/avatarImage'
import type { SquareImageSource, SquareImageSourceValue } from '@/types/domain'

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
const sourceOptions: Array<{ title: string; value: SquareImageSource; icon: string }> = [
  { title: 'None', value: 'none', icon: 'mdi-image-off-outline' },
  { title: 'Upload', value: 'upload', icon: 'mdi-image-plus-outline' },
  { title: 'URL', value: 'url', icon: 'mdi-link-variant' },
]

const previewUrl = computed(() => {
  if (props.modelValue.source === 'url') return props.modelValue.url.trim()
  if (props.modelValue.source !== 'upload') return ''
  return uploadPreviewUrl.value
    || (props.modelValue.existingSource === 'upload' ? props.modelValue.existingUrl : '')
})
const urlIsValid = computed(() => props.modelValue.source !== 'url'
  || squareImageSourceIsValid(props.modelValue))

watch(() => props.modelValue.upload, (upload) => {
  releaseUploadPreview()
  if (upload) uploadPreviewUrl.value = URL.createObjectURL(upload)
  previewFailed.value = false
}, { immediate: true })

watch(() => [props.modelValue.source, props.modelValue.url], () => {
  previewFailed.value = false
})

onBeforeUnmount(releaseUploadPreview)

function updateSource(source: SquareImageSource) {
  emit('update:modelValue', {
    ...props.modelValue,
    source,
    url: source === 'url'
      ? props.modelValue.existingSource === 'url'
        ? props.modelValue.existingUrl
        : props.modelValue.url
      : props.modelValue.url,
  })
}

function updateUrl(url: string) {
  emit('update:modelValue', { ...props.modelValue, url, upload: undefined })
}

function useUpload(upload: Blob) {
  emit('update:modelValue', {
    ...props.modelValue,
    source: 'upload',
    upload,
  })
}

function releaseUploadPreview() {
  if (uploadPreviewUrl.value) URL.revokeObjectURL(uploadPreviewUrl.value)
  uploadPreviewUrl.value = ''
}
</script>

<template>
  <section class="flashcard-image-field">
    <SquareImageUpload
      ref="imageUpload"
      subject="flashcard"
      title="Adjust card image"
      description="Move and resize the image. It will be saved as a 256 × 256 square."
      save-label="Use image"
      :loading="loading"
      @upload="useUpload"
      @error="emit('error', $event)"
    />

    <div>
      <strong class="flashcard-image-field__title">Card image</strong>
      <p class="flashcard-image-field__hint">Optional · uploads are cropped to 256 × 256</p>
    </div>

    <v-btn-toggle
      :model-value="modelValue.source"
      mandatory
      color="secondary"
      variant="tonal"
      class="flashcard-image-field__sources"
      @update:model-value="updateSource"
    >
      <v-btn
        v-for="option in sourceOptions"
        :key="option.value"
        :value="option.value"
        :prepend-icon="option.icon"
      >
        {{ option.title }}
      </v-btn>
    </v-btn-toggle>

    <v-expand-transition>
      <div v-if="modelValue.source === 'url'" class="mt-4">
        <v-text-field
          :model-value="modelValue.url"
          label="Image URL"
          placeholder="https://example.com/image.jpg"
          autocomplete="off"
          :rules="[() => urlIsValid || 'Enter a complete HTTP or HTTPS URL']"
          @update:model-value="updateUrl"
        />
      </div>
    </v-expand-transition>

    <v-expand-transition>
      <div v-if="modelValue.source === 'upload'" class="flashcard-image-field__upload mt-4">
        <v-btn
          variant="tonal"
          color="secondary"
          prepend-icon="mdi-image-plus-outline"
          :disabled="loading"
          @click="imageUpload?.choose()"
        >
          {{ previewUrl ? 'Replace upload' : 'Choose image' }}
        </v-btn>
        <p>JPEG output, up to 256 × 256</p>
      </div>
    </v-expand-transition>

    <v-expand-transition>
      <div v-if="previewUrl && !previewFailed" class="flashcard-image-field__preview mt-4">
        <v-img
          :src="previewUrl"
          alt="Card image preview"
          width="256"
          max-width="100%"
          aspect-ratio="1"
          cover
          @error="previewFailed = true"
        />
      </div>
    </v-expand-transition>

    <v-alert
      v-if="previewFailed"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-4"
    >
      This image could not be previewed. Check the URL or choose another upload.
    </v-alert>
  </section>
</template>

<style scoped>
.flashcard-image-field { padding-top: .25rem; }
.flashcard-image-field__title { font-size: .82rem; font-weight: 850; }
.flashcard-image-field__hint { margin-top: .2rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; }
.flashcard-image-field__sources { display: grid; width: 100%; margin-top: .75rem; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
.flashcard-image-field__sources :deep(.v-btn) { width: 100%; min-width: 0; min-height: 2.75rem; }
.flashcard-image-field__upload { display: flex; align-items: center; gap: .75rem; }
.flashcard-image-field__upload p { color: rgba(var(--v-theme-on-surface), .52); font-size: .68rem; }
.flashcard-image-field__preview { display: grid; overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1rem; place-items: center; background: rgba(var(--v-theme-on-surface), .04); }

@media (max-width: 31.25rem) {
  .flashcard-image-field__sources :deep(.v-btn__prepend) { margin-inline-end: 0; }
  .flashcard-image-field__sources :deep(.v-btn__content) { font-size: .68rem; }
  .flashcard-image-field__upload { align-items: flex-start; flex-direction: column; }
}
</style>
