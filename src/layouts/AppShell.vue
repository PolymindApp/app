<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import AccountMenu from '@/components/AccountMenu.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import MainNavigationIcon from '@/components/MainNavigationIcon.vue'
import {
  bottomNavigationFontSize,
  mainMenuTransitionDirection,
  MAIN_MENU_ORDER_CHANGED_EVENT,
  MAIN_MENU_VISIBILITY_CHANGED_EVENT,
  readStoredHiddenMainMenuItems,
  readStoredMainMenuOrder,
  visibleMainNavItems,
} from '@/services/navigation'
import {
  formatRunningSessionTitle,
  RUNNING_SESSION_TITLE_INTERVAL_MS,
} from '@/services/runningSessionTitle'
import { useAuthStore } from '@/stores/auth'
import { useFlashcardStore } from '@/stores/flashcards'
import { useIntervalStore } from '@/stores/intervals'
import { useSnackbarStore } from '@/stores/snackbar'

const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const flashcardStore = useFlashcardStore()
const intervalStore = useIntervalStore()
const snackbar = useSnackbarStore()
const logoutDialog = ref(false)
const pageTransition = ref('page-level-forward')
const isIos = Capacitor.getPlatform() === 'ios'
const isBrowser = Capacitor.getPlatform() === 'web'
const storedMenuOrder = ref(readStoredMainMenuOrder())
const storedHiddenMenuItems = ref(readStoredHiddenMainMenuItems())
const reducedMotion = ref(
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
)
const documentTitle = typeof document === 'undefined'
  ? 'Polymind — Many systems. One mind.'
  : document.title
let documentTitleFrame = 0
let documentTitleTimer: number | undefined

const items = computed(() => visibleMainNavItems(
  storedMenuOrder.value ?? auth.user?.settings?.mainMenuOrder,
  storedHiddenMenuItems.value ?? auth.user?.settings?.mainMenuHidden,
))
const intervalIsRunning = computed(() => intervalStore.activeSession?.status === 'running')
const flashcardIsRunning = computed(() => flashcardStore.activeSession?.status === 'running')
const intervalSessionIsActive = computed(() => Boolean(intervalStore.activeSession))
const flashcardSessionIsActive = computed(() => Boolean(flashcardStore.activeSession))
const sessionIsRunning = computed(() => intervalIsRunning.value || flashcardIsRunning.value)

const immersive = computed(() => Boolean(router.currentRoute.value.meta.immersive))
const pageTitle = computed(() => String(router.currentRoute.value.meta.title || 'Polymind'))
const canGoBack = computed(() => Number(router.currentRoute.value.meta.pageDepth ?? 0) > 0)
const accountName = computed(() => auth.user?.name || auth.firstName || 'You')
const accountEmail = computed(() => auth.user?.email || '')
const accountAvatar = computed(() => auth.user?.avatar || '')
const accountInitials = computed(() => {
  const source = auth.user?.name || auth.user?.email || 'A'
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'A'
})
const current = computed({
  get: () => {
    const path = router.currentRoute.value.path
    if (path.startsWith('/intervals')) return '/intervals'
    if (path.startsWith('/flashcards')) return '/flashcards'
    if (path.startsWith('/tracking')) return '/tracking'
    if (path.startsWith('/journal')) return '/journal'
    if (path.startsWith('/tasks')) return '/tasks'
    return path
  },
  set: (path: string) => router.push(path),
})

function menuItemHasActiveSession(itemId: string) {
  if (itemId === 'intervals') return intervalSessionIsActive.value
  if (itemId === 'flashcards') return flashcardSessionIsActive.value
  return false
}

function menuItemLabel(item: { id: string; title: string }) {
  if (item.id === 'intervals' && intervalStore.activeSession) {
    return `${item.title}, session ${intervalStore.activeSession.status}`
  }
  if (item.id === 'flashcards' && flashcardStore.activeSession) {
    return `${item.title}, review ${flashcardStore.activeSession.status}`
  }
  return item.title
}

function stopDocumentTitleAnimation(restoreTitle = true) {
  if (documentTitleTimer !== undefined) {
    window.clearInterval(documentTitleTimer)
    documentTitleTimer = undefined
  }
  if (restoreTitle && typeof document !== 'undefined') document.title = documentTitle
}

function renderDocumentTitleFrame() {
  if (typeof document === 'undefined') return
  document.title = formatRunningSessionTitle(
    documentTitle,
    documentTitleFrame,
    reducedMotion.value,
  )
  documentTitleFrame += 1
}

function syncDocumentTitle() {
  if (!isBrowser || typeof window === 'undefined') return
  stopDocumentTitleAnimation()
  if (!sessionIsRunning.value) return
  documentTitleFrame = 0
  renderDocumentTitleFrame()
  if (!reducedMotion.value) {
    documentTitleTimer = window.setInterval(
      renderDocumentTitleFrame,
      RUNNING_SESSION_TITLE_INTERVAL_MS,
    )
  }
}

watch([sessionIsRunning, reducedMotion], syncDocumentTitle, { immediate: true })

const removeTransitionGuard = router.beforeEach((to, from) => {
  const menuDirection = mainMenuTransitionDirection(items.value, from.path, to.path)
  if (menuDirection) {
    pageTransition.value = menuDirection === 'forward'
      ? 'page-level-forward'
      : 'page-level-back'
    return
  }

  const toDepth = Number(to.meta.pageDepth ?? 0)
  const fromDepth = Number(from.meta.pageDepth ?? 0)

  if (toDepth > fromDepth) {
    pageTransition.value = 'page-depth-deeper'
  } else if (toDepth < fromDepth) {
    pageTransition.value = 'page-depth-higher'
  } else {
    const toOrder = Number(to.meta.pageOrder ?? 0)
    const fromOrder = Number(from.meta.pageOrder ?? 0)
    pageTransition.value = toOrder >= fromOrder ? 'page-level-forward' : 'page-level-back'
  }
})

function refreshStoredMenuSettings() {
  storedMenuOrder.value = readStoredMainMenuOrder()
  storedHiddenMenuItems.value = readStoredHiddenMainMenuItems()
}

onMounted(() => {
  window.addEventListener(MAIN_MENU_ORDER_CHANGED_EVENT, refreshStoredMenuSettings)
  window.addEventListener(MAIN_MENU_VISIBILITY_CHANGED_EVENT, refreshStoredMenuSettings)
  window.addEventListener('storage', refreshStoredMenuSettings)
  void Promise.allSettled([
    !intervalStore.loading ? intervalStore.load() : Promise.resolve(),
    !flashcardStore.loading ? flashcardStore.load() : Promise.resolve(),
  ])
})

onBeforeUnmount(() => {
  stopDocumentTitleAnimation()
  removeTransitionGuard()
  window.removeEventListener(MAIN_MENU_ORDER_CHANGED_EVENT, refreshStoredMenuSettings)
  window.removeEventListener(MAIN_MENU_VISIBILITY_CHANGED_EVENT, refreshStoredMenuSettings)
  window.removeEventListener('storage', refreshStoredMenuSettings)
})

function logout() {
  logoutDialog.value = false
  auth.logout()
  router.replace('/auth')
}

function pinLeavingPage(element: Element) {
  if (!(element instanceof HTMLElement) || getComputedStyle(element).position === 'fixed') return
  const bounds = element.getBoundingClientRect()
  element.style.setProperty('--page-leave-top', `${bounds.top}px`)
  element.style.setProperty('--page-leave-left', `${bounds.left}px`)
  element.style.setProperty('--page-leave-width', `${bounds.width}px`)
  element.classList.add('page-route-leaving-pinned')
}

function releaseLeavingPage(element: Element) {
  if (!(element instanceof HTMLElement)) return
  element.classList.remove('page-route-leaving-pinned')
  element.style.removeProperty('--page-leave-top')
  element.style.removeProperty('--page-leave-left')
  element.style.removeProperty('--page-leave-width')
}

</script>

<template>
  <v-app theme="forgeDark">
    <v-navigation-drawer v-if="mdAndUp && !immersive" permanent width="224" color="background">
      <div class="pa-6 pt-8">
        <div class="brand-mark mb-3">
          <img src="/brand/polymind-wordmark.png" alt="Polymind" />
        </div>
        <p class="text-caption text-medium-emphasis mt-2">Many systems. One mind.</p>
      </div>

      <v-list nav class="px-3 mt-6">
        <v-list-item
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          :title="item.title"
          :aria-label="menuItemLabel(item)"
          :active="current === item.to"
          rounded="xl"
          class="mb-2"
          color="secondary"
        >
          <template #prepend>
            <MainNavigationIcon
              :icon="item.icon"
              :running="menuItemHasActiveSession(item.id)"
              badge-surface="background"
            />
          </template>
        </v-list-item>
      </v-list>

      <template #append>
        <div class="pa-4">
          <v-btn block variant="text" prepend-icon="mdi-logout" @click="logoutDialog = true">Sign out</v-btn>
        </div>
      </template>
    </v-navigation-drawer>

    <transition name="app-chrome">
      <header
        v-if="!immersive"
        class="app-bar"
        :class="{ 'app-bar--ios': isIos, 'app-bar--back': canGoBack }"
      >
        <div class="app-bar__inner">
          <div class="app-bar__leading">
            <transition name="app-bar-button">
              <div v-if="canGoBack" class="app-bar__back-control">
                <v-btn
                  class="app-bar__back-button"
                  icon="mdi-chevron-left"
                  variant="text"
                  aria-label="Go back"
                  @click="router.back()"
                />
              </div>
            </transition>
          </div>

          <h1 class="app-bar__title">{{ pageTitle }}</h1>

          <AccountMenu
            :account-name="accountName"
            :account-email="accountEmail"
            :account-initials="accountInitials"
            :account-avatar="accountAvatar"
            @open-account="router.push('/account')"
            @open-settings="router.push('/settings')"
            @sign-out="logoutDialog = true"
          />
        </div>
      </header>
    </transition>

    <v-main
      tag="div"
      class="app-scroll"
      :class="{
        'app-scroll--with-nav': !mdAndUp && !immersive,
        'app-scroll--with-bar': !immersive,
      }"
    >
      <div class="page-transition-stage">
        <router-view v-slot="{ Component, route: viewRoute }">
          <transition
            :name="pageTransition"
            @before-leave="pinLeavingPage"
            @after-leave="releaseLeavingPage"
            @leave-cancelled="releaseLeavingPage"
          >
            <component :is="Component" :key="viewRoute.path" />
          </transition>
        </router-view>
      </div>
    </v-main>

    <transition name="app-chrome">
      <nav
        v-if="!mdAndUp && !immersive"
        class="bottom-nav"
        :style="{ '--bottom-nav-font-size': bottomNavigationFontSize(items.length) }"
        aria-label="Primary navigation"
      >
        <router-link
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="bottom-nav__link"
          :class="{ 'bottom-nav__link--active': current === item.to }"
          :aria-current="current === item.to ? 'page' : undefined"
          :aria-label="menuItemLabel(item)"
        >
          <MainNavigationIcon
            :icon="item.icon"
            :running="menuItemHasActiveSession(item.id)"
            badge-surface="surface"
          />
          <span>{{ item.title }}</span>
        </router-link>
      </nav>
    </transition>

    <ConfirmDialog
      v-model="logoutDialog"
      title="Sign out?"
      message="Are you sure you want to end your current session?"
      confirm-text="Sign out"
      icon="mdi-logout"
      @confirm="logout"
    />

    <v-snackbar
      :key="snackbar.revision"
      v-model="snackbar.visible"
      color="success"
      location="bottom"
      :timeout="4000"
    >
      <div class="d-flex align-center ga-2">
        <v-icon icon="mdi-check-circle-outline" />
        <span>{{ snackbar.message }}</span>
      </div>
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          aria-label="Dismiss confirmation"
          @click="snackbar.dismiss"
        />
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
.app-bar {
  position: fixed;
  z-index: 1002;
  top: 0;
  right: 0;
  left: 0;
  height: calc(60px + max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px)));
  padding-top: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px));
  border-bottom: 1px solid rgb(var(--v-theme-on-surface) / .08);
  background: rgb(var(--v-theme-background) / .9);
  backdrop-filter: blur(16px);
}

.app-bar__inner {
  display: grid;
  width: 100%;
  max-width: 900px;
  height: 60px;
  margin: 0 auto;
  padding: 0 1rem;
  grid-template-columns: 0 minmax(0, 1fr) 44px;
  align-items: center;
  gap: 0;
}

.app-bar__leading {
  display: grid;
  width: 44px;
  place-items: center;
}

.app-bar__back-control {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
}

.app-bar__back-button {
  width: 2.75rem !important;
  min-width: 2.75rem !important;
  height: 2.75rem !important;
}

.app-bar-button-enter-active,
.app-bar-button-leave-active {
  transition:
    opacity 160ms ease,
    transform 220ms ease;
}

.app-bar-button-enter-from,
.app-bar-button-leave-to {
  opacity: 0;
  transform: translateX(-.5rem);
}

.app-chrome-enter-active,
.app-chrome-leave-active {
  transition: opacity 200ms ease;
}

.app-chrome-enter-from,
.app-chrome-leave-to {
  opacity: 0;
}

.app-bar__title {
  overflow: hidden;
  margin: 0;
  font-size: .95rem;
  font-weight: 850;
  letter-spacing: -.01em;
  line-height: 1.2;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-bar--back .app-bar__inner {
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  gap: 1rem;
}

.app-bar--ios .app-bar__inner {
  padding: 0 .5rem;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  gap: .5rem;
}

.app-bar--ios .app-bar__title {
  text-align: center;
}

.app-bar--ios.app-bar--back .app-bar__inner {
  gap: 1rem;
}

.brand-mark {
  width: 160px;
  height: 36px;
}

.brand-mark img {
  display: block;
  width: 160px;
  height: 36px;
  object-fit: contain;
  object-position: left center;
}

.bottom-nav {
  position: fixed;
  z-index: 1000;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: env(safe-area-inset-bottom);
  height: calc(72px + env(safe-area-inset-bottom)) !important;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.3) !important;
}

.bottom-nav__link {
  display: flex;
  min-width: 0;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: rgb(var(--v-theme-on-surface) / .62);
  font-size: var(--bottom-nav-font-size, .68rem);
  font-weight: 800;
  line-height: 1.25;
  text-decoration: none;
  transition:
    color 160ms ease,
    font-size 160ms ease;
}

.bottom-nav__link--active {
  color: rgb(var(--v-theme-secondary));
}

.app-scroll {
  transition:
    padding-top 240ms ease,
    padding-bottom 240ms ease;
}

.app-scroll--with-nav {
  padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important;
}

.app-scroll--with-bar {
  padding-top: calc(60px + max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px))) !important;
}

.page-transition-stage {
  display: grid;
  min-width: 0;
  overflow-x: clip;
}

.page-transition-stage > * {
  min-width: 0;
  grid-area: 1 / 1;
  align-self: start;
}

@media (min-width: 960px) {
  .app-bar {
    left: 224px;
  }
}

</style>

<style>
:where(
  .page-level-forward-enter-active,
  .page-level-forward-leave-active,
  .page-level-back-enter-active,
  .page-level-back-leave-active,
  .page-depth-deeper-enter-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-enter-active,
  .page-depth-higher-leave-active
) {
  transition: opacity 240ms ease;
}

:where(
  .page-level-forward-enter-active,
  .page-level-forward-leave-active,
  .page-level-back-enter-active,
  .page-level-back-leave-active,
  .page-depth-deeper-enter-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-enter-active,
  .page-depth-higher-leave-active
) > :not(.page-action-area) {
  transition: transform 240ms cubic-bezier(.22, 1, .36, 1);
}

:where(
  .page-level-forward-leave-active,
  .page-level-back-leave-active,
  .page-depth-deeper-leave-active,
  .page-depth-higher-leave-active
) {
  pointer-events: none;
}

.page-route-leaving-pinned {
  position: fixed !important;
  z-index: 1;
  top: var(--page-leave-top) !important;
  right: auto !important;
  left: var(--page-leave-left) !important;
  width: var(--page-leave-width) !important;
  margin: 0 !important;
}

:where(
  .page-level-forward-enter-from,
  .page-level-forward-leave-to,
  .page-level-back-enter-from,
  .page-level-back-leave-to,
  .page-depth-deeper-enter-from,
  .page-depth-deeper-leave-to,
  .page-depth-higher-enter-from,
  .page-depth-higher-leave-to
) {
  opacity: 0;
}

.page-level-forward-enter-from > :not(.page-action-area) { transform: translateX(1.5rem); }
.page-level-forward-leave-to > :not(.page-action-area) { transform: translateX(-1rem); }
.page-level-back-enter-from > :not(.page-action-area) { transform: translateX(-1.5rem); }
.page-level-back-leave-to > :not(.page-action-area) { transform: translateX(1rem); }
.page-depth-deeper-enter-from > :not(.page-action-area) { transform: translateY(1.5rem); }
.page-depth-deeper-leave-to > :not(.page-action-area) { transform: translateY(-1rem); }
.page-depth-higher-enter-from > :not(.page-action-area) { transform: translateY(-1.5rem); }
.page-depth-higher-leave-to > :not(.page-action-area) { transform: translateY(1rem); }

@media (prefers-reduced-motion: reduce) {
  :where(
    .page-level-forward-enter-from,
    .page-level-forward-leave-to,
    .page-level-back-enter-from,
    .page-level-back-leave-to,
    .page-depth-deeper-enter-from,
    .page-depth-deeper-leave-to,
    .page-depth-higher-enter-from,
    .page-depth-higher-leave-to
  ) > :not(.page-action-area) {
    transform: none;
  }
}

</style>
