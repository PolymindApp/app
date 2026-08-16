<script setup lang="ts">
import { Camera, CameraDirection, EncodingType } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppDialog from '@/components/AppDialog.vue'
import {
  clampSquareImageCrop,
  compressSquareImage,
  squareImageCropMetrics,
} from '@/services/avatarImage'

const props = withDefaults(defineProps<{
  loading?: boolean
  subject?: string
  title?: string
  description?: string
  saveLabel?: string
  outputSize?: number
}>(), {
  loading: false,
  subject: 'image',
  title: 'Adjust image',
  description: 'Move the image, then use the slider to resize it.',
  saveLabel: 'Use image',
  outputSize: 256,
})

const emit = defineEmits<{
  upload: [image: Blob]
  error: [message: string]
}>()

const existingImageInput = ref<HTMLInputElement>()
const cropImage = ref<HTMLImageElement>()
const cropViewport = ref<HTMLElement>()
const sourceActions = ref(false)
const cropDialog = ref(false)
const cropError = ref('')
const sourceUrl = ref('')
const sourceWidth = ref(1)
const sourceHeight = ref(1)
const viewportSize = ref(280)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const compressing = ref(false)
const cameraOpening = ref(false)
const mobilePlatform = ['android', 'ios'].includes(Capacitor.getPlatform())
let resizeObserver: ResizeObserver | undefined
let drag: {
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
} | undefined

const crop = computed(() => ({
  viewportSize: viewportSize.value,
  imageWidth: sourceWidth.value,
  imageHeight: sourceHeight.value,
  zoom: zoom.value,
  offsetX: offsetX.value,
  offsetY: offsetY.value,
}))
const imageStyle = computed(() => {
  const metrics = squareImageCropMetrics(crop.value)
  return {
    width: `${metrics.renderedWidth}px`,
    height: `${metrics.renderedHeight}px`,
    transform: `translate(calc(-50% + ${offsetX.value}px), calc(-50% + ${offsetY.value}px))`,
  }
})
const outputSize = computed(() => Math.min(512, Math.max(1, Math.round(props.outputSize))))

watch(zoom, (nextZoom, previousZoom) => {
  if (previousZoom > 0 && nextZoom !== previousZoom) {
    const ratio = nextZoom / previousZoom
    offsetX.value *= ratio
    offsetY.value *= ratio
  }
  clampOffsets()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  releaseSourceUrl()
})

function choose() {
  if (mobilePlatform) {
    sourceActions.value = true
    return
  }
  existingImageInput.value?.click()
}

async function takePhoto() {
  sourceActions.value = false
  if (cameraOpening.value) return
  cameraOpening.value = true
  try {
    const photo = await Camera.takePhoto({
      quality: 90,
      targetWidth: 2048,
      targetHeight: 2048,
      correctOrientation: true,
      encodingType: EncodingType.JPEG,
      saveToGallery: false,
      cameraDirection: CameraDirection.Rear,
    })
    const response = await fetch(photo.webPath)
    if (!response.ok) throw new Error('The captured photo could not be opened.')
    const blob = await response.blob()
    openImage(blob.type.startsWith('image/') ? blob : blob.slice(0, blob.size, 'image/jpeg'))
  } catch (cause) {
    if (cameraErrorCode(cause) === 'OS-PLUG-CAMR-0006') return
    emit('error', cause instanceof Error
      ? cause.message
      : 'The camera could not be opened.')
  } finally {
    cameraOpening.value = false
  }
}

function chooseExisting() {
  sourceActions.value = false
  existingImageInput.value?.click()
}

function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  openImage(file)
}

function openImage(file: Blob) {
  if (!file.type.startsWith('image/')) {
    emit('error', 'Choose an image file.')
    return
  }
  if (file.size > 15_000_000) {
    emit('error', 'Choose an image smaller than 15 MB.')
    return
  }

  const objectUrl = URL.createObjectURL(file)
  const probe = new Image()
  probe.onload = async () => {
    releaseSourceUrl()
    sourceUrl.value = objectUrl
    sourceWidth.value = probe.naturalWidth
    sourceHeight.value = probe.naturalHeight
    zoom.value = 1
    offsetX.value = 0
    offsetY.value = 0
    cropError.value = ''
    cropDialog.value = true
    await nextTick()
    observeViewport()
  }
  probe.onerror = () => {
    URL.revokeObjectURL(objectUrl)
    emit('error', 'This image format cannot be opened on this device.')
  }
  probe.src = objectUrl
}

function cameraErrorCode(cause: unknown) {
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return ''
  return typeof cause.code === 'string' ? cause.code : ''
}

function observeViewport() {
  resizeObserver?.disconnect()
  updateViewportSize()
  if (!cropViewport.value || typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(updateViewportSize)
  resizeObserver.observe(cropViewport.value)
}

function updateViewportSize() {
  const size = cropViewport.value?.clientWidth
  if (!size) return
  viewportSize.value = size
  clampOffsets()
}

function clampOffsets() {
  const clamped = clampSquareImageCrop(crop.value)
  offsetX.value = clamped.offsetX
  offsetY.value = clamped.offsetY
}

function beginDrag(event: PointerEvent) {
  if (props.loading) return
  drag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: offsetX.value,
    offsetY: offsetY.value,
  }
  cropViewport.value?.setPointerCapture(event.pointerId)
}

function moveDrag(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return
  offsetX.value = drag.offsetX + event.clientX - drag.startX
  offsetY.value = drag.offsetY + event.clientY - drag.startY
  clampOffsets()
}

function endDrag(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return
  if (cropViewport.value?.hasPointerCapture(event.pointerId)) {
    cropViewport.value.releasePointerCapture(event.pointerId)
  }
  drag = undefined
}

async function saveCrop() {
  if (!cropImage.value || props.loading || compressing.value) return
  compressing.value = true
  cropError.value = ''
  try {
    const blob = await compressSquareImage(cropImage.value, crop.value, outputSize.value)
    emit('upload', blob)
    closeCrop(true)
  } catch (cause) {
    cropError.value = cause instanceof Error
      ? cause.message
      : 'The selected image could not be prepared.'
  } finally {
    compressing.value = false
  }
}

function closeCrop(force = false) {
  if (!force && (props.loading || compressing.value)) return
  cropDialog.value = false
  resizeObserver?.disconnect()
  resizeObserver = undefined
  releaseSourceUrl()
}

function releaseSourceUrl() {
  if (sourceUrl.value) URL.revokeObjectURL(sourceUrl.value)
  sourceUrl.value = ''
}

defineExpose({ choose })
</script>

<template>
  <input
    ref="existingImageInput"
    class="square-image-file-input"
    type="file"
    accept="image/*"
    :aria-label="`Choose a ${subject} image`"
    @change="handleFile"
  />
  <ActionBottomSheet
    v-model="sourceActions"
    title="Add image"
    :description="`Take a new ${subject} photo or choose one already on this device.`"
    :aria-label="`Choose ${subject} image source`"
  >
    <v-list-item
      prepend-icon="mdi-camera-outline"
      title="Take photo"
      rounded="lg"
      @click="takePhoto"
    />
    <v-list-item
      prepend-icon="mdi-image-outline"
      title="Choose existing"
      rounded="lg"
      @click="chooseExisting"
    />
  </ActionBottomSheet>

  <AppDialog
    :model-value="cropDialog"
    max-width="520"
    persistent
    @update:model-value="!$event && closeCrop()"
  >
    <v-card class="crop-card">
      <div class="crop-header">
        <div>
          <h2>{{ title }}</h2>
          <p>{{ description }}</p>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="`Cancel ${subject} upload`"
          :disabled="loading || compressing"
          @click="closeCrop()"
        />
      </div>

      <v-alert v-if="cropError" type="error" variant="tonal" class="mb-4">
        {{ cropError }}
      </v-alert>

      <div
        ref="cropViewport"
        class="crop-viewport"
        @pointerdown.prevent="beginDrag"
        @pointermove.prevent="moveDrag"
        @pointerup.prevent="endDrag"
        @pointercancel="endDrag"
      >
        <img
          v-if="sourceUrl"
          ref="cropImage"
          :src="sourceUrl"
          :alt="`Selected ${subject} crop`"
          draggable="false"
          :style="imageStyle"
        />
        <div class="crop-frame" aria-hidden="true" />
      </div>

      <div class="crop-resize">
        <div class="crop-resize__heading">
          <strong>Image size</strong>
          <span>{{ Math.round(zoom * 100) }}%</span>
        </div>
        <div class="crop-resize__control">
          <v-icon icon="mdi-image-size-select-small" size="20" aria-hidden="true" />
          <v-slider
            v-model="zoom"
            :min="1"
            :max="3"
            :step=".01"
            :track-size="6"
            :thumb-size="26"
            color="secondary"
            hide-details="auto"
            :disabled="loading || compressing"
            aria-label="Image size"
          />
          <v-icon icon="mdi-image-size-select-large" size="22" aria-hidden="true" />
        </div>
      </div>

      <div class="crop-actions">
        <v-btn variant="text" :disabled="loading || compressing" @click="closeCrop()">
          Cancel
        </v-btn>
        <v-btn color="secondary" size="large" :loading="loading || compressing" @click="saveCrop">
          {{ saveLabel }}
        </v-btn>
      </div>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.square-image-file-input { position: fixed; width: .0625rem; height: .0625rem; overflow: hidden; opacity: 0; pointer-events: none; }
.crop-card { padding: clamp(1rem, 4vw, 1.5rem); }
.crop-header { display: grid; margin-bottom: 1.25rem; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 1rem; }
.crop-header h2 { font-size: 1.15rem; font-weight: 900; }
.crop-header p { margin-top: .25rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .78rem; }
.crop-viewport {
  position: relative;
  width: min(100%, 22.5rem);
  margin: auto;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 1.125rem;
  background:
    linear-gradient(45deg, rgb(var(--v-theme-surface-variant)) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(var(--v-theme-surface-variant)) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(var(--v-theme-surface-variant)) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(var(--v-theme-surface-variant)) 75%);
  background-position: 0 0, 0 .5rem, .5rem -.5rem, -.5rem 0;
  background-size: 1rem 1rem;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.crop-viewport:active { cursor: grabbing; }
.crop-viewport img { position: absolute; top: 50%; left: 50%; max-width: none; pointer-events: none; user-select: none; }
.crop-frame { position: absolute; inset: 0; border: .125rem solid rgba(var(--v-theme-secondary), .9); border-radius: inherit; box-shadow: inset 0 0 0 .0625rem rgba(0, 0, 0, .2); pointer-events: none; }
.crop-frame::before,
.crop-frame::after { position: absolute; content: ""; background: rgba(var(--v-theme-on-surface), .28); }
.crop-frame::before { inset: 33.333% 0; border-top: .0625rem solid rgba(var(--v-theme-on-surface), .28); border-bottom: .0625rem solid rgba(var(--v-theme-on-surface), .28); background: transparent; }
.crop-frame::after { inset: 0 33.333%; border-right: .0625rem solid rgba(var(--v-theme-on-surface), .28); border-left: .0625rem solid rgba(var(--v-theme-on-surface), .28); background: transparent; }
.crop-resize { max-width: 25rem; margin: 1.25rem 0; }
.crop-resize__heading { display: flex; margin-bottom: .6rem; align-items: center; justify-content: space-between; gap: 1rem; font-size: .78rem; }
.crop-resize__heading strong { font-weight: 850; }
.crop-resize__heading span { color: rgba(var(--v-theme-on-surface), .58); font-variant-numeric: tabular-nums; }
.crop-resize__control { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .75rem; }
.crop-resize__control :deep(.v-slider) { width: 100%; min-width: 0; }
.crop-actions { display: flex; margin-top: 1rem; align-items: center; justify-content: flex-end; gap: .5rem; }

@media (max-width: 37.4375rem) {
  .crop-viewport { width: min(100%, 52dvh, 26.25rem); }
  .crop-actions { display: grid; grid-template-columns: 1fr 1fr; }
}
</style>
