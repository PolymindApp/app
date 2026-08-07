<script setup lang="ts">
import packageMetadata from '../../package.json'

const appVersion = packageMetadata.version
</script>

<template>
  <p class="app-version-label" :aria-label="`Application version ${appVersion}`">
    Version {{ appVersion }}
  </p>
</template>

<style scoped>
.app-version-label {
  margin-bottom: 0;
  color: rgb(var(--v-theme-on-surface) / .4);
  font-size: .625rem;
  font-weight: 750;
  letter-spacing: .04em;
  text-align: center;
}
</style>
