<script setup lang="ts">
withDefaults(defineProps<{
  icon: string
  running?: boolean
  size?: string | number
  badgeSurface?: 'background' | 'surface'
}>(), {
  running: false,
  size: 24,
  badgeSurface: 'surface',
})
</script>

<template>
  <v-badge
    :model-value="running"
    color="secondary"
    dot
    location="top end"
    class="main-navigation-icon"
    :class="`main-navigation-icon--${badgeSurface}`"
    aria-hidden="true"
  >
    <v-icon :icon="icon" :size="size" />
  </v-badge>
</template>

<style scoped>
.main-navigation-icon {
  display: inline-grid;
  width: 1.5rem;
  height: 1.5rem;
  place-items: center;
}

.main-navigation-icon--background {
  --running-session-badge-ring: rgb(var(--v-theme-background));
}

.main-navigation-icon--surface {
  --running-session-badge-ring: rgb(var(--v-theme-surface));
}

.main-navigation-icon :deep(.v-badge__badge) {
  box-shadow: 0 0 0 .1rem var(--running-session-badge-ring);
}
</style>
