<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import SquareImageUpload from '@/components/SquareImageUpload.vue'
import { useTaskStore } from '@/stores/tasks'
import type { TaskLogImage, TaskProgress } from '@/types/domain'

const props = defineProps<{
  progress?: TaskProgress
  completionId?: string
}>()

const emit = defineEmits<{
  logged: []
}>()

const model = defineModel<boolean>({ default: false })
const store = useTaskStore()
const imageUpload = ref<InstanceType<typeof SquareImageUpload>>()
const mode = ref<'gallery' | 'new'>('gallery')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const label = ref('')
const amount = ref<number | null>(null)
const upload = ref<Blob>()
const previewUrl = ref('')

const images = computed(() => store.taskLogImages
  .filter(item => item.task === props.progress?.task.id)
  .sort((left, right) => (
    right.usageCount - left.usageCount
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.label.localeCompare(right.label)
  )))
const unit = computed(() => props.progress?.programStep?.customUnit
  || props.progress?.programStep?.unit
  || props.progress?.task.customUnit
  || props.progress?.task.unit
  || (props.progress?.task.type === 'duration' ? 'hours' : ''))
const canSave = computed(() => Boolean(
  label.value.trim()
  && amount.value !== null
  && Number.isFinite(amount.value)
  && amount.value > 0
  && upload.value,
))

watch(model, (open) => {
  if (!open) return
  mode.value = 'gallery'
  error.value = ''
  void loadImages()
})

onBeforeUnmount(releasePreview)

async function loadImages() {
  const taskId = props.progress?.task.id
  if (!taskId || loading.value) return
  loading.value = true
  try {
    await store.loadTaskLogImages(taskId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load image logs.'
  } finally {
    loading.value = false
  }
}

function openNew() {
  mode.value = 'new'
  label.value = ''
  amount.value = null
  upload.value = undefined
  error.value = ''
  releasePreview()
}

function useUpload(image: Blob) {
  releasePreview()
  upload.value = image
  previewUrl.value = URL.createObjectURL(image)
}

function releasePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

async function selectImageLog(imageLog: TaskLogImage) {
  if (!props.progress || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await store.logTaskImage(props.progress, imageLog, props.completionId)
    model.value = false
    emit('logged')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not log this amount.'
  } finally {
    saving.value = false
  }
}

async function saveNew() {
  if (!props.progress || !canSave.value || !upload.value || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await store.createTaskLogImage(props.progress, {
      label: label.value.trim(),
      amount: amount.value!,
      image: upload.value,
    }, props.completionId)
    model.value = false
    emit('logged')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save this image log.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ActionBottomSheet
    v-model="model"
    :title="mode === 'new' ? 'New image log' : 'Log with image'"
    :description="mode === 'new'
      ? 'Add a reusable photo, label, and amount.'
      : progress?.task.name"
    aria-label="Log task with image"
  >
    <template #content>
      <SquareImageUpload
        ref="imageUpload"
        subject="task log"
        title="Adjust task log image"
        description="Move and resize the image. It will be saved as a 512 × 512 square."
        save-label="Use image"
        :output-size="512"
        :loading="saving"
        @upload="useUpload"
        @error="error = $event"
      />

      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">
        {{ error }}
      </v-alert>

      <template v-if="mode === 'gallery'">
        <v-btn
          block
          color="secondary"
          size="large"
          prepend-icon="mdi-image-plus-outline"
          :disabled="saving"
          class="mb-4"
          @click="openNew"
        >
          Add new
        </v-btn>

        <div v-if="loading" class="image-log-state py-8" aria-live="polite">
          <v-progress-circular indeterminate color="secondary" :size="32" :width="3" />
          <strong>Loading image logs…</strong>
        </div>
        <div v-else-if="images.length" class="image-log-gallery">
          <button
            v-for="imageLog in images"
            :key="imageLog.id"
            type="button"
            class="image-log-tile"
            :aria-label="`Log ${imageLog.amount}${imageLog.unit ? ` ${imageLog.unit}` : ''} for ${imageLog.label}`"
            :disabled="saving"
            @click="selectImageLog(imageLog)"
          >
            <v-img :src="imageLog.image" :alt="imageLog.label" aspect-ratio="1" cover />
            <span class="image-log-tile__label">{{ imageLog.label }}</span>
            <span class="image-log-tile__amount">
              {{ Number(imageLog.amount.toFixed(2)) }}{{ imageLog.unit ? ` ${imageLog.unit}` : '' }}
            </span>
          </button>
        </div>
        <div v-else class="image-log-state py-8">
          <v-icon icon="mdi-image-multiple-outline" size="36" color="medium-emphasis" />
          <strong>No image logs yet</strong>
          <p>Add one to make future logging a single tap.</p>
        </div>
      </template>

      <template v-else>
        <button
          type="button"
          class="image-log-picker"
          :disabled="saving"
          @click="imageUpload?.choose()"
        >
          <v-img
            v-if="previewUrl"
            :src="previewUrl"
            alt="New task log image"
            width="100%"
            height="100%"
            aspect-ratio="1"
            cover
          />
          <span v-else>
            <v-icon icon="mdi-camera-plus-outline" size="34" />
            <strong>Take or choose an image<span class="text-error"> *</span></strong>
          </span>
        </button>
        <v-text-field
          v-model="label"
          label="Label *"
          maxlength="160"
          autocomplete="off"
          class="mt-4"
        />
        <v-number-input
          v-model="amount"
          label="Amount *"
          :min="0"
          :precision="null"
          autocomplete="off"
          class="mt-3"
        >
          <template v-if="unit" #append-inner>{{ unit }}</template>
        </v-number-input>
        <v-row dense class="mt-3">
          <v-col cols="5">
            <v-btn block variant="text" size="large" :disabled="saving" @click="mode = 'gallery'">
              Back
            </v-btn>
          </v-col>
          <v-col cols="7">
            <v-btn
              block
              color="secondary"
              size="large"
              :loading="saving"
              :disabled="!canSave || saving"
              @click="saveNew"
            >
              Save and log
            </v-btn>
          </v-col>
        </v-row>
      </template>
    </template>
  </ActionBottomSheet>
</template>

<style scoped>
.image-log-gallery { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem; }
.image-log-tile {
  min-width: 0;
  padding: 0 0 .5rem;
  overflow: hidden;
  border: .0625rem solid rgb(var(--v-theme-on-surface) / .1);
  border-radius: .85rem;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  text-align: left;
}
.image-log-tile:focus-visible { outline: .125rem solid rgb(var(--v-theme-secondary)); outline-offset: .125rem; }
.image-log-tile:disabled { opacity: .55; cursor: default; }
.image-log-tile__label,
.image-log-tile__amount { display: block; overflow: hidden; padding: 0 .45rem; text-overflow: ellipsis; white-space: nowrap; }
.image-log-tile__label { margin-top: .45rem; font-size: .7rem; font-weight: 850; }
.image-log-tile__amount { margin-top: .1rem; color: rgb(var(--v-theme-on-surface) / .6); font-size: .62rem; }
.image-log-state { display: grid; min-height: 9rem; place-items: center; align-content: center; gap: .7rem; text-align: center; }
.image-log-state p { max-width: 15rem; color: rgb(var(--v-theme-on-surface) / .56); font-size: .78rem; }
.image-log-picker {
  display: grid;
  width: min(100%, 14rem);
  margin: 0 auto;
  padding: 0;
  overflow: hidden;
  border: .0625rem dashed rgb(var(--v-theme-on-surface) / .28);
  border-radius: 1rem;
  aspect-ratio: 1;
  place-items: center;
  background: rgb(var(--v-theme-on-surface) / .04);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}
.image-log-picker > span { display: grid; padding: 1rem; place-items: center; gap: .75rem; font-size: .78rem; }
</style>
