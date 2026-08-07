<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { nextTick, ref, watch } from 'vue'
import { api } from '@/lib/api'
import type { ImageLibraryAsset } from '@/types/domain'

const props = withDefaults(defineProps<{
  active?: boolean
  initialQuery?: string
  selectedImageId?: number
  disabled?: boolean
  focusOnOpen?: boolean
  wide?: boolean
  actionLabel?: string
}>(), {
  active: true,
  initialQuery: '',
  selectedImageId: 0,
  disabled: false,
  focusOnOpen: false,
  wide: false,
  actionLabel: 'Use image',
})

const emit = defineEmits<{
  select: [image: ImageLibraryAsset]
  search: [query: string]
}>()

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const searchField = ref()
const query = ref('')
const searchedQuery = ref('')
const images = ref<ImageLibraryAsset[]>([])
const page = ref(1)
const totalPages = ref(1)
const totalItems = ref(0)
const loading = ref(false)
const error = ref('')
let requestVersion = 0

watch(
  [() => props.active, () => props.initialQuery],
  async ([active, initialQuery]) => {
    if (!active) return
    const suggestion = initialQuery.trim().slice(0, 100)
    if (suggestion && suggestion !== searchedQuery.value) {
      query.value = suggestion
      await search(true)
    }
    if (props.focusOnOpen && allowAutomaticFocus) {
      await nextTick()
      searchField.value?.focus()
    }
  },
  { immediate: true },
)

async function search(reset: boolean) {
  const normalized = query.value.trim()
  if (!normalized || loading.value || props.disabled) return
  const requestedPage = reset ? 1 : page.value + 1
  const version = ++requestVersion
  if (reset) emit('search', normalized)
  loading.value = true
  error.value = ''
  try {
    const response = await api.searchImageLibrary(normalized, requestedPage, 30)
    if (version !== requestVersion) return
    searchedQuery.value = normalized
    page.value = response.page
    totalPages.value = response.totalPages
    totalItems.value = response.totalItems
    images.value = reset ? response.items : [...images.value, ...response.items]
  } catch (cause) {
    if (version !== requestVersion) return
    error.value = cause instanceof Error ? cause.message : 'Could not search the image library.'
    if (reset) {
      images.value = []
      totalItems.value = 0
      totalPages.value = 1
    }
  } finally {
    if (version === requestVersion) loading.value = false
  }
}
</script>

<template>
  <section class="image-library-search-panel">
    <a
      class="image-library-search-panel__provider"
      href="https://www.pexels.com"
      target="_blank"
      rel="noopener noreferrer"
    >
      <v-icon icon="mdi-camera-outline" size="small" />
      Photos provided by Pexels
      <v-icon icon="mdi-open-in-new" size="x-small" />
    </a>

    <form class="image-library-search-panel__search" @submit.prevent="search(true)">
      <v-text-field
        ref="searchField"
        v-model="query"
        label="Search images"
        placeholder="e.g. bicycle, courir, feliz"
        prepend-inner-icon="mdi-magnify"
        autocomplete="off"
        maxlength="100"
        hide-details
        clearable
        :disabled="disabled"
      />
      <v-btn
        type="submit"
        color="secondary"
        variant="flat"
        prepend-icon="mdi-magnify"
        :loading="loading && page === 1"
        :disabled="!query.trim() || loading || disabled"
      >
        Search
      </v-btn>
    </form>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-4">
      {{ error }}
    </v-alert>

    <p
      v-if="searchedQuery && !error"
      class="image-library-search-panel__count mt-4"
      aria-live="polite"
    >
      {{ totalItems }} {{ totalItems === 1 ? 'image' : 'images' }} for “{{ searchedQuery }}”
    </p>

    <v-row v-if="images.length" dense class="image-library-search-panel__grid mt-1">
      <v-col
        v-for="image in images"
        :key="image.id"
        cols="6"
        sm="4"
        md="3"
        :lg="wide ? 2 : 3"
      >
        <v-card
          class="image-library-result"
          :class="{ 'image-library-result--selected': image.id === selectedImageId }"
          variant="outlined"
        >
          <v-img
            :src="image.imageUrl"
            :alt="image.alt || image.concept?.name || 'Pexels image'"
            aspect-ratio="1"
            cover
            class="image-library-result__image"
          >
            <template #placeholder>
              <div class="image-library-result__placeholder">
                <v-progress-circular indeterminate size="24" width="2" color="secondary" />
              </div>
            </template>
          </v-img>
          <div class="image-library-result__details">
            <a
              v-if="image.photographerUrl"
              :href="image.photographerUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="image-library-result__credit"
              @click.stop
            >
              {{ image.photographer || 'Pexels photographer' }}
            </a>
            <span v-else class="image-library-result__credit">
              {{ image.photographer || 'Pexels photographer' }}
            </span>
            <v-btn
              block
              color="secondary"
              :variant="image.id === selectedImageId ? 'flat' : 'tonal'"
              :prepend-icon="image.id === selectedImageId ? 'mdi-check' : 'mdi-image-check-outline'"
              :disabled="disabled"
              @click="emit('select', image)"
            >
              {{ image.id === selectedImageId ? 'Selected' : actionLabel }}
            </v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <div v-else-if="loading" class="image-library-search-panel__state">
      <v-progress-circular indeterminate color="secondary" />
      <span>Searching the image library…</span>
    </div>

    <div v-else-if="searchedQuery && !error" class="image-library-search-panel__state">
      <v-icon icon="mdi-image-search-outline" size="36" />
      <strong>No cached images found</strong>
      <span>Try a simpler word or a synonym.</span>
    </div>

    <div v-else class="image-library-search-panel__state">
      <v-icon icon="mdi-image-multiple-outline" size="36" />
      <strong>Find a visual for this card</strong>
      <span>Search nouns, verbs, adjectives, and other common concepts.</span>
    </div>

    <div v-if="images.length && page < totalPages" class="image-library-search-panel__load-more">
      <v-btn
        variant="tonal"
        color="secondary"
        prepend-icon="mdi-image-plus-outline"
        :loading="loading"
        :disabled="disabled"
        @click="search(false)"
      >
        Load more
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.image-library-search-panel__provider { display: inline-flex; align-items: center; min-height: 2.75rem; color: rgb(var(--v-theme-secondary)); font-size: .78rem; font-weight: 850; gap: .35rem; text-decoration: none; }
.image-library-search-panel__search { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: .75rem; }
.image-library-search-panel__search :deep(.v-btn) { min-height: 3.5rem; }
.image-library-search-panel__count { color: rgba(var(--v-theme-on-surface), .6); font-size: .72rem; font-weight: 750; }
.image-library-search-panel__grid { align-items: stretch; }
.image-library-result { height: 100%; overflow: hidden; border-color: rgba(var(--v-theme-on-surface), .12); }
.image-library-result--selected { border-color: rgb(var(--v-theme-secondary)); box-shadow: 0 0 0 .0625rem rgb(var(--v-theme-secondary)); }
.image-library-result__image { background: rgba(var(--v-theme-on-surface), .06); }
.image-library-result__placeholder { display: grid; width: 100%; height: 100%; place-items: center; }
.image-library-result__details { display: grid; padding: .55rem; gap: .5rem; }
.image-library-result__credit { overflow: hidden; min-height: 1.1rem; color: rgba(var(--v-theme-on-surface), .65); font-size: .68rem; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.image-library-result__credit[href]:hover { color: rgb(var(--v-theme-secondary)); }
.image-library-result__details :deep(.v-btn) { min-height: 2.75rem; }
.image-library-search-panel__state { display: grid; min-height: 14rem; place-items: center; align-content: center; color: rgba(var(--v-theme-on-surface), .58); text-align: center; gap: .5rem; }
.image-library-search-panel__state strong { color: rgba(var(--v-theme-on-surface), .8); }
.image-library-search-panel__state span { max-width: 24rem; font-size: .78rem; }
.image-library-search-panel__load-more { display: flex; justify-content: center; padding-top: 1rem; }
.image-library-search-panel__load-more :deep(.v-btn) { min-height: 2.75rem; }

@media (max-width: 37.5rem) {
  .image-library-search-panel__search { grid-template-columns: 1fr; }
  .image-library-search-panel__search :deep(.v-btn) { min-height: 2.75rem; }
  .image-library-result__details { padding: .4rem; }
  .image-library-result__credit { font-size: .62rem; }
}
</style>
