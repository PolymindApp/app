import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'web'),
  native: vi.fn(() => false),
  set: vi.fn(async (_options: { value: string }) => undefined),
  clear: vi.fn(async () => undefined),
  dispatchEvent: vi.fn(async () => undefined),
  registerPlugin: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: mocks.platform,
    isNativePlatform: mocks.native,
  },
  registerPlugin: mocks.registerPlugin,
}))

vi.mock('@capacitor/background-runner', () => ({
  BackgroundRunner: { dispatchEvent: mocks.dispatchEvent },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.platform.mockReset().mockReturnValue('web')
  mocks.native.mockReset().mockReturnValue(false)
  mocks.set.mockReset().mockResolvedValue(undefined)
  mocks.clear.mockReset().mockResolvedValue(undefined)
  mocks.dispatchEvent.mockReset().mockResolvedValue(undefined)
  mocks.registerPlugin.mockReset().mockReturnValue({ set: mocks.set, clear: mocks.clear })
})

describe('background sync staging', () => {
  it('writes Android stages directly without executing the background runner', async () => {
    mocks.platform.mockReturnValue('android')
    mocks.native.mockReturnValue(true)
    const { writeBackgroundSyncStage } = await import('./backgroundSyncStage')
    const details = {
      url: '/sync/exchange',
      cursor: 12,
      operations: [{ operationId: 'operation-1' }],
    }

    await writeBackgroundSyncStage(details)
    await writeBackgroundSyncStage(details)

    expect(mocks.registerPlugin).toHaveBeenCalledWith('BackgroundSyncStage')
    expect(mocks.set).toHaveBeenCalledOnce()
    expect(mocks.set).toHaveBeenCalledWith({ value: JSON.stringify(details) })
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  it('clears a native stage when foreground synchronization drains the outbox', async () => {
    mocks.platform.mockReturnValue('android')
    mocks.native.mockReturnValue(true)
    const { writeBackgroundSyncStage } = await import('./backgroundSyncStage')

    await writeBackgroundSyncStage({ url: '/sync/exchange', cursor: 12, operations: [] })

    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  it('clears the Android stage directly', async () => {
    mocks.platform.mockReturnValue('android')
    mocks.native.mockReturnValue(true)
    const { removeBackgroundSyncStage } = await import('./backgroundSyncStage')

    await removeBackgroundSyncStage()

    expect(mocks.clear).toHaveBeenCalledOnce()
    expect(mocks.dispatchEvent).not.toHaveBeenCalled()
  })

  it('keeps the background runner staging path for other native platforms', async () => {
    mocks.platform.mockReturnValue('ios')
    mocks.native.mockReturnValue(true)
    const { writeBackgroundSyncStage } = await import('./backgroundSyncStage')
    const details = { cursor: 3 }

    await writeBackgroundSyncStage(details)

    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.dispatchEvent).toHaveBeenCalledWith({
      label: 'app.polymind.sync',
      event: 'stageSync',
      details,
    })
  })
})
