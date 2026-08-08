import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { CodexSession, CodexSessionPool, createBridgeServer } from './server.mjs'

const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url))
const subject = 'a'.repeat(64)

async function eventually(assertion) {
  let lastError
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      return await assertion()
    } catch (cause) {
      lastError = cause
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  throw lastError
}

test('manages ChatGPT device-code authentication through Codex App Server', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'mom-codex-session-'))
  const session = new CodexSession({
    subject,
    executable: process.execPath,
    executableArgs: [fixture],
    dataRoot,
    environment: { FAKE_CODEX_AUTO_COMPLETE: '1' },
  })
  t.after(async () => {
    session.close()
    await rm(dataRoot, { recursive: true, force: true })
  })

  assert.deepEqual(await session.status(), { available: true, connected: false })
  const login = await session.startLogin()
  assert.equal(login.pending, true)
  assert.equal(login.userCode, 'MOM-TEST')
  assert.equal(login.verificationUrl, 'https://auth.openai.com/codex/device')

  await eventually(async () => {
    const status = await session.status()
    assert.equal(status.connected, true)
    assert.equal(status.email, 'person@example.com')
    assert.equal(status.planType, 'plus')
  })

  assert.deepEqual(await session.disconnect(), { available: true, connected: false })
})

test('protects the bridge HTTP contract with its shared bearer token', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'mom-codex-bridge-'))
  const token = 'test-bridge-token-at-least-32-characters'
  const pool = new CodexSessionPool({
    executable: process.execPath,
    executableArgs: [fixture],
    dataRoot,
    environment: { FAKE_CODEX_AUTO_COMPLETE: '0' },
    idleTimeoutMs: 30_000,
  })
  const server = createBridgeServer({ token, pool })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  t.after(async () => {
    pool.closeAll()
    await new Promise(resolveClose => server.close(resolveClose))
    await rm(dataRoot, { recursive: true, force: true })
  })

  assert.equal((await fetch(`${baseUrl}/health`)).status, 200)
  assert.equal((await fetch(`${baseUrl}/v1/connections/${subject}`)).status, 401)

  const response = await fetch(`${baseUrl}/v1/connections/${subject}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { available: true, connected: false })
})
