/**
 * The browser half's configuration state.
 *
 * One owner of the profile section: it reads it from the host route, hands the
 * same snapshot to the rail unit and the settings page, and writes edits
 * optimistically (apply locally → PUT → keep or roll back) so the rail reacts
 * on the same frame as the click.
 *
 * The snapshot object identity is stable between changes, so consumers can use
 * it directly as a `useSyncExternalStore` source.
 */
import {
  cloneProfileConfig,
  emptyProfileConfig,
  type PanellistConfig,
  type ProfileConfig,
} from '../../shared/config.ts'
import { normalizeConfigDocument } from '../../shared/validate.ts'
import { API_ROUTES, type ConfigResponse, type HealthReport, type PutConfigRequest } from '../../shared/protocol.ts'

/** Minimal fetch surface, so tests can inject a stub. */
export interface FetchLike {
  (input: string, init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }): Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
    text(): Promise<string>
  }>
}

/** Immutable state handed to consumers. */
export interface StoreSnapshot {
  status: 'loading' | 'ready' | 'error'
  /** Profile this section belongs to, as the host resolved it. */
  profileId: string
  /** The live profile section. */
  profile: ProfileConfig
  /** The whole document (drives export). */
  document: PanellistConfig
  /** Host-reported storage health. */
  health: HealthReport | null
  /** Raw failure reason (never localized here; the view maps it to copy). */
  error: string | null
  /** Increments on every accepted local change (rail re-projection trigger). */
  revision: number
}

/** The store surface consumed by the rail, the settings page and the tests. */
export interface PanellistStore {
  getSnapshot(): StoreSnapshot
  subscribe(listener: () => void): () => void
  /** Read the section from the host (called once on mount). */
  load(): Promise<void>
  /**
   * Apply one pure edit. Returns `false` when the write failed, in which case
   * the previous section has already been restored.
   */
  update(mutator: (profile: ProfileConfig) => ProfileConfig): Promise<boolean>
  /** Replace the section from an imported document's text. */
  importDocument(text: string): Promise<{ ok: true } | { ok: false; error: string }>
  /** Serialize the whole document (what "Export JSON" copies). */
  exportDocument(): string
  /** Reset this profile's section to defaults. */
  reset(): Promise<boolean>
  /** Ask the host to reveal the configuration file in the OS file manager. */
  reveal(): Promise<boolean>
  dispose(): void
}

function emptySnapshot(): StoreSnapshot {
  return {
    status: 'loading',
    profileId: '',
    profile: emptyProfileConfig(),
    document: { schemaVersion: 1, profiles: {} },
    health: null,
    error: null,
    revision: 0,
  }
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Read a `{error, details}` failure body, falling back to the status text. */
async function failureOf(response: { status: number; text(): Promise<string> }): Promise<string> {
  try {
    const raw = await response.text()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as { error?: unknown; details?: unknown }
      if (typeof record.error === 'string') {
        const details = Array.isArray(record.details) ? record.details.filter((d): d is string => typeof d === 'string') : []
        return details.length === 0 ? record.error : `${record.error}: ${details.join('; ')}`
      }
    }
    return raw.slice(0, 400)
  } catch {
    return `HTTP ${response.status}`
  }
}

/**
 * Create the store.
 * @param options.profileId - profile to address; omit to use the host's own.
 * @param options.fetch - fetch implementation (defaults to the global one).
 */
export function createPanellistStore(options: { profileId?: string; fetch?: FetchLike } = {}): PanellistStore {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const listeners = new Set<() => void>()
  let snapshot = emptySnapshot()
  let disposed = false

  const publish = (patch: Partial<StoreSnapshot>): void => {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }

  const query = (): string => (options.profileId === undefined || options.profileId === ''
    ? ''
    : `?profile=${encodeURIComponent(options.profileId)}`)

  const accept = (body: ConfigResponse): void => {
    publish({
      status: 'ready',
      profileId: body.profileId,
      profile: cloneProfileConfig(body.profile),
      document: body.document,
      health: body.health,
      error: null,
      revision: snapshot.revision + 1,
    })
  }

  const put = async (profile: ProfileConfig): Promise<boolean> => {
    const body: PutConfigRequest = { profile }
    try {
      const response = await doFetch(`${API_ROUTES.config}${query()}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        publish({ error: await failureOf(response) })
        return false
      }
      const parsed = await response.json() as ConfigResponse
      publish({
        status: 'ready',
        profileId: parsed.profileId,
        profile: cloneProfileConfig(parsed.profile),
        document: parsed.document,
        health: parsed.health,
        error: null,
      })
      return true
    } catch (error) {
      publish({ error: reasonOf(error) })
      return false
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: async () => {
      if (disposed) return
      try {
        const response = await doFetch(`${API_ROUTES.config}${query()}`)
        if (!response.ok) {
          publish({ status: 'error', error: await failureOf(response) })
          return
        }
        accept(await response.json() as ConfigResponse)
      } catch (error) {
        publish({ status: 'error', error: reasonOf(error) })
      }
    },
    update: async (mutator) => {
      if (disposed) return false
      const previous = snapshot.profile
      const next = mutator(cloneProfileConfig(snapshot.profile))
      publish({ profile: next, revision: snapshot.revision + 1 })
      const ok = await put(next)
      if (!ok && !disposed) {
        publish({ profile: cloneProfileConfig(previous), revision: snapshot.revision + 1 })
      }
      return ok
    },
    importDocument: async (text) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        return { ok: false, error: reasonOf(error) }
      }
      const normalized = normalizeConfigDocument(parsed)
      if (!normalized.ok) return { ok: false, error: normalized.errors.join('; ') }
      const keys = Object.keys(normalized.config.profiles)
      const own = snapshot.profileId
      const chosen = normalized.config.profiles[own] ?? (keys.length === 1 ? normalized.config.profiles[keys[0] as string] : undefined)
      if (chosen === undefined) {
        return { ok: false, error: `document has no section for profile "${own}"` }
      }
      const ok = await put(chosen)
      return ok ? { ok: true } : { ok: false, error: snapshot.error ?? 'write failed' }
    },
    exportDocument: () => `${JSON.stringify(snapshot.document, null, 2)}\n`,
    reset: async () => {
      try {
        const response = await doFetch(`${API_ROUTES.reset}${query()}`, { method: 'POST' })
        if (!response.ok) {
          publish({ error: await failureOf(response) })
          return false
        }
        accept(await response.json() as ConfigResponse)
        return true
      } catch (error) {
        publish({ error: reasonOf(error) })
        return false
      }
    },
    reveal: async () => {
      try {
        const response = await doFetch(`${API_ROUTES.reveal}${query()}`, { method: 'POST' })
        if (!response.ok) {
          publish({ error: await failureOf(response) })
          return false
        }
        return true
      } catch (error) {
        publish({ error: reasonOf(error) })
        return false
      }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
    },
  }
}
