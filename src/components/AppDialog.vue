<script setup lang="ts">
import { useOverlayStack } from '@/services/overlayStack'

defineOptions({ inheritAttrs: false })

const model = defineModel<boolean>({ default: false })
const zIndex = useOverlayStack(model)
</script>

<template>
  <v-dialog
    v-model="model"
    v-bind="$attrs"
    :z-index="zIndex"
  >
    <template
      v-for="(_, slotName) in $slots"
      #[slotName]="slotProps"
    >
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </v-dialog>
</template>
