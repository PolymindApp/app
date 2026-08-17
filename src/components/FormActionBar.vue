<script setup lang="ts">
withDefaults(defineProps<{
  primaryText?: string
  loading?: boolean
  primaryDisabled?: boolean
  cancelDisabled?: boolean
  showDelete?: boolean
  deleteLabel?: string
  deleteDisabled?: boolean
  embedded?: boolean
}>(), {
  primaryText: 'Save',
  loading: false,
  primaryDisabled: false,
  cancelDisabled: false,
  showDelete: false,
  deleteLabel: 'Delete',
  deleteDisabled: false,
  embedded: false,
})

const emit = defineEmits<{
  submit: []
  cancel: []
  delete: []
}>()
</script>

<template>
  <div class="form-action-bar page-action-area" :class="{ 'form-action-bar--embedded': embedded }">
    <div class="form-action-bar__inner">
      <v-btn
        v-if="showDelete"
        class="form-action-bar__delete"
        icon="mdi-delete-outline"
        color="error"
        variant="text"
        type="button"
        :aria-label="deleteLabel"
        :disabled="deleteDisabled || loading"
        @click="emit('delete')"
      />
      <v-btn
        class="form-action-bar__cancel"
        variant="text"
        type="button"
        :disabled="cancelDisabled || loading"
        @click="emit('cancel')"
      >
        Cancel
      </v-btn>
      <v-btn
        class="form-action-bar__primary"
        color="secondary"
        type="button"
        :loading="loading"
        :disabled="primaryDisabled"
        @click="emit('submit')"
      >
        {{ primaryText }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.form-action-bar {
  position: fixed;
  z-index: 20;
  right: 0;
  bottom: calc(4.5rem + env(safe-area-inset-bottom));
  left: 0;
  padding: .75rem 1rem;
  border-top: .0625rem solid rgba(255, 255, 255, .08);
  -webkit-backdrop-filter: blur(1rem);
  backdrop-filter: blur(1rem);
}

.form-action-bar__inner {
  display: flex;
  width: 100%;
  max-width: 54.25rem;
  margin: 0 auto;
  align-items: center;
  gap: .5rem;
}

.form-action-bar__inner > .v-btn {
  height: 3rem;
}

.form-action-bar__primary,
.form-action-bar__cancel {
  min-width: 0;
  flex: 1 1 0;
}

.form-action-bar__delete {
  width: 3rem;
  min-width: 3rem;
  flex: 0 0 3rem;
}

.form-action-bar__cancel {
  margin-left: auto;
}

.form-action-bar--embedded {
  position: static;
  padding: .75rem 0 0;
  border-top: .0625rem solid rgba(var(--v-theme-on-surface), .08);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

@media (min-width: 60rem) {
  .form-action-bar {
    bottom: 0;
    left: 17rem;
  }

  .form-action-bar__inner {
    justify-content: flex-end;
  }

  .form-action-bar__primary,
  .form-action-bar__cancel {
    max-width: 10rem;
  }
}
</style>
