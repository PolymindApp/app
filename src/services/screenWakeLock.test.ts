import { beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorMocks = vi.hoisted(() => ({
  acquire: vi.fn(async (_options: { token: string }) => undefined),
  release: vi.fn(async (_options: { token: string }) => undefined),
  getPlatform: vi.fn(() => 'web'),
  isNativePlatform: vi.fn(() => false),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: capacitorMocks.getPlatform,
    isNativePlatform: capacitorMocks.isNativePlatform,
  },
  registerPlugin: () => ({
    acquire: capacitorMocks.acquire,
    release: capacitorMocks.release,
  }),
}))

beforeEach(() => {
  vi.resetModules()
  capacitorMocks.acquire.mockReset().mockResolvedValue(undefined)
  capacitorMocks.release.mockReset().mockResolvedValue(undefined)
  capacitorMocks.getPlatform.mockReset().mockReturnValue('web')
  capacitorMocks.isNativePlatform.mockReset().mockReturnValue(false)
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: undefined,
  })
})

describe('screen wake lock', () => {
  it('uses the browser Screen Wake Lock API when available', async () => {
    const release = vi.fn(async () => undefined)
    const request = vi.fn(async () => ({ release }))
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    })
    const { requestScreenWakeLock } = await import('./screenWakeLock')

    const lock = await requestScreenWakeLock()

    expect(request).toHaveBeenCalledWith('screen')
    await lock?.release()
    expect(release).toHaveBeenCalledOnce()
  })

  it('uses the native Android window flag and releases each lock once', async () => {
    capacitorMocks.getPlatform.mockReturnValue('android')
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    const { requestScreenWakeLock } = await import('./screenWakeLock')

    const lock = await requestScreenWakeLock()
    const token = capacitorMocks.acquire.mock.calls[0]?.[0].token

    expect(token).toMatch(/^screen-/)
    await lock?.release()
    await lock?.release()
    expect(capacitorMocks.release).toHaveBeenCalledOnce()
    expect(capacitorMocks.release).toHaveBeenCalledWith({ token })
  })

  it('falls back to the browser API if the Android bridge is unavailable', async () => {
    capacitorMocks.getPlatform.mockReturnValue('android')
    capacitorMocks.isNativePlatform.mockReturnValue(true)
    capacitorMocks.acquire.mockRejectedValueOnce(new Error('Bridge unavailable'))
    const request = vi.fn(async () => ({ release: vi.fn(async () => undefined) }))
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    })
    const { requestScreenWakeLock } = await import('./screenWakeLock')

    await expect(requestScreenWakeLock()).resolves.toBeDefined()
    expect(request).toHaveBeenCalledWith('screen')
  })
})
