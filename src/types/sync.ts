export type SyncOperationKind = 'create' | 'patch' | 'delete' | 'command'
export type SyncOperationStatus = 'pending' | 'sending' | 'rejected'
export type SyncPhase = 'idle' | 'hydrating' | 'syncing' | 'synced' | 'offline' | 'auth-required' | 'attention'

export interface SyncOperation {
  operationId: string
  transactionId?: string
  accountId: string
  clientId: string
  resource: string
  recordId?: string
  kind: SyncOperationKind
  payload: Record<string, unknown>
  fieldClocks: Record<string, string>
  dependsOn: string[]
  status: SyncOperationStatus
  sequence: number
  attempts: number
  nextAttemptAt: number
  createdAt: string
  error?: string
}

export interface SyncResource<T = Record<string, any>> {
  resource: string
  id: string
  revision: number
  fieldClocks: Record<string, string>
  deleted: boolean
  data?: T
}

export interface LocalSyncResource<T = Record<string, any>> extends SyncResource<T> {
  key: string
  accountId: string
  locallyModified: boolean
}

export interface SyncAcknowledgement {
  operationId: string
  status: 'applied' | 'merged' | 'duplicate' | 'rejected'
  resource?: SyncResource
  replacementId?: string
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export interface SyncBootstrapResponse {
  watermark: number
  nextPageToken: string | null
  resources: SyncResource[]
  protocolVersion: number
}

export interface SyncExchangeResponse {
  cursor: number
  hasMore: boolean
  serverTime: string
  authToken?: string
  syncUrl?: string
  acknowledgements: SyncAcknowledgement[]
  changes: SyncResource[]
  resetRequired: boolean
  protocolVersion: number
}

export interface SyncMetadata {
  accountId: string
  clientId: string
  cursor: number
  bootstrapped: boolean
  lastSyncedAt: string
  serverTime: string
  authToken?: string
  syncUrl?: string
}

export interface SyncIssue {
  id: string
  accountId: string
  operationId: string
  resource: string
  recordId?: string
  message: string
  details: Record<string, unknown>
  createdAt: string
  resolved: 0 | 1
}

export interface SyncStatusSnapshot {
  phase: SyncPhase
  pendingCount: number
  issueCount: number
  lastSyncedAt: string
  message: string
}
