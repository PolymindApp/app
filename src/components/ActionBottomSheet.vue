<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  ariaLabel?: string
}>(), {
  ariaLabel: 'Actions',
})

const model = defineModel<boolean>({ default: false })
</script>

<template>
  <v-navigation-drawer
    v-model="model"
    temporary
    location="bottom"
    :width="430"
    class="action-bottom-sheet"
    :aria-label="ariaLabel"
  >
    <div class="action-bottom-sheet__header">
      <div class="action-bottom-sheet__handle" aria-hidden="true" />
      <div class="px-4 pt-2 pb-2">
        <strong class="d-block text-truncate">{{ title }}</strong>
      </div>
    </div>
    <v-list class="px-2 pb-4">
      <slot />
    </v-list>
  </v-navigation-drawer>
</template>

<style scoped>
.action-bottom-sheet {
  bottom: max(
    env(safe-area-inset-bottom, 0px),
    var(--safe-area-inset-bottom, 0px)
  ) !important;
  height: auto !important;
  max-height: min(80dvh, 430px);
  overflow: hidden;
  border-radius: 24px 24px 0 0;
}

.action-bottom-sheet__header {
  position: sticky;
  z-index: 1;
  top: 0;
  background: rgb(var(--v-theme-surface));
}

.action-bottom-sheet__handle {
  width: 42px;
  height: 5px;
  margin: 10px auto 0;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), .42);
}
</style>
