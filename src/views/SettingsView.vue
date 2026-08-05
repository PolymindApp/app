<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
  orderedMainNavItems,
  readStoredMainMenuOrder,
  storeMainMenuOrder,
  type MainNavItem,
} from '@/services/navigation'
import type { StepSource } from '@/types/domain'

const stepSource = ref<StepSource>(DEFAULT_STEP_SOURCE)
const menuItems = ref<MainNavItem[]>(orderedMainNavItems(
  readStoredMainMenuOrder() ?? api.authStore.record?.settings?.mainMenuOrder,
))
const loading = ref(true)
const connecting = ref(false)
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
  if (!isAndroidApp) return 'Open this page in the Mom Android app to connect your step data.'
  if (healthStatus.value.availability === 'update_required') {
    return 'Install or update Health Connect before Mom can read your steps.'
  }
  if (healthStatus.value.availability === 'unavailable') {
    return 'This device does not currently provide Health Connect.'
  }
  if (healthStatus.value.authorized) {
    return 'Mom can read aggregated step totals. You can change this permission at any time.'
  }
  return 'Allow Mom to read steps before using step-counter tasks.'
})

const connectionColor = computed(() => healthStatus.value.authorized ? 'success' : 'info')
const connectionIcon = computed(() => healthStatus.value.authorized
  ? 'mdi-check-circle-outline'
  : 'mdi-heart-pulse',
)

onMounted(async () => {
  try {
    const settings = await api.getUserSettings()
    menuItems.value = orderedMainNavItems(
      readStoredMainMenuOrder() ?? settings.mainMenuOrder,
    )
    stepSource.value = normalizeStepSource(settings.stepSource)
    if (settings.stepSource !== stepSource.value) {
      await api.updateUserSettings({ stepSource: stepSource.value })
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Your settings could not be loaded.'
  }

  await refreshHealthStatus()
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
</script>

<template>
  <main class="app-page settings-page">
    <header class="settings-intro">
      <div class="settings-intro__icon">
        <v-icon icon="mdi-cog-outline" size="26" />
      </div>
      <div>
        <h1 class="text-h5 font-weight-black">Settings</h1>
        <p>Customize Mom's navigation and connected data.</p>
      </div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable @click:close="error = ''">
      {{ error }}
    </v-alert>

    <v-card class="surface-card pa-5 pa-sm-6">
      <div class="settings-section-heading">
        <div>
          <h2>Main menu</h2>
          <p>Press and hold an item, then drag it to choose where it appears.</p>
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
        >
          <v-icon icon="mdi-drag" size="22" class="menu-order-item__handle" />
          <span class="menu-order-item__icon">
            <v-icon :icon="item.icon" size="21" />
          </span>
          <strong>{{ item.title }}</strong>
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

    <v-snackbar v-model="notice" color="success" location="bottom" :timeout="4000">
      {{ noticeMessage }}
    </v-snackbar>
  </main>
</template>

<style scoped>
.settings-page {
  display: grid;
  max-width: 720px;
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
  grid-template-columns: 2rem 2.75rem minmax(0, 1fr);
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

.settings-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 440px) {
  .settings-actions .v-btn {
    width: 100%;
  }
}
</style>
