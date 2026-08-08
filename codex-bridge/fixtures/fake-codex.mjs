import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const home = process.env.CODEX_HOME
if (!home) throw new Error('CODEX_HOME is required.')
mkdirSync(home, { recursive: true })
const accountPath = join(home, 'fake-account.json')

function connectedAccount() {
  try {
    return JSON.parse(readFileSync(accountPath, 'utf8'))
  } catch {
    return null
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake-codex' } })
    return
  }
  if (message.method === 'initialized') return
  if (message.method === 'account/read') {
    send({
      id: message.id,
      result: { account: connectedAccount(), requiresOpenaiAuth: true },
    })
    return
  }
  if (message.method === 'account/login/start') {
    const result = {
      type: 'chatgptDeviceCode',
      loginId: 'login-test',
      verificationUrl: 'https://auth.openai.com/codex/device',
      userCode: 'MOM-TEST',
    }
    send({ id: message.id, result })
    if (process.env.FAKE_CODEX_AUTO_COMPLETE === '1') {
      setTimeout(() => {
        writeFileSync(accountPath, JSON.stringify({
          type: 'chatgpt',
          email: 'person@example.com',
          planType: 'plus',
        }))
        send({
          method: 'account/login/completed',
          params: { loginId: result.loginId, success: true, error: null },
        })
      }, 40)
    }
    return
  }
  if (message.method === 'account/login/cancel') {
    send({ id: message.id, result: {} })
    return
  }
  if (message.method === 'account/logout') {
    writeFileSync(accountPath, 'null')
    send({ id: message.id, result: {} })
    return
  }
  send({ id: message.id, error: { code: -32601, message: 'Unknown method.' } })
})
