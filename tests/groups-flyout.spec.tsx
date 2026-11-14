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
import { GROUPS_CSS } from '../src/client/groups/groups.css.ts'
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
  /** Mutable hover behaviour the deps closure reads on each event. */
  behavior: { hoverOpenGroups: boolean; hoverOpenDelayMs: number }
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
  const behavior = { hoverOpenGroups: true, hoverOpenDelayMs: 150 }

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
    behavior: () => behavior,
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
    behavior,
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

/** Mount the trigger inside a shell-like row (no click). */
function mountRow(harness: Harness, rect: Partial<DOMRect>): HTMLButtonElement {
  const registration = harness.registered.get(RAIL_ID)
  if (registration === undefined) throw new Error('group row was not registered')
  render(<ShellRow glyph={registration.glyph} />)
  const button = screen.getByRole('button', { name: 'More' }) as HTMLButtonElement
  button.getBoundingClientRect = () => makeRect(rect)
  return button
}

/** Mount the trigger inside a shell-like row and open the menu at a pointer. */
function openMenu(
  harness: Harness,
  rect: Partial<DOMRect>,
  point: { clientX: number; clientY: number } = { clientX: 0, clientY: 0 },
): HTMLButtonElement {
  const button = mountRow(harness, rect)
  fireEvent.click(button, point)
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
    openMenu(harness, { left: 8, top: 100, width: 200, height: 36 }, { clientX: 120, clientY: 200 })

    const container = card().parentElement
    expect(container?.hasAttribute('data-dsh-railist-portal')).toBe(true)
    expect(container?.parentElement).toBe(document.body)
    expect(card().style.position).toBe('fixed')
  })

  it('appears directly below the pointer, aligned to its x', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 }, { clientX: 120, clientY: 200 })

    expect(card().style.left).toBe('120px')
    expect(card().style.top).toBe('210px')
    expect(card().style.visibility).toBe('visible')
  })

  it('keeps a gap below the trigger row when the pointer rests on the row', () => {
    const harness = createHarness([ALPHA, GROUP])
    // The row spans y=100..136; a pointer at y=118 sits on it, so the card must
    // clear the row: top = row.bottom (136) + gap (10), left = pointer x (60).
    openMenu(harness, { left: 8, top: 100, width: 200, height: 36 }, { clientX: 60, clientY: 118 })

    expect(card().style.top).toBe('146px')
    expect(card().style.left).toBe('60px')
  })

  it('flips left of the pointer when the card would clip the right edge', () => {
    const harness = createHarness([ALPHA, GROUP])
    // jsdom's viewport is 1024x768; a left edge at 1020 clips the 8px margin.
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 }, { clientX: 1020, clientY: 200 })

    expect(card().style.left).toBe('1010px')
  })

  it('flips above the pointer when the card would clip the bottom edge', () => {
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 }, { clientX: 120, clientY: 765 })

    expect(card().style.top).toBe('755px')
    expect(card().style.left).toBe('120px')
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

  it('opens straight into the members, with no group title above them', () => {
    // The trigger row already names the group, so a "Group: <name>" line inside
    // the card only repeated it and pushed the first member down a line (user
    // feedback, 2026-10-25). An "Overview" link was removed earlier for the same
    // reason; that page stays registered as the group's `main` fallback.
    const harness = createHarness([ALPHA, GROUP])
    openMenu(harness, { left: 8, top: 100, width: 36, height: 36 })

    expect(document.querySelector('[data-dsh-railist-flyout-header]')).toBeNull()
    expect(document.querySelector('[data-dsh-railist-flyout-title]')).toBeNull()
    const card = document.querySelector('[data-dsh-railist-flyout]')
    expect(card?.querySelector('[role="menu"]')).not.toBeNull()
    // The card is only the surface layers plus the list: the members are in it,
    // the group's own name is not (it would be the "Group: More" title again).
    expect(card?.textContent).toContain('Beta')
    expect(card?.textContent).not.toContain('More')
    // Layer order is load-bearing: both layers paint at z-index -1, so DOM order
    // alone decides that the fill sits on top of the macOS backing plate.
    // Reversed, the opaque plate would bury the translucent fill and only the
    // screenshot would notice — so assert the order here.
    const layers = Array.from(card?.children ?? [])
      .filter(child => child.hasAttribute('data-dsh-railist-flyout-backing')
        || child.hasAttribute('data-dsh-railist-flyout-material'))
      .map(child => (
        child.hasAttribute('data-dsh-railist-flyout-backing') ? 'backing' : 'material'
      ))
    expect(layers).toEqual(['backing', 'material'])
    expect(screen.queryByRole('button', { name: 'Overview' })).toBeNull()
    // Nothing outside the members navigates: `selectCalls` stays empty until a
    // member is clicked.
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
    // 20 for the row, 14 inside the flyout — the shell's menu item icon size.
    // (The card measures itself, so it renders one extra time before it becomes
    // visible.)
    expect([...new Set(harness.glyphRequests.map(request => request.size))].sort()).toEqual([14, 20])
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

describe('groups flyout — hover', () => {
  afterEach(() => { vi.useRealTimers() })

  it('opens after the hover delay, without stealing focus', () => {
    vi.useFakeTimers()
    const harness = createHarness([ALPHA, GROUP])
    const button = mountRow(harness, { left: 8, top: 100, width: 200, height: 36 })

    fireEvent.mouseEnter(button)
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => { vi.advanceTimersByTime(150) })
    const menu = screen.getByRole('menu')
    expect(menu).toBeTruthy()
    // A hover must never pull keyboard focus out of wherever the user was.
    expect(document.activeElement).not.toBe(menu)
  })

  it('does not open on hover when the behaviour is off, but a click still does', () => {
    vi.useFakeTimers()
    const harness = createHarness([ALPHA, GROUP])
    harness.behavior.hoverOpenGroups = false
    const button = mountRow(harness, { left: 8, top: 100, width: 36, height: 36 })

    fireEvent.mouseEnter(button)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(button)
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('cancels the pending open when the pointer leaves before the delay', () => {
    vi.useFakeTimers()
    const harness = createHarness([ALPHA, GROUP])
    const button = mountRow(harness, { left: 8, top: 100, width: 36, height: 36 })

    fireEvent.mouseEnter(button)
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.mouseLeave(button)
    act(() => { vi.advanceTimersByTime(500) })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('appears at the pointer in hover mode too', () => {
    vi.useFakeTimers()
    const harness = createHarness([ALPHA, GROUP])
    const button = mountRow(harness, { left: 24, top: 100, width: 200, height: 36 })

    fireEvent.mouseEnter(button, { clientX: 300, clientY: 240 })
    act(() => { vi.advanceTimersByTime(150) })

    expect(card().style.left).toBe('300px')
    expect(card().style.top).toBe('250px')
  })

  it('keeps the menu open while the pointer is inside the card, then closes after the grace', () => {
    vi.useFakeTimers()
    const harness = createHarness([ALPHA, GROUP])
    const button = mountRow(harness, { left: 8, top: 100, width: 36, height: 36 })

    fireEvent.mouseEnter(button)
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getByRole('menu')).toBeTruthy()

    // Travelling from the row into the card: the card's enter cancels the close.
    fireEvent.mouseLeave(button)
    fireEvent.mouseEnter(card())
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('menu')).not.toBeNull()

    // Leaving the card closes it after the 220 ms grace.
    fireEvent.mouseLeave(card())
    act(() => { vi.advanceTimersByTime(219) })
    expect(screen.queryByRole('menu')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(2) })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('groups flyout — style contract', () => {
  // The surface is a CSS chunk of strings: jsdom cannot tell us it still
  // matches the shell's menu, and a deleted rule or a renamed token would only
  // show up as a screenshot difference. These assertions are the cheap guard
  // for exactly that.
  it('keeps the shell surface metrics', () => {
    expect(GROUPS_CSS).toContain('min-width: 144px')
    expect(GROUPS_CSS).toContain('max-width: min(360px, calc(100vw - 16px))')
    expect(GROUPS_CSS).toContain('box-shadow: var(--dsw-elevation-prominent')
    // The hairline follows the shell's two steps: light baseline l1, dark l3.
    // Both the selector AND its value are asserted, so swapping the two
    // assignments cannot pass.
    expect(GROUPS_CSS).toMatch(
      /\[data-dsh-railist-flyout\][^{]*\{[^}]*--dsw-elevation-stroke-color: var\(--dsw-alias-border-l1\)/,
    )
    expect(GROUPS_CSS).toMatch(
      /body\[data-ds-dark-theme\] \[data-dsh-railist-flyout\][^{]*\{[^}]*--dsw-elevation-stroke-color: var\(--dsw-alias-border-l3\)/,
    )
    expect(GROUPS_CSS).toContain('min-height: 34px')
    expect(GROUPS_CSS).toContain('gap: 6px')
  })

  it('keeps the padding on the card and the scrolling on the list', () => {
    // Padding on the scroller scrolls away with the first row; the shell keeps
    // it on the card and scrolls an inner list. Assert the split, so a future
    // "tidy-up" that moves the padding back fails here.
    expect(GROUPS_CSS).toMatch(/\[data-dsh-railist-flyout\][^{]*\{[^}]*padding: 4px/)
    const listRule = GROUPS_CSS.match(/\[data-dsh-railist-flyout-menu\][^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(listRule).toContain('overflow: auto')
    expect(listRule).toContain('min-height: 0')
    expect(listRule).not.toContain('padding:')
  })

  it('keeps the two surface layers and the macOS plate', () => {
    expect(GROUPS_CSS).toContain('[data-dsh-railist-flyout-material]')
    expect(GROUPS_CSS).toContain('[data-dsh-railist-flyout-backing]')
    expect(GROUPS_CSS).toContain("html[data-platform='darwin'] [data-dsh-railist-flyout-backing]")
    // A member that is hidden or uninstalled leaves the menu, so the item can
    // never be disabled: the rule would be dead code.
    expect(GROUPS_CSS).not.toContain('[data-dsh-railist-flyout-item]:disabled')
  })
})
