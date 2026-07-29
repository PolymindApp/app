<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
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

const items = [
  { title: 'Today', icon: 'mdi-lightning-bolt', to: '/today' },
  { title: 'Intervals', icon: 'mdi-timer-outline', to: '/intervals' },
  { title: 'Plan', icon: 'mdi-calendar-edit', to: '/plan' },
]

const immersive = computed(() => Boolean(router.currentRoute.value.meta.immersive))
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
          <img src="/brand/rep-wordmark.png" alt="REP" />
        </div>
        <p class="text-caption text-medium-emphasis mt-2">Consistency, measured.</p>
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

    <v-main
      ref="appScroll"
      tag="div"
      class="app-scroll"
      :class="{ 'app-scroll--with-nav': !mdAndUp && !immersive }"
    >
      <div class="page-transition-stage">
        <router-view v-slot="{ Component, route: viewRoute }">
          <transition :name="pageTransition" @before-leave="beginPageScrollReset">
            <component :is="Component" :key="viewRoute.path" />
          </transition>
        </router-view>
      </div>
    </v-main>

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
}

.app-scroll--with-nav {
  padding-bottom: calc(72px + env(safe-area-inset-bottom)) !important;
}

.page-transition-stage {
  display: grid;
  min-width: 0;
}

.page-transition-stage > * {
  min-width: 0;
  grid-area: 1 / 1;
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
