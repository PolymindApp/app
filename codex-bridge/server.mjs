import { timingSafeEqual } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const SUBJECT_PATTERN = /^[a-f0-9]{64}$/
const LOGIN_MAX_AGE_MS = 15 * 60 * 1000

function asError(cause, fallback) {
  return cause instanceof Error ? cause : new Error(fallback)
}

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

function authorized(header, expectedToken) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice(7))
  const expected = Buffer.from(expectedToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function safeHttpsUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null
    return url.href
  } catch {
    return null
  }
}

export class CodexSession {
  constructor({
    subject,
    executable,
    executableArgs = [],
    dataRoot,
    environment = {},
    requestTimeoutMs = 15_000,
  }) {
    if (!SUBJECT_PATTERN.test(subject)) throw new Error('Invalid Codex account subject.')
    this.subject = subject
    this.executable = executable
    this.executableArgs = executableArgs
    this.home = resolve(dataRoot, subject)
    this.environment = environment
    this.requestTimeoutMs = requestTimeoutMs
    this.nextRequestId = 1
    this.pendingRequests = new Map()
    this.login = null
    this.loginCompletion = null
    this.loginError = ''
    this.started = null
    this.process = null
    this.stdoutBuffer = ''
  }

  async start() {
    if (this.started) return this.started
    this.started = this.#start()
    try {
      await this.started
    } catch (cause) {
      this.started = null
      throw cause
    }
  }

  async #start() {
    await mkdir(this.home, { recursive: true, mode: 0o700 })
    this.stdoutBuffer = ''
    this.process = spawn(
      this.executable,
      [
        ...this.executableArgs,
        'app-server',
        '--listen',
        'stdio://',
        '--session-source',
        'polymind',
      ],
      {
        env: {
          ...process.env,
          ...this.environment,
          CODEX_HOME: this.home,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', chunk => this.#consumeOutput(chunk))
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', () => {})
    this.process.once('error', cause => this.#fail(cause))
    this.process.once('exit', (code, signal) => {
      this.#fail(new Error(`Codex App Server exited (${signal || code || 'unknown'}).`))
    })

    await this.#request('initialize', {
      clientInfo: {
        name: 'polymind',
        title: 'Polymind',
        version: '0.3.0',
      },
    })
    this.#send({ method: 'initialized', params: {} })
  }

  async status() {
    await this.start()
    const result = await this.#request('account/read', { refreshToken: false })
    const account = result?.account
    const connected = account?.type === 'chatgpt'
    if (connected) {
      this.login = null
      this.loginError = ''
    }
    return {
      available: true,
      connected,
      ...(connected && typeof account.email === 'string' && account.email
        ? { email: account.email }
        : {}),
      ...(connected && typeof account.planType === 'string' && account.planType
        ? { planType: account.planType }
        : {}),
      ...(!connected && this.login
        ? {
            pending: true,
            loginId: this.login.loginId,
            verificationUrl: this.login.verificationUrl,
            userCode: this.login.userCode,
          }
        : {}),
      ...(!connected && this.loginError ? { loginError: this.loginError } : {}),
    }
  }

  async startLogin() {
    const status = await this.status()
    if (status.connected || status.pending) return status
    this.loginError = ''
    const result = await this.#request('account/login/start', {
      type: 'chatgptDeviceCode',
    })
    const verificationUrl = safeHttpsUrl(result?.verificationUrl)
    if (
      result?.type !== 'chatgptDeviceCode'
      || typeof result.loginId !== 'string'
      || !verificationUrl
      || typeof result.userCode !== 'string'
    ) {
      throw new Error('Codex App Server returned an invalid login response.')
    }
    this.login = {
      loginId: result.loginId,
      verificationUrl,
      userCode: result.userCode,
      startedAt: Date.now(),
    }
    this.#consumeLoginCompletion()
    return this.status()
  }

  async disconnect() {
    await this.start()
    if (this.login) {
      try {
        await this.#request('account/login/cancel', { loginId: this.login.loginId })
      } catch {
        // Logging out below remains the authoritative cleanup operation.
      }
    }
    await this.#request('account/logout')
    this.login = null
    this.loginCompletion = null
    this.loginError = ''
    return { available: true, connected: false }
  }

  close() {
    if (!this.process) return
    this.process.removeAllListeners('exit')
    this.process.kill('SIGTERM')
    this.#fail(new Error('Codex App Server session closed.'))
  }

  #request(method, params) {
    if (!this.process?.stdin.writable) {
      return Promise.reject(new Error('Codex App Server is unavailable.'))
    }
    const id = this.nextRequestId++
    return new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        rejectRequest(new Error(`Codex App Server request timed out: ${method}.`))
      }, this.requestTimeoutMs)
      timer.unref()
      this.pendingRequests.set(id, { resolveRequest, rejectRequest, timer })
      this.#send({ method, id, ...(params === undefined ? {} : { params }) })
    })
  }

  #send(message) {
    if (!this.process?.stdin.writable) throw new Error('Codex App Server is unavailable.')
    this.process.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #consumeOutput(chunk) {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.#handleMessage(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  #handleMessage(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }

    if (Number.isInteger(message.id) && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)
      this.pendingRequests.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.rejectRequest(new Error(message.error.message || 'Codex App Server request failed.'))
      } else {
        pending.resolveRequest(message.result)
      }
      return
    }

    if (message.method === 'account/login/completed') {
      this.loginCompletion = {
        loginId: message.params?.loginId || null,
        success: Boolean(message.params?.success),
        error: message.params?.error || '',
      }
      this.#consumeLoginCompletion()
    }
  }

  #consumeLoginCompletion() {
    if (!this.login || !this.loginCompletion) return
    if (
      this.loginCompletion.loginId
      && this.loginCompletion.loginId !== this.login.loginId
    ) return
    this.loginError = this.loginCompletion.success
      ? ''
      : this.loginCompletion.error || 'ChatGPT sign-in did not complete.'
    this.login = null
    this.loginCompletion = null
  }

  #fail(cause) {
    const error = asError(cause, 'Codex App Server failed.')
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.rejectRequest(error)
    }
    this.pendingRequests.clear()
    this.process = null
    this.started = null
  }
}

export class CodexSessionPool {
  constructor(config) {
    this.config = config
    this.sessions = new Map()
    this.idleTimers = new Map()
  }

  session(subject) {
    if (!SUBJECT_PATTERN.test(subject)) throw new Error('Invalid Codex account subject.')
    let session = this.sessions.get(subject)
    if (!session) {
      session = new CodexSession({ ...this.config, subject })
      this.sessions.set(subject, session)
    }
    this.touch(subject)
    return session
  }

  touch(subject) {
    const existingTimer = this.idleTimers.get(subject)
    if (existingTimer) clearTimeout(existingTimer)
    const timer = setTimeout(() => {
      const session = this.sessions.get(subject)
      if (
        session?.login
        && Date.now() - session.login.startedAt < LOGIN_MAX_AGE_MS
      ) {
        this.touch(subject)
        return
      }
      session?.close()
      this.sessions.delete(subject)
      this.idleTimers.delete(subject)
    }, this.config.idleTimeoutMs)
    timer.unref()
    this.idleTimers.set(subject, timer)
  }

  closeAll() {
    for (const timer of this.idleTimers.values()) clearTimeout(timer)
    for (const session of this.sessions.values()) session.close()
    this.idleTimers.clear()
    this.sessions.clear()
  }
}

export function createBridgeServer({ token, pool }) {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      jsonResponse(response, 200, { status: 'ok' })
      return
    }
    if (!authorized(request.headers.authorization, token)) {
      jsonResponse(response, 401, { message: 'Unauthorized.' })
      return
    }

    const path = new URL(request.url || '/', 'http://bridge.local').pathname
    const match = path.match(/^\/v1\/connections\/([a-f0-9]{64})$/)
    if (!match || !['GET', 'POST', 'DELETE'].includes(request.method || '')) {
      jsonResponse(response, 404, { message: 'Not found.' })
      return
    }

    try {
      const session = pool.session(match[1])
      const result = request.method === 'GET'
        ? await session.status()
        : request.method === 'POST'
          ? await session.startLogin()
          : await session.disconnect()
      pool.touch(match[1])
      jsonResponse(response, 200, result)
    } catch (cause) {
      const error = asError(cause, 'Codex bridge request failed.')
      process.stderr.write(`[codex-bridge] ${error.message}\n`)
      jsonResponse(response, 502, { message: 'Codex bridge request failed.' })
    }
  })
}

export function loadConfig(environment = process.env) {
  const token = (environment.MOM_CODEX_BRIDGE_TOKEN || '').trim()
  if (token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('MOM_CODEX_BRIDGE_TOKEN must contain at least 32 printable characters.')
  }
  const port = Number.parseInt(environment.PORT || '8091', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be between 1 and 65535.')
  }
  const idleTimeoutMs = Number.parseInt(environment.MOM_CODEX_SESSION_IDLE_MS || '300000', 10)
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 30_000) {
    throw new Error('MOM_CODEX_SESSION_IDLE_MS must be at least 30000.')
  }
  return {
    host: environment.HOST || '127.0.0.1',
    port,
    token,
    pool: new CodexSessionPool({
      executable: environment.MOM_CODEX_EXECUTABLE || 'codex',
      dataRoot: resolve(environment.MOM_CODEX_BRIDGE_DATA || 'private/codex-bridge'),
      idleTimeoutMs,
    }),
  }
}

async function main() {
  const config = loadConfig()
  await mkdir(resolve(process.env.MOM_CODEX_BRIDGE_DATA || 'private/codex-bridge'), {
    recursive: true,
    mode: 0o700,
  })
  const server = createBridgeServer(config)
  const shutdown = () => {
    server.close(() => process.exit(0))
    config.pool.closeAll()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.listen(config.port, config.host, () => {
    process.stdout.write(`Polymind Codex bridge listening on ${config.host}:${config.port}\n`)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(cause => {
    process.stderr.write(`${asError(cause, 'Codex bridge failed.').message}\n`)
    process.exitCode = 1
  })
}
