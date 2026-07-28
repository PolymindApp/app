<script setup lang="ts">
import { onMounted } from 'vue'
import { format } from 'date-fns'
import { useRouter } from 'vue-router'
import { prepareIntervalCues } from '@/services/intervalCues'
import { formatIntervalDuration, intervalDuration, intervalStepCount } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalTemplate } from '@/types/domain'

const store = useIntervalStore()
const router = useRouter()

onMounted(() => {
  store.load().catch(() => undefined)
})

async function start(template: IntervalTemplate) {
  await prepareIntervalCues(template.cues)
  const session = await store.startSession({
    name: template.name,
    source: 'template',
    definition: template.definition,
    cues: template.cues,
    template: template.id,
  })
  await router.push(`/intervals/run/${session.id}`)
}
</script>

<template>
  <main class="app-page intervals-page">
    <header class="mb-6">
      <h1 class="display-title text-h3 mt-2">INTERVALS<span class="text-secondary">.</span></h1>
      <p class="text-body-2 muted mt-2">Start a sequence and stay inside the moment.</p>
    </header>

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
      <div class="quick-icon"><v-icon icon="mdi-flash-outline" size="24" /></div>
      <div class="flex-grow-1">
        <h2 class="text-h6 font-weight-black">Quick interval</h2>
        <p class="text-body-2 muted mt-1">Work, rest, rounds, and go. Nothing is added to your Plan.</p>
      </div>
      <v-btn color="secondary" append-icon="mdi-play" to="/intervals/quick">Build</v-btn>
    </v-card>

    <div class="section-heading"><h2>Your templates</h2><v-btn size="small" variant="text" :to="{ path: '/plan', query: { tab: 'intervals' } }">Manage</v-btn></div>
    <div v-if="store.templates.length" class="template-launcher">
      <v-card v-for="template in store.templates" :key="template.id" class="surface-card pa-4">
        <div class="d-flex align-start ga-3">
          <div class="template-icon" :style="{ background: template.color }"><v-icon icon="mdi-timer-outline" /></div>
          <div class="flex-grow-1 min-width-0">
            <h3 class="text-body-1 font-weight-black text-truncate">{{ template.name }}</h3>
            <p class="text-caption muted mt-1">{{ formatIntervalDuration(intervalDuration(template.definition)) }} · {{ intervalStepCount(template.definition) }} intervals</p>
          </div>
          <v-btn icon="mdi-play" color="secondary" size="small" :aria-label="`Start ${template.name}`" @click="start(template)" />
        </div>
      </v-card>
    </div>
    <v-card v-else-if="!store.loading" class="surface-card pa-7 text-center">
      <p class="text-body-2 muted mb-4">No reusable intervals yet.</p>
      <v-btn color="secondary" to="/plan/intervals/new">Create in Plan</v-btn>
    </v-card>

    <div class="section-heading"><h2>Recent runs</h2><span class="text-caption muted">{{ store.recentSessions.length }}</span></div>
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
    <v-card v-else-if="!store.loading" class="surface-card pa-7 text-center">
      <p class="text-body-2 muted">Finished sessions will appear here.</p>
    </v-card>
  </main>
</template>

<style scoped>
.active-session { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.active-label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-copy { color: rgb(var(--v-theme-on-secondary) / .7); font-size: .75rem; }
.quick-card { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }
.quick-icon, .template-icon { display: grid; width: 44px; height: 44px; flex: 0 0 auto; place-items: center; border-radius: 14px; background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-secondary)); }
.template-icon { color: #17200f; }
.template-launcher { display: grid; gap: .75rem; }
@media (min-width: 700px) { .template-launcher { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
