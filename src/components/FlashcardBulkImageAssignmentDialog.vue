<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ImageLibrarySearchPanel from '@/components/ImageLibrarySearchPanel.vue'
import { useFlashcardStore } from '@/stores/flashcards'
import type { Flashcard, ImageLibraryAsset } from '@/types/domain'

const props = defineProps<{
  modelValue: boolean
  cards: Flashcard[]
  assignImage?: (cardId: string, imageId: number) => Promise<unknown>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  complete: [assigned: number, skipped: number]
}>()

const store = useFlashcardStore()
const queueIds = ref<string[]>([])
const currentIndex = ref(0)
const selectedImage = ref<ImageLibraryAsset>()
const saving = ref(false)
const error = ref('')
const assignedCount = ref(0)
const skippedCount = ref(0)

const totalCards = computed(() => queueIds.value.length)
const currentCard = computed(() => {
  const id = queueIds.value[currentIndex.value]
  return props.cards.find(card => card.id === id)
    || store.cards.find(card => card.id === id)
})
const complete = computed(() => totalCards.value > 0 && currentIndex.value >= totalCards.value)
const reviewedCount = computed(() => Math.min(currentIndex.value, totalCards.value))
const progress = computed(() => totalCards.value
  ? reviewedCount.value / totalCards.value * 100
  : 0)
const initialQuery = computed(() => (
  currentCard.value?.front.trim()
  || currentCard.value?.back.trim()
  || ''
).slice(0, 100))

watch(() => props.modelValue, (open) => {
  if (!open) return
  queueIds.value = props.cards.map(card => card.id)
  currentIndex.value = 0
  selectedImage.value = undefined
  saving.value = false
  error.value = ''
  assignedCount.value = 0
  skippedCount.value = 0
}, { immediate: true })

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

function advance() {
  selectedImage.value = undefined
  error.value = ''
  currentIndex.value += 1
}

function skip() {
  if (!currentCard.value || saving.value) return
  skippedCount.value += 1
  advance()
}

async function assignAndContinue() {
  const card = currentCard.value
  const image = selectedImage.value
  if (!card || !image || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await (props.assignImage || store.assignLibraryImage)(card.id, image.id)
    assignedCount.value += 1
    advance()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not assign this image.'
  } finally {
    saving.value = false
  }
}

function finish() {
  emit('complete', assignedCount.value, skippedCount.value)
  close()
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    :persistent="saving"
    transition="dialog-bottom-transition"
    @update:model-value="$event ? undefined : close()"
  >
    <v-card class="bulk-image-assignment" rounded="0">
      <header class="bulk-image-assignment__header">
        <div class="bulk-image-assignment__header-content">
          <v-btn
            icon="mdi-close"
            variant="text"
            :disabled="saving"
            aria-label="Close bulk image assignment"
            @click="close"
          />
          <div class="bulk-image-assignment__heading min-width-0">
            <h2 class="text-h6 font-weight-black">Assign card images</h2>
            <p v-if="!complete">
              Card {{ Math.min(currentIndex + 1, totalCards) }} of {{ totalCards }}
            </p>
            <p v-else>Review complete</p>
          </div>
          <v-chip color="secondary" variant="tonal" size="small">
            {{ reviewedCount }}/{{ totalCards }} reviewed
          </v-chip>
        </div>
        <v-progress-linear
          :model-value="progress"
          color="secondary"
          height="3"
          aria-label="Bulk image assignment progress"
        />
      </header>

      <v-card-text class="bulk-image-assignment__body">
        <div v-if="complete" class="bulk-image-assignment__complete">
          <v-icon icon="mdi-check-circle-outline" color="secondary" size="64" />
          <h3 class="text-h5 font-weight-black">Every selected card was reviewed</h3>
          <p class="muted">Assigned {{ assignedCount }} · Skipped {{ skippedCount }}</p>
          <v-btn
            color="secondary"
            size="large"
            prepend-icon="mdi-check"
            @click="finish"
          >
            Done
          </v-btn>
        </div>

        <v-row v-else-if="currentCard" class="bulk-image-assignment__content" align="start">
          <v-col cols="12" md="4" lg="3">
            <v-card class="surface-card bulk-image-card-info pa-4">
              <div class="bulk-image-card-info__status">
                <v-icon icon="mdi-card-text-outline" color="secondary" />
                <strong>Card information</strong>
              </div>

              <div class="bulk-image-card-info__image mt-4">
                <v-img
                  v-if="currentCard.image"
                  :src="currentCard.image"
                  :alt="currentCard.libraryImage?.alt || 'Current card image'"
                  aspect-ratio="1"
                  cover
                />
                <div v-else class="bulk-image-card-info__placeholder">
                  <v-icon icon="mdi-image-outline" size="32" />
                  <span>No current image</span>
                </div>
              </div>

              <dl class="bulk-image-card-info__faces mt-4">
                <div>
                  <dt>Front</dt>
                  <dd>{{ currentCard.front }}</dd>
                </div>
                <div>
                  <dt>Back</dt>
                  <dd>{{ currentCard.back }}</dd>
                </div>
                <div v-if="currentCard.note">
                  <dt>Note</dt>
                  <dd>{{ currentCard.note }}</dd>
                </div>
              </dl>

              <p v-if="currentCard.libraryImage" class="bulk-image-card-info__credit mt-4">
                Current photo by
                <a
                  :href="currentCard.libraryImage.photographerUrl || currentCard.libraryImage.sourceUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ currentCard.libraryImage.photographer || 'Pexels photographer' }}</a>
              </p>
            </v-card>
          </v-col>

          <v-col cols="12" md="8" lg="9">
            <div class="bulk-image-assignment__proposals">
              <div class="mb-2">
                <h3 class="text-subtitle-1 font-weight-black">Proposed images</h3>
                <p class="text-caption muted">Select one, refine the search, or skip this card.</p>
              </div>
              <ImageLibrarySearchPanel
                :key="currentCard.id"
                :active="modelValue"
                :initial-query="initialQuery"
                :selected-image-id="selectedImage?.id"
                :disabled="saving"
                action-label="Select"
                wide
                @search="selectedImage = undefined"
                @select="selectedImage = $event"
              />
            </div>
          </v-col>
        </v-row>
      </v-card-text>

      <footer v-if="!complete && currentCard" class="bulk-image-assignment__actions">
        <div class="bulk-image-assignment__actions-content">
          <v-alert v-if="error" type="error" variant="tonal" density="compact">
            {{ error }}
          </v-alert>
          <div class="bulk-image-assignment__selection min-width-0">
            <v-icon :icon="selectedImage ? 'mdi-image-check-outline' : 'mdi-image-outline'" />
            <span>{{ selectedImage ? `Selected: ${selectedImage.photographer || 'Pexels image'}` : 'Select an image to assign' }}</span>
          </div>
          <div class="bulk-image-assignment__buttons">
            <v-btn
              variant="text"
              :disabled="saving"
              prepend-icon="mdi-skip-next-outline"
              @click="skip"
            >
              Skip
            </v-btn>
            <v-btn
              color="secondary"
              :loading="saving"
              :disabled="!selectedImage"
              prepend-icon="mdi-image-check-outline"
              @click="assignAndContinue"
            >
              Assign &amp; next
            </v-btn>
          </div>
        </div>
      </footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bulk-image-assignment { display: flex; box-sizing: border-box; height: 100dvh; padding-top: max(env(safe-area-inset-top, 0rem), var(--safe-area-inset-top, 0rem)); padding-bottom: max(env(safe-area-inset-bottom, 0rem), var(--safe-area-inset-bottom, 0rem)); flex-direction: column; background: rgb(var(--v-theme-background)); }
.bulk-image-assignment__header { flex: 0 0 auto; border-bottom: .0625rem solid rgba(var(--v-theme-on-surface), .1); background: rgb(var(--v-theme-surface)); }
.bulk-image-assignment__header-content { display: flex; width: min(100%, 80rem); min-height: 4rem; margin: 0 auto; padding: .5rem 1rem; align-items: center; gap: .75rem; }
.bulk-image-assignment__heading { flex: 1; }
.bulk-image-assignment__heading p { color: rgba(var(--v-theme-on-surface), .56); font-size: .72rem; }
.bulk-image-assignment__body { flex: 1 1 auto; overflow-y: auto; padding: 1rem; }
.bulk-image-assignment__content { width: min(100%, 80rem); margin: 0 auto; }
.bulk-image-card-info { border-color: rgba(var(--v-theme-on-surface), .1); }
.bulk-image-card-info__status { display: flex; align-items: center; gap: .5rem; font-size: .78rem; }
.bulk-image-card-info__image { overflow: hidden; border: .0625rem solid rgba(var(--v-theme-on-surface), .1); border-radius: .75rem; background: rgba(var(--v-theme-on-surface), .04); }
.bulk-image-card-info__placeholder { display: grid; aspect-ratio: 1; place-items: center; align-content: center; color: rgba(var(--v-theme-on-surface), .4); font-size: .72rem; gap: .4rem; }
.bulk-image-card-info__faces { display: grid; gap: .85rem; }
.bulk-image-card-info__faces div { min-width: 0; }
.bulk-image-card-info__faces dt { color: rgba(var(--v-theme-on-surface), .5); font-size: .62rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.bulk-image-card-info__faces dd { margin: .2rem 0 0; overflow-wrap: anywhere; font-size: .86rem; font-weight: 750; white-space: pre-wrap; }
.bulk-image-card-info__credit { color: rgba(var(--v-theme-on-surface), .58); font-size: .68rem; }
.bulk-image-card-info__credit a { color: rgb(var(--v-theme-secondary)); font-weight: 800; }
.bulk-image-assignment__proposals { min-width: 0; }
.bulk-image-assignment__actions { flex: 0 0 auto; border-top: .0625rem solid rgba(var(--v-theme-on-surface), .1); background: rgb(var(--v-theme-surface)); box-shadow: 0 -.5rem 1.5rem rgba(0, 0, 0, .16); }
.bulk-image-assignment__actions-content { display: grid; width: min(100%, 80rem); min-height: 4.75rem; margin: 0 auto; padding: .65rem 1rem; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .75rem; }
.bulk-image-assignment__selection { display: flex; align-items: center; color: rgba(var(--v-theme-on-surface), .62); font-size: .72rem; gap: .45rem; }
.bulk-image-assignment__selection span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bulk-image-assignment__actions-content :deep(.v-alert) { grid-column: 1 / -1; }
.bulk-image-assignment__buttons { display: flex; gap: .5rem; }
.bulk-image-assignment__buttons :deep(.v-btn) { min-height: 2.75rem; }
.bulk-image-assignment__complete { display: grid; min-height: 70dvh; place-items: center; align-content: center; text-align: center; gap: 1rem; }

@media (min-width: 60rem) {
  .bulk-image-card-info { position: sticky; top: 0; }
}

@media (max-width: 37.5rem) {
  .bulk-image-assignment__header-content { padding-right: .75rem; padding-left: .5rem; }
  .bulk-image-assignment__header-content :deep(.v-chip) { display: none; }
  .bulk-image-assignment__body { padding: .75rem; }
  .bulk-image-card-info { display: grid; grid-template-columns: 5.5rem minmax(0, 1fr); align-items: start; gap: .75rem; }
  .bulk-image-card-info__status { grid-column: 1 / -1; }
  .bulk-image-card-info__image { grid-column: 1; grid-row: 2; margin-top: 0 !important; }
  .bulk-image-card-info__faces { grid-column: 2; grid-row: 2; margin-top: 0 !important; }
  .bulk-image-card-info__credit { grid-column: 1 / -1; margin-top: 0 !important; }
  .bulk-image-assignment__actions-content { grid-template-columns: 1fr; padding: .6rem .75rem; }
  .bulk-image-assignment__selection { display: none; }
  .bulk-image-assignment__buttons { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); }
  .bulk-image-assignment__buttons :deep(.v-btn) { width: 100%; }
}
</style>
