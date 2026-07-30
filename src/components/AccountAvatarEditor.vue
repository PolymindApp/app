<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import {
  avatarCropMetrics,
  clampAvatarCrop,
  compressAvatar,
} from '@/services/avatarImage'

const props = defineProps<{
  avatarUrl?: string
  initials: string
  loading?: boolean
}>()

const emit = defineEmits<{
  upload: [image: Blob]
  remove: []
  error: [message: string]
}>()

const { smAndDown } = useDisplay()
const fileInput = ref<HTMLInputElement>()
const cropImage = ref<HTMLImageElement>()
const cropViewport = ref<HTMLElement>()
const desktopMenu = ref(false)
const actionsDrawer = ref(false)
const cropDialog = ref(false)
const removeDialog = ref(false)
const imageFailed = ref(false)
const cropError = ref('')
const sourceUrl = ref('')
const sourceWidth = ref(1)
const sourceHeight = ref(1)
const viewportSize = ref(280)
const zoom = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const compressing = ref(false)
const pendingUpload = ref(false)
let avatarAtUpload = ''
let resizeObserver: ResizeObserver | undefined
let drag: {
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
} | undefined

const hasAvatar = computed(() => Boolean(props.avatarUrl))
const showImage = computed(() => hasAvatar.value && !imageFailed.value)
const crop = computed(() => ({
  viewportSize: viewportSize.value,
  imageWidth: sourceWidth.value,
  imageHeight: sourceHeight.value,
  zoom: zoom.value,
  offsetX: offsetX.value,
  offsetY: offsetY.value,
}))
const imageStyle = computed(() => {
  const metrics = avatarCropMetrics(crop.value)
  return {
    width: `${metrics.renderedWidth}px`,
    height: `${metrics.renderedHeight}px`,
    transform: `translate(calc(-50% + ${offsetX.value}px), calc(-50% + ${offsetY.value}px))`,
  }
})

watch(() => props.avatarUrl, (avatarUrl) => {
  imageFailed.value = false
  if (!avatarUrl) removeDialog.value = false
  if (pendingUpload.value && avatarUrl && avatarUrl !== avatarAtUpload) {
    pendingUpload.value = false
    closeCrop(true)
  }
})

watch(() => props.loading, (loading, wasLoading) => {
  if (wasLoading && !loading && pendingUpload.value && props.avatarUrl === avatarAtUpload) {
    pendingUpload.value = false
  }
})

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

function choosePhoto() {
  desktopMenu.value = false
  actionsDrawer.value = false
  fileInput.value?.click()
}

function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
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
  const clamped = clampAvatarCrop(crop.value)
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
    const blob = await compressAvatar(cropImage.value, crop.value)
    pendingUpload.value = true
    avatarAtUpload = props.avatarUrl || ''
    emit('upload', blob)
  } catch (cause) {
    pendingUpload.value = false
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

function requestRemoval() {
  desktopMenu.value = false
  actionsDrawer.value = false
  removeDialog.value = true
}
</script>

<template>
  <input
    ref="fileInput"
    class="avatar-file-input"
    type="file"
    accept="image/*"
    aria-label="Choose an avatar image"
    @change="handleFile"
  />

  <button
    v-if="!hasAvatar"
    type="button"
    class="avatar-button"
    aria-label="Upload an avatar"
    @click="choosePhoto"
  >
    <v-avatar color="secondary" size="72">
      <span>{{ initials }}</span>
    </v-avatar>
    <span class="avatar-edit-icon"><v-icon icon="mdi-camera-plus-outline" size="17" /></span>
  </button>

  <button
    v-else-if="smAndDown"
    type="button"
    class="avatar-button"
    aria-label="Open avatar actions"
    @click="actionsDrawer = true"
  >
    <v-avatar color="secondary" size="72">
      <v-img v-if="showImage" :src="avatarUrl" alt="" cover @error="imageFailed = true" />
      <span v-else>{{ initials }}</span>
    </v-avatar>
    <span class="avatar-edit-icon"><v-icon icon="mdi-camera-outline" size="17" /></span>
  </button>

  <v-menu v-else v-model="desktopMenu" location="bottom start">
    <template #activator="{ props: menuProps }">
      <button
        v-bind="menuProps"
        type="button"
        class="avatar-button"
        aria-label="Open avatar actions"
      >
        <v-avatar color="secondary" size="72">
          <v-img v-if="showImage" :src="avatarUrl" alt="" cover @error="imageFailed = true" />
          <span v-else>{{ initials }}</span>
        </v-avatar>
        <span class="avatar-edit-icon"><v-icon icon="mdi-camera-outline" size="17" /></span>
      </button>
    </template>
    <v-list density="compact">
      <v-list-item prepend-icon="mdi-image-plus-outline" title="Upload new avatar" @click="choosePhoto" />
      <v-list-item prepend-icon="mdi-delete-outline" title="Remove" base-color="error" @click="requestRemoval" />
    </v-list>
  </v-menu>

  <v-navigation-drawer
    v-if="smAndDown"
    v-model="actionsDrawer"
    temporary
    location="bottom"
    class="avatar-actions-drawer"
  >
    <div class="drawer-handle" aria-hidden="true" />
    <div class="pa-4 pb-2">
      <strong>Avatar</strong>
    </div>
    <v-list class="px-2 pb-4">
      <v-list-item prepend-icon="mdi-image-plus-outline" title="Upload new avatar" rounded="lg" @click="choosePhoto" />
      <v-list-item prepend-icon="mdi-delete-outline" title="Remove" rounded="lg" base-color="error" @click="requestRemoval" />
    </v-list>
  </v-navigation-drawer>

  <v-dialog
    :model-value="cropDialog"
    max-width="520"
    persistent
  >
    <v-card class="crop-card">
      <div class="crop-header">
        <div>
          <h2>Adjust your avatar</h2>
          <p>Move the image, then use the slider to resize it.</p>
        </div>
        <v-btn icon="mdi-close" variant="text" aria-label="Cancel avatar upload" :disabled="loading || compressing" @click="closeCrop()" />
      </div>

      <v-alert v-if="cropError" type="error" variant="tonal" class="mb-4">{{ cropError }}</v-alert>

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
          alt="Selected avatar crop"
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
            style="min-width: 50dvw"
            color="secondary"
            hide-details
            :disabled="loading || compressing"
            aria-label="Image size"
          />
          <v-icon icon="mdi-image-size-select-large" class="ml-4" size="22" aria-hidden="true" />
        </div>
      </div>

      <div class="crop-actions">
        <v-btn variant="text" :disabled="loading || compressing" @click="closeCrop()">Cancel</v-btn>
        <v-btn color="secondary" :loading="loading || compressing" @click="saveCrop">Save avatar</v-btn>
      </div>
    </v-card>
  </v-dialog>

  <ConfirmDialog
    v-model="removeDialog"
    title="Remove your avatar?"
    message="Your monogram will be shown instead."
    confirm-text="Remove avatar"
    icon="mdi-delete-outline"
    :loading="loading"
    @confirm="emit('remove')"
  />
</template>

<style scoped>
.avatar-file-input {
  position: fixed;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}

.avatar-button {
  position: relative;
  display: block;
  width: 76px;
  height: 76px;
  flex: 0 0 auto;
  padding: 2px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.avatar-button:focus-visible {
  outline: 3px solid rgb(var(--v-theme-secondary) / .55);
  outline-offset: 3px;
}

.avatar-button :deep(.v-avatar) {
  color: rgb(var(--v-theme-on-secondary));
  font-size: 1rem;
  font-weight: 900;
}

.avatar-edit-icon {
  position: absolute;
  right: 0;
  bottom: 0;
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border: 3px solid rgb(var(--v-theme-background));
  border-radius: 50%;
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
}

.avatar-actions-drawer {
  height: auto !important;
  max-height: min(65dvh, 250px);
  border-radius: 24px 24px 0 0;
}

.drawer-handle {
  width: 42px;
  height: 4px;
  margin: 10px auto 2px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface) / .24);
}

.crop-card {
  padding: clamp(1rem, 4vw, 1.5rem);
}

.crop-header {
  display: grid;
  margin-bottom: 1.25rem;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 1rem;
}

.crop-header h2 {
  font-size: 1.15rem;
  font-weight: 900;
}

.crop-header p {
  margin-top: .25rem;
  color: rgb(var(--v-theme-on-surface) / .58);
  font-size: .78rem;
}

.crop-viewport {
  position: relative;
  width: min(100%, 360px);
  margin: auto;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 18px;
  background:
    linear-gradient(45deg, rgb(var(--v-theme-surface-variant)) 25%, transparent 25%),
    linear-gradient(-45deg, rgb(var(--v-theme-surface-variant)) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgb(var(--v-theme-surface-variant)) 75%),
    linear-gradient(-45deg, transparent 75%, rgb(var(--v-theme-surface-variant)) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.crop-viewport:active {
  cursor: grabbing;
}

.crop-viewport img {
  position: absolute;
  top: 50%;
  left: 50%;
  max-width: none;
  pointer-events: none;
  user-select: none;
}

.crop-frame {
  position: absolute;
  inset: 0;
  border: 2px solid rgb(var(--v-theme-secondary) / .9);
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / .2);
  pointer-events: none;
}

.crop-frame::before,
.crop-frame::after {
  position: absolute;
  content: "";
  background: rgb(var(--v-theme-on-surface) / .28);
}

.crop-frame::before {
  top: 33.333%;
  bottom: 33.333%;
  left: 0;
  right: 0;
  border-top: 1px solid rgb(var(--v-theme-on-surface) / .28);
  border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .28);
  background: transparent;
}

.crop-frame::after {
  top: 0;
  bottom: 0;
  left: 33.333%;
  right: 33.333%;
  border-left: 1px solid rgb(var(--v-theme-on-surface) / .28);
  border-right: 1px solid rgb(var(--v-theme-on-surface) / .28);
  background: transparent;
}

.crop-resize {
  max-width: 400px;
  margin: 1.25rem auto 0;
}

.crop-resize__heading {
  display: flex;
  margin-bottom: .6rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: .78rem;
}

.crop-resize__heading strong {
  font-weight: 850;
}

.crop-resize__heading span {
  color: rgb(var(--v-theme-on-surface) / .58);
  font-variant-numeric: tabular-nums;
}

.crop-resize__control {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: .75rem;
}

.crop-resize__control :deep(.v-slider) {
  width: 100%;
  min-width: 0;
}

.crop-actions {
  display: flex;
  margin-top: 1rem;
  align-items: center;
  justify-content: flex-end;
  gap: .5rem;
}

@media (max-width: 599px) {
  .crop-viewport {
    width: min(100%, 52dvh, 420px);
  }

  .crop-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
</style>
