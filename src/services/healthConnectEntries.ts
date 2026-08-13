import type { Entry } from '@/types/domain'

export const HEALTH_CONNECT_ENTRY_SESSION_PREFIX = 'health-connect:'

export function healthConnectEntrySession(entryDate: string) {
  return `${HEALTH_CONNECT_ENTRY_SESSION_PREFIX}${entryDate}`
}

export function isHealthConnectEntry(entry?: Pick<Entry, 'sourceType' | 'sourceSession'>) {
  return entry?.sourceType === 'health_connect'
    || entry?.sourceSession?.startsWith(HEALTH_CONNECT_ENTRY_SESSION_PREFIX) === true
}
