const STAGED_SYNC_KEY = 'polymind.background-sync'

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
    await fetch(staged.url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${staged.token}`,
      },
      body: JSON.stringify({
        clientId: staged.clientId,
        cursor: Number(staged.cursor || 0),
        operations: Array.isArray(staged.operations) ? staged.operations : [],
      }),
    })
    resolve()
  } catch {
    // The same idempotent batch remains staged for a later OS opportunity.
    resolve()
  }
})
