<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import IntervalReviewCardsField from '@/components/IntervalReviewCardsField.vue'
import IntervalNodeEditor from '@/components/IntervalNodeEditor.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import {
  createIntervalGroup,
  createIntervalStep,
  duplicateIntervalNode,
  formatIntervalDuration,
  intervalDuration,
  intervalGlobalRepetitionSettings,
  intervalStepCount,
  MAX_GLOBAL_REPETITIONS,
  MIN_GLOBAL_REPETITIONS,
  moveIntervalNodeToGroup,
} from '@/services/intervals'
import type {
  IntervalCueSettings,
  IntervalDefinition,
  FlashcardReviewSet,
  IntervalGroupNode,
  IntervalNode,
} from '@/types/domain'

defineProps<{
  reviewSetSpeechEnabled?: boolean
  reviewSets?: FlashcardReviewSet[]
  allowReviewSetCreate?: boolean
}>()

const definition = defineModel<IntervalDefinition>('definition', { required: true })
const cues = defineModel<IntervalCueSettings>('cues', { required: true })
const reviewSet = defineModel<string | undefined>('reviewSet', { default: undefined })
const root = ref<HTMLElement>()
const pendingNodeDelete = ref<{ id: string; name: string; type: IntervalNode['type'] }>()
const selectedNodeId = ref<string>()
const expandedNodeId = ref<string>()
const nodeActionsDrawer = ref(false)
const sequenceDropTypes = ['interval-step', 'interval-group']

const totalDuration = computed(() => intervalDuration(definition.value))
const totalSteps = computed(() => intervalStepCount(definition.value))
const globalRepetitionEnabled = computed({
  get: () => intervalGlobalRepetitionSettings(definition.value).enabled,
  set: (enabled: boolean) => {
    definition.value.globalRepetition = {
      ...intervalGlobalRepetitionSettings(definition.value),
      enabled,
    }
  },
})
const globalRepetitionDefault = computed({
  get: () => intervalGlobalRepetitionSettings(definition.value).defaultCount,
  set: (defaultCount: number) => {
    definition.value.globalRepetition = {
      enabled: globalRepetitionEnabled.value,
      defaultCount,
    }
  },
})

interface NodeLocation {
  nodes: IntervalNode[]
  index: number
  parent?: IntervalGroupNode
  parentNodes?: IntervalNode[]
  parentIndex?: number
}

function findNode(
  nodes: IntervalNode[],
  id: string,
  parent?: IntervalGroupNode,
  parentNodes?: IntervalNode[],
  parentIndex?: number,
): NodeLocation | undefined {
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

const selectedNodeLocation = computed(() => selectedNodeId.value
  ? findNode(definition.value.children, selectedNodeId.value)
  : undefined)
const selectedNode = computed(() => {
  const location = selectedNodeLocation.value
  return location?.nodes[location.index]
})
const selectedNodeCanIndent = computed(() => {
  const location = selectedNodeLocation.value
  if (!location || location.index === 0) return false
  return location.nodes[location.index - 1]?.type === 'group'
})
const selectedNodeCanOutdent = computed(() => Boolean(selectedNodeLocation.value?.parent))

function createNode(type: 'step' | 'group') {
  return type === 'step' ? createIntervalStep() : createIntervalGroup('')
}

function firstIntervalId(nodes: IntervalNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'step') return node.id
    const nested = firstIntervalId(node.children)
    if (nested) return nested
  }
  return undefined
}

watch(definition, value => {
  expandedNodeId.value = firstIntervalId(value.children)
}, { immediate: true })

async function scrollToNode(nodeId: string) {
  await nextTick()
  const node = Array.from(root.value?.querySelectorAll<HTMLElement>('[data-interval-node-id]') || [])
    .find(element => element.dataset.intervalNodeId === nodeId)
  node?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

function addRootNode(type: 'step' | 'group') {
  const node = createNode(type)
  definition.value.children.push(node)
  if (node.type === 'step') expandedNodeId.value = node.id
  void scrollToNode(node.id)
}

const actions = {
  add(parentId: string, type: 'step' | 'group') {
    const location = findNode(definition.value.children, parentId)
    const parent = location?.nodes[location.index]
    if (!parent || parent.type !== 'group') return
    const node = createNode(type)
    parent.children.push(node)
    if (node.type === 'step') expandedNodeId.value = node.id
    void scrollToNode(node.id)
  },
  move(id: string, direction: -1 | 1) {
    const location = findNode(definition.value.children, id)
    if (!location) return
    const target = location.index + direction
    if (target < 0 || target >= location.nodes.length) return
    const [node] = location.nodes.splice(location.index, 1)
    if (node) location.nodes.splice(target, 0, node)
  },
  indent(id: string) {
    const location = findNode(definition.value.children, id)
    if (!location || location.index === 0) return
    const previous = location.nodes[location.index - 1]
    if (!previous || previous.type !== 'group') return
    const [node] = location.nodes.splice(location.index, 1)
    if (node) previous.children.push(node)
  },
  outdent(id: string) {
    const location = findNode(definition.value.children, id)
    if (!location?.parent || !location.parentNodes || location.parentIndex === undefined) return
    const [node] = location.nodes.splice(location.index, 1)
    if (node) location.parentNodes.splice(location.parentIndex + 1, 0, node)
  },
  duplicate(id: string) {
    const location = findNode(definition.value.children, id)
    const node = location?.nodes[location.index]
    if (!location || !node) return
    const duplicate = duplicateIntervalNode(node)
    location.nodes.splice(location.index + 1, 0, duplicate)
    if (duplicate.type === 'step') expandedNodeId.value = duplicate.id
    void scrollToNode(duplicate.id)
  },
  remove(id: string) {
    const location = findNode(definition.value.children, id)
    const node = location?.nodes[location.index]
    if (!node) return
    pendingNodeDelete.value = {
      id,
      name: node.name || (node.type === 'group' ? 'Untitled group' : 'Untitled interval'),
      type: node.type,
    }
  },
  open(id: string) {
    selectedNodeId.value = id
    nodeActionsDrawer.value = true
  },
  toggle(id: string) {
    const location = findNode(definition.value.children, id)
    const node = location?.nodes[location.index]
    if (!node || node.type !== 'step') return
    expandedNodeId.value = expandedNodeId.value === id ? undefined : id
  },
  reorder(result: LongPressDragResult) {
    moveIntervalNodeToGroup(
      definition.value,
      result.id,
      result.toDropZoneId === 'root' ? undefined : result.toDropZoneId,
      result.orderedIds,
    )
  },
}

function moveSelectedNode(direction: -1 | 1) {
  if (!selectedNodeId.value) return
  nodeActionsDrawer.value = false
  actions.move(selectedNodeId.value, direction)
}

function runSelectedNodeAction(action: 'indent' | 'outdent' | 'duplicate' | 'remove') {
  if (!selectedNodeId.value) return
  nodeActionsDrawer.value = false
  actions[action](selectedNodeId.value)
}

function confirmNodeDelete() {
  if (!pendingNodeDelete.value) return
  const location = findNode(definition.value.children, pendingNodeDelete.value.id)
  if (location) {
    const node = location.nodes[location.index]
    location.nodes.splice(location.index, 1)
    if (
      node
      && expandedNodeId.value
      && (node.id === expandedNodeId.value
        || (node.type === 'group' && Boolean(findNode(node.children, expandedNodeId.value))))
    ) expandedNodeId.value = undefined
  }
  pendingNodeDelete.value = undefined
}
</script>

<template>
  <div ref="root" class="interval-settings-fields">
    <div class="interval-settings-fields__cards">
      <IntervalReviewCardsField
        v-if="reviewSets"
        v-model="reviewSet"
        :review-sets="reviewSets"
        :allow-create="allowReviewSetCreate"
      />

      <v-card class="surface-card pa-5">
        <div class="setting-row">
          <div><strong>Sound cues</strong><p>Count down the final three seconds and signal each interval</p></div>
          <v-switch v-model="cues.soundEnabled" color="secondary" hide-details="auto" inset />
        </div>
        <v-divider class="my-3" />
        <div class="setting-row">
          <div><strong>Vibration</strong><p>Vibrate on supported devices</p></div>
          <v-switch v-model="cues.vibrationEnabled" color="secondary" hide-details="auto" inset />
        </div>
        <v-divider class="my-3" />
        <div class="setting-row">
          <div><strong>Flexible repeats</strong><p>Choose how many times to repeat the sequence whenever you start the timer</p></div>
          <v-switch
            v-model="globalRepetitionEnabled"
            color="secondary"
            hide-details="auto"
            inset
            aria-label="Enable flexible repeats"
          />
        </div>
        <v-expand-transition>
          <div v-if="globalRepetitionEnabled" class="global-repetition-default">
            <LabeledSlider
              v-model="globalRepetitionDefault"
              title="Default repetitions"
              :min="MIN_GLOBAL_REPETITIONS"
              :max="MAX_GLOBAL_REPETITIONS"
              :step="1"
              class="mt-4"
              aria-label="Default repetitions for flexible repeats"
            />
          </div>
        </v-expand-transition>
      </v-card>

      <v-card class="surface-card pa-5">
        <div class="summary-grid">
          <div><span>Duration</span><strong>{{ formatIntervalDuration(totalDuration) }}</strong></div>
          <div><span>Intervals</span><strong>{{ totalSteps }}</strong></div>
        </div>
      </v-card>
    </div>

    <div class="section-heading">
      <h2>Sequence</h2>
      <div v-if="definition.children.length" class="d-flex ga-2">
        <v-btn size="small" variant="tonal" icon="mdi-timer-plus-outline" aria-label="Add interval" @click="addRootNode('step')" />
        <v-btn size="small" variant="tonal" icon="mdi-folder-plus-outline" aria-label="Add group" @click="addRootNode('group')" />
      </div>
    </div>
    <div
      v-long-press-drop="{ id: 'root', accepts: sequenceDropTypes }"
      class="sequence-tree"
    >
      <div v-if="!definition.children.length" class="sequence-empty">
        <span class="sequence-empty__icon">
          <v-icon icon="mdi-timeline-plus-outline" size="1.75rem" />
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
          v-for="(node, index) in definition.children"
          :key="node.id"
          :node="node"
          :index="index"
          :depth="0"
          :can-indent="index > 0 && definition.children[index - 1]?.type === 'group'"
          :can-outdent="false"
          :can-skip-on-last-round="index === definition.children.length - 1 && node.type === 'step'"
          :review-set-speech-enabled="reviewSetSpeechEnabled"
          :expanded-node-id="expandedNodeId"
          :actions="actions"
        />
      </template>
    </div>

    <ActionBottomSheet
      v-model="nodeActionsDrawer"
      :title="selectedNode?.name || (selectedNode?.type === 'group' ? 'Untitled group' : 'Untitled interval')"
      aria-label="Sequence item actions"
    >
      <template v-if="selectedNode && selectedNodeLocation">
        <v-list-item
          prepend-icon="mdi-arrow-up"
          title="Move up"
          rounded="lg"
          :disabled="selectedNodeLocation.index === 0"
          @click="moveSelectedNode(-1)"
        />
        <v-list-item
          prepend-icon="mdi-arrow-down"
          title="Move down"
          rounded="lg"
          :disabled="selectedNodeLocation.index === selectedNodeLocation.nodes.length - 1"
          @click="moveSelectedNode(1)"
        />
        <v-list-item
          prepend-icon="mdi-arrow-right"
          title="Indent into previous group"
          rounded="lg"
          :disabled="!selectedNodeCanIndent"
          @click="runSelectedNodeAction('indent')"
        />
        <v-list-item
          prepend-icon="mdi-arrow-left"
          title="Move out of group"
          rounded="lg"
          :disabled="!selectedNodeCanOutdent"
          @click="runSelectedNodeAction('outdent')"
        />
        <v-divider class="my-1" />
        <v-list-item
          prepend-icon="mdi-content-copy"
          title="Duplicate"
          rounded="lg"
          @click="runSelectedNodeAction('duplicate')"
        />
        <v-list-item
          prepend-icon="mdi-delete-outline"
          title="Delete"
          rounded="lg"
          base-color="error"
          @click="runSelectedNodeAction('remove')"
        />
      </template>
    </ActionBottomSheet>

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
  </div>
</template>

<style scoped>
.interval-settings-fields,
.interval-settings-fields__cards,
.sequence-tree { display: grid; gap: 1rem; }
.section-heading { margin-top: 1.5rem; }
.sequence-empty { display: grid; justify-items: center; gap: 1rem; padding: 2rem 1.25rem; border: .0625rem dashed rgb(var(--v-theme-on-surface) / .22); border-radius: 1.25rem; background: rgb(var(--v-theme-surface-variant) / .28); text-align: center; }
.sequence-empty__icon { display: grid; width: 3.375rem; height: 3.375rem; place-items: center; border-radius: 1rem; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.sequence-empty p { max-width: 28rem; margin-top: .25rem; color: rgb(var(--v-theme-on-surface) / .58); font-size: .75rem; }
.sequence-empty__actions { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.sequence-empty__actions .v-btn { width: 100%; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.summary-grid div { display: flex; flex-direction: column; gap: .25rem; }
.summary-grid span { color: rgb(var(--v-theme-on-surface) / .56); font-size: .7rem; text-transform: uppercase; }
.summary-grid strong { font-size: 1.35rem; }
.setting-row { display: grid; min-height: 4rem; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 1rem; }
.setting-row > div { min-width: 0; }
.setting-row p { margin-top: .15rem; color: rgb(var(--v-theme-on-surface) / .5); font-size: .7rem; }
.global-repetition-default { border-top: .0625rem solid rgb(var(--v-theme-on-surface) / .08); }

@media (max-width: 32rem) {
  .sequence-empty__actions { grid-template-columns: 1fr; }
}
</style>
