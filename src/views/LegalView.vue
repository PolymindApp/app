<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import LegalDocument from '@/components/LegalDocument.vue'
import { api } from '@/lib/api'

const route = useRoute()
const kind = computed(() => route.name === 'privacy' ? 'privacy' : 'terms')
const homeRoute = computed(() => api.authStore.hasLocalSession ? '/tasks' : '/')
const appRoute = computed(() => api.authStore.hasLocalSession ? '/settings' : '/auth')
</script>

<template>
  <v-app theme="forgeDark">
    <v-main class="legal-page app-scroll">
      <header class="legal-header px-4 px-sm-6">
        <router-link :to="homeRoute" class="legal-brand" aria-label="BackOnTrack home">
          <img src="/brand/backontrack-wordmark.png" alt="BackOnTrack" />
        </router-link>
        <v-btn
          :to="appRoute"
          variant="outlined"
          :prepend-icon="api.authStore.hasLocalSession ? 'mdi-arrow-left' : 'mdi-login'"
        >
          {{ api.authStore.hasLocalSession ? 'Back to settings' : 'Open app' }}
        </v-btn>
      </header>

      <LegalDocument :kind="kind" />
    </v-main>
  </v-app>
</template>

<style scoped>
.legal-page {
  min-height: var(--app-viewport-height, 100dvh);
  background:
    radial-gradient(circle at 82% 4%, rgba(var(--v-theme-secondary), .1), transparent 24rem),
    rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.legal-header {
  display: flex;
  width: 100%;
  max-width: 84rem;
  min-height: 5.5rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-inline: auto;
  border-bottom: .0625rem solid rgba(var(--v-theme-on-surface), .08);
}

.legal-brand {
  display: inline-flex;
  align-items: center;
}

.legal-brand img {
  display: block;
  width: 10.5rem;
  height: auto;
}

@media (max-width: 37.5rem) {
  .legal-header {
    min-height: 4.75rem;
  }

  .legal-brand img {
    width: 8rem;
  }

  .legal-header :deep(.v-btn) {
    padding-inline: .75rem;
  }
}
</style>
