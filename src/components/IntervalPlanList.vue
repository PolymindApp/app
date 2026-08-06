<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplate } from '@/types/domain'

const store = useIntervalStore()
const router = useRouter()
const pendingDelete = ref<IntervalTemplate>()
const selectedTemplate = ref<IntervalTemplate>()
const primaryActionsDrawer = ref(false)
const overflowActionsDrawer = ref(false)
const deleting = ref(false)
const reordering = ref(false)

onMounted(() => {
  if (!store.templates.length) store.load().catch(() => undefined)
})

async function removeTemplate() {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    await store.deleteTemplate(pendingDelete.value.id)
    pendingDelete.value = undefined
  } catch {
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
  await saveTemplateOrder(ordered)
}

async function saveTemplateOrder(ordered: IntervalTemplate[]) {
  reordering.value = true
  try {
    await store.reorderTemplates(ordered)
  } catch {
    // The store restores the previous order and exposes the save error.
  } finally {
    reordering.value = false
  }
}

async function reorderByDrag(result: LongPressDragResult) {
  const templatesById = new Map(
    store.templates.map((template) => [template.id, template]),
  )
  const ordered = result.orderedIds
    .map((id) => templatesById.get(id))
    .filter((template): template is IntervalTemplate => Boolean(template))
  if (ordered.length !== store.templates.length) return
  await saveTemplateOrder(ordered)
}

function startTemplate(template: IntervalTemplate) {
  primaryActionsDrawer.value = false
  overflowActionsDrawer.value = false
  return router.push(`/intervals/run/template/${template.id}`)
}

function editTemplate(template: IntervalTemplate) {
  primaryActionsDrawer.value = false
  overflowActionsDrawer.value = false
  return router.push(`/intervals/${template.id}/edit`)
}

function openPrimaryActions(template: IntervalTemplate) {
  overflowActionsDrawer.value = false
  selectedTemplate.value = template
  primaryActionsDrawer.value = true
}

function openOverflowActions(template: IntervalTemplate) {
  primaryActionsDrawer.value = false
  selectedTemplate.value = template
  overflowActionsDrawer.value = true
}

async function duplicateTemplate(template: IntervalTemplate) {
  overflowActionsDrawer.value = false
  await store.duplicateTemplate(template)
}

async function moveTemplate(template: IntervalTemplate, direction: -1 | 1) {
  overflowActionsDrawer.value = false
  await move(template, direction)
}

function requestDelete(template: IntervalTemplate) {
  overflowActionsDrawer.value = false
  pendingDelete.value = template
}
</script>

<template>
  <div v-if="store.templates.length" class="interval-plan-list">
    <v-card
      v-for="template in store.templates"
      :key="template.id"
      v-long-press-drag="{
        id: template.id,
        group: 'interval-templates',
        disabled: store.templates.length < 2 || reordering,
        onDrop: reorderByDrag,
      }"
      class="surface-card pa-4 interval-plan-card"
      role="button"
      tabindex="0"
      :aria-label="`Open ${template.name} actions`"
      @click="openPrimaryActions(template)"
      @keydown.enter="openPrimaryActions(template)"
      @keydown.space.prevent="openPrimaryActions(template)"
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
        <div
          class="interval-plan-actions"
          @pointerdown.stop
          @pointerup.stop
          @touchstart.stop
          @click.stop
        >
          <v-btn
            icon="mdi-dots-horizontal"
            variant="text"
            size="small"
            :aria-label="`${template.name} more actions`"
            @click="openOverflowActions(template)"
          />
        </div>
      </div>
    </v-card>
  </div>

  <v-card v-else-if="store.loaded" class="surface-card pa-8 text-center">
    <v-icon icon="mdi-timer-plus-outline" size="42" class="mb-3" />
    <h2 class="text-h6 font-weight-black">Build your first interval</h2>
    <p class="text-body-2 muted mt-2 mb-5">Combine timed steps and repeat groups for any kind of session.</p>
    <v-btn color="secondary" to="/intervals/new">Create interval</v-btn>
  </v-card>

  <ActionBottomSheet
    v-model="primaryActionsDrawer"
    :title="selectedTemplate?.name || 'Interval actions'"
    hide-title
    :aria-label="selectedTemplate ? `${selectedTemplate.name} play or edit actions` : 'Interval actions'"
  >
    <template v-if="selectedTemplate">
      <v-list-item prepend-icon="mdi-play" title="Play" rounded="lg" @click="startTemplate(selectedTemplate)" />
      <v-list-item prepend-icon="mdi-pencil-outline" title="Edit" rounded="lg" @click="editTemplate(selectedTemplate)" />
    </template>
  </ActionBottomSheet>

  <ActionBottomSheet
    v-model="overflowActionsDrawer"
    :title="selectedTemplate?.name || 'Interval actions'"
    hide-title
    :aria-label="selectedTemplate ? `${selectedTemplate.name} more actions` : 'Interval actions'"
  >
    <template v-if="selectedTemplate">
      <v-list-item prepend-icon="mdi-content-copy" title="Duplicate" rounded="lg" @click="duplicateTemplate(selectedTemplate)" />
      <v-list-item
        prepend-icon="mdi-arrow-up"
        title="Move up"
        rounded="lg"
        :disabled="store.templates.findIndex(item => item.id === selectedTemplate?.id) === 0"
        @click="moveTemplate(selectedTemplate, -1)"
      />
      <v-list-item
        prepend-icon="mdi-arrow-down"
        title="Move down"
        rounded="lg"
        :disabled="store.templates.findIndex(item => item.id === selectedTemplate?.id) === store.templates.length - 1"
        @click="moveTemplate(selectedTemplate, 1)"
      />
      <v-list-item prepend-icon="mdi-delete-outline" title="Delete" rounded="lg" base-color="error" @click="requestDelete(selectedTemplate)" />
    </template>
  </ActionBottomSheet>

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
.interval-plan-card:focus-visible { outline: 3px solid rgb(var(--v-theme-primary) / .55); outline-offset: 3px; }
.interval-plan-actions { flex: 0 0 auto; }
.interval-template-icon { display: grid; width: 42px; height: 42px; flex: 0 0 auto; place-items: center; border-radius: 14px; color: #17200f; }
@media (min-width: 700px) { .interval-plan-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
