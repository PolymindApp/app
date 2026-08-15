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

describe('BackOnTrack API client adapter', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not prefix an already resolved API asset URL again', async () => {
    const { apiAssetUrl } = await import('./api')

    expect(apiAssetUrl('/api/flashcard-images/card-1.jpg'))
      .toBe('/api/flashcard-images/card-1.jpg')
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
    expect(localStorage.getItem('backontrack-api-auth')).toContain(token)
  })

  it('runs the email confirmation and password recovery requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        message: 'Check your email to confirm your account.',
        email: 'person@example.com',
      }, 201))
      .mockResolvedValueOnce(jsonResponse({ message: 'Your email is confirmed.' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'A new confirmation is on its way.' }, 202))
      .mockResolvedValueOnce(jsonResponse({ message: 'A reset link is on its way.' }, 202))
      .mockResolvedValueOnce(jsonResponse({ message: 'Your password has been reset.' }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await api.registerAccount('Person', 'person@example.com', 'password123', 'America/Toronto')
    await api.verifyEmail('a'.repeat(64))
    await api.resendEmailVerification('person@example.com')
    await api.requestPasswordReset('person@example.com')
    api.authStore.save(futureToken(), {
      id: 'user-1',
      email: 'person@example.com',
    })
    await api.resetPassword('b'.repeat(64), 'new-password123')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/register', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        name: 'Person',
        email: 'person@example.com',
        password: 'password123',
        passwordConfirm: 'password123',
        timezone: 'America/Toronto',
      }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/email-verification', expect.objectContaining({
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/auth/email-verification/resend', expect.objectContaining({
      body: JSON.stringify({ email: 'person@example.com' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/auth/password/forgot', expect.objectContaining({
      body: JSON.stringify({ email: 'person@example.com' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/auth/password/reset', expect.objectContaining({
      body: JSON.stringify({
        token: 'b'.repeat(64),
        password: 'new-password123',
        passwordConfirm: 'new-password123',
      }),
    }))
    expect(api.authStore.record).toBeNull()
    expect(localStorage.getItem('backontrack-api-auth')).toBeNull()
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
    expect(localStorage.getItem('backontrack-api-auth')).toContain(token)
  })

  it('gets the authenticated user passkey registration status', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com' },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ registered: true }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.getPasskeyStatus()).resolves.toEqual({ registered: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/passkeys/status', expect.objectContaining({
      headers: expect.any(Headers),
    }))
    const [, options] = fetchMock.mock.calls[0]
    expect((options.headers as Headers).get('Authorization')).toBe(`Bearer ${token}`)
  })

  it('disconnects the authenticated user biometric credentials', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com' },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      registered: false,
      removed: 1,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.removePasskeys()).resolves.toEqual({
      registered: false,
      removed: 1,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/passkeys', expect.objectContaining({
      method: 'DELETE',
      headers: expect.any(Headers),
    }))
    const [, options] = fetchMock.mock.calls[0]
    expect((options.headers as Headers).get('Authorization')).toBe(`Bearer ${token}`)
  })

  it('updates the account name and refreshes the persisted auth record', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com', name: 'Person' },
    }))
    const updatedRecord = {
      id: 'user-1',
      email: 'person@example.com',
      name: 'Updated Person',
      updated: '2026-07-30T12:00:00.000Z',
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(updatedRecord))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.updateAccount('Updated Person')).resolves.toEqual(updatedRecord)
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/account', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Person' }),
    }))
    expect(api.authStore.record?.name).toBe('Updated Person')
    expect(JSON.parse(localStorage.getItem('backontrack-api-auth') || '{}').record.name)
      .toBe('Updated Person')
  })

  it('updates user settings and refreshes the persisted auth record', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com', settings: {} },
    }))
    const quickInterval = {
      warmupSeconds: 0,
      workSeconds: 30,
      restSeconds: 15,
      rounds: 4,
      cooldownSeconds: 0,
      restAfterLastRound: true,
      includeRest: true,
      cues: { soundEnabled: true, vibrationEnabled: false },
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      settings: { quickInterval },
      updated: '2026-07-30T12:00:00.000Z',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await expect(api.updateUserSettings({ quickInterval }))
      .resolves.toEqual({ quickInterval })
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ quickInterval }),
    }))
    expect(api.authStore.record?.settings).toEqual({ quickInterval })
    expect(JSON.parse(localStorage.getItem('backontrack-api-auth') || '{}').record.settings)
      .toEqual({ quickInterval })
  })

  it('paginates getFullList calls and sends the bearer token', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
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

  it('leaves interval flashcard snapshot generation to the server for remote creates', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
      token,
      record: { id: 'user-1', email: 'person@example.com' },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'session-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await api.collection('interval_sessions').create({
      template: 'template-1',
      flashcard_snapshot: { cards: [{ id: 'card-1' }] },
    })

    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body as string)).toEqual({ template: 'template-1' })
  })

  it('persists excluded cards with Review set preferences', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
      token,
      record: { id: 'review-preference-user', email: 'person@example.com' },
    }))
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'set-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const { api } = await import('./api')
    await api.updateFlashcardReviewSetPreferences('set-1', {
      mode: 'manual',
      cardSides: 'both',
      indefinite: false,
      maxCards: 20,
      frontSeconds: 5,
      backSeconds: 5,
      backSpeechRepeatCount: 1,
      noteBeforeBack: false,
      speechEnabled: false,
      frontLanguage: '',
      backLanguage: '',
      sortMode: 'difficult',
      excludedCards: ['card-2', 'card-9'],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/flashcard-review-sets/set-1/preferences',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"excluded_cards":["card-2","card-9"]'),
      }),
    )
  })

  it('expires the remote token but preserves the cached offline account after an unauthorized response', async () => {
    const token = futureToken()
    localStorage.setItem('backontrack-api-auth', JSON.stringify({
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
    expect(JSON.parse(localStorage.getItem('backontrack-api-auth') || '{}')).toEqual({
      token: '',
      record: { id: 'user-1', email: 'person@example.com', avatar: '' },
    })
  })
})
