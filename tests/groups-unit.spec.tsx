/**
 * The groups unit's registration lifecycle: one row per live group, idempotent
 * reconciliation, re-registration on an order/label change, and teardown.
 *
 * The rail is a hand-written FAKE that records registrations — the real
 * `SlotRegistry` is the rail host's business, not this unit's.
 */
import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GlyphComponent, GlyphRequest, GroupUnit, GroupUnitDeps, RailHost, RailRowRegistration,
} from '../src/client/contracts.ts'
import { GROUPS_STYLE_ID } from '../src/client/groups/groups.css.ts'
import { createGroupUnit } from '../src/client/groups/index.ts'
import { createTranslator } from '../src/client/i18n/index.ts'
import { buildPlan, type Plan, type RegisteredPanel } from '../src/shared/model.ts'
import type { ProfileConfig, SequenceItem } from '../src/shared/config.ts'

afterEach(() => {
  cleanup()
  for (const node of document.querySelectorAll('[data-dsh-railist-portal]')) node.remove()
})

const RAIL_ID = 'dsh-railist:group:more'

const PANELS: RegisteredPanel[] = [
  { id: 'alpha', label: 'Alpha', order: 0 , container: 'top'},
  { id: 'beta', label: 'Beta', order: 10 , container: 'top'},
  { id: 'gamma', label: 'Gamma', order: 20 , container: 'top'},
]

function profile(sequence: SequenceItem[]): ProfileConfig {
  return { sequence, entries: {} }
}

const GROUP: SequenceItem = { type: 'group', id: 'group:more', label: 'More', members: ['beta', 'gamma'] }
const ALPHA: SequenceItem = { type: 'entry', id: 'alpha' }

interface Harness {
  unit: GroupUnit
  deps: GroupUnitDeps
  rail: RailHost
  registered: Map<string, RailRowRegistration>
  pages: Map<string, () => ReactNode>
  disposeCalls: string[]
  selectCalls: string[]
  styleChunks: Map<string, string>
  glyphRequests: GlyphRequest[]
  setPlan(next: Plan): void
  setActive(panelId: string): void
  setNativeGlyph(panelId: string, glyph: GlyphComponent): void
}

/**
 * Build the unit over a recording rail host.
 * @param registered - native panels the plan is built from.
 * @param initialProfile - the profile section (the plan input).
 */
function createHarness(registered: RegisteredPanel[], initialProfile: ProfileConfig): Harness {
  let plan = buildPlan(registered, initialProfile)
  let activePanelId = ''
  const planListeners = new Set<() => void>()
  const activeListeners = new Set<() => void>()
  const rows = new Map<string, RailRowRegistration>()
  const pages = new Map<string, () => ReactNode>()
  const disposeCalls: string[] = []
  const selectCalls: string[] = []
  const styleChunks = new Map<string, string>()
  const glyphRequests: GlyphRequest[] = []
  const nativeGlyphs = new Map<string, GlyphComponent>()

  const rail: RailHost = {
    nativeGlyph: panelId => nativeGlyphs.get(panelId) ?? null,
    hasPage: panelId => pages.has(panelId),
    selectPanel: (panelId) => {
      selectCalls.push(panelId)
      activePanelId = panelId
      for (const listener of [...activeListeners]) listener()
    },
    registerRow: (registration, page) => {
      rows.set(registration.railId, registration)
      pages.set(registration.railId, page)
      return () => {
        rows.delete(registration.railId)
        pages.delete(registration.railId)
        disposeCalls.push(registration.railId)
      }
    },
    activePanelId: () => activePanelId,
    subscribeActive: (listener) => {
      activeListeners.add(listener)
      return () => { activeListeners.delete(listener) }
    },
  }

  const deps: GroupUnitDeps = {
    // The unit never touches `ctx`; the seam declares it for the units that do.
    ctx: {} as unknown as GroupUnitDeps['ctx'],
    rail,
    plan: () => plan,
    translate: createTranslator(undefined),
    glyph: (props) => {
      glyphRequests.push(props)
      return <span data-testid="effective-glyph" data-size={String(props.size)} />
    },
    subscribe: (listener) => {
      planListeners.add(listener)
      return () => { planListeners.delete(listener) }
    },
    styles: {
      register: (id, css) => { styleChunks.set(id, css) },
      refresh: () => {},
      dispose: () => { styleChunks.clear() },
    },
  }

  return {
    unit: createGroupUnit(deps),
    deps,
    rail,
    registered: rows,
    pages,
    disposeCalls,
    selectCalls,
    styleChunks,
    glyphRequests,
    setPlan: (next) => {
      plan = next
      for (const listener of [...planListeners]) listener()
    },
    setActive: (panelId) => {
      activePanelId = panelId
      for (const listener of [...activeListeners]) listener()
    },
    setNativeGlyph: (panelId, glyph) => { nativeGlyphs.set(panelId, glyph) },
  }
}

/** The shell row: one `<button>` whose only child is the glyph. */
function ShellRow(props: { glyph: GlyphComponent; onClick?: () => void }): ReactElement {
  return (
    <button aria-label="More" onClick={props.onClick}>
      {props.glyph({ size: 20 })}
    </button>
  )
}

describe('groups unit — registration', () => {
  it('registers exactly one row per live group, with the plan order and label', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))

    expect([...harness.registered.keys()]).toEqual([RAIL_ID])
    const registration = harness.registered.get(RAIL_ID)
    expect(registration?.order).toBe(20)
    expect(registration?.label()).toBe('More')
    expect(registration?.rowAttributes).toEqual({ 'aria-haspopup': 'menu' })
    // The insurance page exists, so a programmatic selection cannot throw.
    expect(harness.rail.hasPage(RAIL_ID)).toBe(true)
    // The CSS chunk is registered while the unit is built, not lazily.
    expect(harness.styleChunks.has(GROUPS_STYLE_ID)).toBe(true)
  })

  it('registers no row for a dormant group (every member missing)', () => {
    const dormant: SequenceItem = { type: 'group', id: 'group:gone', members: ['ghost'] }
    const harness = createHarness(PANELS, profile([ALPHA, dormant]))

    // The plan keeps the dormant group (for the settings page) but gives it no
    // row, so the unit must filter it out itself.
    expect([...harness.deps.plan().groups.keys()]).toContain('group:gone')
    expect(harness.registered.size).toBe(0)
  })

  it('is idempotent: a second sync keeps the very same registration', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const first = harness.registered.get(RAIL_ID)

    harness.unit.sync()
    harness.unit.sync()

    expect(harness.registered.get(RAIL_ID)).toBe(first)
    expect(harness.disposeCalls).toEqual([])
  })

  it('re-registers (and only then disposes) when the plan order changes', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const first = harness.registered.get(RAIL_ID)

    harness.setPlan(buildPlan(PANELS, profile([GROUP, ALPHA])))

    expect(harness.disposeCalls).toEqual([RAIL_ID])
    const second = harness.registered.get(RAIL_ID)
    expect(second).not.toBe(first)
    expect(second?.order).toBe(10)
  })

  it('re-registers when the resolved label changes and resolves it lazily', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const renamed: SequenceItem = { type: 'group', id: 'group:more', label: 'Tools', members: ['beta', 'gamma'] }

    harness.setPlan(buildPlan(PANELS, profile([ALPHA, renamed])))

    expect(harness.disposeCalls).toEqual([RAIL_ID])
    expect(harness.registered.get(RAIL_ID)?.label()).toBe('Tools')
  })

  it('drops the row when the group leaves the plan', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))

    harness.setPlan(buildPlan(PANELS, profile([ALPHA])))

    expect(harness.registered.size).toBe(0)
    expect(harness.disposeCalls).toEqual([RAIL_ID])
  })

  it('renders the overview page for the group rail id', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const page = harness.pages.get(RAIL_ID)
    expect(page).toBeTypeOf('function')
    if (page === undefined) return

    const view = render(<>{page()}</>)
    const root = view.container.querySelector('[data-dsh-railist-overview="group:more"]')
    expect(root?.textContent).toContain('Beta')
    expect(root?.textContent).toContain('Gamma')
  })
})

describe('groups unit — trigger glyph', () => {
  it('marks the row with the group id and opens the flyout on a whole-row click', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')
    const rowClick = vi.fn()
    const view = render(<ShellRow glyph={registration.glyph} onClick={rowClick} />)
    const button = screen.getByRole('button', { name: 'More' })

    expect(view.container.querySelector('[data-dsh-railist-group="group:more"]')).not.toBeNull()
    expect(button.getAttribute('aria-haspopup')).toBe('menu')

    const click = createEvent.click(button)
    fireEvent(button, click)

    // The capture-phase listener cancels the row's own activation entirely: the
    // shell's handler never runs and the event never reaches the root.
    expect(click.defaultPrevented).toBe(true)
    expect(rowClick).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).not.toBeNull()
  })

  it('hands the group icon and the fallback panel glyph to deps.glyph', () => {
    const icon = { kind: 'builtin', name: 'grid' } as const
    const withIcon: SequenceItem = { type: 'group', id: 'group:more', label: 'More', icon, members: ['beta', 'gamma'] }
    const harness = createHarness(PANELS, profile([ALPHA, withIcon]))
    const native: GlyphComponent = (props) => <span data-native="" data-size={props.size} />
    harness.setNativeGlyph('beta', native)
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')

    render(<ShellRow glyph={registration.glyph} />)

    // The plan borrows the first live member (beta) as the trigger's fallback.
    const request = harness.glyphRequests.at(-1)
    expect(request?.size).toBe(20)
    expect(request?.icon).toEqual(icon)
    expect(request?.native).toBe(native)
    expect(request?.active).toBe(false)
  })

  it('flags the marker while any member owns the active panel', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')
    const view = render(<ShellRow glyph={registration.glyph} />)
    const marker = (): Element | null => view.container.querySelector('[data-dsh-railist-group-active]')

    expect(marker()).toBeNull()
    act(() => { harness.setActive('gamma') })
    expect(marker()).not.toBeNull()
    act(() => { harness.setActive('alpha') })
    expect(marker()).toBeNull()
  })

  it('hides the trigger row with the same marker a hidden panel uses', () => {
    // On-device regression: the editor showed the group as hidden while the rail
    // kept rendering it, because the trigger glyph never stamped the marker
    // `HIDE_CSS` matches.
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')
    const view = render(<ShellRow glyph={registration.glyph} />)
    const hiddenMarker = (): Element | null => view.container.querySelector('[data-dsh-railist-hidden]')

    expect(hiddenMarker()).toBeNull()
    expect(view.container.querySelector('[data-testid="effective-glyph"]')).not.toBeNull()

    act(() => {
      harness.setPlan(buildPlan(PANELS, profile([ALPHA, { ...GROUP, hidden: true }])))
    })
    expect(hiddenMarker()).not.toBeNull()
    // A hidden row paints nothing: the shell removes it, so the glyph is skipped.
    expect(view.container.querySelector('[data-testid="effective-glyph"]')).toBeNull()

    // README §2.3: a hidden row that is active comes back — for a group that
    // means "any member is the active panel".
    act(() => { harness.setActive('gamma') })
    expect(hiddenMarker()).toBeNull()
    expect(view.container.querySelector('[data-testid="effective-glyph"]')).not.toBeNull()
  })

  it('dispose() disposes every row, closes the menu and removes the portal container', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')
    render(<ShellRow glyph={registration.glyph} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menu')).not.toBeNull()
    expect(document.querySelector('[data-dsh-railist-portal]')).not.toBeNull()

    act(() => { harness.unit.dispose() })

    expect(harness.disposeCalls).toEqual([RAIL_ID])
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.querySelector('[data-dsh-railist-portal]')).toBeNull()
  })

  it('stops reacting to rail changes after dispose()', () => {
    const harness = createHarness(PANELS, profile([ALPHA, GROUP]))

    act(() => { harness.unit.dispose() })
    harness.setPlan(buildPlan(PANELS, profile([ALPHA, GROUP])))

    expect(harness.registered.size).toBe(0)
  })
})
