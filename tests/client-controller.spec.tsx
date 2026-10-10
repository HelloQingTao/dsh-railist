/**
 * End-to-end wiring of the browser half: the real controller, the real icons /
 * groups / settings units, over a fake shell (ledger + layout + locale).
 *
 * This is the test that proves the seams hold: config → plan → registry rewrite
 * → group rows → settings registration, plus the degraded (read-only) path and
 * full restoration on unload.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_ICON_NAMES, emptyProfileConfig, type PanellistConfig, type ProfileConfig } from '../src/shared/config.ts'
import { createController, type PanellistController } from '../src/client/controller.ts'
import { createTranslator } from '../src/client/i18n/index.ts'
import { BuiltinGlyph, Glyph, glyphDataUri, sanitizeSvg } from '../src/client/icons/index.tsx'
import { createStyleRegistry } from '../src/client/styles.ts'
import type { HealthReport } from '../src/shared/protocol.ts'
import type { PanellistStore, StoreSnapshot } from '../src/client/config/store.ts'
import type { ClientContext } from '../src/client/ctx.ts'
import { FakeLedger } from './helpers/fake-ledger.ts'
import { enableHasSelectorSupport, disableHasSelectorSupport } from './setup.ts'

const RAIL = 'sidebar.panellist'
const MAIN = 'main'
const SETTINGS = 'settings.section'

const HEALTH: HealthReport = {
  ok: true,
  profileId: 'desktop',
  configPath: 'C:\\x\\.dsh\\panellist.json',
  schemaVersion: 2,
  storage: { writable: true, exists: true },
  corruption: { detected: false },
  migrations: [],
  checkedAt: '2026-10-10T03:00:00.000Z',
}

/** An in-memory store with the same notify/optimistic semantics as the real one. */
function fakeStore(initial: ProfileConfig = emptyProfileConfig()): PanellistStore & { profile: ProfileConfig; writes: number } {
  const listeners = new Set<() => void>()
  let profile = initial
  let revision = 0
  let snapshot: StoreSnapshot = {
    status: 'ready',
    profileId: 'desktop',
    profile,
    document: { schemaVersion: 2, profiles: { desktop: profile } } satisfies PanellistConfig,
    health: HEALTH,
    error: null,
    revision,
  }
  const publish = (): void => {
    revision += 1
    snapshot = { ...snapshot, profile, revision, document: { schemaVersion: 2, profiles: { desktop: profile } } }
    for (const listener of listeners) listener()
  }
  const store: PanellistStore & { profile: ProfileConfig; writes: number } = {
    profile: initial,
    writes: 0,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: () => Promise.resolve(),
    update: async (mutator) => {
      profile = mutator({ ...profile })
      store.profile = profile
      store.writes += 1
      publish()
      return true
    },
    importDocument: () => Promise.resolve({ ok: true }),
    exportDocument: () => JSON.stringify(snapshot.document),
    reset: async () => {
      profile = emptyProfileConfig()
      store.profile = profile
      publish()
      return true
    },
    reveal: () => Promise.resolve(true),
    dispose: () => { listeners.clear() },
  }
  return store
}

interface Harness {
  controller: PanellistController
  ledger: FakeLedger
  store: ReturnType<typeof fakeStore>
  styles: ReturnType<typeof createStyleRegistry>
  selected: string[]
  active: { id: string }
  /** Each panel's own glyph component, as registered. */
  originals: Map<string, unknown>
  settle(): Promise<void>
  dispose(): void
}

function harness(options: { profile?: ProfileConfig; activePanelId?: string } = {}): Harness {
  const ledger = new FakeLedger()
  for (const slot of [RAIL, MAIN, SETTINGS]) ledger.declare(slot)
  // One named glyph per panel, so a spec can tell "the wrapper replaced this
  // component" (identity differs from the captured original) apart from "these
  // two panels have different glyphs" (which is true no matter what we do).
  const originals = new Map<string, unknown>([
    ['plugins', (): null => null],
    ['schedules', (): null => null],
    ['skills', (): null => null],
  ])
  ledger.register({ name: RAIL, id: 'plugins', order: 0, label: 'Plugins' }, originals.get('plugins'))
  ledger.register({ name: RAIL, id: 'schedules', order: 10, label: () => 'Schedules' }, originals.get('schedules'))
  ledger.register({ name: RAIL, id: 'skills', order: 20, label: 'Skills' }, originals.get('skills'))
  for (const id of ['plugins', 'schedules', 'skills']) ledger.register({ name: MAIN, key: id }, () => null)

  const selected: string[] = []
  const active = { id: options.activePanelId ?? '' }
  const locale = { getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }
  const ctx = {
    slots: ledger,
    get: (name: string) => {
      if (name === 'layout') {
        return {
          panelInfo: {
            getSnapshot: () => ({ activePanelId: active.id === '' ? null : active.id }),
            subscribe: () => () => {},
          },
          selectPanel: (id: unknown) => { selected.push(String(id)) },
        }
      }
      if (name === 'locale') return locale
      return undefined
    },
    inject: () => () => {},
  } as unknown as ClientContext

  const store = fakeStore(options.profile)
  const styles = createStyleRegistry()
  const controller = createController({
    ctx,
    store,
    translate: createTranslator(locale),
    styles,
    glyph: Glyph,
    builtinNames: BUILTIN_ICON_NAMES,
    sanitizeSvg,
  })
  return {
    controller,
    ledger,
    store,
    styles,
    selected,
    active,
    originals,
    settle: () => new Promise<void>(resolve => { setTimeout(resolve, 0) }),
    dispose: () => { controller.dispose(); store.dispose() },
  }
}

function entry(ledger: FakeLedger, id: string): { component: unknown; options: { order?: number; label?: unknown } } {
  const found = ledger.entries(RAIL).find(candidate => candidate.options.id === id)
  if (found === undefined) throw new Error(`no rail entry ${id}`)
  return found as { component: unknown; options: { order?: number; label?: unknown } }
}

const controllers: Harness[] = []
afterEach(() => {
  for (const item of controllers.splice(0)) item.dispose()
  disableHasSelectorSupport()
})

function build(options: Parameters<typeof harness>[0] = {}): Harness {
  const made = harness(options)
  controllers.push(made)
  return made
}

describe('controller: wiring', () => {
  it('rewrites the rail from the configuration on mount', async () => {
    const h = build({
      profile: {
        sequence: [{ type: 'entry', id: 'skills' }, { type: 'entry', id: 'plugins' }],
        entries: { schedules: { label: 'Jobs', hidden: true } },
      },
    })
    h.controller.refresh()
    await h.settle()

    expect(h.controller.plan().rows.map(row => row.id)).toEqual(['skills', 'plugins', 'schedules'])
    expect(entry(h.ledger, 'skills').options.order).toBe(10)
    expect(entry(h.ledger, 'plugins').options.order).toBe(20)
    expect(entry(h.ledger, 'schedules').options.order).toBe(30)
    expect(typeof entry(h.ledger, 'schedules').options.label).toBe('function')
    expect((entry(h.ledger, 'schedules').options.label as () => string)()).toBe('Jobs')
    // Only the rows that need a marker or an icon got a wrapper. The harness
    // registers every entry with its own arrow function, so comparing two of
    // those to each other would pass with the wrapper feature deleted — the
    // comparison has to be against the SAME entry's captured original.
    expect(entry(h.ledger, 'schedules').component).not.toBe(h.originals.get('schedules'))
    expect(entry(h.ledger, 'skills').component).toBe(h.originals.get('skills'))
  })

  it('registers the settings section under the plugin id', () => {
    const h = build()
    h.controller.refresh()
    const section = h.ledger.entries(SETTINGS).find(candidate => candidate.options.id === 'dsh-panellist')
    expect(section).toBeDefined()
    expect(section?.options.order).toBe(100)
    expect(typeof section?.options.label === 'function' ? (section.options.label as () => string)() : section?.options.label).toBe('面板列表')
  })

  it('registers a group row plus its main page and keeps them in step with the plan', async () => {
    const h = build({ profile: { sequence: [{ type: 'group', id: 'group:w', members: ['schedules', 'skills'] }], entries: {} } })
    h.controller.refresh()
    await h.settle()
    expect(h.ledger.entries(RAIL).some(candidate => candidate.options.id === 'dsh-panellist:group:w')).toBe(true)
    expect(h.ledger.entries(MAIN).some(candidate => candidate.options.key === 'dsh-panellist:group:w')).toBe(true)
    expect(h.controller.plan().panels.get('schedules')?.suppressed).toBe(true)

    // Dissolve the group through the store: the row must disappear again.
    await h.store.update(profile => ({ ...profile, sequence: [{ type: 'entry', id: 'schedules' }] }))
    await h.settle()
    expect(h.ledger.entries(RAIL).some(candidate => candidate.options.id === 'dsh-panellist:group:w')).toBe(false)
    expect(h.ledger.entries(MAIN).some(candidate => candidate.options.key === 'dsh-panellist:group:w')).toBe(false)
  })

  it('re-projects when a new panel registers', async () => {
    const h = build({ profile: { sequence: [{ type: 'entry', id: 'skills' }], entries: {} } })
    h.controller.refresh()
    await h.settle()
    h.ledger.register({ name: RAIL, id: 'memory', order: 5, label: 'Memory' }, () => null)
    h.ledger.register({ name: MAIN, key: 'memory' }, () => null)
    await h.settle()
    // Configured first, then the unconfigured block in the contributors' own
    // order (plugins 0, memory 5, schedules 10) — README §2.8.
    expect(h.controller.plan().rows.map(row => row.id)).toEqual(['skills', 'plugins', 'memory', 'schedules'])
    expect(entry(h.ledger, 'memory').options.order).toBe(30)
  })

  it('reflects a configuration change immediately, without a reload', async () => {
    const h = build({ profile: emptyProfileConfig() })
    h.controller.refresh()
    await h.settle()
    expect(h.controller.plan().reordering).toBe(false)

    await h.store.update(profile => ({ ...profile, entries: { plugins: { label: 'Market' } } }))
    await h.settle()
    expect(h.controller.plan().panels.get('plugins')?.label).toBe('Market')
    expect((entry(h.ledger, 'plugins').options.label as () => string)()).toBe('Market')
  })

  it('exposes the selection surface the groups unit needs', () => {
    const h = build({ activePanelId: 'plugins' })
    h.controller.refresh()
    expect(h.controller.registered().map(panel => panel.id)).toEqual(['plugins', 'schedules', 'skills'])
  })
})

describe('controller: degradation', () => {
  it('writes nothing at all once the registry probe has failed', async () => {
    const h = build({ profile: { sequence: [{ type: 'entry', id: 'skills' }], entries: { plugins: { hidden: true } } } })
    // Make the ledger opaque so probe 1 fails, then run the self-check.
    const opaque = h.ledger as unknown as { entriesOfSlot(name: string): readonly unknown[] }
    const original = opaque.entriesOfSlot.bind(h.ledger)
    opaque.entriesOfSlot = (name: string) => original(name).map(item => ({
      component: (item as { component: unknown }).component,
      options: { ...(item as { options: Record<string, unknown> }).options },
    }))
    await h.controller.selfCheck.rerun()
    expect(h.controller.selfCheck.getState().readOnly).toBe(true)

    const before = entry(h.ledger, 'skills').options.order
    h.controller.refresh()
    await h.settle()
    expect(entry(h.ledger, 'skills').options.order).toBe(before)
    expect(h.controller.plan().panels.get('plugins')?.hidden).toBe(true)
  })

  it('turns a hidden row into an always-hidden row when the active prop is unavailable', async () => {
    enableHasSelectorSupport()
    const h = build({ profile: { entries: { plugins: { hidden: true } }, sequence: [] } })
    h.controller.refresh()
    expect(h.controller.plan().panels.get('plugins')?.hidden).toBe(true)
    expect(h.controller.plan().panels.get('plugins')?.suppressed).toBe(false)

    // No glyph is ever rendered in this environment, so probe 3 fails.
    await h.controller.selfCheck.rerun()
    expect(h.controller.selfCheck.getState().activeRuleDisabled).toBe(true)
    h.controller.refresh()
    await h.settle()
    const panel = h.controller.plan().panels.get('plugins')
    expect(panel?.hidden).toBe(false)
    expect(panel?.suppressed).toBe(true)
  })
})

describe('controller: teardown', () => {
  it('restores every touched entry, drops our rows and removes the stylesheet', async () => {
    const h = build({
      profile: {
        sequence: [{ type: 'entry', id: 'skills' }, { type: 'group', id: 'group:w', members: ['plugins'] }],
        entries: { schedules: { label: 'Jobs' } },
      },
    })
    const originalLabel = entry(h.ledger, 'schedules').options.label
    const originalComponent = entry(h.ledger, 'skills').component
    h.controller.refresh()
    await h.settle()
    expect(entry(h.ledger, 'schedules').options.label).not.toBe(originalLabel)

    h.controller.dispose()
    expect(entry(h.ledger, 'schedules').options.label).toBe(originalLabel)
    expect(entry(h.ledger, 'skills').component).toBe(originalComponent)
    expect(h.ledger.entries(RAIL).some(candidate => candidate.options.id === 'dsh-panellist:group:w')).toBe(false)
    expect(h.ledger.entries(SETTINGS).some(candidate => candidate.options.id === 'dsh-panellist')).toBe(false)
    // The injected stylesheet is gone, not merely detached: the id it adopts by
    // is the one the next mount would look for.
    expect(document.getElementById('dsh-panellist-styles')).toBeNull()
  })
})

describe('icons contract', () => {
  it('renders every built-in glyph name', () => {
    for (const name of BUILTIN_ICON_NAMES) {
      expect(BuiltinGlyph({ name, size: 16 })).toBeTruthy()
    }
    expect(glyphDataUri('list').startsWith('data:image/svg+xml')).toBe(true)
  })
})
