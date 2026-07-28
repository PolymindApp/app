<script setup lang="ts">
import { computed } from 'vue'
import type { IntervalGroupNode, IntervalNode, IntervalStepKind } from '@/types/domain'

const props = defineProps<{
  node: IntervalNode
  index: number
  siblingCount: number
  depth: number
  canIndent: boolean
  canOutdent: boolean
  actions: {
    add: (parentId: string, type: 'step' | 'group') => void
    move: (id: string, direction: -1 | 1) => void
    indent: (id: string) => void
    outdent: (id: string) => void
    duplicate: (id: string) => void
    remove: (id: string) => void
  }
}>()

const kinds: Array<{ title: string; value: IntervalStepKind }> = [
  { title: 'Work', value: 'work' },
  { title: 'Rest', value: 'rest' },
  { title: 'Prepare', value: 'prepare' },
  { title: 'Meditation', value: 'meditation' },
  { title: 'Custom', value: 'custom' },
]

const minutes = computed({
  get: () => Math.floor(props.node.type === 'step' ? props.node.durationSeconds / 60 : 0),
  set: (value: number) => {
    if (props.node.type !== 'step') return
    props.node.durationSeconds = Math.max(0, Number(value || 0) * 60 + (props.node.durationSeconds % 60))
  },
})

const seconds = computed({
  get: () => props.node.type === 'step' ? props.node.durationSeconds % 60 : 0,
  set: (value: number) => {
    if (props.node.type !== 'step') return
    props.node.durationSeconds = Math.max(0, Math.floor(props.node.durationSeconds / 60) * 60 + Number(value || 0))
  },
})
</script>

<template>
  <v-card class="interval-node surface-card pa-4" :class="`interval-node--${node.type}`">
    <div class="interval-node__header">
      <div class="d-flex align-center ga-2 min-width-0">
        <span class="node-index">{{ index + 1 }}</span>
        <div class="min-width-0">
          <strong class="text-body-2">{{ node.name || (node.type === 'group' ? 'Untitled group' : 'Untitled interval') }}</strong>
          <p class="text-caption muted">{{ node.type === 'group' ? `${node.repeatCount} repetitions` : node.kind }}</p>
        </div>
      </div>
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" icon="mdi-dots-horizontal" variant="text" size="small" aria-label="Interval item actions" />
        </template>
        <v-list density="compact">
          <v-list-item prepend-icon="mdi-arrow-up" title="Move up" :disabled="index === 0" @click="actions.move(node.id, -1)" />
          <v-list-item prepend-icon="mdi-arrow-down" title="Move down" :disabled="index === siblingCount - 1" @click="actions.move(node.id, 1)" />
          <v-list-item prepend-icon="mdi-arrow-right" title="Indent into previous group" :disabled="!canIndent" @click="actions.indent(node.id)" />
          <v-list-item prepend-icon="mdi-arrow-left" title="Move out of group" :disabled="!canOutdent" @click="actions.outdent(node.id)" />
          <v-list-item prepend-icon="mdi-content-copy" title="Duplicate" @click="actions.duplicate(node.id)" />
          <v-list-item prepend-icon="mdi-delete-outline" title="Delete" base-color="error" @click="actions.remove(node.id)" />
        </v-list>
      </v-menu>
    </div>

    <div v-if="node.type === 'step'" class="node-fields mt-4">
      <v-text-field v-model="node.name" label="Interval name" />
      <v-select v-model="node.kind" label="Type" :items="kinds" />
      <div class="duration-grid">
        <v-text-field v-model.number="minutes" label="Minutes" type="number" min="0" />
        <v-text-field v-model.number="seconds" label="Seconds" type="number" min="0" max="59" />
      </div>
    </div>

    <template v-else>
      <div class="node-fields mt-4">
        <v-text-field v-model="node.name" label="Group name" />
        <v-text-field v-model.number="node.repeatCount" label="Repeat" type="number" min="1" />
      </div>
      <div class="group-actions mt-4">
        <v-btn size="small" variant="tonal" prepend-icon="mdi-timer-plus-outline" @click="actions.add(node.id, 'step')">Add interval</v-btn>
        <v-btn size="small" variant="tonal" prepend-icon="mdi-folder-plus-outline" @click="actions.add(node.id, 'group')">Add group</v-btn>
      </div>
      <div v-if="node.children.length" class="nested-nodes mt-4">
        <IntervalNodeEditor
          v-for="(child, childIndex) in node.children"
          :key="child.id"
          :node="child"
          :index="childIndex"
          :sibling-count="node.children.length"
          :depth="depth + 1"
          :can-indent="childIndex > 0 && node.children[childIndex - 1]?.type === 'group'"
          :can-outdent="true"
          :actions="actions"
        />
      </div>
      <p v-else class="empty-group muted mt-4">Add an interval or nested group.</p>
    </template>
  </v-card>
</template>

<style scoped>
.interval-node { border-color: rgb(var(--v-theme-on-surface) / .12); }
.interval-node--group { background: rgb(var(--v-theme-surface-variant) / .34); }
.interval-node__header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.node-index { display: grid; width: 30px; height: 30px; flex: 0 0 auto; place-items: center; border-radius: 10px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); font-size: .72rem; font-weight: 900; }
.node-fields, .nested-nodes { display: grid; gap: 1rem; }
.nested-nodes { padding-left: .75rem; border-left: 2px solid rgb(var(--v-theme-secondary) / .36); }
.duration-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
.group-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.empty-group { padding: 1rem; border: 1px dashed rgb(var(--v-theme-on-surface) / .18); border-radius: 14px; text-align: center; font-size: .75rem; }
</style>
