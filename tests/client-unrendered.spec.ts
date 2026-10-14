/**
 * The controller's "is this row on screen?" wiring, and the timing it has to
 * survive.
 *
 * `PlanRow.unrendered` is answered from the DOM, and the DOM is the one input
 * that arrives LATE: a row element exists only after React has rendered the
 * entry and the placement pass has stamped it. So the controller cannot read the
 * rail once and be done — and it equally cannot re-run on every read, or the
 * `CASCADE_LIMIT` guard fires and the shell logs "recomputation did not settle".
 *
 * These specs pin both halves: the answer is picked up once the rows appear, and
 * the convergence costs a bounded number of passes and settles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_ICON_NAMES, emptyProfileConfig, type RailistConfig, type ProfileConfig } from '../src/shared/config.ts'
import { createController, type RailistController } from '../src/client/controller.ts'
import { createTranslator } from '../src/client/i18n/index.ts'
import { Glyph, sanitizeSvg } from '../src/client/icons/index.tsx'
import { createStyleRegistry } from '../src/client/styles.ts'
import { ROW_ATTR, SEAT_CONTAINER_SUFFIX, SEAT_SLOT_ATTR } from '../src/client/rail/dom.ts'
import type { HealthReport } from '../src/shared/protocol.ts'
import type { RailistStore, StoreSnapshot } from '../src/client/config/store.ts'
import type { ClientContext } from '../src/client/ctx.ts'
import { FakeLedger } from './helpers/fake-ledger.ts'

const RAIL = 'sidebar.panellist'
const MAIN = 'main'
const SETTINGS = 'settings.section'

const HEALTH: HealthReport = {
  ok: true,
  profileId: 'desktop',
  configPath: 'C:\\x\\.dsh\\railist.json',
  schemaVersion: 2,
  storage: { writable: true, exists: true },
  corruption: { detected: false },
  migrations: [],
  checkedAt: '2026-10-10T03:00:00.000Z',
}

function fakeStore(initial: ProfileConfig = emptyProfileConfig()): RailistStore {
  const listeners = new Set<() => void>()
  let profile = initial
  let revision = 0
  let snapshot: StoreSnapshot = {
    status: 'ready',
    profileId: 'desktop',
    profile,
    document: { schemaVersion: 2, profiles: { desktop: profile } } satisfies RailistConfig,
    health: HEALTH,
    error: null,
    movedRow: null,
    revision,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load: () => Promise.resolve(),
    update: async (mutator) => {
      profile = mutator({ ...profile })
      revision += 1
      snapshot = { ...snapshot, profile, revision, document: { schemaVersion: 2, profiles: { desktop: profile } } }
      for (const listener of listeners) listener()
      return true
    },
    importDocument: () => Promise.resolve({ ok: true }),
    exportDocument: () => JSON.stringify(snapshot.document),
    reset: async () => true,
    reveal: () => Promise.resolve(true),
    dispose: () => { listeners.clear() },
  }
}

/**
 * Render the panel-list seat the way the shell does, stamping the rows the rail
 * is actually showing. A row left out of `visible` is a registration that
 * renders nothing — the whole case this feature exists for.
 */
function paintRail(visible: readonly string[]): void {
  const host = document.createElement('nav')
  host.className = `hHd-Xa${SEAT_CONTAINER_SUFFIX.top}`
  for (const id of visible) {
    const element = document.createElement('button')
    const anchor = document.createElement('div')
    anchor.setAttribute('data-slot', SEAT_SLOT_ATTR.top)
    element.append(anchor)
    element.setAttribute(ROW_ATTR, id)
    host.append(element)
  }
  document.body.append(host)
}

interface Harness {
  controller: RailistController
  ledger: FakeLedger
  warnings: string[]
  settle(): Promise<void>
  dispose(): void
}

const seen: Harness[] = []

function build(profile: ProfileConfig): Harness {
  const ledger = new FakeLedger()
  for (const slot of [RAIL, MAIN, SETTINGS]) ledger.declare(slot)
  // `ghost` is registered exactly like the others, but no row element is ever
  // painted for it: its own component renders nothing right now.
  const registered = ['plugins', 'schedules', 'ghost']
  for (const [index, id] of registered.entries()) {
    ledger.register({ name: RAIL, id, order: index * 10, label: id }, () => null)
    ledger.register({ name: MAIN, key: id }, () => null)
  }

  const warnings: string[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  })

  const locale = { getLocale: () => ({ active: 'en' }), subscribe: () => () => {} }
  const ctx = {
    slots: ledger,
    get: (name: string) => {
      if (name === 'layout') {
        return {
          panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
          selectPanel: () => {},
        }
      }
      if (name === 'locale') return locale
      return undefined
    },
    inject: () => () => {},
  } as unknown as ClientContext

  const controller = createController({
    ctx,
    store: fakeStore(profile),
    translate: createTranslator(locale),
    styles: createStyleRegistry(),
    glyph: Glyph,
    builtinNames: BUILTIN_ICON_NAMES,
    sanitizeSvg,
  })

  const made: Harness = {
    controller,
    ledger,
    warnings,
    settle: () => new Promise<void>(resolve => { setTimeout(resolve, 0) }),
    dispose: () => { controller.dispose(); warn.mockRestore() },
  }
  seen.push(made)
  return made
}

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => {
  for (const item of seen.splice(0)) item.dispose()
  vi.restoreAllMocks()
})

describe('controller: the unrendered flag', () => {
  it('picks the answer up once the rail has painted, and then settles', async () => {
    const h = build(emptyProfileConfig())
    // The page mounts before the sidebar does: nothing to read yet, so nothing
    // may be claimed as unrendered.
    h.controller.refresh()
    await h.settle()
    expect(h.controller.plan().rows.every(row => row.unrendered === false)).toBe(true)

    // The sidebar paints, showing two of the three registered rows.
    paintRail(['plugins', 'schedules'])
    await h.settle()
    await h.settle()

    const plan = h.controller.plan()
    expect(plan.rows.map(row => row.id)).toEqual(['plugins', 'schedules', 'ghost'])
    expect(plan.rows.filter(row => row.unrendered).map(row => row.id)).toEqual(['ghost'])

    // The convergence is bounded: a pass that learns nothing new must not
    // schedule another one, or the guard trips and the shell logs the warning.
    expect(h.warnings.filter(text => text.includes('did not settle'))).toEqual([])
  })

  it('claims nothing when the rail never renders at all', async () => {
    // No seat, ever. "I cannot see the rail" must not be read as "the rail is
    // empty": an unmounted sidebar would otherwise badge every single row.
    const h = build(emptyProfileConfig())
    h.controller.refresh()
    await h.settle()
    await h.settle()
    expect(h.controller.plan().rows.every(row => row.unrendered === false)).toBe(true)
    expect(h.warnings.filter(text => text.includes('did not settle'))).toEqual([])
  })

  it('tells an orphan apart from a registered-but-unrendered row', async () => {
    // `plugins` is configured and on screen, `ghost` is configured and inert,
    // `vanished` is configured with nothing registered behind it at all.
    const h = build({ sequence: [{ type: 'entry', id: 'vanished' }], entries: {} })
    paintRail(['plugins', 'schedules'])
    h.controller.refresh()
    await h.settle()
    await h.settle()

    const plan = h.controller.plan()
    expect(plan.orphans).toContain('vanished')
    expect(plan.rows.filter(row => row.unrendered).map(row => row.id)).toEqual(['ghost'])
    // Nothing is ever both: an orphan has no registration, a live row does.
    for (const row of plan.rows) {
      if (plan.orphans.includes(row.id)) expect(row.unrendered).toBe(false)
    }
  })
})
