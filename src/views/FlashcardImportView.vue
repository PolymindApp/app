<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import { copyTextToClipboard } from '@/services/clipboard'
import { parseFlashcardCsv } from '@/services/flashcardCsv'
import { useFlashcardStore } from '@/stores/flashcards'

const CSV_EXAMPLE = `front,back,transliteration,note,tags
hello,こんにちは,konnichiwa,Common greeting,japanese|greetings
thank you,ありがとう,arigatou,,japanese|greetings`

const router = useRouter()
const route = useRoute()
const store = useFlashcardStore()
const form = ref()
const csv = ref('')
const importing = ref(false)
const error = ref('')
const exampleCopied = ref(false)
const exampleCopyError = ref('')
const reviewSetId = computed(() => typeof route.query.reviewSetId === 'string' ? route.query.reviewSetId : '')
const reviewSet = computed(() => store.reviewSets.find(item => item.id === reviewSetId.value))
const isReviewSetImport = computed(() => Boolean(reviewSetId.value))
const returnTo = computed(() => typeof route.query.returnTo === 'string'
  && route.query.returnTo.startsWith('/')
  && !route.query.returnTo.startsWith('//')
  ? route.query.returnTo
  : '')
const canManageReviewSet = computed(() => (
  !isReviewSetImport.value
  || Boolean(reviewSet.value && reviewSet.value.accessRole !== 'readonly')
))
let exampleCopiedTimer: number | undefined
const parsed = computed(() => parseFlashcardCsv(csv.value))
const previewRows = computed(() => parsed.value.rows.slice(0, 5))
const canImport = computed(() => (
  parsed.value.rows.length > 0
  && parsed.value.errors.length === 0
  && canManageReviewSet.value
  && !importing.value
))
const distinctTagCount = computed(() => new Set(
  parsed.value.rows.flatMap(row => row.tags.map(tag => tag.toLocaleLowerCase())),
).size)

onMounted(async () => {
  try {
    if (!store.loaded) await store.load()
    if (isReviewSetImport.value && (!reviewSet.value || reviewSet.value.accessRole === 'readonly')) {
      throw new Error('Editor access is required to import cards into this Review set.')
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not prepare the flashcard import.'
  }
})

onBeforeUnmount(() => {
  if (exampleCopiedTimer !== undefined) window.clearTimeout(exampleCopiedTimer)
})

async function copyFormatExample() {
  exampleCopied.value = false
  exampleCopyError.value = ''
  if (exampleCopiedTimer !== undefined) window.clearTimeout(exampleCopiedTimer)

  if (!await copyTextToClipboard(CSV_EXAMPLE)) {
    exampleCopyError.value = 'Could not copy the format example. Try again.'
    return
  }

  exampleCopied.value = true
  exampleCopiedTimer = window.setTimeout(() => {
    exampleCopied.value = false
    exampleCopiedTimer = undefined
  }, 2000)
}

async function importCards() {
  const result = await form.value?.validate()
  if (!result?.valid || !canImport.value) return
  importing.value = true
  error.value = ''
  try {
    const rows = parsed.value.rows
    if (isReviewSetImport.value) {
      await store.importReviewSetCards(reviewSetId.value, rows)
      await router.replace(returnTo.value
        || { name: 'flashcard-review-set-cards', params: { id: reviewSetId.value } })
    } else {
      await store.importCards(rows)
      await router.replace({ name: 'flashcard-cards' })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not import these flashcards.'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <main class="app-page app-page--editor flashcard-import-page">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm ref="form" @submit.prevent="importCards">
      <v-card class="surface-card pa-5">
        <h2 class="text-h6 font-weight-black">Paste your CSV table</h2>
        <p class="text-body-2 muted mt-2 mb-4">
          <template v-if="isReviewSetImport">
            Front and back are required. Transliteration and note are optional. Imported cards inherit this Review set’s tags; CSV tags are ignored.
          </template>
          <template v-else>
            Front and back are required. Transliteration, note, and tags are optional; separate multiple tags with a vertical bar (|).
          </template>
        </p>
        <v-textarea
          v-model="csv"
          rows="12"
          auto-grow
          clearable
          autocomplete="off"
          spellcheck="false"
          placeholder="front,back,transliteration,note,tags"
          :rules="[
            value => Boolean(value?.trim()) || 'CSV is required',
            () => parsed.errors[0] || true,
          ]"
        >
          <template #label>CSV table <span class="required-mark">*</span></template>
        </v-textarea>

        <p class="text-caption muted mt-4 mb-2">Use this format, keeping the header row first:</p>
        <div class="flashcard-import-example">
          <pre class="flashcard-import-example__content">{{ CSV_EXAMPLE }}</pre>
          <div class="flashcard-import-example__actions">
            <v-btn
              type="button"
              size="small"
              variant="tonal"
              :color="exampleCopied ? 'success' : undefined"
              :prepend-icon="exampleCopied ? 'mdi-check' : 'mdi-content-copy'"
              @click="copyFormatExample"
            >
              {{ exampleCopied ? 'Copied' : 'Copy example' }}
            </v-btn>
          </div>
        </div>
        <p v-if="exampleCopyError" class="text-caption text-error mt-2" role="alert">
          {{ exampleCopyError }}
        </p>

        <v-alert
          v-if="parsed.errors.length"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
        >
          <ul class="flashcard-import-errors">
            <li v-for="message in parsed.errors.slice(0, 8)" :key="message">{{ message }}</li>
          </ul>
          <p v-if="parsed.errors.length > 8" class="mt-2">And {{ parsed.errors.length - 8 }} more errors.</p>
        </v-alert>

        <template v-else-if="parsed.rows.length">
          <div class="flashcard-import-summary mt-4">
            <v-icon icon="mdi-check-circle-outline" color="success" />
            <strong>{{ parsed.rows.length }} card{{ parsed.rows.length === 1 ? '' : 's' }} ready</strong>
            <span v-if="isReviewSetImport" class="muted">Review set tags will be applied</span>
            <span v-else class="muted">{{ distinctTagCount }} distinct tag{{ distinctTagCount === 1 ? '' : 's' }}</span>
          </div>

          <div
            class="flashcard-import-preview mt-4"
            role="region"
            aria-label="Imported cards preview"
            tabindex="0"
          >
            <v-table density="compact" class="flashcard-import-preview__table">
              <thead>
                <tr>
                  <th scope="col">Front</th>
                  <th scope="col">Back</th>
                  <th scope="col">Transliteration</th>
                  <th scope="col">Note</th>
                  <th scope="col">Tags</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in previewRows" :key="`${row.front}-${index}`">
                  <td>{{ row.front }}</td>
                  <td>{{ row.back }}</td>
                  <td>{{ row.transliteration || '—' }}</td>
                  <td>{{ row.note || '—' }}</td>
                  <td>
                    <div class="flashcard-import-tags">
                      <v-chip v-for="tag in row.tags" :key="tag" size="x-small" variant="tonal">
                        {{ tag }}
                      </v-chip>
                      <span v-if="!row.tags.length" class="muted">—</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
          <p v-if="parsed.rows.length > previewRows.length" class="text-caption muted mt-2 text-end">
            Previewing 5 of {{ parsed.rows.length }} cards
          </p>
        </template>
      </v-card>
    </AppForm>

    <FormActionBar
      :primary-text="parsed.rows.length ? `Import ${parsed.rows.length}` : 'Import'"
      :loading="importing"
      :primary-disabled="!canImport"
      @submit="importCards"
      @cancel="router.back()"
    />
  </main>
</template>

<style scoped>
.flashcard-import-example { overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .045); }
.flashcard-import-example__content { margin: 0; padding: .875rem; overflow-x: auto; color: rgba(var(--v-theme-on-surface), .72); font-size: .72rem; line-height: 1.6; white-space: pre; }
.flashcard-import-example__actions { display: flex; justify-content: flex-end; padding: 0 .875rem .875rem; }
.flashcard-import-example__actions :deep(.v-btn) { min-height: 2.75rem; }
.flashcard-import-errors { padding-left: 1.25rem; }
.flashcard-import-summary { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem .75rem; }
.flashcard-import-preview { max-width: 100%; overflow-x: auto; overscroll-behavior-inline: contain; border: .0625rem solid rgba(var(--v-theme-on-surface), .08); border-radius: 1rem; }
.flashcard-import-preview:focus-visible { outline: .125rem solid rgba(var(--v-theme-secondary), .72); outline-offset: -.125rem; }
.flashcard-import-preview__table { min-width: 52rem; background: transparent; }
.flashcard-import-preview__table :deep(.v-table__wrapper) { overflow: visible; }
.flashcard-import-preview__table :deep(table) { table-layout: fixed; }
.flashcard-import-preview th { width: 20%; }
.flashcard-import-preview th { color: rgba(var(--v-theme-on-surface), .56); font-size: .66rem; font-weight: 900 !important; letter-spacing: .08em; text-transform: uppercase; }
.flashcard-import-preview td { overflow-wrap: anywhere; font-size: .75rem; }
.flashcard-import-tags { display: flex; min-width: 0; flex-wrap: wrap; gap: .25rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
</style>
