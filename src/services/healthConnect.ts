import { Capacitor, registerPlugin } from '@capacitor/core'
import { format, parseISO } from 'date-fns'
import type { StepSource } from '@/types/domain'

export type HealthConnectAvailability = 'available' | 'update_required' | 'unavailable'

export interface HealthConnectStatus {
  availability: HealthConnectAvailability
  authorized: boolean
}

interface HealthConnectPlugin {
  getStatus(): Promise<HealthConnectStatus>
  requestPermissions(): Promise<{ authorized: boolean }>
  readSteps(options: { startTime: string; endTime: string }): Promise<{ steps: number }>
  openSettings(): Promise<void>
}

export type HealthConnectErrorCode =
  | 'HEALTH_CONNECT_UNAVAILABLE'
  | 'HEALTH_CONNECT_UPDATE_REQUIRED'
  | 'HEALTH_CONNECT_PERMISSION_REQUIRED'
  | 'HEALTH_CONNECT_READ_FAILED'

export class HealthConnectError extends Error {
  constructor(
    message: string,
    public readonly code: HealthConnectErrorCode,
  ) {
    super(message)
    this.name = 'HealthConnectError'
  }
}

const nativeHealthConnect = registerPlugin<HealthConnectPlugin>('HealthConnect')
const stepCountCache = new Map<string, { value: number; loadedAt: number }>()
const CURRENT_DAY_CACHE_MS = 60_000

export const DEFAULT_STEP_SOURCE: StepSource = 'health_connect'

export function normalizeStepSource(value: unknown): StepSource {
  return value === 'health_connect' ? value : DEFAULT_STEP_SOURCE
}

export function healthConnectDayRange(date: Date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

export function isNativeHealthConnectSupported() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()
}

export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  if (!isNativeHealthConnectSupported()) {
    return { availability: 'unavailable', authorized: false }
  }
  return nativeHealthConnect.getStatus()
}

export async function requestHealthConnectPermission() {
  if (!isNativeHealthConnectSupported()) {
    throw new HealthConnectError(
      'Health Connect is available only in the Android app.',
      'HEALTH_CONNECT_UNAVAILABLE',
    )
  }
  return nativeHealthConnect.requestPermissions()
}

export async function openHealthConnectSettings() {
  if (!isNativeHealthConnectSupported()) return
  await nativeHealthConnect.openSettings()
}

export async function readHealthConnectSteps(date: Date): Promise<number> {
  if (!isNativeHealthConnectSupported()) {
    throw new HealthConnectError(
      'Open BackOnTrack on a supported Android device to load steps from Health Connect.',
      'HEALTH_CONNECT_UNAVAILABLE',
    )
  }

  const { start, end } = healthConnectDayRange(date)
  try {
    const result = await nativeHealthConnect.readSteps({
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    })
    return Math.max(0, Math.round(Number(result.steps) || 0))
  } catch (cause) {
    throw normalizeHealthConnectError(cause)
  }
}

export async function readHealthConnectStepsForDates(dateKeys: string[]): Promise<Record<string, number>> {
  const keys = [...new Set(dateKeys)].sort()
  const today = format(new Date(), 'yyyy-MM-dd')
  const result: Record<string, number> = {}
  const missing = keys.filter((date) => {
    const cached = stepCountCache.get(date)
    const cacheValid = cached && (date !== today || Date.now() - cached.loadedAt < CURRENT_DAY_CACHE_MS)
    if (cacheValid) result[date] = cached.value
    return !cacheValid
  })
  let nextIndex = 0

  async function loadNext() {
    while (nextIndex < missing.length) {
      const date = missing[nextIndex++]!
      const value = await readHealthConnectSteps(parseISO(date))
      result[date] = value
      stepCountCache.set(date, { value, loadedAt: Date.now() })
    }
  }

  const workerCount = Math.min(4, missing.length)
  await Promise.all(Array.from({ length: workerCount }, () => loadNext()))
  return result
}

function normalizeHealthConnectError(cause: unknown): HealthConnectError {
  if (cause instanceof HealthConnectError) return cause
  const code = cause && typeof cause === 'object' && 'code' in cause
    ? String(cause.code)
    : ''
  if (code === 'HEALTH_CONNECT_PERMISSION_REQUIRED') {
    return new HealthConnectError(
      'Connect Health Connect in Settings to load your steps.',
      'HEALTH_CONNECT_PERMISSION_REQUIRED',
    )
  }
  if (code === 'HEALTH_CONNECT_UPDATE_REQUIRED') {
    return new HealthConnectError(
      'Install or update Health Connect to load your steps.',
      'HEALTH_CONNECT_UPDATE_REQUIRED',
    )
  }
  if (code === 'HEALTH_CONNECT_UNAVAILABLE') {
    return new HealthConnectError(
      'Health Connect is not available on this device.',
      'HEALTH_CONNECT_UNAVAILABLE',
    )
  }
  const message = cause instanceof Error && cause.message
    ? cause.message
    : 'BackOnTrack could not read your steps from Health Connect.'
  return new HealthConnectError(message, 'HEALTH_CONNECT_READ_FAILED')
}
