<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { format, isSameWeek, startOfWeek } from 'date-fns'
import IntervalPlanList from '@/components/IntervalPlanList.vue'
import WeekNavigator from '@/components/WeekNavigator.vue'
import { formatIntervalDuration } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalSession } from '@/types/domain'

const store = useIntervalStore()
const recentWeekStart = ref(startOfWeek(new Date(), { weekStartsOn: 1 }))
const intervalColors = computed(() =>
  new Map(store.templates.map((template) => [template.id, template.color])),
)
const recentSessionsForWeek = computed(() =>
  store.sessions.filter((session) =>
    (session.status === 'completed' || session.status === 'ended')
    && isSameWeek(new Date(session.startedAt), recentWeekStart.value, { weekStartsOn: 1 }),
  ),
)
const recentWeekIsCurrent = computed(() =>
  isSameWeek(recentWeekStart.value, new Date(), { weekStartsOn: 1 }),
)

function recentRunColor(session: IntervalSession) {
  if (session.status !== 'completed') return 'warning'
  return session.template
    ? intervalColors.value.get(session.template) || 'success'
    : 'success'
}

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

    <div class="section-heading">
      <h2>Your intervals</h2>
      <v-btn size="small" variant="text" prepend-icon="mdi-plus" to="/intervals/new">New</v-btn>
    </div>
    <transition name="interval-content">
      <div>
        <IntervalPlanList />
      </div>
    </transition>

    <div class="section-heading"><h2>Recent runs</h2><span class="text-caption muted">{{ recentSessionsForWeek.length }}</span></div>
    <WeekNavigator v-model="recentWeekStart" class="mb-3" />
    <transition name="interval-content">
      <v-card
        v-if="recentSessionsForWeek.length"
        :key="recentWeekStart.toISOString()"
        class="surface-card pa-2"
      >
        <v-list bg-color="transparent">
          <v-list-item
            v-for="session in recentSessionsForWeek"
            :key="session.id"
            :title="session.name"
            :subtitle="`${format(new Date(session.startedAt), 'MMM d · h:mm a')} · ${session.source === 'quick' ? 'Quick' : 'Template'}`"
          >
            <template #prepend>
              <v-icon
                :icon="session.status === 'completed' ? 'mdi-check-circle-outline' : 'mdi-stop-circle-outline'"
                :color="recentRunColor(session)"
              />
            </template>
            <template #append><strong class="text-caption">{{ formatIntervalDuration(session.elapsedSeconds) }}</strong></template>
          </v-list-item>
        </v-list>
      </v-card>
      <v-card
        v-else-if="store.loaded"
        :key="`empty-${recentWeekStart.toISOString()}`"
        class="surface-card pa-7 text-center"
      >
        <p class="text-body-2 muted">
          {{ recentWeekIsCurrent ? 'Finished sessions will appear here.' : 'No finished sessions this week.' }}
        </p>
      </v-card>
    </transition>
  </main>
</template>

<style scoped>
.active-session { display: flex; align-items: center; justify-content: space-between; gap: 1rem; color: rgb(var(--v-theme-on-secondary)); }
.active-label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-copy { color: rgb(var(--v-theme-on-secondary) / .7); font-size: .75rem; }
.quick-card { position: relative; overflow: hidden; border: 2px solid rgba(var(--v-theme-secondary), .68) !important; background: linear-gradient(145deg, rgb(var(--v-theme-surface)), rgba(var(--v-theme-secondary), .07)); box-shadow: inset 0 0 0 1px rgba(var(--v-theme-secondary), .18), 0 12px 30px rgba(0, 0, 0, .2) !important; }
.quick-card__glow { position: absolute; top: -70px; right: -55px; width: 180px; height: 180px; border: 32px solid rgb(var(--v-theme-secondary) / .07); border-radius: 50%; pointer-events: none; }
.quick-card__content { position: relative; display: grid; gap: 1.25rem; }
.quick-card__intro { display: flex; min-width: 0; align-items: center; gap: 1rem; }
.quick-card__copy { max-width: 34rem; color: rgb(var(--v-theme-on-surface) / .62); font-size: .82rem; line-height: 1.5; }
.quick-icon { display: grid; width: 48px; height: 48px; flex: 0 0 auto; place-items: center; border-radius: 16px; background: rgb(var(--v-theme-secondary)); color: rgb(var(--v-theme-on-secondary)); box-shadow: 0 10px 24px rgb(var(--v-theme-secondary) / .12); }
.quick-card__action { width: 100%; }
.interval-content-enter-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.interval-content-enter-from { opacity: 0; transform: translateY(.75rem); }
@media (min-width: 700px) {
  .quick-card__content { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
  .quick-card__intro { grid-column: 1; }
  .quick-card__action { width: auto; min-width: 160px; grid-column: 2; grid-row: 1; }
}
</style>
