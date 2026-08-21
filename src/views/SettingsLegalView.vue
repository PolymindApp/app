<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import LegalDocument from '@/components/LegalDocument.vue'

const route = useRoute()
const kind = computed(() => route.name === 'settings-privacy' ? 'privacy' : 'terms')
</script>

<template>
  <LegalDocument
    :kind="kind"
    privacy-to="/settings/privacy"
    terms-to="/settings/terms"
  />
</template>
