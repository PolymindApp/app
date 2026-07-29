<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { format } from 'date-fns'
import { useRouter } from 'vue-router'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplate } from '@/types/domain'

const store = useIntervalStore()
const router = useRouter()

async function reconcileWhenVisible() {
  if (document.visibilityState !== 'visible') return
  await store.reconcileActiveSession().catch(() => undefined)
}

onMounted(() => {
  store.load().catch(() => undefined)
  document.addEventListener('visibilitychange', reconcileWhenVisible)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', reconcileWhenVisible)
})

function openTemplate(template: IntervalTemplate) {
  return router.push(`/intervals/run/template/${template.id}`)
}
</script>

<template>
  <main class="app-page intervals-page">
    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">{{ store.error }}</v-alert>

    <v-card v-if="store.activeSession" class="active-session pa-5 mb-4" color="secondary">
      <div>
        <span class="active-label">In progress</span>
        <h2 class="text-h5 font-weight-black mt-1">{{ store.activeSession.name }}</h2>
        <p class="active-copy mt-1">{{ store.activeSession.status === 'paused' ? 'Paused and ready when you are.' : 'Your timer is still running.' }}</p>
      </div>
      <v-btn color="primary" append-icon="mdi-arrow-right" :to="`/intervals/run/${store.activeSession.id}`">Resume</v-btn>
    </v-card>

    <v-card class="quick-card surface-card pa-5 mb-6">
      <div class="quick-card__glow" />
      <div class="quick-card__content">
        <div class="quick-card__intro">
          <div class="quick-icon"><v-icon icon="mdi-flash" size="25" /></div>
          <div class="flex-grow-1 min-width-0">
            <h2 class="text-h5 font-weight-black">Quick interval</h2>
            <p class="quick-card__copy mt-2">Build a one-time timer without saving a template.</p>
          </div>
        </div>

        <div class="quick-sequence" aria-label="Work, rest, and repeat">
          <span><v-icon icon="mdi-play" size="14" />Work</span>
          <v-icon icon="mdi-chevron-right" size="16" />
          <span><v-icon icon="mdi-pause" size="14" />Rest</span>
          <v-icon icon="mdi-chevron-right" size="16" />
          <span><v-icon icon="mdi-repeat" size="14" />Repeat</span>
        </div>

        <v-btn
          class="quick-card__action"
          color="secondary"
          size="large"
          append-icon="mdi-arrow-right"
          to="/intervals/quick"
        >
          Set up timer
        </v-btn>
      </div>
    </v-card>

    <div class="section-heading"><h2>Your templates</h2><v-btn size="small" variant="text" :to="{ path: '/plan', query: { tab: 'intervals' } }">Manage</v-btn></div>
    <transition name="interval-content">
      <div v-if="store.templates.length" class="template-launcher">
        <v-card
          v-for="template in store.templates"
          :key="template.id"
          class="template-card surface-card pa-4"
          role="button"
          tabindex="0"
          :aria-label="`Open ${template.name}`"
          @click="openTemplate(template)"
          @keydown.enter="openTemplate(template)"
          @keydown.space.prevent="openTemplate(template)"
        >
          <div class="d-flex align-start ga-3">
            <div class="template-icon" :style="{ background: template.color }"><v-icon icon="mdi-timer-outline" /></div>
            <div class="flex-grow-1 min-width-0">
              <h3 class="text-body-1 font-weight-black text-truncate">{{ template.name }}</h3>
              <p class="text-caption muted mt-1">{{ formatIntervalDuration(intervalDuration(template.definition)) }} · {{ intervalStepCount(template.definition) }} intervals</p>
            </div>
          </div>
        </v-card>
      </div>
      <v-card v-else-if="store.loaded" class="surface-card pa-7 text-center">
        <p class="text-body-2 muted mb-4">No reusable intervals yet.</p>
        <v-btn color="secondary" to="/plan/intervals/new">Create in Plan</v-btn>
      </v-card>
    </transition>

    <div class="section-heading"><h2>Recent runs</h2><span class="text-caption muted">{{ store.recentSessions.length }}</span></div>
    <transition name="interval-content">
      <v-card v-if="store.recentSessions.length" class="surface-card pa-2">
        <v-list bg-color="transparent">
          <v-list-item
            v-for="session in store.recentSessions"
            :key="session.id"
            :title="session.name"
            :subtitle="`${format(new Date(session.startedAt), 'MMM d · h:mm a')} · ${session.source === 'quick' ? 'Quick' : 'Template'}`"
          >
            <template #prepend>
              <v-icon :icon="session.status === 'completed' ? 'mdi-check-circle-outline' : 'mdi-stop-circle-outline'" :color="session.status === 'completed' ? 'success' : 'warning'" />
            </template>
            <template #append><strong class="text-caption">{{ formatIntervalDuration(session.elapsedSeconds) }}</strong></template>
          </v-list-item>
        </v-list>
      </v-card>
      <v-card v-else-if="store.loaded" class="surface-card pa-7 text-center">
        <p class="text-body-2 muted">Finished sessions will appear here.</p>
      </v-card>
    </transition>
  </main>
</template>

<style scoped>
.active-session { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.active-label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-copy { color: rgb(var(--v-theme-on-secondary) / .7); font-size: .75rem; }
.quick-card { position: relative; overflow: hidden; border-color: rgb(var(--v-theme-secondary) / .2); outline: 1px solid rgb(var(--v-theme-secondary) / .34); outline-offset: -1px; background: linear-gradient(145deg, rgb(var(--v-theme-surface)), rgb(var(--v-theme-secondary) / .07)); }
.quick-card__glow { position: absolute; top: -70px; right: -55px; width: 180px; height: 180px; border: 32px solid rgb(var(--v-theme-secondary) / .07); border-radius: 50%; pointer-events: none; }
.quick-card__content { position: relative; display: grid; gap: 1.25rem; }
.quick-card__intro { display: flex; min-width: 0; align-items: center; gap: 1rem; }
.quick-card__copy { max-width: 34rem; color: rgb(var(--v-theme-on-surface) / .62); font-size: .82rem; line-height: 1.5; }
.quick-icon, .template-icon { display: grid; width: 48px; height: 48px; flex: 0 0 auto; place-items: center; border-radius: 16px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); box-shadow: 0 10px 24px rgb(var(--v-theme-secondary) / .12); }
.template-icon { color: #17200f; }
.quick-sequence { display: flex; min-width: 0; align-items: center; gap: .4rem; color: rgb(var(--v-theme-on-surface) / .42); }
.quick-sequence span { display: inline-flex; min-width: 0; flex: 1 1 0; align-items: center; justify-content: center; gap: .35rem; padding: .55rem .45rem; border: 1px solid rgb(var(--v-theme-on-surface) / .09); border-radius: 12px; background: rgb(var(--v-theme-background) / .52); color: rgb(var(--v-theme-on-surface) / .76); font-size: .68rem; font-weight: 800; }
.quick-card__action { width: 100%; }
.template-launcher { display: grid; gap: .75rem; }
.template-card { cursor: pointer; }
.template-card:focus-visible { outline: 3px solid rgb(var(--v-theme-primary) / .55); outline-offset: 3px; }
.interval-content-enter-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.interval-content-enter-from { opacity: 0; transform: translateY(.75rem); }
@media (min-width: 700px) {
  .quick-card__content { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
  .quick-card__intro { grid-column: 1; }
  .quick-sequence { grid-column: 1; }
  .quick-card__action { width: auto; min-width: 160px; grid-column: 2; grid-row: 1 / 3; }
}
@media (min-width: 700px) { .template-launcher { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
