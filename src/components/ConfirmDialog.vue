<script setup lang="ts">
import AppDialog from '@/components/AppDialog.vue'

withDefaults(defineProps<{
  modelValue: boolean
  title: string
  message: string
  confirmText?: string
  confirmColor?: string
  icon?: string
  loading?: boolean
}>(), {
  confirmText: 'Confirm',
  confirmColor: 'error',
  icon: 'mdi-alert-outline',
  loading: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()
</script>

<template>
  <AppDialog
    :model-value="modelValue"
    max-width="400"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="pa-5">
      <div class="confirm-heading">
        <div class="confirm-icon" :class="`confirm-icon--${confirmColor}`">
          <v-icon :icon="icon" size="24" />
        </div>
        <h2 class="text-h6 font-weight-black">{{ title }}</h2>
      </div>
      <p class="text-body-2 muted mt-2">{{ message }}</p>
      <div class="confirm-actions mt-6">
        <v-btn
          class="confirm-actions__primary"
          size="large"
          :color="confirmColor"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </v-btn>
        <v-btn class="confirm-actions__cancel" variant="text" :disabled="loading" @click="emit('update:modelValue', false)">
          Cancel
        </v-btn>
      </div>
    </v-card>
  </AppDialog>
</template>

<style scoped>
.confirm-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.confirm-icon {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 15px;
  background: rgb(var(--v-theme-error) / .16);
  color: rgb(var(--v-theme-error));
}

.confirm-icon--warning {
  background: rgb(var(--v-theme-warning) / .16);
  color: rgb(var(--v-theme-warning));
}

.confirm-icon--secondary {
  background: rgb(var(--v-theme-secondary) / .16);
  color: rgb(var(--v-theme-secondary));
}

.confirm-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.confirm-actions .v-btn {
  width: 100%;
}

@media (min-width: 600px) {
  .confirm-actions {
    flex-direction: row;
    justify-content: flex-end;
  }

  .confirm-actions .v-btn {
    width: auto;
  }

  .confirm-actions__cancel {
    order: 1;
  }

  .confirm-actions__primary {
    order: 2;
  }
}
</style>
