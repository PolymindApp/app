<script setup lang="ts">
import { computed } from 'vue'
import IntervalTypeIcon from '@/components/IntervalTypeIcon.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import TimerWheelPicker from '@/components/TimerWheelPicker.vue'
import {
  changeSelectionFeedback,
  endSelectionFeedback,
  startSelectionFeedback,
} from '@/services/haptics'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { INTERVAL_STEP_TYPES, INTERVAL_TYPE_PRESENTATION } from '@/services/intervalTypes'
import type { IntervalGroupNode, IntervalNode, IntervalStepKind } from '@/types/domain'

const props = defineProps<{
  node: IntervalNode
  index: number
  depth: number
  canIndent: boolean
  canOutdent: boolean
  canSkipOnLastRound: boolean
  reviewSetSpeechEnabled?: boolean
  parentId?: string
  expandedNodeId?: string
  actions: {
    add: (parentId: string, type: 'step' | 'group') => void
    move: (id: string, direction: -1 | 1) => void
    indent: (id: string) => void
    outdent: (id: string) => void
    duplicate: (id: string) => void
    remove: (id: string) => void
    open: (id: string) => void
    toggle: (id: string) => void
    reorder: (result: LongPressDragResult) => void
  }
}>()

const sequenceDropTypes = ['interval-step', 'interval-group']

const emptyKindPresentation = { icon: 'mdi-timer-outline', color: '#A9B0A7' }

const presentation = computed(() =>
  props.node.type === 'group'
    ? { icon: 'mdi-folder-outline', color: '#C7F464' }
    : props.node.kind
      ? INTERVAL_TYPE_PRESENTATION[props.node.kind]
      : emptyKindPresentation,
)
const isExpanded = computed(() => props.expandedNodeId === props.node.id)
const nodeTitle = computed(() =>
  props.node.name || (props.node.type === 'group' ? 'Untitled group' : 'Untitled interval'),
)
const editorPanelId = computed(() => `interval-node-panel-${props.node.id}`)

const repeatCount = computed({
  get: () => props.node.type === 'group'
    ? Math.min(15, Math.max(1, Math.round(props.node.repeatCount || 1)))
    : 1,
  set: (value: number) => {
    if (props.node.type !== 'group') return
    props.node.repeatCount = Math.min(15, Math.max(1, Math.round(Number(value) || 1)))
  },
})

if (props.node.type === 'group') props.node.repeatCount = repeatCount.value

const durationSeconds = computed({
  get: () => props.node.type === 'step' ? props.node.durationSeconds : 0,
  set: (value: number) => {
    if (props.node.type === 'step') props.node.durationSeconds = value
  },
})

const flashcardReviewEnabled = computed({
  get: () => props.node.type === 'step' && props.node.flashcardReviewEnabled !== false,
  set: (enabled: boolean) => {
    if (props.node.type === 'step') props.node.flashcardReviewEnabled = enabled
  },
})

function selectKind(kind: IntervalStepKind | null) {
  if (props.node.type !== 'step' || !kind) return
  const currentName = props.node.name.trim()
  const hasTypeName = INTERVAL_STEP_TYPES.some((option) =>
    option.title.localeCompare(currentName, undefined, { sensitivity: 'accent' }) === 0,
  )
  props.node.kind = kind
  if (!currentName || hasTypeName) {
    props.node.name = INTERVAL_STEP_TYPES.find((option) => option.value === kind)?.title || kind
  }
}
</script>

<template>
  <v-card
    v-long-press-drag="{
      id: node.id,
      type: node.type === 'step' ? 'interval-step' : 'interval-group',
      group: `interval-sequence-${parentId || 'root'}`,
      handle: '.interval-node__drag-handle',
      onDrop: actions.reorder,
    }"
    class="interval-node interval-node--draggable surface-card pa-4"
    :class="[
      `interval-node--${node.type}`,
      {
        'interval-node--nested': depth > 0,
        'interval-node--deep': depth > 1,
        'interval-node--expanded': isExpanded,
      },
    ]"
    :style="{ '--node-accent': presentation.color }"
    :data-interval-node-id="node.id"
  >
    <div class="interval-node__header">
      <button
        v-if="node.type === 'step'"
        type="button"
        class="interval-node__toggle interval-node__drag-handle"
        :aria-expanded="isExpanded"
        :aria-controls="editorPanelId"
        :aria-label="`${isExpanded ? 'Collapse' : 'Expand'} ${nodeTitle}`"
        @click="actions.toggle(node.id)"
      >
        <span class="node-index">{{ index + 1 }}</span>
        <IntervalTypeIcon v-if="node.kind" :kind="node.kind" size="1.25rem" />
        <strong class="node-title text-body-2 text-truncate">{{ nodeTitle }}</strong>
        <v-icon
          class="node-toggle-icon"
          :icon="isExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          size="20"
        />
      </button>
      <div v-else class="interval-node__group-heading interval-node__drag-handle">
        <span class="node-index">{{ index + 1 }}</span>
        <strong class="node-title text-body-2 text-truncate">{{ nodeTitle }}</strong>
      </div>
      <v-btn
        icon="mdi-dots-horizontal"
        variant="text"
        size="small"
        aria-label="Interval item actions"
        @click="actions.open(node.id)"
      />
    </div>

    <v-expand-transition v-if="node.type === 'step'">
      <div v-show="isExpanded" :id="editorPanelId" class="node-fields mt-4">
        <v-text-field v-model="node.name" label="Interval name" />
        <v-select
          :model-value="node.kind || null"
          label="Type"
          :items="INTERVAL_STEP_TYPES"
          item-title="title"
          item-value="value"
          autocomplete="off"
          :menu-props="{ transition: 'slide-y-transition' }"
          @update:model-value="selectKind"
        >
          <template #selection="{ item }">
            <div class="type-select-option">
              <IntervalTypeIcon :kind="item.raw.value" size="1.25rem" />
              <span>{{ item.raw.title }}</span>
            </div>
          </template>
          <template #item="{ props: optionProps, item }">
            <v-list-item v-bind="optionProps">
              <template #prepend>
                <IntervalTypeIcon :kind="item.raw.value" size="1.25rem" class="mr-3" />
              </template>
            </v-list-item>
          </template>
        </v-select>
        <fieldset v-if="node.kind !== 'confirmation'" class="duration-wheel">
          <legend>Duration</legend>
          <TimerWheelPicker v-model="durationSeconds" />
        </fieldset>
        <v-checkbox
          v-if="reviewSetSpeechEnabled"
          v-model="flashcardReviewEnabled"
          label="Play Review set during this step"
          color="secondary"
          density="comfortable"
          hide-details="auto"
        />
        <v-checkbox
          v-if="canSkipOnLastRound"
          v-model="node.skipOnLastRound"
          label="Skip this step on the final round"
          color="secondary"
          density="comfortable"
          hide-details
        />
      </div>
    </v-expand-transition>

    <template v-else>
      <div :id="editorPanelId" class="group-branch">
        <div class="group-editor-panel">
          <div class="node-fields mt-4">
            <v-text-field v-model="node.name" label="Group name" />
            <LabeledSlider
              v-model="repeatCount"
              title="Repeat"
              :min="1"
              :max="15"
              :step="1"
              aria-label="Repeat count"
              @start="startSelectionFeedback"
              @update:model-value="changeSelectionFeedback"
              @end="endSelectionFeedback"
            />
          </div>
          <div class="group-actions mt-4">
            <v-btn size="small" variant="tonal" prepend-icon="mdi-timer-plus-outline" @click="actions.add(node.id, 'step')">Add interval</v-btn>
            <v-btn size="small" variant="tonal" prepend-icon="mdi-folder-plus-outline" @click="actions.add(node.id, 'group')">Add group</v-btn>
          </div>
        </div>
        <div
          v-long-press-drop="{ id: node.id, accepts: sequenceDropTypes }"
          class="nested-nodes mt-4"
          :class="{ 'nested-nodes--empty': !node.children.length }"
        >
          <IntervalNodeEditor
            v-for="(child, childIndex) in node.children"
            :key="child.id"
            :node="child"
            :index="childIndex"
            :depth="depth + 1"
            :can-indent="childIndex > 0 && node.children[childIndex - 1]?.type === 'group'"
            :can-outdent="true"
            :can-skip-on-last-round="node.repeatCount > 1 && childIndex === node.children.length - 1 && child.type === 'step'"
            :review-set-speech-enabled="reviewSetSpeechEnabled"
            :parent-id="node.id"
            :expanded-node-id="expandedNodeId"
            :actions="actions"
          />
          <p v-if="!node.children.length" class="empty-group muted">
            Add or drop an interval or nested group.
          </p>
        </div>
      </div>
    </template>
  </v-card>
</template>

<style scoped>
.interval-node {
  border: 1px solid rgba(241, 244, 236, .2) !important;
  background: #202520 !important;
  box-shadow: 0 10px 24px rgba(0, 0, 0, .28) !important;
  transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
}
.interval-node--group {
  border-color: rgba(241, 244, 236, .28) !important;
  background: #2c332a !important;
}
.interval-node--expanded { border-color: rgba(var(--v-theme-secondary), .52) !important; }
.interval-node--step.interval-node--nested { background: #171b17 !important; }
.interval-node--step.interval-node--deep { background: #222821 !important; }
.interval-node--group.interval-node--nested { background: #343c31 !important; }
.interval-node--group.interval-node--deep { background: #3b4537 !important; }
.interval-node--nested {
  border-color: rgba(241, 244, 236, .24) !important;
  box-shadow: 0 6px 16px rgba(0, 0, 0, .26) !important;
}
.interval-node:focus-within {
  border-color: rgb(var(--v-theme-secondary) / .9) !important;
  box-shadow: 0 0 0 2px rgb(var(--v-theme-secondary) / .24), 0 12px 28px rgba(0, 0, 0, .32) !important;
}
.interval-node__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.interval-node__toggle,
.interval-node__group-heading { display: flex; min-width: 0; flex: 1 1 auto; align-items: center; gap: .5rem; padding: 0; border: 0; border-radius: 10px; background: transparent; color: inherit; text-align: left; }
.interval-node__toggle { cursor: pointer; }
.interval-node--draggable > .interval-node__header > .interval-node__drag-handle { cursor: grab; }
.interval-node__toggle:focus-visible { outline: 2px solid rgba(var(--v-theme-secondary), .82); outline-offset: 4px; }
.node-title { min-width: 0; flex: 1 1 auto; }
.node-toggle-icon { flex: 0 0 auto; color: rgba(var(--v-theme-on-surface), .62); }
.interval-node--group > .interval-node__header { padding-bottom: .75rem; border-bottom: 1px solid rgba(241, 244, 236, .14); }
.node-index { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 10px; background: var(--node-accent); color: #17200f; font-size: .72rem; font-weight: 900; }
.node-fields, .nested-nodes { display: grid; gap: 1rem; }
.nested-nodes { border-left: 3px solid rgb(var(--v-theme-secondary) / .62); }
.nested-nodes--empty { min-height: 3.5rem; align-items: center; }
.duration-wheel { min-width: 0; margin: 0; padding: 0; border: 0; }
.duration-wheel > legend { margin-bottom: .5rem; color: rgb(var(--v-theme-on-surface) / .68); font-size: .75rem; font-weight: 800; }
.type-select-option { display: flex; min-width: 0; align-items: center; gap: .625rem; }
.group-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem; }
.group-actions .v-btn { width: 100%; }
.empty-group { padding: 1rem; border: 1px dashed rgb(var(--v-theme-on-surface) / .18); border-radius: 14px; text-align: center; font-size: .75rem; }
</style>
