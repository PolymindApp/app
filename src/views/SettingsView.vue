<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import AppForm from '@/components/AppForm.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import type { LongPressDragResult } from '@/directives/longPressDrag'
import { api } from '@/lib/api'
import {
  DEFAULT_STEP_SOURCE,
  getHealthConnectStatus,
  isNativeHealthConnectSupported,
  normalizeStepSource,
  openHealthConnectSettings,
  requestHealthConnectPermission,
  type HealthConnectStatus,
} from '@/services/healthConnect'
import {
  normalizeHiddenMainMenuItems,
  orderedMainNavItems,
  readStoredHiddenMainMenuItems,
  readStoredMainMenuOrder,
  storeHiddenMainMenuItems,
  storeMainMenuOrder,
  type MainNavItem,
  type MainNavItemId,
} from '@/services/navigation'
import type { OpenAIConnectionStatus, StepSource } from '@/types/domain'

const stepSource = ref<StepSource>(DEFAULT_STEP_SOURCE)
const menuItems = ref<MainNavItem[]>(orderedMainNavItems(
  readStoredMainMenuOrder() ?? api.authStore.record?.settings?.mainMenuOrder,
))
const hiddenMenuItems = ref<MainNavItemId[]>(normalizeHiddenMainMenuItems(
  readStoredHiddenMainMenuItems() ?? api.authStore.record?.settings?.mainMenuHidden,
))
const loading = ref(true)
const connecting = ref(false)
const openAIConnecting = ref(false)
const openAIDisconnecting = ref(false)
const openAIConnectionDialog = ref(false)
const disconnectOpenAIDialog = ref(false)
const openAIForm = ref()
const openAIApiKey = ref('')
const openAIKeyVisible = ref(false)
const openAIStatus = ref<OpenAIConnectionStatus>({ connected: false })
const openAIError = ref('')
const menuSaving = ref(false)
const error = ref('')
const notice = ref(false)
const noticeMessage = ref('')
const healthStatus = ref<HealthConnectStatus>({
  availability: 'unavailable',
  authorized: false,
})
const isAndroidApp = isNativeHealthConnectSupported()
const stepSources = [
  { title: 'Health Connect', value: 'health_connect' },
]

const connectionTitle = computed(() => {
  if (!isAndroidApp) return 'Android app required'
  if (healthStatus.value.availability === 'update_required') return 'Health Connect needs an update'
  if (healthStatus.value.availability === 'unavailable') return 'Health Connect unavailable'
  return healthStatus.value.authorized ? 'Connected' : 'Permission required'
})

const connectionCopy = computed(() => {
  if (!isAndroidApp) return 'Open this page in the Polymind Android app to connect your step data.'
  if (healthStatus.value.availability === 'update_required') {
    return 'Install or update Health Connect before Polymind can read your steps.'
  }
  if (healthStatus.value.availability === 'unavailable') {
    return 'This device does not currently provide Health Connect.'
  }
  if (healthStatus.value.authorized) {
    return 'Polymind can read aggregated step totals. You can change this permission at any time.'
  }
  return 'Allow Polymind to read steps before using step-counter tasks.'
})

const connectionColor = computed(() => healthStatus.value.authorized ? 'success' : 'info')
const connectionIcon = computed(() => healthStatus.value.authorized
  ? 'mdi-check-circle-outline'
  : 'mdi-heart-pulse',
)
const visibleMenuItemCount = computed(() => menuItems.value.length - hiddenMenuItems.value.length)
const openAIConnectionCopy = computed(() => openAIStatus.value.connected
  ? `API key ending in ${openAIStatus.value.keyHint || '••••'} is ready for OpenAI commands.`
  : 'Connect an API key to let Polymind use OpenAI models. ChatGPT chats and subscriptions stay separate.',
)
const canConnectOpenAI = computed(() => (
  !openAIConnecting.value
  && /^sk-[A-Za-z0-9._-]{17,}$/.test(openAIApiKey.value.trim())
))

onMounted(async () => {
  try {
    const settings = await api.getUserSettings()
    menuItems.value = orderedMainNavItems(
      readStoredMainMenuOrder() ?? settings.mainMenuOrder,
    )
    hiddenMenuItems.value = normalizeHiddenMainMenuItems(
      readStoredHiddenMainMenuItems() ?? settings.mainMenuHidden,
    )
    stepSource.value = normalizeStepSource(settings.stepSource)
    if (settings.stepSource !== stepSource.value) {
      await api.updateUserSettings({ stepSource: stepSource.value })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Your settings could not be loaded.'
  }

  await Promise.all([refreshHealthStatus(), refreshOpenAIStatus()])
  loading.value = false
})

async function refreshHealthStatus() {
  try {
    healthStatus.value = await getHealthConnectStatus()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Health Connect status could not be checked.'
  }
}

async function connectHealthConnect() {
  connecting.value = true
  error.value = ''
  try {
    const result = await requestHealthConnectPermission()
    await refreshHealthStatus()
    if (result.authorized) {
      noticeMessage.value = 'Health Connect is ready for step-counter tasks.'
      notice.value = true
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Health Connect could not be connected.'
  } finally {
    connecting.value = false
  }
}

async function refreshOpenAIStatus() {
  try {
    openAIStatus.value = await api.getOpenAIConnection()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'OpenAI status could not be checked.'
  }
}

async function showOpenAIConnectionDialog() {
  openAIError.value = ''
  openAIApiKey.value = ''
  openAIKeyVisible.value = false
  openAIConnectionDialog.value = true
  await nextTick()
  openAIForm.value?.resetValidation()
}

function closeOpenAIConnectionDialog() {
  if (openAIConnecting.value) return
  openAIConnectionDialog.value = false
  openAIApiKey.value = ''
  openAIKeyVisible.value = false
}

async function connectOpenAI() {
  const validation = await openAIForm.value?.validate()
  if (!validation?.valid || !canConnectOpenAI.value) return
  openAIConnecting.value = true
  openAIError.value = ''
  try {
    openAIStatus.value = await api.connectOpenAI(openAIApiKey.value.trim())
    openAIConnectionDialog.value = false
    openAIApiKey.value = ''
    openAIKeyVisible.value = false
    noticeMessage.value = 'OpenAI API connected.'
    notice.value = true
  } catch (cause) {
    openAIError.value = cause instanceof Error ? cause.message : 'OpenAI could not be connected.'
  } finally {
    openAIConnecting.value = false
  }
}

async function disconnectOpenAI() {
  openAIDisconnecting.value = true
  error.value = ''
  try {
    openAIStatus.value = await api.disconnectOpenAI()
    disconnectOpenAIDialog.value = false
    noticeMessage.value = 'OpenAI API disconnected.'
    notice.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'OpenAI could not be disconnected.'
  } finally {
    openAIDisconnecting.value = false
  }
}

async function reorderMainMenu(result: LongPressDragResult) {
  const itemsById = new Map(menuItems.value.map(item => [item.id, item]))
  const reorderedItems = result.orderedIds
    .map(id => itemsById.get(id as MainNavItem['id']))
    .filter((item): item is MainNavItem => Boolean(item))

  if (reorderedItems.length !== menuItems.value.length) return

  menuItems.value = reorderedItems
  storeMainMenuOrder(reorderedItems.map(item => item.id))
  menuSaving.value = true
  error.value = ''
  try {
    const settings = await api.updateUserSettings({
      mainMenuOrder: reorderedItems.map(item => item.id),
    })
    menuItems.value = orderedMainNavItems(settings.mainMenuOrder)
    noticeMessage.value = 'Main menu order saved.'
    notice.value = true
  } catch {
    noticeMessage.value = 'Main menu order saved on this device.'
    notice.value = true
  } finally {
    menuSaving.value = false
  }
}

function mainMenuItemIsVisible(id: MainNavItemId) {
  return !hiddenMenuItems.value.includes(id)
}

function mainMenuItemStatus(id: MainNavItemId) {
  if (!mainMenuItemIsVisible(id)) return 'Hidden from the main menu'
  if (visibleMenuItemCount.value === 1) return 'Keep at least one item visible'
  return 'Shown in the main menu'
}

async function setMainMenuItemVisibility(id: MainNavItemId, visible: boolean) {
  if (menuSaving.value || (mainMenuItemIsVisible(id) && !visible && visibleMenuItemCount.value === 1)) return

  const hidden = new Set(hiddenMenuItems.value)
  if (visible) hidden.delete(id)
  else hidden.add(id)
  hiddenMenuItems.value = storeHiddenMainMenuItems([...hidden])
  menuSaving.value = true
  error.value = ''
  try {
    const settings = await api.updateUserSettings({
      mainMenuHidden: hiddenMenuItems.value,
    })
    hiddenMenuItems.value = storeHiddenMainMenuItems(settings.mainMenuHidden)
    noticeMessage.value = `${menuItems.value.find(item => item.id === id)?.title || 'Menu item'} ${visible ? 'shown' : 'hidden'}.`
    notice.value = true
  } catch {
    noticeMessage.value = 'Main menu visibility saved on this device.'
    notice.value = true
  } finally {
    menuSaving.value = false
  }
}
</script>

<template>
  <main class="app-page settings-page">
    <header class="settings-intro">
      <div class="settings-intro__icon">
        <v-icon icon="mdi-cog-outline" size="26" />
      </div>
      <div>
        <h1 class="text-h5 font-weight-black">Settings</h1>
        <p>Customize Polymind's navigation and connected data.</p>
      </div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-card class="surface-card pa-5 pa-sm-6">
      <div class="settings-section-heading">
        <div>
          <h2>Main menu</h2>
          <p>Press and hold to reorder items, or turn them off to hide them from the menu.</p>
        </div>
        <v-progress-circular
          v-if="menuSaving"
          color="secondary"
          indeterminate
          size="22"
          width="2"
        />
        <v-icon v-else icon="mdi-menu" />
      </div>

      <v-progress-linear
        v-if="loading"
        color="secondary"
        indeterminate
        rounded
        class="mt-5"
      />

      <div v-else class="menu-order-list">
        <div
          v-for="item in menuItems"
          :key="item.id"
          v-long-press-drag="{
            id: item.id,
            group: 'settings-main-menu',
            disabled: menuSaving || menuItems.length < 2,
            onDrop: reorderMainMenu,
          }"
          class="menu-order-item"
          :class="{ 'menu-order-item--hidden': !mainMenuItemIsVisible(item.id) }"
        >
          <v-icon icon="mdi-drag" size="22" class="menu-order-item__handle" />
          <span class="menu-order-item__icon">
            <v-icon :icon="item.icon" size="21" />
          </span>
          <span class="menu-order-item__copy">
            <strong>{{ item.title }}</strong>
            <small>{{ mainMenuItemStatus(item.id) }}</small>
          </span>
          <span
            class="menu-order-item__visibility"
            @pointerdown.stop
            @pointerup.stop
            @touchstart.stop
            @click.stop
          >
            <v-switch
              :model-value="mainMenuItemIsVisible(item.id)"
              color="secondary"
              inset
              hide-details="auto"
              :disabled="menuSaving || (mainMenuItemIsVisible(item.id) && visibleMenuItemCount === 1)"
              :aria-label="`${mainMenuItemIsVisible(item.id) ? 'Hide' : 'Show'} ${item.title} in the main menu`"
              @update:model-value="setMainMenuItemVisibility(item.id, $event === true)"
            />
          </span>
        </div>
      </div>
    </v-card>

    <v-card class="surface-card pa-5 pa-sm-6">
      <div class="settings-section-heading">
        <div>
          <h2>Steps</h2>
          <p>Used by step-counter tasks to update progress automatically.</p>
        </div>
        <v-icon icon="mdi-shoe-print" />
      </div>

      <v-progress-linear
        v-if="loading"
        color="secondary"
        indeterminate
        rounded
        class="mt-5"
      />

      <template v-else>
        <v-select
          v-model="stepSource"
          class="mt-5"
          label="Steps source"
          :items="stepSources"
          hide-details
        />

        <v-alert
          :type="connectionColor"
          variant="tonal"
          :icon="connectionIcon"
          class="mt-4"
        >
          <strong>{{ connectionTitle }}</strong>
          <p class="mt-1">{{ connectionCopy }}</p>
        </v-alert>

        <div v-if="isAndroidApp" class="settings-actions mt-4">
          <v-btn
            v-if="healthStatus.availability === 'available' && !healthStatus.authorized"
            color="secondary"
            prepend-icon="mdi-link-variant"
            :loading="connecting"
            @click="connectHealthConnect"
          >
            Connect Health Connect
          </v-btn>
          <v-btn
            v-else
            variant="outlined"
            prepend-icon="mdi-open-in-new"
            @click="openHealthConnectSettings"
          >
            Open Health Connect
          </v-btn>
        </div>
      </template>
    </v-card>

    <v-card class="surface-card pa-5 pa-sm-6">
      <div class="settings-section-heading">
        <div>
          <h2>OpenAI</h2>
          <p>Use OpenAI models for commands and assisted workflows in Polymind.</p>
        </div>
        <v-icon icon="mdi-creation-outline" />
      </div>

      <v-progress-linear
        v-if="loading"
        color="secondary"
        indeterminate
        rounded
        class="mt-5"
      />

      <template v-else>
        <v-alert
          :type="openAIStatus.connected ? 'success' : 'info'"
          variant="tonal"
          :icon="openAIStatus.connected ? 'mdi-check-circle-outline' : 'mdi-robot-outline'"
          class="mt-5"
        >
          <strong>{{ openAIStatus.connected ? 'OpenAI connected' : 'API key required' }}</strong>
          <p class="mt-1">{{ openAIConnectionCopy }}</p>
        </v-alert>

        <div class="settings-actions mt-4">
          <v-btn
            v-if="openAIStatus.connected"
            color="error"
            variant="outlined"
            prepend-icon="mdi-link-variant-off"
            @click="disconnectOpenAIDialog = true"
          >
            Disconnect OpenAI
          </v-btn>
          <v-btn
            v-else
            color="secondary"
            prepend-icon="mdi-link-variant"
            @click="showOpenAIConnectionDialog"
          >
            Connect OpenAI
          </v-btn>
        </div>
      </template>
    </v-card>

    <v-dialog
      :model-value="openAIConnectionDialog"
      max-width="32rem"
      persistent
      @update:model-value="!$event && closeOpenAIConnectionDialog()"
    >
      <v-card class="pa-5 pa-sm-6">
        <div class="settings-dialog-heading">
          <span class="settings-dialog-heading__icon">
            <v-icon icon="mdi-creation-outline" size="24" />
          </span>
          <div>
            <h2 class="text-h6 font-weight-black">Connect OpenAI</h2>
            <p>Use an OpenAI Platform API key. This does not connect your ChatGPT chats or subscription.</p>
          </div>
        </div>

        <v-alert v-if="openAIError" type="error" variant="tonal" density="compact" class="mt-5">
          {{ openAIError }}
        </v-alert>

        <AppForm ref="openAIForm" class="mt-5" @submit.prevent="connectOpenAI">
          <v-text-field
            v-model="openAIApiKey"
            :type="openAIKeyVisible ? 'text' : 'password'"
            prepend-inner-icon="mdi-key-outline"
            :append-inner-icon="openAIKeyVisible ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
            autocomplete="off"
            :disabled="openAIConnecting"
            :rules="[
              value => Boolean(value?.trim()) || 'API key is required',
              value => /^sk-[A-Za-z0-9._-]{17,}$/.test(value?.trim() || '') || 'Enter a valid OpenAI API key',
            ]"
            @click:append-inner="openAIKeyVisible = !openAIKeyVisible"
          >
            <template #label>API key <span class="required-mark">*</span></template>
          </v-text-field>

          <v-btn
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            variant="text"
            append-icon="mdi-open-in-new"
            class="mt-2"
          >
            Create an API key
          </v-btn>
        </AppForm>

        <v-card-actions class="settings-dialog-actions pa-0 mt-6 ga-2">
          <v-spacer />
          <v-btn variant="text" :disabled="openAIConnecting" @click="closeOpenAIConnectionDialog">
            Cancel
          </v-btn>
          <v-btn
            color="secondary"
            :loading="openAIConnecting"
            :disabled="!canConnectOpenAI"
            @click="connectOpenAI"
          >
            Connect
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <ConfirmDialog
      v-model="disconnectOpenAIDialog"
      title="Disconnect OpenAI?"
      message="Polymind will permanently remove the stored API key. OpenAI commands will stop working until another key is connected."
      confirm-text="Disconnect"
      icon="mdi-link-variant-off"
      :loading="openAIDisconnecting"
      @confirm="disconnectOpenAI"
    />

    <v-snackbar v-model="notice" color="success" location="bottom" :timeout="4000">
      {{ noticeMessage }}
    </v-snackbar>
  </main>
</template>

<style scoped>
.settings-page {
  display: grid;
  gap: 1rem;
}

.settings-intro {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: .5rem .25rem .75rem;
}

.settings-intro__icon {
  display: grid;
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid rgb(var(--v-theme-secondary) / .24);
  border-radius: 17px;
  background: rgb(var(--v-theme-secondary) / .1);
  color: rgb(var(--v-theme-secondary));
}

.settings-intro p,
.settings-section-heading p,
.v-alert p {
  margin-top: .2rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .78rem;
  line-height: 1.45;
}

.settings-section-heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 1rem;
}

.settings-section-heading h2 {
  font-size: 1rem;
  font-weight: 900;
}

.settings-section-heading > .v-icon {
  color: rgb(var(--v-theme-secondary));
}

.menu-order-list {
  display: grid;
  gap: .65rem;
  margin-top: 1.25rem;
}

.menu-order-item {
  display: grid;
  grid-template-columns: 2rem 2.75rem minmax(0, 1fr) auto;
  align-items: center;
  min-height: 3.75rem;
  gap: .75rem;
  padding: .5rem .75rem;
  border: 1px solid rgb(var(--v-theme-on-surface) / .1);
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-variant) / .28);
  cursor: grab;
  user-select: none;
}

.menu-order-item__copy {
  display: grid;
  min-width: 0;
  gap: .15rem;
}

.menu-order-item__copy small {
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface) / .52);
  font-size: .68rem;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-order-item__visibility {
  display: grid;
  min-width: 3.5rem;
  place-items: center end;
}

.menu-order-item__visibility :deep(.v-switch) {
  flex: 0 0 auto;
}

.menu-order-item__handle {
  color: rgb(var(--v-theme-on-surface) / .52);
}

.menu-order-item__icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border-radius: 14px;
  background: rgb(var(--v-theme-secondary) / .12);
  color: rgb(var(--v-theme-secondary));
}

.menu-order-item--hidden .menu-order-item__icon {
  background: rgb(var(--v-theme-on-surface) / .08);
  color: rgb(var(--v-theme-on-surface) / .46);
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
}

.settings-dialog-heading {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}

.settings-dialog-heading p {
  margin-top: .2rem;
  color: rgb(var(--v-theme-on-surface) / .56);
  font-size: .78rem;
  line-height: 1.45;
}

.settings-dialog-heading__icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 1rem;
  background: rgb(var(--v-theme-secondary) / .12);
  color: rgb(var(--v-theme-secondary));
}

.required-mark {
  color: rgb(var(--v-theme-error));
}

@media (max-width: 440px) {
  .settings-actions .v-btn {
    width: 100%;
  }

  .settings-dialog-actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .settings-dialog-actions .v-spacer {
    display: none;
  }

  .settings-dialog-actions .v-btn {
    width: 100%;
  }
}

@media (max-width: 27.5rem) {
  .menu-order-item {
    grid-template-columns: 1.25rem 2.5rem minmax(0, 1fr) auto;
    gap: .5rem;
    padding-inline: .5rem;
  }

  .menu-order-item__icon {
    width: 2.5rem;
    height: 2.5rem;
  }

  .menu-order-item__visibility {
    min-width: 3.25rem;
  }
}
</style>
