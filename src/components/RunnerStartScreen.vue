<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  title: string
  summary: string
  icon: string
  color?: string
  primaryLabel: string
  backLabel: string
  busy?: boolean
}>()

defineEmits<{
  start: []
  back: []
}>()

const titleElement = ref<HTMLElement>()
const fittedTitleSize = ref('')
const titleWords = computed(() => props.title.trim().split(/\s+/).filter(Boolean))
let fitRevision = 0

async function fitTitleWords() {
  const revision = ++fitRevision
  fittedTitleSize.value = ''
  await nextTick()
  if (revision !== fitRevision) return
  const title = titleElement.value
  if (!title?.clientWidth) return

  const words = [...title.querySelectorAll<HTMLElement>('.runner-start-screen__word')]
  const widestWord = words.reduce((widest, word) => {
    const previousWhiteSpace = word.style.whiteSpace
    const previousMaxWidth = word.style.maxWidth
    word.style.whiteSpace = 'nowrap'
    word.style.maxWidth = 'none'
    const width = word.scrollWidth
    word.style.whiteSpace = previousWhiteSpace
    word.style.maxWidth = previousMaxWidth
    return Math.max(widest, width)
  }, 0)
  if (widestWord <= title.clientWidth) return

  const renderedFontPixels = Number.parseFloat(window.getComputedStyle(title).fontSize)
  const rootFontPixels = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
  if (!Number.isFinite(renderedFontPixels) || renderedFontPixels <= 0) return
  fittedTitleSize.value = `${renderedFontPixels * title.clientWidth / widestWord * .98 / rootFontPixels}rem`
}

watch(() => props.title, fitTitleWords)

onMounted(() => {
  void fitTitleWords()
  window.addEventListener('resize', fitTitleWords)
  void document.fonts?.ready.then(fitTitleWords)
})

onBeforeUnmount(() => {
  fitRevision += 1
  window.removeEventListener('resize', fitTitleWords)
})
</script>

<template>
  <section class="runner-start-screen">
    <div class="runner-start-screen__identity">
      <div
        class="runner-start-screen__icon"
        :style="color ? { background: color } : undefined"
      >
        <v-icon :icon="icon" size="2.25rem" />
      </div>
      <h1
        ref="titleElement"
        class="display-title runner-start-screen__title"
        :style="fittedTitleSize ? { fontSize: fittedTitleSize } : undefined"
      >
        <template v-for="(word, index) in titleWords" :key="`${word}-${index}`">
          {{ index ? ' ' : '' }}<span class="runner-start-screen__word">{{ word }}<span v-if="index === titleWords.length - 1" class="text-secondary">.</span></span>
        </template>
      </h1>
      <p class="runner-start-screen__summary">{{ summary }}</p>
    </div>
    <div class="runner-start-screen__actions">
      <v-btn
        color="secondary"
        size="x-large"
        prepend-icon="mdi-play"
        :aria-label="primaryLabel"
        :loading="busy"
        @click="$emit('start')"
      >
        {{ primaryLabel }}
      </v-btn>
      <v-btn
        variant="text"
        size="large"
        prepend-icon="mdi-arrow-left"
        :aria-label="backLabel"
        :disabled="busy"
        @click="$emit('back')"
      >
        Back
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.runner-start-screen {
  display: flex;
  width: min(100%, 44rem);
  min-height: 0;
  margin: 0 auto;
  padding-top: 1rem;
  flex: 1 1 auto;
  align-items: center;
  flex-direction: column;
  text-align: center;
}
.runner-start-screen__identity {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
.runner-start-screen__icon {
  display: grid;
  width: 5rem;
  height: 5rem;
  margin-bottom: 1.5rem;
  place-items: center;
  border-radius: 1.5rem;
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
}
.runner-start-screen__title {
  width: 100%;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: clamp(2rem, 10vw, 6rem);
}
.runner-start-screen__word { max-width: 100%; }
.runner-start-screen__summary {
  margin-top: 1rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .875rem;
  font-weight: 800;
}
.runner-start-screen__actions {
  display: flex;
  width: min(100%, 22rem);
  flex: 0 0 auto;
  flex-direction: column;
  gap: .75rem;
}
.runner-start-screen__actions :deep(.v-btn:first-child) { min-height: 4rem; }
.runner-start-screen__actions :deep(.v-btn:last-child) { min-height: 3rem; }
</style>
