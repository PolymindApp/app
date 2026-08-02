import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/backgroundInterval', () => ({
  nativeBackgroundIntervalOwnsCues: () => false,
}))

const audioContexts: FakeAudioContext[] = []

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  destination = {}
  decodeAudioData = vi.fn(async () => ({} as AudioBuffer))
  resume = vi.fn(async () => {
    this.state = 'running'
  })

  constructor() {
    audioContexts.push(this)
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  audioContexts.length = 0
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })))
})

describe('interval cue audio', () => {
  it('preloads and decodes each cue once, including concurrent requests', async () => {
    const { preloadIntervalCueAudio } = await import('./intervalCues')

    await Promise.all([preloadIntervalCueAudio(), preloadIntervalCueAudio()])
    await preloadIntervalCueAudio()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith('/sounds/count.mp3')
    expect(fetch).toHaveBeenCalledWith('/sounds/go.mp3')
    expect(audioContexts).toHaveLength(1)
    expect(audioContexts[0].decodeAudioData).toHaveBeenCalledTimes(2)
  })

  it('resumes the preloaded audio context when interval cues are prepared', async () => {
    const { preloadIntervalCueAudio, prepareIntervalCues } = await import('./intervalCues')

    await preloadIntervalCueAudio()
    await prepareIntervalCues({ soundEnabled: true, vibrationEnabled: false })

    expect(audioContexts).toHaveLength(1)
    expect(audioContexts[0].resume).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
