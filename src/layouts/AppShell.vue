<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'

const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const logoutDialog = ref(false)
const appScroll = ref<HTMLElement | { $el?: HTMLElement }>()
const pageTransition = ref('page-level-forward')
const isIos = Capacitor.getPlatform() === 'ios'

const items = [
  { title: 'Today', icon: 'mdi-lightning-bolt', to: '/today' },
  { title: 'Intervals', icon: 'mdi-timer-outline', to: '/intervals' },
  { title: 'Plan', icon: 'mdi-calendar-edit', to: '/plan' },
]

const immersive = computed(() => Boolean(router.currentRoute.value.meta.immersive))
const pageTitle = computed(() => String(router.currentRoute.value.meta.title || 'Mom'))
const canGoBack = computed(() => Number(router.currentRoute.value.meta.pageDepth ?? 0) > 0)
const accountName = computed(() => auth.user?.name || auth.firstName || 'You')
const accountEmail = computed(() => auth.user?.email || '')
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
    if (path.startsWith('/plan') || path.startsWith('/tasks')) return '/plan'
    return path
  },
  set: (path: string) => router.push(path),
})

const removeTransitionGuard = router.beforeEach((to, from) => {
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

onBeforeUnmount(removeTransitionGuard)

function logout() {
  logoutDialog.value = false
  auth.logout()
  router.replace('/auth')
}

function beginPageScrollReset() {
  const target = appScroll.value instanceof HTMLElement ? appScroll.value : appScroll.value?.$el
  target?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
}
</script>

<template>
  <v-app theme="forgeDark">
    <v-navigation-drawer v-if="mdAndUp && !immersive" permanent width="224" color="background">
      <div class="pa-6 pt-8">
        <div class="brand-mark mb-3">
          <img src="/brand/mom-wordmark.png" alt="Mom" />
        </div>
        <p class="text-caption text-medium-emphasis mt-2">Management of Me.</p>
      </div>

      <v-list nav class="px-3 mt-6">
        <v-list-item
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          rounded="xl"
          class="mb-2"
          color="secondary"
        />
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
                  icon="mdi-chevron-left"
                  variant="text"
                  density="compact"
                  aria-label="Go back"
                  @click="router.back()"
                />
              </div>
            </transition>
          </div>

          <h1 class="app-bar__title">{{ pageTitle }}</h1>

          <v-menu location="bottom end" :offset="8">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon
                variant="text"
                class="app-bar__account"
                :aria-label="`Open account menu for ${accountName}`"
              >
                <v-avatar color="secondary" size="36">
                  <span>{{ accountInitials }}</span>
                </v-avatar>
              </v-btn>
            </template>

            <v-card class="account-menu" min-width="240">
              <div class="account-menu__identity pa-4">
                <v-avatar color="secondary" size="40">
                  <span>{{ accountInitials }}</span>
                </v-avatar>
                <div class="min-width-0">
                  <strong class="d-block text-truncate">{{ accountName }}</strong>
                  <span v-if="accountEmail" class="d-block text-caption muted text-truncate">{{ accountEmail }}</span>
                </div>
              </div>
              <v-divider />
              <v-list density="compact" class="pa-2">
                <v-list-item
                  title="Sign out"
                  prepend-icon="mdi-logout"
                  rounded="lg"
                  @click="logoutDialog = true"
                />
              </v-list>
            </v-card>
          </v-menu>
        </div>
      </header>
    </transition>

    <v-main
      ref="appScroll"
      tag="div"
      class="app-scroll"
      :class="{
        'app-scroll--with-nav': !mdAndUp && !immersive,
        'app-scroll--with-bar': !immersive,
      }"
    >
      <div class="page-transition-stage">
        <router-view v-slot="{ Component, route: viewRoute }">
          <transition :name="pageTransition" @before-leave="beginPageScrollReset">
            <component :is="Component" :key="viewRoute.path" />
          </transition>
        </router-view>
      </div>
    </v-main>

    <transition name="app-chrome">
      <nav
        v-if="!mdAndUp && !immersive"
        class="bottom-nav"
        aria-label="Primary navigation"
      >
        <router-link
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="bottom-nav__link"
          :class="{ 'bottom-nav__link--active': current === item.to }"
          :aria-current="current === item.to ? 'page' : undefined"
        >
          <v-icon :icon="item.icon" size="24" />
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
  transition:
    grid-template-columns 220ms ease,
    gap 220ms ease;
}

.app-bar__leading {
  display: grid;
  width: 0;
  overflow: hidden;
  place-items: center;
  transition: width 220ms ease;
}

.app-bar__back-control {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  overflow: hidden;
  place-items: center;
}

.app-bar-button-enter-active,
.app-bar-button-leave-active {
  transition:
    width 220ms ease,
    opacity 160ms ease,
    transform 220ms ease;
}

.app-bar-button-enter-from,
.app-bar-button-leave-to {
  width: 0;
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

.app-bar--back .app-bar__inner {
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  gap: 1rem;
}

.app-bar--back .app-bar__leading {
  width: 44px;
}

.app-bar--ios .app-bar__inner {
  padding: 0 .5rem;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  gap: .5rem;
}

.app-bar--ios .app-bar__leading {
  width: 44px;
}

.app-bar--ios .app-bar__title {
  text-align: center;
}

.app-bar--ios.app-bar--back .app-bar__inner {
  gap: 1rem;
}

.account-menu {
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-on-surface) / .1);
}

.account-menu__identity {
  display: flex;
  align-items: center;
  gap: .75rem;
}

.account-menu__identity > .v-avatar {
  flex: 0 0 auto;
  color: rgb(var(--v-theme-on-secondary));
  font-size: .75rem;
  font-weight: 900;
}

.brand-mark {
  width: 104px;
  height: 36px;
}

.brand-mark img {
  display: block;
  width: 104px;
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
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.25;
  text-decoration: none;
  transition: color 160ms ease;
}

.bottom-nav__link--active {
  color: rgb(var(--v-theme-secondary));
}

.app-scroll {
  overflow-x: hidden;
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
}

.page-transition-stage > * {
  min-width: 0;
  grid-area: 1 / 1;
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
