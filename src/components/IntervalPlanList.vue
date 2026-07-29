<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplate } from '@/types/domain'

const store = useIntervalStore()
const router = useRouter()
const pendingDelete = ref<IntervalTemplate>()
const deleting = ref(false)

onMounted(() => {
  if (!store.templates.length) store.load().catch(() => undefined)
})

async function removeTemplate() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    await store.deleteTemplate(pendingDelete.value.id)
    pendingDelete.value = undefined
  } finally {
    deleting.value = false
  }
}

async function move(template: IntervalTemplate, direction: -1 | 1) {
  const index = store.templates.findIndex((item) => item.id === template.id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= store.templates.length) return
  const ordered = [...store.templates]
  const [item] = ordered.splice(index, 1)
  if (!item) return
  ordered.splice(target, 0, item)
  await store.reorderTemplates(ordered)
}
</script>

<template>
  <div v-if="store.templates.length" class="interval-plan-list">
    <v-card
      v-for="(template, index) in store.templates"
      :key="template.id"
      class="surface-card pa-4 interval-plan-card"
      @click="router.push(`/plan/intervals/${template.id}`)"
    >
      <div class="d-flex align-start ga-3">
        <div class="interval-template-icon" :style="{ background: template.color }">
          <v-icon icon="mdi-timer-outline" size="21" />
        </div>
        <div class="flex-grow-1 min-width-0">
          <h2 class="text-body-1 font-weight-black text-truncate">{{ template.name }}</h2>
          <p class="text-caption muted mt-1">
            {{ formatIntervalDuration(intervalDuration(template.definition)) }} ·
            {{ intervalStepCount(template.definition) }} intervals
          </p>
          <p v-if="template.description" class="text-caption muted mt-3 text-truncate">{{ template.description }}</p>
        </div>
        <v-menu location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon="mdi-dots-horizontal"
              variant="text"
              size="small"
              aria-label="Interval template actions"
              @click.stop
            />
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-pencil-outline" title="Edit" @click="router.push(`/plan/intervals/${template.id}`)" />
            <v-list-item prepend-icon="mdi-content-copy" title="Duplicate" @click="store.duplicateTemplate(template)" />
            <v-list-item prepend-icon="mdi-arrow-up" title="Move up" :disabled="index === 0" @click="move(template, -1)" />
            <v-list-item prepend-icon="mdi-arrow-down" title="Move down" :disabled="index === store.templates.length - 1" @click="move(template, 1)" />
            <v-list-item prepend-icon="mdi-delete-outline" title="Delete" base-color="error" @click="pendingDelete = template" />
          </v-list>
        </v-menu>
      </div>
    </v-card>
  </div>

  <v-card v-else-if="store.loaded" class="surface-card pa-8 text-center">
    <v-icon icon="mdi-timer-plus-outline" size="42" class="mb-3" />
    <h2 class="text-h6 font-weight-black">Build your first interval</h2>
    <p class="text-body-2 muted mt-2 mb-5">Combine timed steps and repeat groups for any kind of session.</p>
    <v-btn color="secondary" to="/plan/intervals/new">Create interval</v-btn>
  </v-card>

  <ConfirmDialog
    :model-value="Boolean(pendingDelete)"
    title="Delete this interval?"
    message="The reusable interval will be removed. Existing session history will remain."
    confirm-text="Delete interval"
    icon="mdi-delete-outline"
    :loading="deleting"
    @update:model-value="!$event && (pendingDelete = undefined)"
    @confirm="removeTemplate"
  />
</template>

<style scoped>
.interval-plan-list { display: grid; gap: .75rem; }
.interval-plan-card { cursor: pointer; }
.interval-template-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; color: #17200f; }
@media (min-width: 700px) { .interval-plan-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
