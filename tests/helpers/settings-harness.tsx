/**
 * Test-support builders for the settings page.
 *
 * This module is NOT part of the runtime page — `settings/index.tsx` never
 * imports it, so it stays out of the client bundle. It lives under
 * `client/settings/` because that directory is the settings unit's write scope,
 * and the three `tests/settings-*.spec.tsx` suites share it instead of each
 * re-declaring a 150-line fake.
 */
import { emptyProfileConfig, SCHEMA_VERSION, cloneProfileConfig, type BuiltinIconName, type RailistConfig, type ProfileConfig } from '../../src/shared/config.ts'
import { buildPlan, type Plan, type RegisteredPanel } from '../../src/shared/model.ts'
import type { HealthReport } from '../../src/shared/protocol.ts'
import type {
  GlyphProps,
  GlyphRequest,
  ProbeResult,
  SanitizeResult,
  SelfCheckState,
  SettingsUnitDeps,
} from '../../src/client/contracts.ts'
import type { ClientContext } from '../../src/client/ctx.ts'
import type { RailistStore, StoreSnapshot } from '../../src/client/config/store.ts'
import { createTranslator, type Translator } from '../../src/client/i18n/index.ts'
import { createPluginInfoStore, type PluginInfo } from '../../src/client/settings/pluginInfo.ts'
import type { StyleRegistry } from '../../src/client/styles.ts'

/** One `ctx.slots.register` call, as the fake context records it. */
export interface RecordedSection {
  name: string
  id: string
  order: number
  label: (() => string) | undefined
  component: unknown
}

export interface SelfCheckFake {
  state: SelfCheckState
  /** Patch the state and notify subscribers (e.g. flip one probe to failed). */
  set(patch: Partial<SelfCheckState>): void
  /** How many times `rerun()` was called. */
  reruns: number
}

export interface Harness {
  deps: SettingsUnitDeps
  /** Every profile the store accepted, in order. */
  updates: ProfileConfig[]
  profile(): ProfileConfig
  setProfile(next: ProfileConfig): void
  /** The live plan the deps report. */
  plan(): Plan
  snapshot(): StoreSnapshot
  registered: RegisteredPanel[]
  selfCheck: SelfCheckFake
  /** Registered settings sections, in call order. */
  sections: RecordedSection[]
  /** Keys passed to `ctx.slots.inject`. */
  injectKeys: string[]
  /** Ids/chunks handed to `styles.register`. */
  cssChunks: Map<string, string>
  resets: number
  reveals: number
  imports: ProfileConfig[]
  /** Notify every `deps.subscribe` listener without changing the profile. */
  notify(): void
  document(): RailistConfig
}

export interface HarnessOptions {
  profile?: ProfileConfig
  registered?: readonly RegisteredPanel[]
  health?: HealthReport | null
  selfCheck?: Partial<SelfCheckState>
  sanitizeSvg?: (source: string) => SanitizeResult
  translate?: Translator
  builtinNames?: readonly BuiltinIconName[]
  /**
   * Panel id → contributor, as `GET /plugins` would answer. Omitted means the
   * store starts empty and never resolves anything — the state every existing
   * test was written against, so none of them gain a subtitle by accident.
   */
  plugins?: Record<string, PluginInfo>
}

const DEFAULT_REGISTERED: readonly RegisteredPanel[] = [
  { id: 'plugins', label: 'Plugins', order: 10 , container: 'top'},
  { id: 'schedules', label: 'Scheduled tasks', order: 20 , container: 'top'},
  { id: 'skills', label: 'Skills', order: 30 , container: 'top'},
]

const DEFAULT_BUILTINS: readonly BuiltinIconName[] = ['grid', 'puzzle', 'sparkles', 'clock']

const DEFAULT_HEALTH: HealthReport = {
  ok: true,
  profileId: 'desktop',
  configPath: 'C:/Users/test/.dsh/railist.json',
  schemaVersion: SCHEMA_VERSION,
  storage: { writable: true, exists: true },
  corruption: { detected: false },
  migrations: [],
  checkedAt: '2026-10-10T00:00:00.000Z',
}

const OK_PROBES: readonly ProbeResult[] = [
  { id: 'registry', ok: true },
  { id: 'rail', ok: true },
  { id: 'active', ok: true },
  { id: 'settingsNav', ok: true },
]

const DEFAULT_SELF_CHECK: SelfCheckState = {
  results: OK_PROBES,
  degraded: false,
  readOnly: false,
  activeRuleDisabled: false,
  version: '0.2.0-rc.2',
}

function glyphStub(request: GlyphRequest): JSX.Element {
  const icon = request.icon
  const keepsOriginal = icon === null || icon.kind === 'original'
  const name = keepsOriginal
    ? 'native'
    : icon.kind === 'builtin' ? `builtin:${icon.name}` : 'custom'
  // A "keep original" request renders the contributor's component when one was
  // supplied, so a spec can assert that the page previews the icon the user
  // actually sees on the rail — the generic fallback is what you get without it.
  const Native = keepsOriginal ? request.native ?? null : null
  return (
    <span className="dsh-railist-harness-glyph" data-glyph={name} data-native={Native === null ? 'none' : 'yes'} data-size={request.size}>
      {Native === null ? null : <Native size={request.size} />}
    </span>
  )
}

/** Build a complete fake of the settings seam. */
export function createHarness(options: HarnessOptions = {}): Harness {
  const registered = [...(options.registered ?? DEFAULT_REGISTERED)]
  const health = options.health === undefined ? DEFAULT_HEALTH : options.health
  const t = options.translate ?? createTranslator(undefined)

  let current = cloneProfileConfig(options.profile ?? emptyProfileConfig())
  let status: StoreSnapshot['status'] = 'ready'
  let error: string | null = null
  let revision = 0
  let lastMoved: string | null = null
  const listeners = new Set<() => void>()
  const updates: ProfileConfig[] = []
  const imports: ProfileConfig[] = []
  const sections: RecordedSection[] = []
  const injectKeys: string[] = []
  const cssChunks = new Map<string, string>()
  let resets = 0
  let reveals = 0

  const configDocument = (): RailistConfig => ({
    schemaVersion: SCHEMA_VERSION,
    profiles: { desktop: cloneProfileConfig(current) },
  })

  const snapshot = (): StoreSnapshot => ({
    status,
    profileId: 'desktop',
    profile: cloneProfileConfig(current),
    document: configDocument(),
    health,
    error,
    movedRow: lastMoved,
    revision,
  })

  let cached = snapshot()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const bump = (): void => {
    revision += 1
    cached = snapshot()
    notify()
  }

  const store: RailistStore = {
    getSnapshot: () => cached,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: async () => {},
    update: async (mutator, moved) => {
      current = mutator(cloneProfileConfig(current))
      lastMoved = moved ?? null
      updates.push(cloneProfileConfig(current))
      bump()
      return true
    },
    importDocument: async (text) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
      }
      const profiles = (parsed as { profiles?: Record<string, ProfileConfig> } | null)?.profiles
      const chosen = profiles === undefined ? undefined : profiles['desktop']
      if (chosen === undefined) return { ok: false, error: 'document has no section for profile "desktop"' }
      current = cloneProfileConfig(chosen)
      imports.push(cloneProfileConfig(current))
      bump()
      return { ok: true }
    },
    exportDocument: () => `${JSON.stringify(configDocument(), null, 2)}\n`,
    reset: async () => {
      current = emptyProfileConfig()
      resets += 1
      bump()
      return true
    },
    reveal: async () => {
      reveals += 1
      return true
    },
    dispose: () => { listeners.clear() },
  }

  let selfState: SelfCheckState = { ...DEFAULT_SELF_CHECK, ...options.selfCheck }
  const selfListeners = new Set<() => void>()
  const selfCheck: SelfCheckFake = {
    get state() { return selfState },
    set: (patch) => {
      selfState = { ...selfState, ...patch }
      for (const listener of selfListeners) listener()
    },
    reruns: 0,
  }

  const styles: StyleRegistry = {
    register: (id, css) => { cssChunks.set(id, css) },
    refresh: () => {},
    dispose: () => { cssChunks.clear() },
  }

  const ctx = {
    slots: {
      inject: (key: string, callback: () => () => void): (() => void) => {
        injectKeys.push(key)
        return callback()
      },
      register: (sectionOptions: Record<string, unknown>, component: unknown): (() => void) => {
        const label = sectionOptions['label']
        sections.push({
          name: String(sectionOptions['name']),
          id: String(sectionOptions['id']),
          order: Number(sectionOptions['order']),
          label: typeof label === 'function' ? label as () => string : undefined,
          component,
        })
        return () => {}
      },
    },
  } as unknown as ClientContext

  const deps: SettingsUnitDeps = {
    ctx,
    store,
    plan: () => buildPlan(registered, current),
    registered: () => registered,
    snapshot: () => cached,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    selfCheck: {
      getState: () => selfState,
      subscribe: (listener) => {
        selfListeners.add(listener)
        return () => { selfListeners.delete(listener) }
      },
      rerun: async () => {
        selfCheck.reruns += 1
        for (const listener of selfListeners) listener()
      },
    },
    translate: t,
    glyph: glyphStub,
    // Every registered panel answers with its own distinguishable component,
    // exactly as the rail adapter does for a contributor that has not been wrapped.
    nativeGlyph: (panelId: string) => (registered.some(panel => panel.id === panelId)
      ? (props: GlyphProps) => <span data-native-panel={panelId} data-size={props.size} />
      : null),
    builtinNames: options.builtinNames ?? DEFAULT_BUILTINS,
    sanitizeSvg: options.sanitizeSvg ?? (source => (source.includes('<script')
      ? { ok: false, reason: 'script element' }
      : { ok: true, svg: source })),
    health: () => health,
    // The response the harness was configured with, delivered through the real
    // store so a test exercises the same normalization the browser does. The
    // default is an empty map, which is also what a host that predates the
    // route answers — so no existing test gains a subtitle by accident.
    plugins: createPluginInfoStore({
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ plugins: options.plugins ?? {} }),
      }),
    }),
    styles,
  }

  return {
    deps,
    updates,
    profile: () => current,
    setProfile: (next) => {
      current = cloneProfileConfig(next)
      bump()
    },
    plan: () => buildPlan(registered, current),
    snapshot: () => cached,
    registered,
    selfCheck,
    sections,
    injectKeys,
    cssChunks,
    get resets() { return resets },
    get reveals() { return reveals },
    imports,
    notify,
    document: configDocument,
  }
}
