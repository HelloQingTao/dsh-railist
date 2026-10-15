/**
 * The group flyout: placement, dismissal, keyboard selection and the missing
 * member case. Rendered through the real unit over a recording rail host, so the
 * spec proves the trigger wiring and the overlay together.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  GlyphComponent, GlyphRequest, GroupUnitDeps, RailHost, RailRowRegistration,
} from '../src/client/contracts.ts'
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

const ALPHA: SequenceItem = { type: 'entry', id: 'alpha' }
const GROUP: SequenceItem = { type: 'group', id: 'group:more', label: 'More', members: ['beta', 'gamma'] }

interface Harness {
  deps: GroupUnitDeps
  registered: Map<string, RailRowRegistration>
  selectCalls: string[]
  activateCalls: string[]
  /** Fake `main`-page registrations, keyed by panel id. */
  pages: Map<string, () => ReactNode>
  glyphRequests: GlyphRequest[]
  dispose(): void
  setActive(panelId: string): void
}

function createHarness(sequence: SequenceItem[], entries: ProfileConfig['entries'] = {}): Harness {
  const profile: ProfileConfig = { sequence, entries }
  let plan: Plan = buildPlan(PANELS, profile)
  let activePanelId = ''
  const planListeners = new Set<() => void>()
  const activeListeners = new Set<() => void>()
  const rows = new Map<string, RailRowRegistration>()
  const pages = new Map<string, () => ReactNode>()
  const selectCalls: string[] = []
  const activateCalls: string[] = []
  const glyphRequests: GlyphRequest[] = []

  const rail: RailHost = {
    nativeGlyph: () => null,
    hasPage: panelId => pages.has(panelId),
    selectPanel: (panelId) => {
      selectCalls.push(panelId)
      activePanelId = panelId
      for (const listener of [...activeListeners]) listener()
    },
    activateRow: (panelId) => {
      activateCalls.push(panelId)
    },
    registerRow: (registration, page) => {
      rows.set(registration.railId, registration)
      pages.set(registration.railId, page)
      return () => {
        rows.delete(registration.railId)
        pages.delete(registration.railId)
      }
    },
    activePanelId: () => activePanelId,
    subscribeActive: (listener) => {
      activeListeners.add(listener)
      return () => { activeListeners.delete(listener) }
    },
  }

  const deps: GroupUnitDeps = {
    ctx: {} as unknown as GroupUnitDeps['ctx'],
    rail,
    plan: () => plan,
    translate: createTranslator(undefined),
    glyph: (request) => {
      glyphRequests.push(request)
      return <span data-testid="effective-glyph" data-size={String(request.size)} />
    },
    subscribe: (listener) => {
      planListeners.add(listener)
      return () => { planListeners.delete(listener) }
    },
    styles: { register: () => {}, refresh: () => {}, dispose: () => {} },
  }

  const unit = createGroupUnit(deps)
  // Standard members carry a `main` page, exactly as a real registration does —
  // `select()` routes them to `selectPanel`. A member WITHOUT a page (a footer
  // action) is the subject of the `activateRow` test below.
  for (const panel of PANELS) pages.set(panel.id, () => null)
  return {
    deps,
    registered: rows,
    selectCalls,
    activateCalls,
    pages,
    glyphRequests,
    dispose: () => { unit.dispose() },
    setActive: (panelId) => {
      activePanelId = panelId
      for (const listener of [...activeListeners]) listener()
    },
  }
}

/** The shell row: one `<button>` whose only child is the glyph. */
function ShellRow(props: { glyph: GlyphComponent; onClick?: () => void; onKeyDown?: () => void }): ReactElement {
  return (
    <button aria-label="More" onClick={props.onClick} onKeyDown={props.onKeyDown}>
      {props.glyph({ size: 20 })}
    </button>
  )
}

function makeRect(partial: Partial<DOMRect>): DOMRect {
  const left = partial.left ?? 0
  const top = partial.top ?? 0
  const width = partial.width ?? 0
  const height = partial.height ?? 0
  return {
    left,
    top,
    width,
    height,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** Mount the trigger inside a shell-like row and open the menu. */
function openMenu(harness: Harness, rect: Partial<DOMRect>): HTMLButtonElement {
  const registration = harness.registered.get(RAIL_ID)
  if (registration === undefined) throw new Error('group row was not registered')
  render(<ShellRow glyph={registration.glyph} />)
  const button = screen.getByRole('button', { name: 'More' }) as HTMLButtonElement
  button.getBoundingClientRect = () => makeRect(rect)
  fireEvent.click(button)
  return button
}

/** The portaled card. */
function card(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-dsh-railist-flyout]')
  if (found === null) throw new Error('the flyout card is not in the document')
  return found
}

describe('groups flyout — placement', () => {
  it('portals the card into a fixed container appended to document.body', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 200, height: 36 })

    const container = card().parentElement
    expect(container?.hasAttribute('data-dsh-railist-portal')).toBe(true)
    expect(container?.parentElement).toBe(document.body)
    expect(card().style.position).toBe('fixed')
  })

  it('flies out to the RIGHT of a collapsed row', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    expect(card().style.left).toBe('52px')
    expect(card().style.top).toBe('100px')
    expect(card().style.visibility).toBe('visible')
  })

  it('drops BELOW a wide row', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 24, top: 100, width: 200, height: 36 })

    expect(card().style.left).toBe('24px')
    expect(card().style.top).toBe('144px')
  })

  it('flips above the row at the bottom viewport edge', () => {
    const harness = createHarness([ALPHA, GROUP])
    // jsdom's viewport is 1024x768; 760 + 8 would clip the 8px margin.
    openMenu(harness, { left: 24, top: 700, width: 200, height: 60 })

    expect(card().style.top).toBe('692px')
    expect(card().style.left).toBe('24px')
  })

  it('flips left of the row at the right viewport edge', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 984, top: 100, width: 36, height: 36 })

    expect(card().style.left).toBe('976px')
  })
})

describe('groups flyout — interaction', () => {
  it('closes on Escape and restores focus to the row', () => {
    const harness = createHarness([ALPHA, GROUP])
    const button = openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(menu)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('closes on an outside mousedown', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('selects the highlighted member with ArrowDown then Enter', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })
    const menu = screen.getByRole('menu')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(menu.querySelector('[data-dsh-railist-flyout-highlighted]')?.textContent).toContain('Beta')

    fireEvent.keyDown(menu, { key: 'Enter' })

    expect(harness.selectCalls).toEqual(['beta'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('selects a member by click', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Gamma' }))

    expect(harness.selectCalls).toEqual(['gamma'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keeps the header to the group title, with no second destination in it', () => {
    // The menu's job is the members. An "Overview" link to the group's own page
    // used to sit in this header; it was removed on user feedback, and the page
    // itself stays registered as the group's `main` fallback (groups-unit spec).
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    const header = document.querySelector('[data-dsh-railist-flyout-header]')
    expect(header?.textContent).toBe('Group: More')
    expect(header?.querySelector('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull()
    // Nothing in the header navigates: `selectCalls` stays empty until a member
    // is clicked.
    expect(harness.selectCalls).toEqual([])
  })

  it('marks the member that owns the active panel', () => {
    const harness = createHarness([ALPHA, GROUP])
    act(() => { harness.setActive('beta') })
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    const current = screen.getByRole('menu').querySelector('[data-dsh-railist-flyout-current]')
    expect(current?.textContent).toContain('Beta')
    expect(current?.getAttribute('aria-current')).toBe('true')
  })

  it('does not leak a click inside the card to the shell row', () => {
    const harness = createHarness([ALPHA, GROUP])
    const rowClick = vi.fn()
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')
    render(<ShellRow glyph={registration.glyph} onClick={rowClick} />)
    const button = screen.getByRole('button', { name: 'More' }) as HTMLButtonElement
    button.getBoundingClientRect = () => makeRect({ left: 8, top: 100, width: 36, height: 36 })
    fireEvent.click(button)
    expect(rowClick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }))

    // A portal stays inside the row in the React tree; the selection must not be
    // overwritten by the row's own click handler running afterwards.
    expect(rowClick).not.toHaveBeenCalled()
    expect(harness.selectCalls).toEqual(['beta'])
  })

  it('does not leak a keypress inside the card to the shell row', () => {
    const harness = createHarness([ALPHA, GROUP])
    const rowKeyDown = vi.fn()
    const registration = harness.registered.get(RAIL_ID)
    if (registration === undefined) throw new Error('group row was not registered')
    render(<ShellRow glyph={registration.glyph} onKeyDown={rowKeyDown} />)
    const button = screen.getByRole('button', { name: 'More' }) as HTMLButtonElement
    button.getBoundingClientRect = () => makeRect({ left: 8, top: 100, width: 36, height: 36 })
    fireEvent.click(button)

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })

    expect(rowKeyDown).not.toHaveBeenCalled()
    expect(harness.selectCalls).toEqual(['gamma'])
  })

  it('evokes a member without a main page instead of selecting it', () => {
    // A footer action (e.g. the capability panel) registers no `main` page:
    // `selectPanel` is a guarded no-op there, so the member's own row is
    // evoked for one interaction and its real button is clicked instead —
    // the native behaviour keeps working from inside the group.
    const harness = createHarness([ALPHA, GROUP])
    harness.pages.delete('gamma')
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    fireEvent.click(screen.getByRole('menuitem', { name: 'Gamma' }))

    expect(harness.activateCalls).toEqual(['gamma'])
    expect(harness.selectCalls).toEqual([])
  })
})

describe('groups flyout — missing members', () => {
  const WITH_MISSING: SequenceItem = {
    type: 'group', id: 'group:more', label: 'More', members: ['ghost', 'beta'],
  }

  it('leaves a missing member out of the menu instead of parking a dead row in it', () => {
    // A missing member's registration is gone: a disabled "missing" row only
    // took up room the user cannot act on. The settings page is where one gets
    // cleaned up, so the menu just leaves it out.
    const harness = createHarness([ALPHA, WITH_MISSING])
    const registration = harness.registered.get(RAIL_ID)
    expect(registration?.order).toBe(20)
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    const items = screen.getAllByRole('menuitem') as HTMLButtonElement[]
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('Beta')
    expect(items[0]?.disabled).toBe(false)
    expect(screen.queryByText('ghost')).toBeNull()

    // The remaining member is selectable; nothing traps the keyboard cursor.
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(harness.selectCalls).toEqual(['beta'])
  })

  it('renders every member through deps.glyph at the flyout size', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    // The trigger glyph plus one glyph per member.
    expect(screen.getAllByTestId('effective-glyph')).toHaveLength(3)
    // 20 for the row, 18 inside the flyout (the card measures itself, so it
    // renders one extra time before it becomes visible).
    expect([...new Set(harness.glyphRequests.map(request => request.size))].sort()).toEqual([18, 20])
  })
})

describe('groups flyout — hidden members', () => {
  it('leaves a hidden member out of the menu but keeps it in the group', () => {
    // Hiding a member means "not in this menu": its rail row is already
    // suppressed, so the rail never showed it. The member stays a member — the
    // group row, its order and its highlight are unaffected.
    const harness = createHarness([ALPHA, GROUP], { beta: { hidden: true } })
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]?.textContent).toContain('Gamma')
    expect(screen.queryByText('Beta')).toBeNull()
  })

  it('says so when every member is hidden', () => {
    const harness = createHarness([ALPHA, GROUP], { beta: { hidden: true }, gamma: { hidden: true } })
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    expect(screen.getByText('No panel is shown in this group.')).toBeTruthy()
  })
})
