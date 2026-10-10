/**
 * The loopback HTTP surface of the host half.
 *
 * One prefix route (`/panellist/api`) is registered through the optional
 * `webServer` service; everything under it is answered here. The endpoints are
 * the only way the browser half reaches the disk, so each one is fenced twice:
 *
 * - **Loopback fence** — the socket's peer must be a loopback address *and* the
 *   `Host` header must name a loopback authority, which is what stops a DNS
 *   rebind in a browser from reaching a local plugin route.
 * - **Profile fence** — an explicit `?profile=` is honoured only for a profile
 *   the harness has actually initialized, so a crafted query cannot read or
 *   write an unrelated profile's section.
 *
 * Every non-2xx body is an `ApiFailure`; bodies are capped at 2 MB.
 * @module
 */
import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname } from 'node:path'
import { emptyProfileConfig } from '../shared/config.ts'
import {
  API_PREFIX,
  API_ROUTES,
  type ApiFailure,
  type ConfigResponse,
  type PutConfigRequest,
} from '../shared/protocol.ts'
import { InvalidConfigError, type PanellistStore } from './store.ts'

/** Largest accepted request body (README §4.3 route contract). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

/** Peer addresses the fence accepts: the IPv4 loopback, its IPv6 form, and the IPv4-mapped spelling Node reports. */
const LOOPBACK_ADDRESSES: readonly string[] = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/** `Host` authorities the fence accepts. */
const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '::1']

/** Mirrors `profiles.propertyNames` in the schema. */
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** One endpoint: the pathname it answers and the methods it accepts. */
interface Endpoint {
  path: string
  methods: readonly string[]
}

const ENDPOINTS: readonly Endpoint[] = [
  { path: API_ROUTES.config, methods: ['GET', 'PUT'] },
  { path: API_ROUTES.reset, methods: ['POST'] },
  { path: API_ROUTES.health, methods: ['GET'] },
  { path: API_ROUTES.reveal, methods: ['POST'] },
]

/** Options a test (or an unusual host) can use to replace the side effects. */
export interface ApiHandlerOptions {
  /**
   * Hands the configuration file to the OS file manager. Defaults to
   * `explorer` / `open` / `xdg-open`; injected in tests so no window opens.
   */
  reveal?: (configPath: string) => void | Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Hostname of a `Host` header value: `host`, `host:port`, `[::1]` or `[::1]:port`.
 * A bare IPv6 literal keeps its colons.
 */
function hostnameOf(host: string): string {
  const authority = host.trim().toLowerCase()
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end === -1 ? '' : authority.slice(1, end)
  }
  const first = authority.indexOf(':')
  if (first === -1) return authority
  // Exactly one colon is host:port; several mean a bracket-less IPv6 literal.
  return first === authority.lastIndexOf(':') ? authority.slice(0, first) : authority
}

/**
 * Whether a request originates on the loopback interface.
 *
 * Both halves are required: a loopback peer with a foreign `Host` is exactly the
 * DNS-rebinding shape, and a loopback `Host` with a remote peer is a proxied
 * request the plugin must not answer.
 * @param req - the incoming request.
 */
export function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket?.remoteAddress
  if (address === undefined || !LOOPBACK_ADDRESSES.includes(address)) return false
  const host = req.headers.host
  if (host === undefined) return false
  return LOOPBACK_HOSTNAMES.includes(hostnameOf(host))
}

function parseUrl(raw: string | undefined): URL | null {
  try {
    return new URL(raw ?? '/', 'http://localhost')
  } catch {
    return null
  }
}

function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function respondJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = `${JSON.stringify(body)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(text)
}

function fail(
  res: ServerResponse,
  status: number,
  error: string,
  details?: string[],
  headers?: Record<string, string>,
): void {
  const body: ApiFailure = {
    error,
    ...(details === undefined || details.length === 0 ? {} : { details }),
  }
  respondJson(res, status, body, headers)
}

/**
 * Read the request body, refusing anything over `cap`.
 * @returns the UTF-8 body, or `null` when it exceeded the cap.
 */
function readBody(req: IncomingMessage, cap: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const settle = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk: unknown) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buffer.length
      if (size > cap) {
        // Answer immediately: draining a hostile stream would keep the socket
        // open. The remaining chunks are ignored below.
        settle(null)
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => settle(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (error: unknown) => {
      if (settled) return
      settled = true
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

/**
 * Resolve the profile an endpoint addresses.
 * @returns the profile id, or the failure status/message to answer with.
 */
async function resolveProfile(
  store: PanellistStore,
  searchParams: URLSearchParams,
): Promise<{ profileId: string } | { error: string; details?: string[] }> {
  const requested = searchParams.get('profile')
  if (requested === null || requested === '') return { profileId: store.profileId }
  if (!PROFILE_ID_RE.test(requested)) {
    return { error: `invalid profile id ${JSON.stringify(requested)}` }
  }
  if (!(await store.profileExists(requested))) {
    return {
      error: `unknown profile ${JSON.stringify(requested)}`,
      details: [`no profile directory at ${store.home}/profiles/${requested}`],
    }
  }
  return { profileId: requested }
}

/** Build the response every config endpoint answers with. */
async function configResponse(store: PanellistStore, profileId: string): Promise<ConfigResponse> {
  const document = await store.readDocument()
  return {
    document,
    profile: document.profiles[profileId] ?? emptyProfileConfig(),
    profileId,
    health: store.health(),
  }
}

/** Whether the configuration file is on disk. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Open the configuration file (or its folder) in the OS file manager. */
async function revealInFileManager(configPath: string): Promise<void> {
  const present = await fileExists(configPath)
  const directory = dirname(configPath)
  let command: string
  let args: string[]
  if (process.platform === 'win32') {
    // `explorer /select,<path>` selects the file; a plain path opens the folder.
    command = 'explorer'
    args = [present ? `/select,${configPath}` : directory]
  } else if (process.platform === 'darwin') {
    command = 'open'
    args = present ? ['-R', configPath] : [directory]
  } else {
    // xdg-open opens a target rather than selecting it; the folder is the useful one.
    command = 'xdg-open'
    args = [directory]
  }
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {
      // A host without a file manager is not an error for the settings page:
      // it also shows the path, and the request has already been answered.
    })
    child.unref()
  } catch {
    // Spawning is best effort by design; the route still answers 204.
  }
}

/**
 * Create the handler for the `/panellist/api` prefix route.
 * @param store - the configuration store every endpoint works through.
 * @param options - side-effect overrides (tests).
 * @returns a handler owning the whole response lifecycle.
 */
export function createApiHandler(
  store: PanellistStore,
  options: ApiHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const reveal = options.reveal ?? revealInFileManager
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackRequest(req)) {
      fail(res, 403, 'refused: this endpoint answers loopback requests only')
      return
    }

    const url = parseUrl(req.url)
    if (url === null) {
      fail(res, 400, 'malformed request URL')
      return
    }
    const pathname = normalizePath(url.pathname)
    const endpoint = ENDPOINTS.find(candidate => candidate.path === pathname)
    if (endpoint === undefined) {
      fail(res, 404, `unknown endpoint ${url.pathname}`)
      return
    }

    const method = (req.method ?? 'GET').toUpperCase()
    if (!endpoint.methods.includes(method)) {
      fail(res, 405, `${method} is not allowed on ${pathname}`, undefined, { allow: endpoint.methods.join(', ') })
      return
    }

    switch (pathname) {
      case API_ROUTES.config: {
        const chosen = await resolveProfile(store, url.searchParams)
        if ('error' in chosen) {
          fail(res, 400, chosen.error, chosen.details)
          return
        }
        if (method === 'GET') {
          respondJson(res, 200, await configResponse(store, chosen.profileId))
          return
        }
        const body = await readBody(req, MAX_BODY_BYTES)
        if (body === null) {
          fail(res, 413, `request body exceeds ${MAX_BODY_BYTES} bytes`)
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch {
          fail(res, 400, 'request body is not valid JSON')
          return
        }
        if (!isRecord(parsed) || !isRecord(parsed['profile'])) {
          fail(res, 400, 'request body must be {"profile": {...}}')
          return
        }
        const request = parsed as unknown as PutConfigRequest
        try {
          await store.write(request.profile, chosen.profileId)
        } catch (error) {
          if (error instanceof InvalidConfigError) {
            fail(res, 400, 'the configuration was rejected by the schema', error.details)
            return
          }
          fail(res, 500, error instanceof Error ? error.message : String(error))
          return
        }
        respondJson(res, 200, await configResponse(store, chosen.profileId))
        return
      }

      case API_ROUTES.reset: {
        const chosen = await resolveProfile(store, url.searchParams)
        if ('error' in chosen) {
          fail(res, 400, chosen.error, chosen.details)
          return
        }
        try {
          await store.resetProfile(chosen.profileId)
        } catch (error) {
          if (error instanceof InvalidConfigError) {
            fail(res, 400, 'the configuration was rejected by the schema', error.details)
            return
          }
          fail(res, 500, error instanceof Error ? error.message : String(error))
          return
        }
        respondJson(res, 200, await configResponse(store, chosen.profileId))
        return
      }

      case API_ROUTES.health: {
        // A read refreshes every fact the report carries (existence,
        // writability, corruption, migration).
        await store.readDocument()
        respondJson(res, 200, store.health())
        return
      }

      case API_ROUTES.reveal: {
        // The file is one per harness home, not one per profile, so the query
        // is deliberately ignored here.
        try {
          await reveal(store.configPath)
        } catch {
          // Opening a file manager is best effort: the request's contract is
          // "asked the OS", not "the OS succeeded", and the settings page also
          // shows the path.
        }
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
        return
      }

      default: {
        fail(res, 404, `unknown endpoint ${pathname}`)
      }
    }
  }
}

/**
 * The prefix route registration this plugin makes through `ctx.webServer`.
 * Exported so the plugin entry and its tests describe the route once.
 */
export const ROUTE_REGISTRATION = { kind: 'prefix', path: API_PREFIX } as const
