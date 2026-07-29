<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IntervalNodeEditor from '@/components/IntervalNodeEditor.vue'
import { previewIntervalCue } from '@/services/intervalCues'
import {
  createIntervalGroup,
  createIntervalId,
  createIntervalStep,
  formatIntervalDuration,
  intervalDuration,
  intervalStepCount,
  validateIntervalDefinition,
} from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalCueSound, IntervalGroupNode, IntervalNode, IntervalTemplateDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const error = ref('')
const isEditing = computed(() => Boolean(route.params.id))

const starterGroup = createIntervalGroup('Rounds', 4)
starterGroup.children = [
  createIntervalStep('Work', 'work', 30),
  createIntervalStep('Rest', 'rest', 15),
]

const draft = reactive<IntervalTemplateDraft>({
  name: '',
  description: '',
  color: '#C7F464',
  definition: { version: 1, children: [starterGroup] },
  cues: { soundEnabled: true, vibrationEnabled: true, sound: 'beep' },
  sortOrder: 0,
})

const colors = ['#C7F464', '#8FB8FF', '#FFB86B', '#D4A5FF', '#79C174', '#FF776B']
const totalDuration = computed(() => intervalDuration(draft.definition))
const totalSteps = computed(() => intervalStepCount(draft.definition))

function previewSound(sound: unknown = draft.cues.sound) {
  return previewIntervalCue({ ...draft.cues, sound: sound as IntervalCueSound })
}

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

const actions = {
  add(parentId: string, type: 'step' | 'group') {
    const location = findNode(draft.definition.children, parentId)
    const parent = location?.nodes[location.index]
    if (!parent || parent.type !== 'group') return
    parent.children.push(type === 'step' ? createIntervalStep('', 'work', 30) : createIntervalGroup('', 2))
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
    if (location) location.nodes.splice(location.index, 1)
  },
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
  Object.assign(draft, structuredClone(template))
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
      <v-card class="surface-card pa-5 mb-4">
        <div class="field-stack">
          <v-text-field v-model="draft.name" label="Template name" :rules="[value => Boolean(value) || 'Name is required']" />
          <v-textarea v-model="draft.description" label="Description (optional)" rows="2" auto-grow />
        </div>
        <label class="field-label d-block mt-4">Template color</label>
        <div class="color-row mt-2">
          <button
            v-for="color in colors"
            :key="color"
            type="button"
            class="color-choice"
            :class="{ 'color-choice--selected': draft.color === color }"
            :style="{ background: color }"
            :aria-label="`Use color ${color}`"
            @click="draft.color = color"
          >
            <v-icon v-if="draft.color === color" icon="mdi-check-bold" size="16" />
          </button>
        </div>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <div class="summary-grid">
          <div><span>Duration</span><strong>{{ formatIntervalDuration(totalDuration) }}</strong></div>
          <div><span>Intervals</span><strong>{{ totalSteps }}</strong></div>
        </div>
      </v-card>

      <v-card class="surface-card pa-5 mb-4">
        <div class="setting-row">
          <div><strong>Sound cues</strong><p>Play a cue when intervals change</p></div>
          <v-switch v-model="draft.cues.soundEnabled" color="secondary" hide-details inset />
        </div>
        <v-select
          v-if="draft.cues.soundEnabled"
          v-model="draft.cues.sound"
          label="Cue sound"
          :items="[{ title: 'Beep', value: 'beep' }, { title: 'Bell', value: 'bell' }, { title: 'Soft', value: 'soft' }]"
          class="mt-4"
        >
          <template #append-inner>
            <v-btn
              icon="mdi-play"
              variant="text"
              size="small"
              aria-label="Preview cue sound"
              @mousedown.stop
              @click.stop="previewSound()"
            />
          </template>
          <template #item="{ props, item }">
            <v-list-item v-bind="props">
              <template #append>
                <v-btn
                  icon="mdi-play"
                  variant="text"
                  size="small"
                  :aria-label="`Preview ${item.title} sound`"
                  @mousedown.stop
                  @click.stop="previewSound(item.value)"
                />
              </template>
            </v-list-item>
          </template>
        </v-select>
        <v-divider class="my-3" />
        <div class="setting-row">
          <div><strong>Vibration</strong><p>Vibrate on supported devices</p></div>
          <v-switch v-model="draft.cues.vibrationEnabled" color="secondary" hide-details inset />
        </div>
      </v-card>

      <div class="section-heading">
        <h2>Sequence</h2>
        <div class="d-flex ga-2">
          <v-btn size="small" variant="tonal" icon="mdi-timer-plus-outline" aria-label="Add interval" @click="draft.definition.children.push(createIntervalStep('', 'work', 30))" />
          <v-btn size="small" variant="tonal" icon="mdi-folder-plus-outline" aria-label="Add group" @click="draft.definition.children.push(createIntervalGroup('', 2))" />
        </div>
      </div>
      <div class="sequence-tree">
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
.field-stack, .sequence-tree { display: grid; gap: 1rem; }
.field-label { color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 750; }
.color-row { display: flex; flex-wrap: wrap; gap: .55rem; }
.color-choice { display: grid; width: 38px; height: 38px; place-items: center; border: 2px solid transparent; border-radius: 12px; color: #17200f; cursor: pointer; }
.color-choice--selected { border-color: rgb(var(--v-theme-on-surface)); box-shadow: 0 0 0 2px rgb(var(--v-theme-background)); }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.summary-grid div { display: flex; flex-direction: column; gap: .25rem; }
.summary-grid span { color: rgb(var(--v-theme-on-surface) / .56); font-size: .7rem; text-transform: uppercase; }
.summary-grid strong { font-size: 1.35rem; }
.setting-row { display: flex; min-height: 64px; align-items: center; justify-content: space-between; gap: 1rem; }
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
