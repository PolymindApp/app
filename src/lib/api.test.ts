import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const futureToken = () => {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('Mom API client adapter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('authenticates and persists the bearer token', async () => {
    const token = futureToken()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      token,
      record: { id: 'user-1', email: 'person@example.com', name: 'Person' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await api.collection('users').authWithPassword('person@example.com', 'password123')

    expect(api.authStore.isValid).toBe(true)
    expect(api.authStore.record?.id).toBe('user-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'person@example.com', password: 'password123' }),
    }))
    expect(localStorage.getItem('mom-api-auth')).toContain(token)
  })

  it('completes a passkey login and persists the returned session', async () => {
    const token = futureToken()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ceremonyId: 'ceremony-1',
        requestJson: '{"challenge":"challenge-1"}',
      }))
      .mockResolvedValueOnce(jsonResponse({
        token,
        record: { id: 'user-1', email: 'person@example.com', name: 'Person' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    const options = await api.beginPasskeyLogin()
    await api.finishPasskeyLogin(options.ceremonyId, {
      id: 'credential-1',
      type: 'public-key',
    })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/passkeys/login/options', expect.objectContaining({
      method: 'POST',
      body: '{}',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/passkeys/login/verify', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        ceremonyId: 'ceremony-1',
        credential: { id: 'credential-1', type: 'public-key' },
      }),
    }))
    expect(api.authStore.isValid).toBe(true)
    expect(localStorage.getItem('mom-api-auth')).toContain(token)
  })

  it('paginates getFullList calls and sends the bearer token', async () => {
    const token = futureToken()
    localStorage.setItem('mom-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com' },
    }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        page: 1,
        perPage: 200,
        totalItems: 2,
        totalPages: 2,
        items: [{ id: 'task-1' }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        page: 2,
        perPage: 200,
        totalItems: 2,
        totalPages: 2,
        items: [{ id: 'task-2' }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    const records = await api.collection('tasks').getFullList({ sort: 'sort_order' })

    expect(records.map((record) => record.id)).toEqual(['task-1', 'task-2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, firstOptions] = fetchMock.mock.calls[0]
    expect((firstOptions.headers as Headers).get('Authorization')).toBe(`Bearer ${token}`)
  })

  it('clears local authentication after an unauthorized response', async () => {
    const token = futureToken()
    localStorage.setItem('mom-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com' },
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      message: 'The authentication token is invalid.',
      details: {},
    }, 401)))

    const { ApiError, api } = await import('./api')
    await expect(api.collection('tasks').getList()).rejects.toBeInstanceOf(ApiError)
    expect(api.authStore.isValid).toBe(false)
    expect(localStorage.getItem('mom-api-auth')).toBeNull()
  })
})
