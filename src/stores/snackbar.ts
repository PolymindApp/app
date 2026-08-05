import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useSnackbarStore = defineStore('snackbar', () => {
  const visible = ref(false)
  const message = ref('')
  const revision = ref(0)

  function showDeletion(subject: string) {
    message.value = `${subject} deleted.`
    revision.value += 1
    visible.value = true
  }

  function dismiss() {
    visible.value = false
  }

  return { visible, message, revision, showDeletion, dismiss }
})
