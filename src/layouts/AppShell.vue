<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'
import { useRouter } from 'vue-router'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useAuthStore } from '@/stores/auth'

const { mdAndUp } = useDisplay()
const router = useRouter()
const auth = useAuthStore()
const logoutDialog = ref(false)

const items = [
  { title: 'Today', icon: 'mdi-lightning-bolt', to: '/today' },
  { title: 'Plan', icon: 'mdi-calendar-edit', to: '/plan' },
  { title: 'Intervals', icon: 'mdi-timer-outline', to: '/intervals' },
  { title: 'History', icon: 'mdi-chart-timeline-variant', to: '/history' },
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

function logout() {
  logoutDialog.value = false
  auth.logout()
  router.replace('/auth')
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

    <v-main>
      <router-view />
    </v-main>

    <v-bottom-navigation
      v-if="!mdAndUp && !immersive"
      v-model="current"
      grow
      mandatory
      color="secondary"
      bg-color="surface"
      height="72"
      class="bottom-nav"
    >
      <v-btn v-for="item in items" :key="item.to" :value="item.to" :prepend-icon="item.icon">
        {{ item.title }}
      </v-btn>
    </v-bottom-navigation>

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
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: env(safe-area-inset-bottom);
  height: calc(72px + env(safe-area-inset-bottom)) !important;
  box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.3) !important;
}

.bottom-nav :deep(.v-btn__content) {
  gap: 2px;
  font-size: 0.68rem;
  font-weight: 800;
}

</style>
