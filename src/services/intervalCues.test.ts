import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/backgroundInterval', () => ({
  nativeBackgroundIntervalOwnsCues: () => false,
}))

const audioContexts: FakeAudioContext[] = []

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  destination = {}
  sources: Array<{
    buffer: AudioBuffer | null
    connect: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
  }> = []
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({
    marker: new Uint8Array(data)[0],
  } as unknown as AudioBuffer))
  createBufferSource = vi.fn(() => {
    const source = {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(),
    }
    this.sources.push(source)
    return source
  })
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

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch).toHaveBeenCalledWith('/sounds/count.mp3')
    expect(fetch).toHaveBeenCalledWith('/sounds/go.mp3')
    expect(fetch).toHaveBeenCalledWith('/sounds/complete.mp3')
    expect(audioContexts).toHaveLength(1)
    expect(audioContexts[0].decodeAudioData).toHaveBeenCalledTimes(3)
  })

  it('resumes the preloaded audio context when interval cues are prepared', async () => {
    const { preloadIntervalCueAudio, prepareIntervalCues } = await import('./intervalCues')

    await preloadIntervalCueAudio()
    await prepareIntervalCues({ soundEnabled: true, vibrationEnabled: false })

    expect(audioContexts).toHaveLength(1)
    expect(audioContexts[0].resume).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('plays the completion sound for the terminal interval cue', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const marker = String(input).includes('complete') ? 3 : String(input).includes('go') ? 2 : 1
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([marker]).buffer,
      } as Response
    })
    const { playIntervalCompleteCue } = await import('./intervalCues')

    playIntervalCompleteCue({ soundEnabled: true, vibrationEnabled: false })

    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
    expect(audioContexts[0].sources[0].buffer).toMatchObject({ marker: 3 })
  })

  it('plays the completion sound for a completed review set', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const marker = String(input).includes('complete') ? 3 : 1
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([marker]).buffer,
      } as Response
    })
    const { playReviewCompleteCue } = await import('./intervalCues')

    playReviewCompleteCue()

    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
    expect(audioContexts[0].sources[0].buffer).toMatchObject({ marker: 3 })
  })
})
