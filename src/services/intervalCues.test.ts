import { beforeEach, describe, expect, it, vi } from 'vitest'

const backgroundIntervalMocks = vi.hoisted(() => ({
  nativeBackgroundIntervalOwnsCues: vi.fn(() => false),
  playNativeIntervalCue: vi.fn(async () => false),
}))

vi.mock('@/services/backgroundInterval', () => backgroundIntervalMocks)

const audioContexts: FakeAudioContext[] = []

class FakeAudioContext {
  state: AudioContextState = 'suspended'
  destination = {}
  sources: Array<{
    buffer: AudioBuffer | null
    connect: ReturnType<typeof vi.fn>
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    onended?: () => void
  }> = []
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({
    marker: new Uint8Array(data)[0],
  } as unknown as AudioBuffer))
  createBufferSource = vi.fn(() => {
    const source = {
      buffer: null as AudioBuffer | null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
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
  backgroundIntervalMocks.nativeBackgroundIntervalOwnsCues.mockReset().mockReturnValue(false)
  backgroundIntervalMocks.playNativeIntervalCue.mockReset().mockResolvedValue(false)
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: undefined,
  })
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })))
})

describe('interval cue audio', () => {
  it('requests a screen wake lock when the device supports it', async () => {
    const release = vi.fn(async () => undefined)
    const request = vi.fn(async () => ({ release }))
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    })
    const { requestIntervalWakeLock } = await import('./intervalCues')

    await expect(requestIntervalWakeLock()).resolves.toEqual({ release })
    expect(request).toHaveBeenCalledWith('screen')
  })

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

  it('uses the native cue player for interval signals when Android accepts the cue', async () => {
    backgroundIntervalMocks.playNativeIntervalCue.mockResolvedValue(true)
    const { playIntervalGoCue } = await import('./intervalCues')

    playIntervalGoCue({ soundEnabled: true, vibrationEnabled: false })

    await vi.waitFor(() => expect(backgroundIntervalMocks.playNativeIntervalCue).toHaveBeenCalledWith('go'))
    expect(audioContexts).toHaveLength(0)
  })

  it('plays the sound assigned to the interval type', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const marker = String(input).includes('complete') ? 3 : String(input).includes('go') ? 2 : 1
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([marker]).buffer,
      } as Response
    })
    const { playIntervalGoCue } = await import('./intervalCues')

    playIntervalGoCue({
      soundEnabled: true,
      vibrationEnabled: false,
      typeSounds: {
        train: 'go',
        work: 'go',
        rest: 'complete',
        prepare: 'go',
        meditation: 'go',
        confirmation: 'go',
        custom: 'go',
      },
    }, 'rest')

    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
    expect(audioContexts[0].sources[0].buffer).toMatchObject({ marker: 3 })
  })

  it('treats an assigned Countdown cue as a transition signal on Android', async () => {
    backgroundIntervalMocks.playNativeIntervalCue.mockResolvedValue(true)
    const { playIntervalGoCue } = await import('./intervalCues')

    playIntervalGoCue({
      soundEnabled: true,
      vibrationEnabled: false,
      typeSounds: {
        train: 'go',
        work: 'count',
        rest: 'go',
        prepare: 'go',
        meditation: 'go',
        confirmation: 'go',
        custom: 'go',
      },
    }, 'work')

    await vi.waitFor(() => expect(backgroundIntervalMocks.playNativeIntervalCue)
      .toHaveBeenCalledWith('count', true))
  })

  it('keeps a type silent when its assigned sound is None', async () => {
    const { playIntervalGoCue } = await import('./intervalCues')

    playIntervalGoCue({
      soundEnabled: true,
      vibrationEnabled: false,
      typeSounds: {
        train: 'go',
        work: 'go',
        rest: 'go',
        prepare: 'go',
        meditation: 'none',
        confirmation: 'go',
        custom: 'go',
      },
    }, 'meditation')
    await Promise.resolve()

    expect(backgroundIntervalMocks.playNativeIntervalCue).not.toHaveBeenCalled()
    expect(audioContexts).toHaveLength(0)
  })

  it('falls back to Web Audio when the Android cue bridge rejects the request', async () => {
    backgroundIntervalMocks.playNativeIntervalCue.mockRejectedValue(new Error('Bridge unavailable'))
    const { playIntervalCompleteCue } = await import('./intervalCues')

    playIntervalCompleteCue({ soundEnabled: true, vibrationEnabled: false })

    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
  })

  it('gives the final signal priority over a countdown sound still playing', async () => {
    const { playIntervalCompleteCue, playIntervalCountCue } = await import('./intervalCues')
    const cues = { soundEnabled: true, vibrationEnabled: false }

    playIntervalCountCue(cues)
    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
    playIntervalCompleteCue(cues)
    await vi.waitFor(() => expect(audioContexts[0]?.sources[1]?.start).toHaveBeenCalledOnce())

    expect(audioContexts[0].sources[0].stop).toHaveBeenCalledOnce()
    expect(audioContexts[0].sources[1].stop).not.toHaveBeenCalled()
  })

  it('does not let a countdown sound overlap a terminal signal', async () => {
    const { playIntervalCountCue, playIntervalGoCue } = await import('./intervalCues')
    const cues = { soundEnabled: true, vibrationEnabled: false }

    playIntervalGoCue(cues)
    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
    playIntervalCountCue(cues)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/sounds/count.mp3'))

    expect(audioContexts[0].sources).toHaveLength(1)
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

  it('prepares and plays the completion sound for a task time target', async () => {
    const { playTaskCompleteCue, prepareTaskCompleteCue } = await import('./intervalCues')

    await prepareTaskCompleteCue()
    playTaskCompleteCue()

    await vi.waitFor(() => expect(audioContexts[0]?.sources[0]?.start).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith('/sounds/complete.mp3')
    expect(audioContexts[0].resume).toHaveBeenCalledOnce()
  })
})
