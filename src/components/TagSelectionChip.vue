<script setup lang="ts">
defineProps<{
  chipProps: Record<string, unknown>
  label: string
}>()
</script>

<template>
  <v-chip
    v-bind="chipProps"
    size="small"
    prepend-icon="mdi-tag-outline"
    @pointerdown.stop
    @touchstart.stop
    @click.stop
    @click:close.stop
  >
    {{ label }}
  </v-chip>
</template>
