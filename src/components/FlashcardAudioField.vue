<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { FlashcardAudioValue } from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: FlashcardAudioValue
  label: string
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: FlashcardAudioValue]
  'recording-change': [recording: boolean]
  error: [message: string]
}>()

const MAX_RECORDING_SECONDS = 60
const MAX_RECORDING_BYTES = 1_500_000
const recording = ref(false)
const elapsedSeconds = ref(0)
const fieldError = ref('')
let recorder: MediaRecorder | undefined
let stream: MediaStream | undefined
let chunks: Blob[] = []
let elapsedTimer: number | undefined
let recordingStartedAt = 0
let ownedObjectUrl = ''

const recordingSupported = computed(() => (
  typeof navigator !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)
  && typeof MediaRecorder !== 'undefined'
))
const elapsedLabel = computed(() => {
  const seconds = Math.min(MAX_RECORDING_SECONDS, elapsedSeconds.value)
  return `0:${String(seconds).padStart(2, '0')}`
})

function preferredMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return ''
  }
  return [
    'audio/webm;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm',
  ].find(type => MediaRecorder.isTypeSupported(type)) || ''
}

function stopTracks() {
  stream?.getTracks().forEach(track => track.stop())
  stream = undefined
}

function stopTimer() {
  if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer)
  elapsedTimer = undefined
}

function revokeOwnedObjectUrl() {
  if (ownedObjectUrl) URL.revokeObjectURL(ownedObjectUrl)
  ownedObjectUrl = ''
}

function reportError(message: string) {
  fieldError.value = message
  emit('error', message)
}

async function startRecording() {
  if (props.disabled || recording.value || !recordingSupported.value) return
  fieldError.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const mimeType = preferredMimeType()
    recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 96_000,
    })
    chunks = []
    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      cancelRecording()
      reportError(`The ${props.label.toLocaleLowerCase()} recording could not be captured.`)
    }
    recorder.onstop = () => {
      stopTimer()
      stopTracks()
      recording.value = false
      emit('recording-change', false)
      const type = recorder?.mimeType || chunks[0]?.type || 'audio/webm'
      const blob = new Blob(chunks, { type })
      chunks = []
      if (!blob.size) {
        reportError(`The ${props.label.toLocaleLowerCase()} recording was empty.`)
        return
      }
      if (blob.size > MAX_RECORDING_BYTES) {
        reportError('The card recording is larger than 1.5 MB. Record a shorter clip.')
        return
      }
      revokeOwnedObjectUrl()
      ownedObjectUrl = URL.createObjectURL(blob)
      emit('update:modelValue', {
        url: ownedObjectUrl,
        existingUrl: props.modelValue.existingUrl,
        recording: blob,
      })
    }
    recordingStartedAt = Date.now()
    elapsedSeconds.value = 0
    recorder.start(250)
    recording.value = true
    emit('recording-change', true)
    elapsedTimer = window.setInterval(() => {
      elapsedSeconds.value = Math.min(
        MAX_RECORDING_SECONDS,
        Math.floor((Date.now() - recordingStartedAt) / 1000),
      )
      if (elapsedSeconds.value >= MAX_RECORDING_SECONDS) stopRecording()
    }, 250)
  } catch (cause) {
    stopTimer()
    stopTracks()
    recording.value = false
    emit('recording-change', false)
    const denied = cause instanceof DOMException
      && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError')
    reportError(denied
      ? 'Microphone access is required to record card audio.'
      : `The ${props.label.toLocaleLowerCase()} recording could not start.`)
  }
}

function stopRecording() {
  if (!recording.value || recorder?.state !== 'recording') return
  recorder.stop()
}

function cancelRecording() {
  if (recorder?.state === 'recording') {
    recorder.onstop = null
    recorder.stop()
  }
  chunks = []
  stopTimer()
  stopTracks()
  if (recording.value) emit('recording-change', false)
  recording.value = false
}

function removeRecording() {
  if (props.disabled || recording.value) return
  revokeOwnedObjectUrl()
  fieldError.value = ''
  emit('update:modelValue', {
    url: '',
    existingUrl: props.modelValue.existingUrl,
  })
}

watch(() => props.modelValue.url, url => {
  if (ownedObjectUrl && url !== ownedObjectUrl) revokeOwnedObjectUrl()
})

watch(() => props.disabled, disabled => {
  if (disabled && recording.value) cancelRecording()
})

onBeforeUnmount(() => {
  cancelRecording()
  revokeOwnedObjectUrl()
})
</script>

<template>
  <div class="flashcard-audio-field">
    <div class="flashcard-audio-field__heading">
      <div>
        <strong>{{ label }}</strong>
        <p>Up to 60 seconds. Used instead of text-to-speech.</p>
      </div>
      <v-btn
        v-if="recording"
        color="error"
        variant="tonal"
        prepend-icon="mdi-stop-circle-outline"
        :disabled="disabled"
        @click="stopRecording"
      >
        Stop · {{ elapsedLabel }}
      </v-btn>
      <v-btn
        v-else
        color="secondary"
        variant="tonal"
        prepend-icon="mdi-microphone-outline"
        :disabled="disabled || !recordingSupported"
        @click="startRecording"
      >
        {{ modelValue.url ? 'Record again' : 'Record' }}
      </v-btn>
    </div>

    <v-progress-linear
      v-if="recording"
      class="mt-3"
      color="error"
      :model-value="elapsedSeconds / MAX_RECORDING_SECONDS * 100"
      rounded
    />

    <div v-if="modelValue.url && !recording" class="flashcard-audio-field__preview mt-3">
      <audio :src="modelValue.url" controls preload="metadata" :aria-label="`Preview ${label.toLocaleLowerCase()}`" />
      <v-btn
        icon="mdi-delete-outline"
        variant="text"
        color="error"
        :disabled="disabled"
        :aria-label="`Remove ${label.toLocaleLowerCase()}`"
        @click="removeRecording"
      />
    </div>

    <p v-if="!recordingSupported" class="flashcard-audio-field__message mt-2">
      Audio recording is not available on this device.
    </p>
    <p v-else-if="fieldError" class="flashcard-audio-field__message flashcard-audio-field__message--error mt-2" role="alert">
      {{ fieldError }}
    </p>
  </div>
</template>

<style scoped>
.flashcard-audio-field { height: 100%; padding: .875rem; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: 1rem; background: rgba(var(--v-theme-surface-variant), .26); }
.flashcard-audio-field__heading { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.flashcard-audio-field__heading strong { font-size: .78rem; }
.flashcard-audio-field__heading p,
.flashcard-audio-field__message { margin-top: .15rem; color: rgba(var(--v-theme-on-surface), .56); font-size: .7rem; line-height: 1.4; }
.flashcard-audio-field__preview { display: flex; align-items: center; gap: .5rem; }
.flashcard-audio-field__preview audio { min-width: 0; width: 100%; height: 2.75rem; }
.flashcard-audio-field__message--error { color: rgb(var(--v-theme-error)); }

@media (max-width: 26.25rem) {
  .flashcard-audio-field__heading { align-items: stretch; flex-direction: column; }
  .flashcard-audio-field__heading .v-btn { align-self: flex-start; }
}
</style>
