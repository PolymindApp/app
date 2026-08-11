import { ref } from 'vue'
import { defineStore } from 'pinia'
import {
  discardAllSyncIssues,
  discardSyncIssue,
  listSyncIssues,
} from '@/lib/localDatabase'
import {
  offlineSyncStatus,
  syncNow,
  syncStatusChangedEvent,
} from '@/services/offlineSync'
import { api } from '@/lib/api'
import type { SyncIssue, SyncStatusSnapshot } from '@/types/sync'

export const useSyncStore = defineStore('sync', () => {
  const status = ref<SyncStatusSnapshot>({ ...offlineSyncStatus })
  const issues = ref<SyncIssue[]>([])

  async function refresh() {
    status.value = { ...offlineSyncStatus }
    issues.value = api.authStore.record
      ? await listSyncIssues(api.authStore.record.id)
      : []
  }

  function handleStatus() {
    void refresh()
  }

  async function discardIssue(issueId: string) {
    await discardSyncIssue(issueId)
    await refresh()
    return syncNow('discard-issue')
  }

  async function discardAllIssues() {
    const accountId = api.authStore.record?.id
    if (!accountId) return 0
    const discarded = await discardAllSyncIssues(accountId)
    await refresh()
    void syncNow('discard-issues')
    return discarded
  }

  window.addEventListener(syncStatusChangedEvent, handleStatus)

  return {
    status,
    issues,
    refresh,
    syncNow,
    discardIssue,
    discardAllIssues,
  }
})
