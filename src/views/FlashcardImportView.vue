<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppForm from '@/components/AppForm.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import { parseFlashcardCsv } from '@/services/flashcardCsv'
import { useFlashcardStore } from '@/stores/flashcards'

const AI_PROMPT = 'Generate 50 rows of English-to-Spanish vocabulary about woodworking as CSV with the headers front,back,note,tags. Use note for a short optional learning hint, use | between multiple tags, keep note and tags optional, quote any value containing a comma, and include no text outside the CSV.'
const CSV_EXAMPLE = `front,back,note,tags
chisel,formón,Hand tool for carving wood,woodworking|tools
wood grain,veta de la madera,,woodworking|materials`

const router = useRouter()
const store = useFlashcardStore()
const form = ref()
const csv = ref('')
const importing = ref(false)
const error = ref('')
const promptCopied = ref(false)
const promptCopyError = ref('')
let promptCopiedTimer: number | undefined
const parsed = computed(() => parseFlashcardCsv(csv.value))
const previewRows = computed(() => parsed.value.rows.slice(0, 5))
const canImport = computed(() => (
  parsed.value.rows.length > 0
  && parsed.value.errors.length === 0
  && !importing.value
))
const distinctTagCount = computed(() => new Set(
  parsed.value.rows.flatMap(row => row.tags.map(tag => tag.toLocaleLowerCase())),
).size)

onMounted(() => {
  if (!store.loaded) store.load().catch(() => undefined)
})

onBeforeUnmount(() => {
  if (promptCopiedTimer !== undefined) window.clearTimeout(promptCopiedTimer)
})

async function copyAiPrompt() {
  promptCopied.value = false
  promptCopyError.value = ''
  if (promptCopiedTimer !== undefined) window.clearTimeout(promptCopiedTimer)

  let copied = false
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(AI_PROMPT)
      copied = true
    } catch {
      // Some browsers and Android WebViews expose the API but deny access.
    }
  }

  if (!copied) {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined
    const textarea = document.createElement('textarea')
    textarea.value = AI_PROMPT
    textarea.readOnly = true
    textarea.style.position = 'fixed'
    textarea.style.left = '-100vw'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    textarea.remove()
    previousFocus?.focus()
  }

  if (!copied) {
    promptCopyError.value = 'Could not copy the prompt. Try again or copy it manually.'
    return
  }

  promptCopied.value = true
  promptCopiedTimer = window.setTimeout(() => {
    promptCopied.value = false
    promptCopiedTimer = undefined
  }, 2000)
}

async function importCards() {
  const result = await form.value?.validate()
  if (!result?.valid || !canImport.value) return
  importing.value = true
  error.value = ''
  try {
    const rows = parsed.value.rows
    await store.importCards(rows)
    await router.replace({ name: 'flashcard-cards' })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not import these flashcards.'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <main class="app-page app-page--editor flashcard-import-page">
    <v-alert
      type="info"
      variant="tonal"
      icon="mdi-creation-outline"
      class="mb-4"
    >
      <strong>Ask an AI to prepare the CSV</strong>
      <p class="text-body-2 mt-2">Copy this prompt and adjust the topic, languages, or number of rows:</p>
      <blockquote class="flashcard-import-prompt mt-3">“{{ AI_PROMPT }}”</blockquote>
      <div class="flashcard-import-prompt-actions mt-3">
        <v-btn
          size="small"
          variant="tonal"
          :color="promptCopied ? 'success' : 'info'"
          :prepend-icon="promptCopied ? 'mdi-check' : 'mdi-content-copy'"
          @click="copyAiPrompt"
        >
          {{ promptCopied ? 'Copied' : 'Copy prompt' }}
        </v-btn>
      </div>
      <p v-if="promptCopyError" class="text-caption text-error mt-2" role="alert">
        {{ promptCopyError }}
      </p>
    </v-alert>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <AppForm ref="form" @submit.prevent="importCards">
      <v-card class="surface-card pa-5">
        <h2 class="text-h6 font-weight-black">Paste your CSV table</h2>
        <p class="text-body-2 muted mt-2 mb-4">
          Front and back are required. Note and tags are optional; separate multiple tags with a vertical bar (|).
        </p>
        <pre class="flashcard-import-example mb-4">{{ CSV_EXAMPLE }}</pre>

        <v-textarea
          v-model="csv"
          rows="12"
          auto-grow
          autocomplete="off"
          spellcheck="false"
          placeholder="front,back,note,tags"
          :rules="[
            value => Boolean(value?.trim()) || 'CSV is required',
            () => parsed.errors[0] || true,
          ]"
        >
          <template #label>CSV table <span class="required-mark">*</span></template>
        </v-textarea>

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
            <span class="muted">{{ distinctTagCount }} distinct tag{{ distinctTagCount === 1 ? '' : 's' }}</span>
          </div>

          <v-table density="compact" class="flashcard-import-preview mt-4">
            <thead>
              <tr>
                <th scope="col">Front</th>
                <th scope="col">Back</th>
                <th scope="col">Note</th>
                <th scope="col">Tags</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in previewRows" :key="`${row.front}-${index}`">
                <td>{{ row.front }}</td>
                <td>{{ row.back }}</td>
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
.flashcard-import-prompt { padding-left: 1rem; border-left: .1875rem solid rgba(var(--v-theme-info), .62); color: rgba(var(--v-theme-on-surface), .82); font-size: .82rem; line-height: 1.55; }
.flashcard-import-prompt-actions { display: flex; justify-content: flex-end; }
.flashcard-import-prompt-actions :deep(.v-btn) { min-height: 2.75rem; }
.flashcard-import-example { padding: .875rem; overflow-x: auto; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .045); color: rgba(var(--v-theme-on-surface), .72); font-size: .72rem; line-height: 1.6; white-space: pre; }
.flashcard-import-errors { padding-left: 1.25rem; }
.flashcard-import-summary { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem .75rem; }
.flashcard-import-preview { overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .08); border-radius: 1rem; }
.flashcard-import-preview :deep(.v-table__wrapper) { overflow-x: hidden; }
.flashcard-import-preview :deep(table) { table-layout: fixed; }
.flashcard-import-preview th:nth-child(1),
.flashcard-import-preview th:nth-child(2) { width: 28%; }
.flashcard-import-preview th:nth-child(3) { width: 26%; }
.flashcard-import-preview th:nth-child(4) { width: 18%; }
.flashcard-import-preview th { color: rgba(var(--v-theme-on-surface), .56); font-size: .66rem; font-weight: 900 !important; letter-spacing: .08em; text-transform: uppercase; }
.flashcard-import-preview td { overflow-wrap: anywhere; font-size: .75rem; }
.flashcard-import-tags { display: flex; min-width: 0; flex-wrap: wrap; gap: .25rem; }
.required-mark { color: rgb(var(--v-theme-error)); }
</style>
