<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const transitioning = ref(false)
const enteringApp = computed(() => route.name !== 'auth')
const transitionName = computed(() => enteringApp.value ? 'session-forward' : 'session-back')
</script>

<template>
  <router-view v-slot="{ Component, route: viewRoute }">
    <transition
      :name="transitionName"
      mode="out-in"
      @before-leave="transitioning = true"
      @after-enter="transitioning = false"
      @leave-cancelled="transitioning = false"
    >
      <component :is="Component" :key="viewRoute.meta.guest ? 'guest' : 'app'" />
    </transition>
  </router-view>

  <transition name="session-loader">
    <div v-if="transitioning" class="session-loading" role="status" aria-live="polite">
      <v-progress-circular indeterminate color="secondary" size="30" width="3" />
      <span>{{ enteringApp ? 'Entering REP…' : 'Signing out…' }}</span>
    </div>
  </transition>
</template>

<style>
.session-forward-enter-active,
.session-forward-leave-active,
.session-back-enter-active,
.session-back-leave-active {
  transition:
    opacity 240ms ease,
    transform 360ms cubic-bezier(.22, 1, .36, 1);
}

.session-forward-enter-from {
  opacity: 0;
  transform: translateX(2rem);
}

.session-forward-leave-to {
  opacity: 0;
  transform: translateX(-1.5rem);
}

.session-back-enter-from {
  opacity: 0;
  transform: translateX(-1.5rem);
}

.session-back-leave-to {
  opacity: 0;
  transform: translateX(2rem);
}

.session-loading {
  position: fixed;
  z-index: 10000;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: .75rem;
  background: rgba(16, 19, 16, .58);
  color: #f1f4ec;
  backdrop-filter: blur(3px);
}

.session-loading span {
  font-size: .78rem;
  font-weight: 800;
  letter-spacing: .04em;
}

.session-loader-enter-active,
.session-loader-leave-active {
  transition: opacity 180ms ease;
}

.session-loader-enter-from,
.session-loader-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .session-forward-enter-from,
  .session-forward-leave-to,
  .session-back-enter-from,
  .session-back-leave-to {
    transform: none;
  }
}
</style>
