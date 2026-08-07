<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import SquareImageUpload from '@/components/SquareImageUpload.vue'

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

const imageUpload = ref<InstanceType<typeof SquareImageUpload>>()
const actionsDrawer = ref(false)
const removeDialog = ref(false)
const imageFailed = ref(false)
const hasAvatar = computed(() => Boolean(props.avatarUrl))
const showImage = computed(() => hasAvatar.value && !imageFailed.value)

watch(() => props.avatarUrl, (avatarUrl) => {
  imageFailed.value = false
  if (!avatarUrl) removeDialog.value = false
})

function choosePhoto() {
  actionsDrawer.value = false
  imageUpload.value?.choose()
}

function requestRemoval() {
  actionsDrawer.value = false
  removeDialog.value = true
}
</script>

<template>
  <SquareImageUpload
    ref="imageUpload"
    subject="avatar"
    title="Adjust your avatar"
    save-label="Save avatar"
    :loading="loading"
    @upload="emit('upload', $event)"
    @error="emit('error', $event)"
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
    v-else
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

  <ActionBottomSheet v-model="actionsDrawer" title="Avatar" aria-label="Avatar actions">
    <v-list-item
      prepend-icon="mdi-image-plus-outline"
      title="Upload new avatar"
      rounded="lg"
      @click="choosePhoto"
    />
    <v-list-item
      prepend-icon="mdi-delete-outline"
      title="Remove"
      rounded="lg"
      base-color="error"
      @click="requestRemoval"
    />
  </ActionBottomSheet>

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
.avatar-button {
  position: relative;
  display: block;
  width: 4.75rem;
  height: 4.75rem;
  flex: 0 0 auto;
  padding: .125rem;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.avatar-button:focus-visible { outline: .1875rem solid rgba(var(--v-theme-secondary), .55); outline-offset: .1875rem; }
.avatar-button :deep(.v-avatar) { color: rgb(var(--v-theme-on-secondary)); font-size: 1rem; font-weight: 900; }
.avatar-edit-icon { position: absolute; right: 0; bottom: 0; display: grid; width: 1.6875rem; height: 1.6875rem; border: .1875rem solid rgb(var(--v-theme-background)); border-radius: 50%; place-items: center; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); }
</style>
