<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { SubmitEventPromise } from 'vuetify'
import type { VForm } from 'vuetify/components'

defineOptions({ inheritAttrs: false })

const emit = defineEmits<{
  submit: [event: SubmitEventPromise]
}>()

const form = ref<VForm>()
let pendingErrorReveal: Promise<void> | undefined

function revealFirstError() {
  if (pendingErrorReveal) return pendingErrorReveal

  pendingErrorReveal = nextTick()
    .then(() => {
      const formElement = form.value?.$el
      if (!(formElement instanceof HTMLElement)) return

      const errorField = formElement.querySelector<HTMLElement>('.v-input--error')
      if (!errorField) return

      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      errorField.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      })
    })
    .finally(() => {
      pendingErrorReveal = undefined
    })

  return pendingErrorReveal
}

async function validate() {
  const result = await form.value?.validate()
  if (result && !result.valid) await revealFirstError()
  return result
}

function reset() {
  return form.value?.reset()
}

function resetValidation() {
  return form.value?.resetValidation()
}

function onSubmit(event: SubmitEventPromise) {
  emit('submit', event)
  void event.then((result) => {
    if (!result.valid) return revealFirstError()
  })
}

defineExpose({
  reset,
  resetValidation,
  validate,
})
</script>

<template>
  <v-form ref="form" v-bind="$attrs" @submit="onSubmit">
    <slot />
  </v-form>
</template>
