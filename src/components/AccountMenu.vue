<script setup lang="ts">
import { Capacitor } from '@capacitor/core'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import AppVersionLabel from '@/components/AppVersionLabel.vue'
import { getAccountMenuPosition } from '@/services/accountMenuPosition'

const props = defineProps<{
  accountName: string
  accountEmail?: string
  accountInitials: string
  accountAvatar?: string
}>()

const emit = defineEmits<{
  openAccount: []
  openSettings: []
  signOut: []
}>()

const allowAutomaticFocus = Capacitor.getPlatform() !== 'android'
const menuId = `account-menu-${useId()}`
const activator = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const menuStyle = ref<Record<string, string>>({ visibility: 'hidden' })
const avatarFailed = ref(false)
const showAvatar = computed(() => Boolean(props.accountAvatar) && !avatarFailed.value)
let listenersBound = false

watch(() => props.accountAvatar, () => {
  avatarFailed.value = false
})

async function openMenu() {
  if (menuOpen.value) return

  menuStyle.value = { visibility: 'hidden' }
  menuOpen.value = true
  bindListeners()
  await nextTick()
  if (!menuOpen.value) return

  positionMenu()
  if (allowAutomaticFocus) {
    requestAnimationFrame(() => {
      if (menuOpen.value) menu.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
  }
}

function closeMenu(restoreFocus = false) {
  if (!menuOpen.value) return
  menuOpen.value = false
  unbindListeners()
  if (restoreFocus && allowAutomaticFocus) activator.value?.querySelector<HTMLElement>('button')?.focus()
}

function toggleMenu() {
  if (menuOpen.value) closeMenu()
  else void openMenu()
}

function requestSignOut() {
  closeMenu()
  emit('signOut')
}

function requestOpenAccount() {
  closeMenu()
  emit('openAccount')
}

function requestOpenSettings() {
  closeMenu()
  emit('openSettings')
}

function positionMenu() {
  if (!menuOpen.value || !activator.value || !menu.value) return

  const activatorRect = activator.value.getBoundingClientRect()
  const menuRect = menu.value.getBoundingClientRect()
  const position = getAccountMenuPosition(
    activatorRect,
    menuRect,
    { width: window.innerWidth, height: window.innerHeight },
  )

  menuStyle.value = {
    left: `${position.left}px`,
    top: `${position.top}px`,
    visibility: 'visible',
  }
}

function onPointerDown(event: PointerEvent) {
  const path = event.composedPath()
  if (path.includes(activator.value as EventTarget) || path.includes(menu.value as EventTarget)) return
  closeMenu()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  } else if (event.key === 'Tab') {
    window.setTimeout(() => {
      const focused = document.activeElement
      if (!menu.value?.contains(focused) && !activator.value?.contains(focused)) closeMenu()
    })
  }
}

function bindListeners() {
  if (listenersBound) return
  listenersBound = true
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', positionMenu)
  window.addEventListener('scroll', positionMenu, true)
}

function unbindListeners() {
  if (!listenersBound) return
  listenersBound = false
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', positionMenu)
  window.removeEventListener('scroll', positionMenu, true)
}

onBeforeUnmount(unbindListeners)
</script>

<template>
  <div ref="activator" class="account-menu-activator">
    <v-btn
      icon
      variant="text"
      class="app-bar__account"
      :aria-label="`Open account menu for ${accountName}`"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :aria-controls="menuOpen ? menuId : undefined"
      @click="toggleMenu"
      @keydown.down.prevent="openMenu"
    >
      <v-avatar color="secondary" size="36">
        <v-img v-if="showAvatar" :src="accountAvatar" alt="" cover @error="avatarFailed = true" />
        <span v-else>{{ accountInitials }}</span>
      </v-avatar>
    </v-btn>
  </div>

  <Teleport to="body">
    <Transition name="account-menu-slide-y">
      <div
        v-if="menuOpen"
        ref="menu"
        class="account-menu-popover"
        :style="menuStyle"
      >
        <v-card
          :id="menuId"
          class="account-menu"
          min-width="240"
          role="menu"
        >
          <button
            type="button"
            class="account-menu__identity pa-4"
            role="menuitem"
            @click="requestOpenAccount"
          >
            <v-avatar color="secondary" size="40">
              <v-img v-if="showAvatar" :src="accountAvatar" alt="" cover @error="avatarFailed = true" />
              <span v-else>{{ accountInitials }}</span>
            </v-avatar>
            <div class="min-width-0">
              <strong class="d-block text-truncate">{{ accountName }}</strong>
              <span v-if="accountEmail" class="d-block text-caption muted text-truncate">{{ accountEmail }}</span>
              <AppVersionLabel class="account-menu__version" />
            </div>
            <v-icon icon="mdi-chevron-right" size="20" />
          </button>
          <v-divider />
          <v-list role="presentation" density="compact" class="pa-2">
            <v-list-item
              role="menuitem"
              title="Settings"
              prepend-icon="mdi-cog-outline"
              rounded="lg"
              @click="requestOpenSettings"
            />
            <v-divider class="my-2" />
            <v-list-item
              role="menuitem"
              title="Sign out"
              prepend-icon="mdi-logout"
              rounded="lg"
              @click="requestSignOut"
            />
          </v-list>
        </v-card>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.account-menu-activator,
.app-bar__account {
  width: 44px;
  height: 44px;
}

.app-bar__account :deep(.v-avatar) {
  border: 1px solid rgb(var(--v-theme-on-secondary) / .18);
  color: rgb(var(--v-theme-on-secondary));
  font-size: .75rem;
  font-weight: 900;
}

.account-menu-popover {
  position: fixed;
  z-index: 2500;
  width: 240px;
  max-width: calc(100vw - 24px);
}

.account-menu {
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-on-surface) / .1);
}

.account-menu__version {
  margin-top: .15rem;
  text-align: left;
}

.account-menu__identity {
  display: flex;
  width: 100%;
  border: 0;
  align-items: center;
  gap: .75rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background-color 160ms ease;
}

.account-menu__identity:hover,
.account-menu__identity:focus-visible {
  background: rgb(var(--v-theme-on-surface) / .06);
  outline: none;
}

.account-menu__identity > div {
  flex: 1 1 auto;
}

.account-menu__identity > .v-avatar {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-on-secondary));
  font-size: .75rem;
  font-weight: 900;
}

.account-menu-slide-y-enter-active,
.account-menu-slide-y-leave-active {
  transition:
    opacity 180ms cubic-bezier(.4, 0, .2, 1),
    transform 180ms cubic-bezier(.4, 0, .2, 1);
}

.account-menu-slide-y-enter-from,
.account-menu-slide-y-leave-to {
  opacity: 0;
  transform: translateY(-15px);
}

@media (prefers-reduced-motion: reduce) {
  .account-menu-slide-y-enter-active,
  .account-menu-slide-y-leave-active {
    transition: none !important;
  }

  .account-menu-slide-y-enter-from,
  .account-menu-slide-y-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
