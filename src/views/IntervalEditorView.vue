<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IntervalNodeEditor from '@/components/IntervalNodeEditor.vue'
import {
  cloneIntervalTemplateDraft,
  createIntervalGroup,
  createIntervalId,
  createIntervalStep,
  formatIntervalDuration,
  intervalDuration,
  intervalStepCount,
  validateIntervalDefinition,
} from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalGroupNode, IntervalNode, IntervalTemplateDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const pendingNodeDelete = ref<{ id: string; name: string; type: IntervalNode['type'] }>()
const error = ref('')
const isEditing = computed(() => Boolean(route.params.id))

const draft = reactive<IntervalTemplateDraft>({
  name: '',
  description: '',
  color: '#C7F464',
  definition: { version: 1, children: [] },
  cues: { soundEnabled: true, vibrationEnabled: true },
  sortOrder: 0,
})

const totalDuration = computed(() => intervalDuration(draft.definition))
const totalSteps = computed(() => intervalStepCount(draft.definition))

interface NodeLocation {
  nodes: IntervalNode[]
  index: number
  parent?: IntervalGroupNode
  parentNodes?: IntervalNode[]
  parentIndex?: number
}

function findNode(nodes: IntervalNode[], id: string, parent?: IntervalGroupNode, parentNodes?: IntervalNode[], parentIndex?: number): NodeLocation | undefined {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (!node) continue
    if (node.id === id) return { nodes, index, parent, parentNodes, parentIndex }
    if (node.type === 'group') {
      const nested = findNode(node.children, id, node, nodes, index)
      if (nested) return nested
    }
  }
  return undefined
}

function cloneNode(node: IntervalNode): IntervalNode {
  if (node.type === 'step') return { ...structuredClone(node), id: createIntervalId() }
  return {
    ...structuredClone(node),
    id: createIntervalId(),
    children: node.children.map(cloneNode),
  }
}

function createNode(type: 'step' | 'group') {
  return type === 'step'
    ? createIntervalStep()
    : createIntervalGroup('')
}

async function scrollToNode(nodeId: string) {
  await nextTick()
  const node = Array.from(document.querySelectorAll<HTMLElement>('[data-interval-node-id]'))
    .find((element) => element.dataset.intervalNodeId === nodeId)
  node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

function addRootNode(type: 'step' | 'group') {
  const node = createNode(type)
  draft.definition.children.push(node)
  void scrollToNode(node.id)
}

const actions = {
  add(parentId: string, type: 'step' | 'group') {
    const location = findNode(draft.definition.children, parentId)
    const parent = location?.nodes[location.index]
    if (!parent || parent.type !== 'group') return
    const node = createNode(type)
    parent.children.push(node)
    void scrollToNode(node.id)
  },
  move(id: string, direction: -1 | 1) {
    const location = findNode(draft.definition.children, id)
    if (!location) return
    const target = location.index + direction
    if (target < 0 || target >= location.nodes.length) return
    const [node] = location.nodes.splice(location.index, 1)
    if (node) location.nodes.splice(target, 0, node)
  },
  indent(id: string) {
    const location = findNode(draft.definition.children, id)
    if (!location || location.index === 0) return
    const previous = location.nodes[location.index - 1]
    if (!previous || previous.type !== 'group') return
    const [node] = location.nodes.splice(location.index, 1)
    if (node) previous.children.push(node)
  },
  outdent(id: string) {
    const location = findNode(draft.definition.children, id)
    if (!location?.parent || !location.parentNodes || location.parentIndex === undefined) return
    const [node] = location.nodes.splice(location.index, 1)
    if (node) location.parentNodes.splice(location.parentIndex + 1, 0, node)
  },
  duplicate(id: string) {
    const location = findNode(draft.definition.children, id)
    const node = location?.nodes[location.index]
    if (location && node) location.nodes.splice(location.index + 1, 0, cloneNode(node))
  },
  remove(id: string) {
    const location = findNode(draft.definition.children, id)
    const node = location?.nodes[location.index]
    if (!node) return
    pendingNodeDelete.value = {
      id,
      name: node.name || (node.type === 'group' ? 'Untitled group' : 'Untitled interval'),
      type: node.type,
    }
  },
}

function confirmNodeDelete() {
  if (!pendingNodeDelete.value) return
  const location = findNode(draft.definition.children, pendingNodeDelete.value.id)
  if (location) location.nodes.splice(location.index, 1)
  pendingNodeDelete.value = undefined
}

onMounted(async () => {
  if (!store.templates.length) await store.load()
  if (!route.params.id) {
    draft.sortOrder = store.templates.length
    return
  }
  const template = store.templates.find((item) => item.id === route.params.id)
  if (!template) {
    error.value = 'That interval template could not be found.'
    return
  }
  Object.assign(draft, cloneIntervalTemplateDraft(template))
})

async function save() {
  const result = await form.value?.validate()
  if (!result?.valid) return
  const definitionErrors = validateIntervalDefinition(draft.definition)
  if (definitionErrors.length) {
    error.value = definitionErrors[0] || 'Check the interval sequence.'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await store.saveTemplate(draft)
    await router.replace({ path: '/plan', query: { tab: 'intervals' } })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save the interval.'
  } finally {
    saving.value = false
  }
}

async function removeTemplate() {
  if (!draft.id) return
  deleting.value = true
  try {
    await store.deleteTemplate(draft.id)
    await router.replace({ path: '/plan', query: { tab: 'intervals' } })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not delete the interval.'
    deleteDialog.value = false
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <main class="app-page interval-editor">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-form ref="form" validate-on="lazy" @submit.prevent="save">
      <div class="interval-form-cards">
      <v-card class="surface-card pa-5">
        <div class="field-stack">
          <v-text-field v-model="draft.name" label="Template name" :rules="[value => Boolean(value) || 'Name is required']" />
          <v-textarea v-model="draft.description" label="Description (optional)" rows="2" auto-grow />
        </div>
        <ColorSwatchPicker
          v-model="draft.color"
          label="Template color"
          custom-label="Choose a custom interval template color"
          class="mt-4"
        />
      </v-card>

      <v-card class="surface-card pa-5">
        <div class="summary-grid">
          <div><span>Duration</span><strong>{{ formatIntervalDuration(totalDuration) }}</strong></div>
          <div><span>Intervals</span><strong>{{ totalSteps }}</strong></div>
        </div>
      </v-card>

      <v-card class="surface-card pa-5">
        <div class="setting-row">
          <div><strong>Sound cues</strong><p>Count down the final three seconds and signal each interval</p></div>
          <v-switch v-model="draft.cues.soundEnabled" color="secondary" hide-details inset />
        </div>
        <v-divider class="my-3" />
        <div class="setting-row">
          <div><strong>Vibration</strong><p>Vibrate on supported devices</p></div>
          <v-switch v-model="draft.cues.vibrationEnabled" color="secondary" hide-details inset />
        </div>
      </v-card>
      </div>

      <div class="section-heading">
        <h2>Sequence</h2>
        <div v-if="draft.definition.children.length" class="d-flex ga-2">
          <v-btn size="small" variant="tonal" icon="mdi-timer-plus-outline" aria-label="Add interval" @click="addRootNode('step')" />
          <v-btn size="small" variant="tonal" icon="mdi-folder-plus-outline" aria-label="Add group" @click="addRootNode('group')" />
        </div>
      </div>
      <div class="sequence-tree">
        <div v-if="!draft.definition.children.length" class="sequence-empty">
          <span class="sequence-empty__icon">
            <v-icon icon="mdi-timeline-plus-outline" size="28" />
          </span>
          <div>
            <strong>Build your sequence</strong>
            <p>Add individual intervals or group them into repeatable sets.</p>
          </div>
          <div class="sequence-empty__actions">
            <v-btn variant="tonal" prepend-icon="mdi-timer-plus-outline" @click="addRootNode('step')">Add interval</v-btn>
            <v-btn variant="tonal" prepend-icon="mdi-folder-plus-outline" @click="addRootNode('group')">Add group</v-btn>
          </div>
        </div>
        <template v-else>
          <IntervalNodeEditor
            v-for="(node, index) in draft.definition.children"
            :key="node.id"
            :node="node"
            :index="index"
            :sibling-count="draft.definition.children.length"
            :depth="0"
            :can-indent="index > 0 && draft.definition.children[index - 1]?.type === 'group'"
            :can-outdent="false"
            :actions="actions"
          />
        </template>
      </div>
    </v-form>

    <div class="editor-save-bar page-action-area">
      <div class="editor-save-bar__inner">
        <v-btn class="editor-save-bar__save" color="secondary" :loading="saving" @click="save">Save</v-btn>
        <v-btn class="editor-save-bar__cancel" variant="text" @click="router.back()">Cancel</v-btn>
        <v-btn
          v-if="isEditing"
          class="editor-save-bar__delete"
          icon="mdi-delete-outline"
          color="error"
          variant="text"
          aria-label="Delete interval"
          @click="deleteDialog = true"
        />
      </div>
    </div>

    <ConfirmDialog
      :model-value="Boolean(pendingNodeDelete)"
      :title="pendingNodeDelete?.type === 'group' ? 'Delete this group?' : 'Delete this interval?'"
      :message="pendingNodeDelete?.type === 'group'
        ? `${pendingNodeDelete?.name || 'This group'} and every interval or group inside it will be removed from the sequence.`
        : `${pendingNodeDelete?.name || 'This interval'} will be removed from the sequence.`"
      :confirm-text="pendingNodeDelete?.type === 'group' ? 'Delete group' : 'Delete interval'"
      icon="mdi-delete-outline"
      @update:model-value="!$event && (pendingNodeDelete = undefined)"
      @confirm="confirmNodeDelete"
    />

    <ConfirmDialog
      v-model="deleteDialog"
      title="Delete this interval?"
      message="The template will be removed, but completed session history will remain."
      confirm-text="Delete interval"
      icon="mdi-delete-outline"
      :loading="deleting"
      @confirm="removeTemplate"
    />
  </main>
</template>

<style scoped>
.interval-editor { max-width: 760px; padding-bottom: 6rem; }
.interval-form-cards { display: grid; gap: 1rem; }
.field-stack, .sequence-tree { display: grid; gap: 1rem; }
.sequence-empty { display: grid; justify-items: center; gap: 1rem; padding: 2rem 1.25rem; border: 1px dashed rgb(var(--v-theme-on-surface) / .22); border-radius: 20px; background: rgb(var(--v-theme-surface-variant) / .28); text-align: center; }
.sequence-empty__icon { display: grid; width: 54px; height: 54px; place-items: center; border-radius: 16px; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.sequence-empty p { max-width: 28rem; margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; }
.sequence-empty__actions { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.sequence-empty__actions .v-btn { width: 100%; }
.field-label { color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 750; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.summary-grid div { display: flex; flex-direction: column; gap: .25rem; }
.summary-grid span { color: rgb(var(--v-theme-on-surface) / .56); font-size: .7rem; text-transform: uppercase; }
.summary-grid strong { font-size: 1.35rem; }
.setting-row { display: grid; min-height: 64px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
.setting-row > div { min-width: 0; }
.setting-row p { margin-top: .15rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .7rem; }
.editor-save-bar { position: fixed; z-index: 20; right: 0; bottom: calc(72px + env(safe-area-inset-bottom)); left: 0; padding: .75rem 1rem; border-top: 1px solid rgba(255,255,255,.08); background: rgb(var(--v-theme-background) / .94); backdrop-filter: blur(14px); }
.editor-save-bar__inner { display: flex; width: 100%; max-width: 760px; margin: 0 auto; align-items: center; gap: .5rem; }
.editor-save-bar__inner > .v-btn { height: 48px; }
.editor-save-bar__save,
.editor-save-bar__cancel { min-width: 0; flex: 1 1 0; }
.editor-save-bar__delete { order: 1; width: 48px; min-width: 48px; flex: 0 0 48px; }
.editor-save-bar__cancel { order: 2; margin-left: auto; }
.editor-save-bar__save { order: 3; }
@media (min-width: 960px) {
  .interval-editor { padding-bottom: 6rem; }
  .editor-save-bar { left: 224px; bottom: 0; }
  .editor-save-bar__inner { justify-content: flex-end; }
  .editor-save-bar__save,
  .editor-save-bar__cancel { max-width: 160px; }
}
</style>
