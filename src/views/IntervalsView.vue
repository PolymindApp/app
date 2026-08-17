<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { format, isSameWeek, startOfWeek } from 'date-fns'
import IntervalPlanList from '@/components/IntervalPlanList.vue'
import WeekNavigator from '@/components/WeekNavigator.vue'
import { groupIntervalSessionsByDate, intervalRunProgressPercent } from '@/services/intervalHistory'
import { formatIntervalDuration } from '@/services/intervals'
import { useIntervalStore } from '@/stores/intervals'
import type { IntervalSession } from '@/types/domain'

const store = useIntervalStore()
const recentWeekStart = ref(startOfWeek(new Date(), { weekStartsOn: 1 }))
const expandedRecentRunDays = ref(new Set([format(new Date(), 'yyyy-MM-dd')]))
const intervalColors = computed(() =>
  new Map(store.templates.map((template) => [template.id, template.color])),
)
const recentSessionsForWeek = computed(() =>
  store.sessions.filter((session) =>
    (session.status === 'completed' || session.status === 'ended')
    && isSameWeek(new Date(session.startedAt), recentWeekStart.value, { weekStartsOn: 1 }),
  ),
)
const recentSessionGroups = computed(() => groupIntervalSessionsByDate(recentSessionsForWeek.value))
const recentWeekIsCurrent = computed(() =>
  isSameWeek(recentWeekStart.value, new Date(), { weekStartsOn: 1 }),
)

function isRecentRunDayExpanded(dayKey: string) {
  return expandedRecentRunDays.value.has(dayKey)
}

function toggleRecentRunDay(dayKey: string) {
  const nextExpandedDays = new Set(expandedRecentRunDays.value)
  if (nextExpandedDays.has(dayKey)) nextExpandedDays.delete(dayKey)
  else nextExpandedDays.add(dayKey)
  expandedRecentRunDays.value = nextExpandedDays
}

function recentRunColor(session: IntervalSession) {
  if (session.status !== 'completed') return 'warning'
  if (session.source === 'quick') return 'secondary'
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
  <main class="app-page intervals-page" :class="{ 'intervals-page--active': store.activeSession }">
    <v-alert v-if="store.error" type="error" variant="tonal" class="mb-4">{{ store.error }}</v-alert>

        <div class="section-heading mt-0">
          <h2>Your intervals</h2>
          <div class="d-flex ga-1">
            <v-btn
              size="small"
              color="secondary"
              variant="text"
              prepend-icon="mdi-flash"
              to="/intervals/quick"
            >
              Quick
            </v-btn>
            <v-btn size="small" variant="text" prepend-icon="mdi-plus" to="/intervals/new">
              New
            </v-btn>
          </div>
        </div>
        <transition name="interval-content">
          <div>
            <IntervalPlanList />
          </div>
        </transition>
        <div class="section-heading">
          <h2>Recent runs</h2>
        </div>
        <WeekNavigator v-model="recentWeekStart" class="mb-3" />
        <transition name="interval-content" mode="out-in">
          <v-card
            v-if="recentSessionsForWeek.length"
            :key="recentWeekStart.toISOString()"
            class="surface-card pa-2"
          >
            <section
              v-for="(group, groupIndex) in recentSessionGroups"
              :key="group.key"
              class="recent-run-group"
            >
              <v-divider v-if="groupIndex" />
              <v-btn
                block
                variant="text"
                class="recent-run-group__heading px-4"
                :aria-expanded="isRecentRunDayExpanded(group.key)"
                :aria-controls="`recent-runs-${group.key}`"
                @click="toggleRecentRunDay(group.key)"
              >
                <h3>{{ group.label }}</h3>
                <span class="recent-run-group__count">{{ group.sessions.length }}</span>
                <v-icon
                  :icon="isRecentRunDayExpanded(group.key) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  size="small"
                />
              </v-btn>
              <v-expand-transition>
                <v-list
                  v-show="isRecentRunDayExpanded(group.key)"
                  :id="`recent-runs-${group.key}`"
                  bg-color="transparent"
                >
                  <v-list-item
                    v-for="session in group.sessions"
                    :key="session.id"
                    class="recent-run-item"
                    :title="session.name"
                  >
                    <template #prepend>
                      <v-icon
                        :icon="session.status === 'completed' ? 'mdi-check-circle-outline' : 'mdi-stop-circle-outline'"
                        :color="recentRunColor(session)"
                      />
                    </template>
                    <span class="recent-run-meta">
                      {{ format(new Date(session.startedAt), 'h:mm a') }} · {{ session.source === 'quick' ? 'Quick' : 'Template' }}
                    </span>
                    <div class="recent-run-progress">
                      <v-progress-linear
                        :model-value="intervalRunProgressPercent(session)"
                        :color="recentRunColor(session)"
                        bg-color="surface-variant"
                        height="4"
                        rounded
                        :aria-label="`${session.name}: ${intervalRunProgressPercent(session)}% accomplished`"
                      />
                    </div>
                    <div v-if="session.note" class="recent-run-note">
                      <span>{{ session.note }}</span>
                    </div>
                    <template #append>
                      <strong class="recent-run-time text-caption">{{ formatIntervalDuration(session.elapsedSeconds) }}</strong>
                    </template>
                  </v-list-item>
                </v-list>
              </v-expand-transition>
            </section>
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

    <v-card
      v-if="store.activeSession"
      class="active-session page-action-area pa-5"
      color="secondary"
    >
      <div class="active-session__inner">
        <div class="active-session__details">
          <span class="active-label">
            {{ store.activeSession.status === 'paused' ? 'Paused' : 'In progress' }}
          </span>
          <strong class="active-session__name text-truncate">{{ store.activeSession.name }}</strong>
        </div>
        <v-btn
          color="primary"
          size="large"
          append-icon="mdi-arrow-right"
          :to="{
            name: 'interval-runner',
            params: { sessionId: store.activeSession.id },
            query: { autoplay: '1' },
          }"
        >
          Resume
        </v-btn>
      </div>
    </v-card>
  </main>
</template>

<style scoped>
.intervals-page--active { padding-bottom: calc(7rem + var(--page-safe-area-bottom)); }
.active-session { position: fixed; z-index: 20; right: 0; bottom: 0; left: 17rem; border-radius: 0 !important; color: rgb(var(--v-theme-on-secondary)); box-shadow: 0 -.75rem 1.875rem rgba(0, 0, 0, .28) !important; }
.active-session__inner { display: flex; width: 100%; max-width: 54.25rem; margin: 0 auto; align-items: center; justify-content: space-between; gap: 1rem; }
.active-session__details { display: flex; min-width: 0; flex-direction: column; }
.active-label { font-size: .65rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
.active-session__name { font-size: 1.5rem; }
.interval-content-enter-active { transition: opacity 180ms ease, transform 220ms cubic-bezier(.22, 1, .36, 1); }
.interval-content-enter-from { opacity: 0; transform: translateY(.75rem); }
.recent-run-group__heading { min-height: 2.75rem; }
.recent-run-group__heading :deep(.v-btn__content) { width: 100%; justify-content: flex-start; gap: .5rem; }
.recent-run-group__heading h3 { font-size: .75rem; font-weight: 900; letter-spacing: .04em; }
.recent-run-group__count { margin-left: auto; color: rgba(var(--v-theme-on-surface), .54); font-size: .68rem; font-weight: 800; }
.recent-run-progress { margin-top: .45rem; }
.recent-run-note { min-width: 0; margin-top: .5rem; color: rgba(var(--v-theme-on-surface), .68); font-size: .75rem; line-height: 1.45; }
.recent-run-note span { min-width: 0; overflow-wrap: anywhere; white-space: pre-line; }
.recent-run-meta { display: block; margin-top: .25rem; overflow: hidden; color: rgba(var(--v-theme-on-surface), .62); font-size: .875rem; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.recent-run-time { display: block; width: 3.5rem; font-variant-numeric: tabular-nums; text-align: end; }
@media (max-width: 59.9375rem) {
  .active-session {
    bottom: calc(4.5rem + env(safe-area-inset-bottom));
    left: 0;
  }
}
</style>
