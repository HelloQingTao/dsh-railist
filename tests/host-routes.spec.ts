/**
 * Host-half routes: the loopback/trusted-host fence, the endpoint table, the
 * profile fence, and every failure path (400 / 403 / 404 / 405 / 413).
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION, emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'
import { API_PREFIX, API_ROUTES, type ConfigResponse, type HealthReport } from '../src/shared/protocol.ts'
import { RailistStore } from '../src/plugin/store.ts'
import { apply, inject, name } from '../src/plugin/index.ts'
import { MAX_BODY_BYTES, createApiHandler, isLoopbackRequest } from '../src/plugin/routes.ts'

const PROFILE = 'desktop'

interface RequestOptions {
  method: string
  url: string
  body?: string
  remoteAddress?: string
  host?: string
}

function sampleProfile(): ProfileConfig {
  return {
    sequence: [{ type: 'entry', id: 'plugins' }],
    entries: { plugins: { label: 'Plugin market', hidden: true } },
  }
}

/** A request that satisfies the wire contract of `IncomingMessage` for this handler. */
function fakeRequest(options: RequestOptions): IncomingMessage {
  const { body } = options
  const stream = Readable.from(body === undefined || body === '' ? [] : [Buffer.from(body, 'utf8')])
  const request = stream as unknown as IncomingMessage
  Object.assign(request, {
    method: options.method,
    url: options.url,
    headers: { host: options.host ?? '127.0.0.1:19387' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  })
  return request
}

class FakeResponse {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body = ''
  ended = false

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.statusCode = status
    if (headers !== undefined) this.headers = { ...this.headers, ...headers }
    return this
  }

  setHeader(name: string, value: unknown): void {
    this.headers[name.toLowerCase()] = value
  }

  getHeader(name: string): unknown {
    return this.headers[name.toLowerCase()]
  }

  end(chunk?: unknown): this {
    if (typeof chunk === 'string') this.body += chunk
    else if (Buffer.isBuffer(chunk)) this.body += chunk.toString('utf8')
    this.ended = true
    return this
  }

  json<T>(): T {
    return JSON.parse(this.body) as T
  }
}

let home = ''
let store: RailistStore
let handler: ReturnType<typeof createApiHandler>
let revealed: string[]

async function call(options: RequestOptions): Promise<FakeResponse> {
  const res = new FakeResponse()
  await handler(fakeRequest(options), res as unknown as ServerResponse)
  return res
}

async function callJson<T>(options: RequestOptions): Promise<{ res: FakeResponse; body: T }> {
  const res = await call(options)
  return { res, body: res.json<T>() }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'panellist-routes-'))
  // The route answers an unqualified read for the store's own profile, and the
  // store resolves that from the launcher's `profileContext` — so a store built
  // with only a `profileId` must be given the section it addresses too.
  await mkdir(join(home, 'profiles', PROFILE), { recursive: true })
  store = new RailistStore({ home, profileId: PROFILE })
  revealed = []
  handler = createApiHandler(store, { reveal: (configPath) => { revealed.push(configPath) } })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('trust fence', () => {
  it('accepts the loopback peer and host pairings Node actually reports', () => {
    for (const [remoteAddress, host] of [
      ['127.0.0.1', '127.0.0.1:19387'],
      ['127.0.0.1', 'localhost:19387'],
      ['127.0.0.1', 'localhost'],
      ['::1', '[::1]:19387'],
      ['::1', '::1'],
      ['::ffff:127.0.0.1', '127.0.0.1'],
    ] as const) {
      expect(isLoopbackRequest(fakeRequest({ method: 'GET', url: '/', remoteAddress, host }))).toBe(true)
    }
  })

  it('refuses a non-loopback peer, a foreign Host, no Host, and near-miss authorities', () => {
    const rejected: RequestOptions[] = [
      { method: 'GET', url: '/', remoteAddress: '10.1.2.3' },
      { method: 'GET', url: '/', remoteAddress: '::ffff:10.1.2.3' },
      { method: 'GET', url: '/', host: 'evil.example' },
      { method: 'GET', url: '/', host: '127.0.0.1.evil.example' },
      { method: 'GET', url: '/', host: 'localhost.evil.example' },
      { method: 'GET', url: '/', host: '' },
    ]
    for (const options of rejected) {
      expect(isLoopbackRequest(fakeRequest(options))).toBe(false)
    }
  })

  it('answers 403 with an ApiFailure before touching the store', async () => {
    const { res, body } = await callJson<{ error: string }>({
      method: 'GET',
      url: API_ROUTES.config,
      remoteAddress: '10.1.2.3',
    })
    expect(res.statusCode).toBe(403)
    expect(body.error).toContain('loopback')
    expect(res.headers['content-type']).toContain('application/json')

    const foreign = await callJson<{ error: string }>({
      method: 'GET',
      url: API_ROUTES.config,
      host: 'evil.example',
    })
    expect(foreign.res.statusCode).toBe(403)
  })
})

describe('endpoint table', () => {
  it('answers GET /config with the document, the section and the health report', async () => {
    const { res, body } = await callJson<ConfigResponse>({ method: 'GET', url: API_ROUTES.config })
    expect(res.statusCode).toBe(200)
    expect(body.profileId).toBe(PROFILE)
    expect(body.profile).toEqual(emptyProfileConfig())
    expect(body.document).toEqual({ schemaVersion: SCHEMA_VERSION, profiles: {} })
    expect(body.health.configPath).toBe(store.configPath)
    expect(body.health.storage.exists).toBe(false)
  })

  it('tolerates a trailing slash', async () => {
    const res = await call({ method: 'GET', url: `${API_ROUTES.config}/` })
    expect(res.statusCode).toBe(200)
  })

  it('answers 404 for a path under the prefix it does not serve', async () => {
    const { res, body } = await callJson<{ error: string }>({ method: 'GET', url: '/panellist/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(body.error).toContain('unknown endpoint')
  })

  it('answers 405 with Allow for a wrong method on a known path', async () => {
    const removed = await call({ method: 'DELETE', url: API_ROUTES.config })
    expect(removed.statusCode).toBe(405)
    expect(String(removed.headers['allow'])).toBe('GET, PUT')

    expect((await call({ method: 'GET', url: API_ROUTES.reset })).statusCode).toBe(405)
    expect((await call({ method: 'GET', url: API_ROUTES.reveal })).statusCode).toBe(405)
    expect((await call({ method: 'POST', url: API_ROUTES.health })).statusCode).toBe(405)
  })

  it('answers GET /health with the self-check report', async () => {
    const { res, body } = await callJson<HealthReport>({ method: 'GET', url: API_ROUTES.health })
    expect(res.statusCode).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.profileId).toBe(PROFILE)
    expect(body.schemaVersion).toBe(SCHEMA_VERSION)
    expect(body.migrations).toEqual([])
    expect(body.corruption.detected).toBe(false)
    expect(body.storage.writable).toBe(true)
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false)
  })
})

describe('PUT /config', () => {
  it('round-trips a profile to disk and back', async () => {
    const profile = sampleProfile()
    const put = await callJson<ConfigResponse>({
      method: 'PUT',
      url: API_ROUTES.config,
      body: JSON.stringify({ profile }),
    })
    expect(put.res.statusCode).toBe(200)
    expect(put.body.profile).toEqual(profile)

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.profiles[PROFILE]).toEqual(profile)

    const read = await callJson<ConfigResponse>({ method: 'GET', url: API_ROUTES.config })
    expect(read.body.profile).toEqual(profile)
    expect(read.body.health.storage.exists).toBe(true)
  })

  it('answers 400 for a body that is not JSON', async () => {
    const { res, body } = await callJson<{ error: string }>({
      method: 'PUT',
      url: API_ROUTES.config,
      body: '{ not json',
    })
    expect(res.statusCode).toBe(400)
    expect(body.error).toContain('not valid JSON')
  })

  it('answers 400 for a body that is not {profile}', async () => {
    const { res } = await callJson<{ error: string }>({
      method: 'PUT',
      url: API_ROUTES.config,
      body: JSON.stringify({ section: {} }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('answers 400 with details when the schema refuses the section', async () => {
    const { res, body } = await callJson<{ error: string; details?: string[] }>({
      method: 'PUT',
      url: API_ROUTES.config,
      body: JSON.stringify({ profile: { sequence: [{ type: 'entry', id: '' }], entries: {} } }),
    })
    expect(res.statusCode).toBe(400)
    expect(body.error).toContain('schema')
    expect(body.details?.length ?? 0).toBeGreaterThan(0)
  })

  it('answers 413 for a body over the cap', async () => {
    const { res, body } = await callJson<{ error: string }>({
      method: 'PUT',
      url: API_ROUTES.config,
      body: 'x'.repeat(MAX_BODY_BYTES + 1),
    })
    expect(res.statusCode).toBe(413)
    expect(body.error).toContain(String(MAX_BODY_BYTES))
  })
})

describe('profile fence', () => {
  it('refuses an explicit profile the harness has not initialized', async () => {
    const { res, body } = await callJson<{ error: string }>({
      method: 'GET',
      url: `${API_ROUTES.config}?profile=ghost`,
    })
    expect(res.statusCode).toBe(400)
    expect(body.error).toContain('ghost')
  })

  it('refuses an out-of-shape profile id', async () => {
    const { res } = await callJson<{ error: string }>({
      method: 'GET',
      url: `${API_ROUTES.config}?profile=${encodeURIComponent('../escape')}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it('honours an explicit profile once its directory exists', async () => {
    await mkdir(join(home, 'profiles', 'work'), { recursive: true })

    const read = await callJson<ConfigResponse>({ method: 'GET', url: `${API_ROUTES.config}?profile=work` })
    expect(read.res.statusCode).toBe(200)
    expect(read.body.profileId).toBe('work')

    const put = await callJson<ConfigResponse>({
      method: 'PUT',
      url: `${API_ROUTES.config}?profile=work`,
      body: JSON.stringify({ profile: sampleProfile() }),
    })
    expect(put.res.statusCode).toBe(200)

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(Object.keys(stored.profiles)).toEqual(['work'])
    expect((await callJson<ConfigResponse>({ method: 'GET', url: API_ROUTES.config })).body.profile)
      .toEqual(emptyProfileConfig())
  })

  it('ignores the query on /health and /reveal, which are file-scoped', async () => {
    expect((await call({ method: 'GET', url: `${API_ROUTES.health}?profile=ghost` })).statusCode).toBe(200)
    expect((await call({ method: 'POST', url: `${API_ROUTES.reveal}?profile=ghost` })).statusCode).toBe(204)
  })
})

describe('POST /config/reset', () => {
  it('answers with the default section and stores it', async () => {
    await callJson<ConfigResponse>({
      method: 'PUT',
      url: API_ROUTES.config,
      body: JSON.stringify({ profile: sampleProfile() }),
    })

    const { res, body } = await callJson<ConfigResponse>({ method: 'POST', url: API_ROUTES.reset })
    expect(res.statusCode).toBe(200)
    expect(body.profile).toEqual(emptyProfileConfig())

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.profiles[PROFILE]).toEqual(emptyProfileConfig())
  })
})

describe('POST /reveal', () => {
  it('hands the configuration file to the OS file manager and answers 204', async () => {
    const res = await call({ method: 'POST', url: API_ROUTES.reveal })
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
    expect(revealed).toEqual([store.configPath])
  })

  it('answers 204 even when the file manager is missing', async () => {
    const failing = createApiHandler(store, { reveal: () => { throw new Error('no file manager') } })
    const res = new FakeResponse()
    await failing(fakeRequest({ method: 'POST', url: API_ROUTES.reveal }), res as unknown as ServerResponse)
    expect(res.statusCode).toBe(204)
  })
})

describe('corruption', () => {
  it('reports a quarantined file through /health and still serves defaults', async () => {
    await writeFile(store.configPath, 'not json at all', 'utf8')

    const health = await callJson<HealthReport>({ method: 'GET', url: API_ROUTES.health })
    expect(health.res.statusCode).toBe(200)
    expect(health.body.ok).toBe(false)
    expect(health.body.corruption.detected).toBe(true)
    expect(health.body.corruption.backupPath).toContain('railist.json.corrupt-')

    const config = await callJson<ConfigResponse>({ method: 'GET', url: API_ROUTES.config })
    expect(config.res.statusCode).toBe(200)
    expect(config.body.profile).toEqual(emptyProfileConfig())
  })
})

describe('handler robustness', () => {
  it('keeps the reveal injection optional', () => {
    expect(() => createApiHandler(store)).not.toThrow()
  })

  it('never writes on a refused request', async () => {
    const spy = vi.spyOn(store, 'write')
    await call({ method: 'PUT', url: API_ROUTES.config, remoteAddress: '192.168.1.5', body: '{}' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('plugin entry', () => {
  interface RegisteredRoute {
    kind: string
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }

  it('exposes the host-half contract and registers the prefix route when webServer appears', async () => {
    expect(name).toBe('dsh-railist')
    // `webServer` is optional: it must not be a hard inject requirement.
    expect(inject).toEqual([])

    const state: { route?: RegisteredRoute; dispose?: () => void } = {}
    const webServer = {
      register: (route: RegisteredRoute): (() => void) => {
        state.route = route
        return () => { state.dispose = undefined }
      },
    }
    const webContext = {
      reflect: { get: () => webServer },
      effect: (body: () => (() => void) | Iterable<() => void>): void => {
        const result = body()
        state.dispose = typeof result === 'function' ? result : undefined
      },
    }
    const context = {
      inject: (deps: string[], callback: (ctx: unknown) => void): void => {
        expect(deps).toEqual(['webServer'])
        callback(webContext)
      },
    }

    apply(context as unknown as Context, {
      home,
      profileId: PROFILE,
      routes: { reveal: () => {} },
    })

    expect(state.route?.kind).toBe('prefix')
    expect(state.route?.path).toBe(API_PREFIX)
    expect(typeof state.dispose).toBe('function')

    const res = new FakeResponse()
    await state.route?.handler(
      fakeRequest({ method: 'GET', url: API_ROUTES.config }),
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(200)
    expect(res.json<ConfigResponse>().profileId).toBe(PROFILE)

    state.dispose?.()
  })
})
