/**
 * The contributor label next to a row in the settings list (README §3.1).
 *
 * This module is the *only* client-side owner of `GET /plugins`, and it is
 * deliberately unable to fail: the request is decoration, so every outcome — a
 * non-2xx answer, a body that is not the expected shape, a network error, a
 * shell with no fetch at all — resolves to "nothing is known about any panel".
 * The settings page then renders exactly what it rendered before this feature
 * existed, and the rail keeps being editable.
 *
 * One read per page mount, no polling: a profile's installed plugins do not
 * change while the settings dialog is open.
 * @module
 */
import { API_ROUTES } from '../../shared/protocol.ts'

/** Minimal fetch surface, so tests can inject a stub (mirrors `config/store.ts`). */
export interface FetchLike {
  (input: string, init?: { method?: string }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
}

/** Everything the settings page can learn about one panel's contributor. */
export interface PluginInfo {
  /** Package name, e.g. `@chengdb/capability-panel`. */
  package?: string
  /** Version or short commit, e.g. `1.1.0` or `94fc90d`. */
  version?: string
}

/** The store surface the settings page consumes. */
export interface PluginInfoStore {
  /** Current mapping; the same object identity until a read lands. */
  get(): Record<string, PluginInfo>
  /** Read once (called on mount); never rejects. */
  load(): Promise<void>
  /** Subscribe to changes. Returns the unsubscribe handle. */
  subscribe(listener: () => void): () => void
  dispose(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A printable label: a non-blank string, or `undefined`. */
export function label(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Accept only what the settings page can render: an object of objects carrying
 * at least one printable field. Everything else is dropped rather than passed
 * on, so a host that answers something unexpected degrades to "no subtitle"
 * instead of putting `undefined` in the markup.
 */
export function normalizePluginsResponse(value: unknown): Record<string, PluginInfo> {
  if (!isRecord(value)) return {}
  const plugins = value['plugins']
  if (!isRecord(plugins)) return {}
  const result: Record<string, PluginInfo> = {}
  for (const [id, entry] of Object.entries(plugins)) {
    if (!isRecord(entry)) continue
    const packageName = label(entry['package'])
    const version = label(entry['version'])
    if (packageName === undefined && version === undefined) continue
    result[id] = {
      ...(packageName === undefined ? {} : { package: packageName }),
      ...(version === undefined ? {} : { version }),
    }
  }
  return result
}

/**
 * Create the store.
 * @param options.fetch - fetch implementation (defaults to the global one).
 */
export function createPluginInfoStore(options: { fetch?: FetchLike } = {}): PluginInfoStore {
  const doFetch = options.fetch ?? ((input: string, init?: { method?: string }) => fetch(input, init))
  const listeners = new Set<() => void>()
  let current: Record<string, PluginInfo> = {}
  let disposed = false

  const publish = (next: Record<string, PluginInfo>): void => {
    current = next
    if (disposed) return
    for (const listener of listeners) listener()
  }

  return {
    get: () => current,
    load: async () => {
      if (disposed) return
      try {
        const response = await doFetch(API_ROUTES.plugins)
        if (!response.ok) return
        publish(normalizePluginsResponse(await response.json()))
      } catch {
        // Silent by design: this endpoint only decorates the list.
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
    },
  }
}
