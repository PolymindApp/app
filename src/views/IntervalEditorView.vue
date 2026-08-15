<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ActionBottomSheet from '@/components/ActionBottomSheet.vue'
import AppForm from '@/components/AppForm.vue'
import ColorSwatchPicker from '@/components/ColorSwatchPicker.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FormActionBar from '@/components/FormActionBar.vue'
import IntervalNodeEditor from '@/components/IntervalNodeEditor.vue'
import LabeledSlider from '@/components/LabeledSlider.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import {
  cloneIntervalTemplateDraft,
  createIntervalGroup,
  createIntervalStep,
  duplicateIntervalNode,
  duplicateIntervalTemplateDraft,
  formatIntervalDuration,
  intervalDuration,
  intervalGlobalRepetitionSettings,
  intervalStepCount,
  MAX_GLOBAL_REPETITIONS,
  MIN_GLOBAL_REPETITIONS,
  moveIntervalNodeToGroup,
  validateIntervalDefinition,
} from '@/services/intervals'
import { reviewSortTitle } from '@/services/flashcards'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalGroupNode, IntervalNode, IntervalTemplateDraft } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const store = useIntervalStore()
const flashcardStore = useFlashcardStore()
const form = ref()
const saving = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const pendingNodeDelete = ref<{ id: string; name: string; type: IntervalNode['type'] }>()
const selectedNodeId = ref<string>()
const expandedNodeId = ref<string>()
const nodeActionsDrawer = ref(false)
const error = ref('')
const isEditing = computed(() => Boolean(route.params.id))
const sequenceDropTypes = ['interval-step', 'interval-group']

const draft = reactive<IntervalTemplateDraft>({
  name: '',
  description: '',
  color: '#C7F464',
  flashcardReviewSet: undefined,
  definition: {
    version: 1,
    children: [],
    globalRepetition: { enabled: false, defaultCount: MIN_GLOBAL_REPETITIONS },
  },
  cues: { soundEnabled: true, vibrationEnabled: true },
  sortOrder: 0,
})

const totalDuration = computed(() => intervalDuration(draft.definition))
const totalSteps = computed(() => intervalStepCount(draft.definition))
const reviewSetItems = computed(() => flashcardStore.reviewSets.map(reviewSet => {
  const cardCount = reviewSet.matchingCardCount
  return {
    title: reviewSet.name,
    value: reviewSet.id,
    subtitle: `${reviewSet.mode === 'passive' ? 'Passive' : 'Manual'} · ${cardCount} ${cardCount === 1 ? 'card' : 'cards'}`,
    props: { disabled: cardCount === 0 },
  }
}))
const selectedReviewSet = computed(() => flashcardStore.reviewSets.find(
  reviewSet => reviewSet.id === draft.flashcardReviewSet,
))
const selectedReviewCardCount = computed(() => selectedReviewSet.value
  ? selectedReviewSet.value.matchingCardCount
  : 0)
const selectedReviewTiming = computed(() => {
  const reviewSet = selectedReviewSet.value
  if (!reviewSet || reviewSet.mode !== 'passive') return '5s front · 5s back'
  return `${reviewSet.frontSeconds}s front · ${reviewSet.backSeconds}s back`
})
const globalRepetitionEnabled = computed({
  get: () => intervalGlobalRepetitionSettings(draft.definition).enabled,
  set: (enabled: boolean) => {
    draft.definition.globalRepetition = {
      ...intervalGlobalRepetitionSettings(draft.definition),
      enabled,
    }
  },
})
const globalRepetitionDefault = computed({
  get: () => intervalGlobalRepetitionSettings(draft.definition).defaultCount,
  set: (defaultCount: number) => {
    draft.definition.globalRepetition = {
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

const selectedNodeLocation = computed(() =>
  selectedNodeId.value
    ? findNode(draft.definition.children, selectedNodeId.value)
    : undefined,
)
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
  return type === 'step'
    ? createIntervalStep()
    : createIntervalGroup('')
}

function firstIntervalId(nodes: IntervalNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === 'step') return node.id
    const nested = firstIntervalId(node.children)
    if (nested) return nested
  }
  return undefined
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
  if (node.type === 'step') expandedNodeId.value = node.id
  void scrollToNode(node.id)
}

const actions = {
  add(parentId: string, type: 'step' | 'group') {
    const location = findNode(draft.definition.children, parentId)
    const parent = location?.nodes[location.index]
    if (!parent || parent.type !== 'group') return
    const node = createNode(type)
    parent.children.push(node)
    if (node.type === 'step') expandedNodeId.value = node.id
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
    if (!location || !node) return
    const duplicate = duplicateIntervalNode(node)
    location.nodes.splice(location.index + 1, 0, duplicate)
    if (duplicate.type === 'step') expandedNodeId.value = duplicate.id
    void scrollToNode(duplicate.id)
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
  open(id: string) {
    selectedNodeId.value = id
    nodeActionsDrawer.value = true
  },
  toggle(id: string) {
    const location = findNode(draft.definition.children, id)
    const node = location?.nodes[location.index]
    if (!node || node.type !== 'step') return
    expandedNodeId.value = expandedNodeId.value === id ? undefined : id
  },
  reorder(result: LongPressDragResult) {
    const targetGroupId = result.toDropZoneId === 'root'
      ? undefined
      : result.toDropZoneId
    moveIntervalNodeToGroup(
      draft.definition,
      result.id,
      targetGroupId,
      result.orderedIds,
    )
  },
}

function closeNodeActions() {
  nodeActionsDrawer.value = false
}

function moveSelectedNode(direction: -1 | 1) {
  if (!selectedNodeId.value) return
  closeNodeActions()
  actions.move(selectedNodeId.value, direction)
}

function runSelectedNodeAction(action: 'indent' | 'outdent' | 'duplicate' | 'remove') {
  if (!selectedNodeId.value) return
  closeNodeActions()
  actions[action](selectedNodeId.value)
}

function confirmNodeDelete() {
  if (!pendingNodeDelete.value) return
  const location = findNode(draft.definition.children, pendingNodeDelete.value.id)
  if (location) {
    const node = location.nodes[location.index]
    location.nodes.splice(location.index, 1)
    if (
      node
      && expandedNodeId.value
      && (node.id === expandedNodeId.value
        || (node.type === 'group' && Boolean(findNode(node.children, expandedNodeId.value))))
    ) {
      expandedNodeId.value = undefined
    }
  }
  pendingNodeDelete.value = undefined
}

onMounted(async () => {
  await Promise.all([
    store.loaded ? Promise.resolve() : store.load(),
    flashcardStore.loaded ? Promise.resolve() : flashcardStore.load(),
  ])
  const duplicateTemplateId = typeof route.query.duplicate === 'string'
    ? route.query.duplicate
    : ''
  if (!route.params.id && !duplicateTemplateId) {
    draft.sortOrder = store.templates.length
    return
  }
  const templateId = typeof route.params.id === 'string'
    ? route.params.id
    : duplicateTemplateId
  const template = store.templates.find((item) => item.id === templateId)
  if (!template) {
    error.value = 'That interval template could not be found.'
    return
  }
  Object.assign(
    draft,
    duplicateTemplateId
      ? duplicateIntervalTemplateDraft(template, store.templates.length)
      : cloneIntervalTemplateDraft(template),
  )
  expandedNodeId.value = firstIntervalId(draft.definition.children)
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
    await router.replace('/intervals')
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
    await router.replace('/intervals')
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

    <AppForm ref="form" validate-on="lazy" @submit.prevent="save">
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
        <div class="review-attachment-heading mb-4">
          <span class="review-attachment-heading__icon">
            <v-icon icon="mdi-cards-outline" size="24" />
          </span>
          <div class="min-width-0">
            <h2 class="text-body-1 font-weight-black">Review cards</h2>
            <p class="text-caption muted mt-1">Optionally cycle through a Review set throughout this interval.</p>
          </div>
        </div>

        <template v-if="flashcardStore.reviewSets.length">
          <v-select
            v-model="draft.flashcardReviewSet"
            :items="reviewSetItems"
            item-title="title"
            item-value="value"
            label="Review set (optional)"
            prepend-inner-icon="mdi-cards-playing-outline"
            clearable
            autocomplete="off"
            :rules="[
              value => !value || selectedReviewCardCount > 0 || 'Choose a Review set with at least one matching card',
            ]"
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item
                v-bind="itemProps"
                prepend-icon="mdi-cards-outline"
                :title="item.raw.title"
                :subtitle="item.raw.subtitle"
              />
            </template>
          </v-select>

          <v-expand-transition>
            <div v-if="selectedReviewSet" class="review-attachment-summary mt-4">
              <div class="review-attachment-summary__chips">
                <v-chip size="small" variant="tonal" prepend-icon="mdi-infinity">Repeating passive</v-chip>
                <v-chip size="small" variant="tonal" prepend-icon="mdi-cards-outline">
                  {{ selectedReviewCardCount }} {{ selectedReviewCardCount === 1 ? 'card' : 'cards' }}
                </v-chip>
                <v-chip size="small" variant="tonal" prepend-icon="mdi-timer-outline">{{ selectedReviewTiming }}</v-chip>
                <v-chip
                  v-if="selectedReviewSet.speechEnabled"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-account-voice"
                >
                  Read aloud
                </v-chip>
              </div>
              <p class="text-caption muted mt-3">
                {{ reviewSortTitle(selectedReviewSet.sortMode) }} order.
                {{ selectedReviewSet.mode === 'manual'
                  ? 'This Manual set will use 5 seconds for the front and 5 seconds for the back.'
                  : 'Its Passive timing will be used.' }}
              </p>
            </div>
          </v-expand-transition>
        </template>

        <div v-else class="review-attachment-empty">
          <p class="text-body-2 muted">Create a Review set before attaching cards to an interval.</p>
          <v-btn variant="tonal" color="secondary" prepend-icon="mdi-plus" :to="{ name: 'flashcard-review-set-new' }">
            Create Review set
          </v-btn>
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
        <v-divider class="my-3" />
        <div class="setting-row">
          <div><strong>Flexible repeats</strong><p>Choose how many times to repeat the sequence whenever you start the timer</p></div>
          <v-switch v-model="globalRepetitionEnabled" color="secondary" hide-details inset aria-label="Enable flexible repeats" />
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
        <div v-if="draft.definition.children.length" class="d-flex ga-2">
          <v-btn size="small" variant="tonal" icon="mdi-timer-plus-outline" aria-label="Add interval" @click="addRootNode('step')" />
          <v-btn size="small" variant="tonal" icon="mdi-folder-plus-outline" aria-label="Add group" @click="addRootNode('group')" />
        </div>
      </div>
      <div
        v-long-press-drop="{ id: 'root', accepts: sequenceDropTypes }"
        class="sequence-tree"
      >
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
            :depth="0"
            :can-indent="index > 0 && draft.definition.children[index - 1]?.type === 'group'"
            :can-outdent="false"
            :can-skip-on-last-round="index === draft.definition.children.length - 1 && node.type === 'step'"
            :review-set-speech-enabled="selectedReviewSet?.speechEnabled === true"
            :expanded-node-id="expandedNodeId"
            :actions="actions"
          />
        </template>
      </div>
    </AppForm>

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

    <FormActionBar
      :primary-text="isEditing ? 'Save' : 'Create'"
      :loading="saving"
      :show-delete="isEditing"
      delete-label="Delete interval"
      :delete-disabled="deleting"
      @submit="save"
      @cancel="router.back()"
      @delete="deleteDialog = true"
    />

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
.interval-editor { padding-bottom: 6rem; }
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
.global-repetition-default { border-top: 1px solid rgb(var(--v-theme-on-surface) / .08); }
.review-attachment-heading { display: flex; align-items: center; gap: .75rem; }
.review-attachment-heading__icon { display: grid; width: 2.75rem; height: 2.75rem; flex: 0 0 auto; place-items: center; border-radius: .875rem; background: rgb(var(--v-theme-secondary) / .14); color: rgb(var(--v-theme-secondary)); }
.review-attachment-summary { padding: .875rem; border: 1px solid rgb(var(--v-theme-on-surface) / .08); border-radius: 1rem; background: rgb(var(--v-theme-surface-variant) / .32); }
.review-attachment-summary__chips { display: flex; flex-wrap: wrap; gap: .4rem; }
.review-attachment-empty { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
@media (max-width: 32rem) { .review-attachment-empty { align-items: stretch; flex-direction: column; } }
</style>
