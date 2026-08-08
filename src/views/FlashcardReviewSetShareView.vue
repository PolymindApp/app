<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { FlashcardReviewSetShare } from '@/types/domain'

const route = useRoute()
const store = useFlashcardStore()
const form = ref()
const email = ref('')
const role = ref<FlashcardReviewSetShare['role']>('readonly')
const shares = ref<FlashcardReviewSetShare[]>([])
const selectedShare = ref<FlashcardReviewSetShare>()
const loading = ref(true)
const saving = ref(false)
const actionSheet = ref(false)
const editorDialog = ref(false)
const revokeDialog = ref(false)
const error = ref('')
const reviewSetId = computed(() => String(route.params.id || ''))
const reviewSet = computed(() => store.reviewSets.find(item => item.id === reviewSetId.value))
const canShare = computed(() => Boolean(email.value.trim()) && !saving.value)

onMounted(async () => {
  try {
    if (!store.loaded) await store.load()
    if (!reviewSet.value || reviewSet.value.accessRole !== 'owner') {
      throw new Error('Only the Review set owner can manage sharing.')
    }
    shares.value = await store.loadReviewSetShares(reviewSetId.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load sharing.'
  } finally {
    loading.value = false
  }
})

function initials(share: FlashcardReviewSetShare) {
  return (share.name || share.email || 'A')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'A'
}

async function addShare() {
  const result = await form.value?.validate()
  if (!result?.valid || !canShare.value) return
  saving.value = true
  error.value = ''
  try {
    shares.value.push(await store.createReviewSetShare(
      reviewSetId.value,
      email.value.trim(),
      role.value,
    ))
    shares.value.sort((left, right) => (
      left.name.localeCompare(right.name) || left.email.localeCompare(right.email)
    ))
    email.value = ''
    role.value = 'readonly'
    form.value?.resetValidation()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not share this Review set.'
  } finally {
    saving.value = false
  }
}

function openActions(share: FlashcardReviewSetShare) {
  selectedShare.value = share
  actionSheet.value = true
}

async function setRole(nextRole: FlashcardReviewSetShare['role']) {
  const share = selectedShare.value
  if (!share || share.role === nextRole) return
  saving.value = true
  error.value = ''
  try {
    const updated = await store.updateReviewSetShare(share.id, nextRole)
    const index = shares.value.findIndex(item => item.id === updated.id)
    if (index >= 0) shares.value.splice(index, 1, updated)
    selectedShare.value = updated
    actionSheet.value = false
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not change this role.'
  } finally {
    saving.value = false
  }
}

function requestRole(nextRole: FlashcardReviewSetShare['role']) {
  if (nextRole === 'editor') {
    actionSheet.value = false
    editorDialog.value = true
    return
  }
  void setRole(nextRole)
}

async function confirmEditorRole() {
  await setRole('editor')
  editorDialog.value = false
}

function requestRevoke() {
  actionSheet.value = false
  revokeDialog.value = true
}

async function revoke() {
  const share = selectedShare.value
  if (!share) return
  saving.value = true
  error.value = ''
  try {
    await store.removeReviewSetShare(share.id)
    shares.value = shares.value.filter(item => item.id !== share.id)
    revokeDialog.value = false
    selectedShare.value = undefined
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not revoke access.'
    revokeDialog.value = false
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="app-page review-set-share-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loading" class="share-loading py-12" role="status">
      <v-progress-circular indeterminate color="secondary" />
      <span class="text-body-2 muted">Loading collaborators…</span>
    </div>

    <template v-else-if="reviewSet?.accessRole === 'owner'">
      <v-card class="surface-card pa-5 pa-sm-6">
        <h1 class="text-h6 font-weight-black">Share {{ reviewSet.name }}</h1>
        <p class="text-body-2 muted mt-2">
          Add an existing Polymind account by its exact email address.
        </p>
        <AppForm ref="form" class="mt-5" @submit.prevent="addShare">
          <v-row>
            <v-col cols="12">
              <v-text-field
                v-model="email"
                type="email"
                label="Account email"
                autocomplete="email"
                :rules="[
                  value => Boolean(value?.trim()) || 'Email is required',
                  value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value?.trim() || '') || 'Enter a valid email',
                ]"
              />
            </v-col>
            <v-col cols="12">
              <label class="share-role-label">Role <span class="required-mark">*</span></label>
              <v-btn-toggle
                v-model="role"
                mandatory
                color="secondary"
                variant="tonal"
                class="share-role-toggle mt-2"
                aria-label="Sharing role"
              >
                <v-btn value="readonly" prepend-icon="mdi-eye-outline">Read only</v-btn>
                <v-btn value="editor" prepend-icon="mdi-pencil-outline">Editor</v-btn>
              </v-btn-toggle>
            </v-col>
          </v-row>
          <v-alert v-if="role === 'editor'" type="warning" variant="tonal" density="compact" class="mt-3">
            Editors can add, change, and permanently delete matching cards from your library.
          </v-alert>
          <v-btn
            block
            color="secondary"
            prepend-icon="mdi-account-plus-outline"
            class="mt-4"
            :loading="saving"
            :disabled="!canShare"
            @click="addShare"
          >
            Share Review set
          </v-btn>
        </AppForm>
      </v-card>

      <section>
        <div class="section-heading">
          <h2>People with access</h2>
          <span class="text-caption muted">{{ shares.length }}</span>
        </div>
        <v-card v-if="shares.length" class="surface-card pa-2">
          <v-list bg-color="transparent">
            <v-list-item
              v-for="share in shares"
              :key="share.id"
              :title="share.name || share.email"
              :subtitle="share.email"
              rounded="lg"
              @click="openActions(share)"
            >
              <template #prepend>
                <v-avatar color="surface-variant" size="40">
                  <v-img v-if="share.avatar" :src="share.avatar" alt="" cover />
                  <strong v-else class="text-caption">{{ initials(share) }}</strong>
                </v-avatar>
              </template>
              <template #append>
                <v-chip size="small" :color="share.role === 'editor' ? 'secondary' : undefined">
                  {{ share.role === 'editor' ? 'Editor' : 'Read only' }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </v-card>
        <v-card v-else class="surface-card pa-7 text-center">
          <v-icon icon="mdi-account-multiple-outline" size="40" color="secondary" />
          <h3 class="text-h6 font-weight-black mt-3">Only you have access</h3>
          <p class="text-body-2 muted mt-2">Add an account above to share this live card set.</p>
        </v-card>
      </section>

    </template>

    <ActionBottomSheet
      v-model="actionSheet"
      :title="selectedShare?.name || selectedShare?.email || 'Access actions'"
      :description="selectedShare?.email"
      aria-label="Collaborator access actions"
    >
      <v-list-item
        prepend-icon="mdi-eye-outline"
        title="Read only"
        rounded="lg"
        :disabled="saving || selectedShare?.role === 'readonly'"
        @click="requestRole('readonly')"
      />
      <v-list-item
        prepend-icon="mdi-pencil-outline"
        title="Editor"
        rounded="lg"
        :disabled="saving || selectedShare?.role === 'editor'"
        @click="requestRole('editor')"
      />
      <v-divider class="my-1" />
      <v-list-item
        prepend-icon="mdi-account-remove-outline"
        title="Revoke access"
        base-color="error"
        rounded="lg"
        :disabled="saving"
        @click="requestRevoke"
      />
    </ActionBottomSheet>

    <ConfirmDialog
      v-model="editorDialog"
      title="Give this account editor access?"
      message="Editors can add, change, and permanently delete matching cards from your library."
      confirm-text="Make editor"
      confirm-color="secondary"
      icon="mdi-pencil-outline"
      :loading="saving"
      @confirm="confirmEditorRole"
    />

    <ConfirmDialog
      v-model="revokeDialog"
      title="Revoke this account’s access?"
      message="The shared set will be detached from their tasks and intervals. Their completed review history will stay."
      confirm-text="Revoke access"
      icon="mdi-account-remove-outline"
      :loading="saving"
      @confirm="revoke"
    />
  </main>
</template>

<style scoped>
.share-loading { display: flex; align-items: center; justify-content: center; gap: .75rem; }
.share-role-label { color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 800; }
.required-mark { color: rgb(var(--v-theme-error)); }
.share-role-toggle { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.share-role-toggle :deep(.v-btn) { width: 100%; min-width: 0; min-height: 3rem; }
</style>
