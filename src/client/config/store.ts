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
  emptyConfig,
  emptyProfileConfig,
  type RailistConfig,
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
  document: RailistConfig
  /** Host-reported storage health. */
  health: HealthReport | null
  /** Raw failure reason (never localized here; the view maps it to copy). */
  error: string | null
  /**
   * The row the user most recently dragged across seats, or `null` when no drag
   * is in flight (README §2.11).
   *
   * This is deliberately NOT part of the persisted document: it describes the
   * gesture that produced the current order, not the order itself. It is carried
   * on the snapshot only so the rail projection can honour "only the row I dragged
   * changes seat" without the pure model having to guess which row that was.
   */
  movedRow: string | null
  /** Increments on every accepted local change (rail re-projection trigger). */
  revision: number
}

/** The store surface consumed by the rail, the settings page and the tests. */
export interface RailistStore {
  getSnapshot(): StoreSnapshot
  subscribe(listener: () => void): () => void
  /** Read the section from the host (called once on mount). */
  load(): Promise<void>
  /**
   * Apply one pure edit. Returns `false` when the write failed, in which case
   * the previous section has already been restored.
   *
   * `moved` names the row the user dragged across seats, when this edit came from
   * such a drag: the rail projection re-seats that row and leaves the rest of the
   * rail alone (README §2.11). Every other update clears it, so an ordinary edit
   * never disturbs a seat.
   */
  update(mutator: (profile: ProfileConfig) => ProfileConfig, moved?: string | null): Promise<boolean>
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
    document: emptyConfig(),
    health: null,
    error: null,
    revision: 0,
    movedRow: null,
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
 * The document's only section, when the answer does not describe a section of its own.
 *
 * The host answers an unqualified read for its own id, which is the process
 * default rather than a statement about which profile is running. When that id
 * has no section in the document but exactly one section exists, that section is
 * the profile in use and the id simply was not set. Returns `null` whenever the
 * answer already describes a profile the document has a section for — including
 * the requested one — so no second read happens in the ordinary case.
 * @param body - the answer received.
 * @param requested - the id the request named, if any.
 */
function soleSectionOf(body: ConfigResponse, requested: string | undefined): string | null {
  if (requested !== undefined && requested !== '' && body.profileId === requested) return null
  if (body.document.profiles[body.profileId] !== undefined) return null
  const keys = Object.keys(body.document.profiles)
  if (keys.length !== 1) return null
  return keys[0] as string
}

/**
 * Create the store.
 * @param options.profileId - profile to address; omit to use the host's own.
 * @param options.fetch - fetch implementation (defaults to the global one).
 */
export function createRailistStore(options: { profileId?: string; fetch?: FetchLike } = {}): RailistStore {
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
        const body = await response.json() as ConfigResponse
        // A request that names no profile is answered for the host's own id —
        // `$DSH_PROFILE`, or the literal `default`. The web host is started
        // without that variable (`dsh web --profile web` writes the section
        // for `web`), so the first answer can be an empty section for a profile
        // nothing configured while the real one sits beside it. The document
        // travels with the answer, so the section that exists can be adopted
        // and re-read once; `importDocument` has always resolved the same
        // ambiguity this way when a hand-edited file omits the running profile.
        const adopted = soleSectionOf(body, options.profileId)
        if (adopted !== null) {
          publish({ document: body.document, profileId: adopted })
          const retry = await doFetch(`${API_ROUTES.config}?profile=${encodeURIComponent(adopted)}`)
          if (!retry.ok) {
            publish({ status: 'error', error: await failureOf(retry) })
            return
          }
          accept(await retry.json() as ConfigResponse)
          return
        }
        accept(body)
      } catch (error) {
        publish({ status: 'error', error: reasonOf(error) })
      }
    },
    update: async (mutator, moved) => {
      if (disposed) return false
      const previous = snapshot.profile
      const next = mutator(cloneProfileConfig(snapshot.profile))
      publish({ profile: next, movedRow: moved ?? null, revision: snapshot.revision + 1 })
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
      if (normalized.config.profiles[own] === undefined) {
        // The file names a profile this instance is not running as; the write
        // must follow the section it is about, not the host's default.
        publish({ profileId: keys[0] as string })
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
