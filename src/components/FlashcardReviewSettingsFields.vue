<script setup lang="ts">
import { computed, watch } from 'vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import {
  FLASHCARD_REVIEW_CARD_SIDE_OPTIONS,
  FLASHCARD_REVIEW_SORT_OPTIONS,
  MAX_FLASHCARD_BACK_SPEECH_REPEATS,
  MAX_FLASHCARD_SESSION_CARDS,
  MIN_FLASHCARD_BACK_SPEECH_REPEATS,
} from '@/services/flashcards'
import {
  defaultFlashcardSpeechLanguage,
  speechLanguageOptions,
} from '@/services/flashcardSpeech'
import type { FlashcardReviewSettings, FlashcardSpeechSupport } from '@/types/domain'

const props = withDefaults(defineProps<{
  modelValue: FlashcardReviewSettings
  speechSupport: FlashcardSpeechSupport
  speechLoading?: boolean
  minCards?: number
  maxCards?: number
  availableCards?: number
  session?: boolean
  interval?: boolean
}>(), {
  speechLoading: false,
  minCards: 1,
  maxCards: MAX_FLASHCARD_SESSION_CARDS,
  availableCards: 0,
  session: false,
  interval: false,
})

const CUSTOM_MAX_CARDS_THRESHOLD = 50
const settings = computed(() => props.modelValue)
const cardLimit = computed(() => {
  const minimum = Math.min(
    MAX_FLASHCARD_SESSION_CARDS,
    Math.max(1, Math.floor(props.minCards)),
  )
  const configuredMaximum = Math.min(
    MAX_FLASHCARD_SESSION_CARDS,
    Math.max(minimum, Math.floor(props.maxCards)),
  )
  const availableMaximum = props.availableCards > 0
    ? Math.min(configuredMaximum, Math.floor(props.availableCards))
    : configuredMaximum
  const maximum = Math.max(minimum, availableMaximum)
  const sliderMaximum = Math.min(CUSTOM_MAX_CARDS_THRESHOLD, maximum)

  return {
    minimum,
    maximum,
    sliderMinimum: Math.min(minimum, sliderMaximum),
    sliderMaximum,
  }
})
const sliderMaxCards = computed({
  get: () => Math.min(Number(settings.value.maxCards), cardLimit.value.sliderMaximum),
  set: (value: number) => {
    settings.value.maxCards = Number(value)
  },
})
const customMaxCardsVisible = computed(() => (
  cardLimit.value.maximum > CUSTOM_MAX_CARDS_THRESHOLD
  && Number(settings.value.maxCards) >= CUSTOM_MAX_CARDS_THRESHOLD
))
const selectedCardSides = computed(() => FLASHCARD_REVIEW_CARD_SIDE_OPTIONS
  .find(option => option.value === settings.value.cardSides)!)
const speechLanguages = computed(() => speechLanguageOptions([
  ...props.speechSupport.languages.map(language => language.tag),
  settings.value.frontLanguage,
  settings.value.backLanguage,
]))

watch(cardLimit, ({ minimum, maximum }) => {
  if (settings.value.maxCards < minimum) settings.value.maxCards = minimum
  if (settings.value.maxCards > maximum) settings.value.maxCards = maximum
}, { immediate: true })

function updateMode(mode: 'manual' | 'passive') {
  settings.value.mode = mode
  if (mode !== 'passive') settings.value.indefinite = false
}

function updateSpeechEnabled(enabled: boolean | null) {
  if (!enabled) return
  const fallback = defaultFlashcardSpeechLanguage(props.speechSupport.languages)
  if (!settings.value.frontLanguage) settings.value.frontLanguage = fallback
  if (!settings.value.backLanguage) settings.value.backLanguage = fallback
}
</script>

<template>
  <div class="flashcard-review-settings-fields">
    <v-card class="surface-card pa-5">
      <template v-if="!interval">
        <label class="field-label">Review mode <span class="required-mark">*</span></label>
        <v-btn-toggle
          :model-value="settings.mode"
          mandatory
          color="secondary"
          variant="tonal"
          class="mode-toggle mt-2"
          @update:model-value="updateMode"
        >
          <v-btn value="manual" prepend-icon="mdi-gesture-tap">Manual</v-btn>
          <v-btn value="passive" prepend-icon="mdi-play-speed">Passive</v-btn>
        </v-btn-toggle>
        <p class="mode-hint mt-3" aria-live="polite">
          <v-icon icon="mdi-information-outline" size="18" />
          <span v-if="settings.mode === 'manual' && settings.cardSides === 'both'">
            Reveal the back when you're ready, then mark the card as a success or error.
          </span>
          <span v-else-if="settings.mode === 'manual'">
            Grade each card immediately after viewing its selected face.
          </span>
          <span v-else-if="settings.cardSides === 'both'">
            Front and back advance automatically using the durations below; cards count as viewed, not graded.
          </span>
          <span v-else>
            The selected face advances automatically using its duration below; cards count as viewed, not graded.
          </span>
        </p>
        <v-divider class="my-5" />
      </template>
      <label class="field-label">Faces to show <span class="required-mark">*</span></label>
      <v-btn-toggle
        v-model="settings.cardSides"
        mandatory
        color="secondary"
        variant="tonal"
        class="faces-toggle mt-2"
      >
        <v-btn
          v-for="option in FLASHCARD_REVIEW_CARD_SIDE_OPTIONS"
          :key="option.value"
          :value="option.value"
          :prepend-icon="option.icon"
        >
          {{ option.title }}
        </v-btn>
      </v-btn-toggle>
      <p class="mode-hint mt-3" aria-live="polite">
        <v-icon icon="mdi-information-outline" size="18" />
        {{ selectedCardSides.hint }}
      </p>

      <v-expand-transition>
        <div v-if="settings.cardSides !== 'front'" class="response-order-setting mt-5">
          <v-divider class="mb-3" />
          <div class="setting-row">
            <div>
              <strong>Show note before answer</strong>
              <p>Place the card note above the back text when the response appears</p>
            </div>
            <v-switch
              v-model="settings.noteBeforeBack"
              color="secondary"
              hide-details="auto"
              inset
              aria-label="Show flashcard note before answer"
            />
          </div>
        </div>
      </v-expand-transition>

      <v-expand-transition>
        <div v-if="settings.mode === 'passive'" class="passive-settings mt-5">
          <v-number-input
            v-if="settings.cardSides !== 'back'"
            v-model="settings.frontSeconds"
            label="Front duration"
            suffix="seconds"
            :min="1"
            :max="60"
            :step="1"
            :rules="[value => value >= 1 && value <= 60 || 'Use 1–60 seconds']"
          />
          <v-number-input
            v-if="settings.cardSides !== 'front'"
            v-model="settings.backSeconds"
            label="Back duration"
            suffix="seconds"
            :min="1"
            :max="60"
            :step="1"
            :rules="[value => value >= 1 && value <= 60 || 'Use 1–60 seconds']"
          />
          <div v-if="!interval" class="setting-row passive-settings__indefinite">
            <div>
              <strong>Run indefinitely</strong>
              <p>Loop through these cards until you end the review; it will not finish on its own</p>
            </div>
            <v-switch
              v-model="settings.indefinite"
              color="secondary"
              hide-details="auto"
              inset
              aria-label="Run review indefinitely"
            />
          </div>
        </div>
      </v-expand-transition>
    </v-card>

    <v-card class="surface-card pa-5">
      <div class="setting-row">
        <div>
          <strong>Read cards aloud</strong>
          <p v-if="speechLoading">Checking speech synthesis on this device…</p>
          <p v-else-if="speechSupport.available">
            {{ settings.cardSides === 'both'
              ? 'Speak the front and back whenever each side appears'
              : `Speak only the ${settings.cardSides} of each card` }}
          </p>
          <p v-else>Speech synthesis is not available on this device</p>
        </div>
        <v-switch
          v-model="settings.speechEnabled"
          color="secondary"
          :loading="speechLoading"
          :disabled="speechLoading || (!speechSupport.available && !settings.speechEnabled)"
          hide-details="auto"
          inset
          aria-label="Read cards aloud"
          @update:model-value="updateSpeechEnabled"
        />
      </div>

      <v-expand-transition>
        <div v-if="settings.speechEnabled" class="speech-language-fields mt-5">
          <v-select
            v-if="settings.cardSides !== 'back'"
            v-model="settings.frontLanguage"
            :items="speechLanguages"
            item-title="title"
            item-value="tag"
            :disabled="!speechSupport.available"
            :rules="[value => Boolean(value) || 'Select a front language']"
          >
            <template #label>Front language <span class="required-mark">*</span></template>
          </v-select>
          <v-select
            v-if="settings.cardSides !== 'front'"
            v-model="settings.backLanguage"
            :items="speechLanguages"
            item-title="title"
            item-value="tag"
            :disabled="!speechSupport.available"
            :rules="[value => Boolean(value) || 'Select a back language']"
          >
            <template #label>Back language <span class="required-mark">*</span></template>
          </v-select>
          <div
            v-if="settings.mode === 'passive' && settings.cardSides !== 'front'"
            class="speech-repeat-setting"
          >
            <LabeledSlider
              v-model="settings.backSpeechRepeatCount"
              title="Repeat back aloud"
              :min="MIN_FLASHCARD_BACK_SPEECH_REPEATS"
              :max="MAX_FLASHCARD_BACK_SPEECH_REPEATS"
              :step="1"
              :value-label="settings.backSpeechRepeatCount === 1 ? 'Once' : `${settings.backSpeechRepeatCount} times`"
              min-label="Once"
              :max-label="`${MAX_FLASHCARD_BACK_SPEECH_REPEATS} times`"
              aria-label="Number of times to read each flashcard back aloud"
            />
            <p class="mode-hint mt-3">
              <v-icon icon="mdi-information-outline" size="18" />
              Each repeat adds the configured back duration before advancing to the next card.
            </p>
          </div>
          <p class="speech-background-hint">
            <v-icon icon="mdi-cellphone-sound" size="18" />
            Passive reviews keep speaking on Android while the app is in the background or the screen is locked.
          </p>
        </div>
      </v-expand-transition>
    </v-card>

    <v-card class="surface-card pa-5">
      <v-select
        v-model="settings.sortMode"
        label="Card order"
        :items="FLASHCARD_REVIEW_SORT_OPTIONS"
        item-title="title"
        item-value="value"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :title="item.raw.title" :subtitle="item.raw.subtitle" />
        </template>
      </v-select>
      <v-divider class="my-5" />
      <LabeledSlider
        v-model="sliderMaxCards"
        title="Max cards per session"
        :min="cardLimit.sliderMinimum"
        :max="cardLimit.sliderMaximum"
        :step="1"
        :value-label="`${settings.maxCards} cards`"
        :min-label="`${cardLimit.sliderMinimum} ${cardLimit.sliderMinimum === 1 ? 'card' : 'cards'}`"
        :max-label="cardLimit.maximum > CUSTOM_MAX_CARDS_THRESHOLD ? `${CUSTOM_MAX_CARDS_THRESHOLD}+ cards` : `${cardLimit.sliderMaximum} cards`"
        aria-label="Maximum cards per Review set session"
      />
      <v-expand-transition>
        <v-number-input
          v-if="customMaxCardsVisible"
          v-model="settings.maxCards"
          class="mt-4"
          :min="Math.max(CUSTOM_MAX_CARDS_THRESHOLD, cardLimit.minimum)"
          :max="cardLimit.maximum"
          :step="1"
          :rules="[
            value => Number.isInteger(Number(value)) || 'Use a whole number',
            value => Number(value) >= Math.max(CUSTOM_MAX_CARDS_THRESHOLD, cardLimit.minimum)
              && Number(value) <= cardLimit.maximum
              || `Use ${Math.max(CUSTOM_MAX_CARDS_THRESHOLD, cardLimit.minimum)}–${cardLimit.maximum} cards`,
          ]"
          autocomplete="off"
          persistent-hint
          :hint="`Choose a custom limit up to ${cardLimit.maximum} available cards`"
        >
          <template #label>Custom max cards <span class="required-mark">*</span></template>
        </v-number-input>
      </v-expand-transition>
      <p class="mode-hint mt-3">
        <v-icon icon="mdi-information-outline" size="18" />
        <span v-if="session">The limit and order are applied to the cards remaining in this session.</span>
        <span v-else>Cards are filtered and ordered first, then up to {{ settings.maxCards }} are included in each session.</span>
      </p>
    </v-card>
  </div>
</template>

<style scoped>
.flashcard-review-settings-fields { display: grid; gap: 1rem; }
.field-label { color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; font-weight: 800; }
.required-mark { color: rgb(var(--v-theme-error)); }
.mode-toggle { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.mode-toggle :deep(.v-btn) { width: 100%; min-height: 3rem; }
.faces-toggle { display: grid; width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
.faces-toggle :deep(.v-btn) { width: 100%; min-height: 3rem; }
.mode-hint { display: flex; align-items: flex-start; gap: .5rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.5; }
.mode-hint .v-icon { flex: 0 0 auto; }
.passive-settings { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.passive-settings__indefinite { grid-column: 1 / -1; }
.setting-row { display: grid; min-height: 4rem; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
.setting-row > div { min-width: 0; }
.setting-row p { margin-top: .15rem; color: rgba(var(--v-theme-on-surface), .5); font-size: .7rem; }
.speech-language-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
.speech-repeat-setting,
.speech-background-hint { grid-column: 1 / -1; }
.speech-background-hint { display: flex; align-items: flex-start; gap: .5rem; color: rgba(var(--v-theme-on-surface), .58); font-size: .72rem; line-height: 1.5; }
.speech-background-hint .v-icon { flex: 0 0 auto; }
@media (max-width: 31.25rem) {
  .passive-settings,
  .speech-language-fields { grid-template-columns: 1fr; }
  .speech-repeat-setting,
  .speech-background-hint { grid-column: auto; }
}
</style>
