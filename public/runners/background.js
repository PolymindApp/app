const STAGED_SYNC_KEY = 'backontrack.background-sync'

addEventListener('stageSync', (resolve, reject, args) => {
  try {
    CapacitorKV.set(STAGED_SYNC_KEY, JSON.stringify(args || {}))
    resolve()
  } catch (error) {
    reject(error)
  }
})

addEventListener('clearSync', (resolve) => {
  CapacitorKV.remove(STAGED_SYNC_KEY)
  resolve()
})

addEventListener('backgroundSync', async (resolve) => {
  try {
    const network = await CapacitorDevice.getNetworkStatus()
    if (!network.connected) {
      resolve()
      return
    }
    const stored = CapacitorKV.get(STAGED_SYNC_KEY)
    const staged = stored?.value ? JSON.parse(stored.value) : undefined
    if (!staged?.url || !staged?.token || !staged?.clientId) {
      resolve()
      return
    }
    const operations = Array.isArray(staged.operations) ? staged.operations : []
    if (!operations.length) {
      if (CapacitorKV.get(STAGED_SYNC_KEY)?.value === stored.value) {
        CapacitorKV.remove(STAGED_SYNC_KEY)
      }
      resolve()
      return
    }
    const response = await fetch(staged.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staged.token}`,
      },
      body: JSON.stringify({
        clientId: staged.clientId,
        cursor: Number(staged.cursor || 0),
        operations,
      }),
    })
    const terminalFailure = response.status >= 400
      && response.status < 500
      && response.status !== 408
      && response.status !== 429
    if ((response.ok || terminalFailure)
      && CapacitorKV.get(STAGED_SYNC_KEY)?.value === stored.value) {
      CapacitorKV.remove(STAGED_SYNC_KEY)
    }
    resolve()
  } catch {
    // The same idempotent batch remains staged for a later OS opportunity.
    resolve()
  }
})
