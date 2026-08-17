<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

withDefaults(defineProps<{
  label: string
  title: string
  actionLabel: string
  actionIcon?: string
  to?: RouteLocationRaw
}>(), {
  actionIcon: 'mdi-arrow-right',
  to: undefined,
})

const emit = defineEmits<{
  action: []
}>()
</script>

<template>
  <v-card class="sticky-action-banner page-action-area pa-5" color="secondary">
    <div class="sticky-action-banner__inner">
      <div class="sticky-action-banner__details">
        <span class="sticky-action-banner__label">{{ label }}</span>
        <strong class="sticky-action-banner__title text-truncate">{{ title }}</strong>
      </div>
      <v-btn
        color="primary"
        size="large"
        :append-icon="actionIcon"
        :to="to"
        @click="emit('action')"
      >
        {{ actionLabel }}
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.sticky-action-banner {
  position: fixed;
  z-index: 20;
  right: 0;
  bottom: 0;
  left: 17rem;
  border-radius: 0 !important;
  color: rgb(var(--v-theme-on-secondary));
  box-shadow: 0 -.75rem 1.875rem rgba(0, 0, 0, .28) !important;
}

.sticky-action-banner__inner {
  display: flex;
  width: 100%;
  max-width: 54.25rem;
  margin: 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.sticky-action-banner__details {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.sticky-action-banner__label {
  font-size: .65rem;
  font-weight: 900;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.sticky-action-banner__title { font-size: 1.5rem; }

@media (max-width: 59.9375rem) {
  .sticky-action-banner {
    bottom: calc(
      4.5rem + max(
        env(safe-area-inset-bottom, 0rem),
        var(--safe-area-inset-bottom, 0rem)
      )
    );
    left: 0;
  }
}
</style>
