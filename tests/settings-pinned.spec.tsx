/**
 * The shell's own Settings row: listed, but never movable (README §2.12).
 *
 * The row lives in `sidebar.settings`, a seat this plugin does NOT take over —
 * that seat's row declares `settings.section` through its own children table, and
 * taking it over blanked the whole settings content area once. So the row cannot
 * be dragged, hidden or grouped like every other row.
 *
 * It is still LISTED, at the bottom of the bottom-left seat, because the user
 * asked to see it: "I want the power button in front of Settings" only makes
 * sense if Settings is on the screen somewhere. Rendering it read-only, pinned
 * below the last draggable row, is the one shape that satisfies both facts at
 * once — visible, and provably unable to move.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import { buildPlan, type Plan, type RegisteredPanel } from '../src/shared/model.ts'
import { emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'

/**
 * `settings` is the id the shell registers into `sidebar.settings`. Everything
 * else is an ordinary top/footer row, so the specs can show that the pin does not
 * leak onto its neighbours.
 */
const REGISTERED: readonly RegisteredPanel[] = [
  { id: 'plugins', label: 'Plugins', order: 10, container: 'top' },
  { id: 'dsh-power-xc', label: 'Power', order: 20, container: 'footer' },
  { id: 'settings', label: 'Settings', order: 30, container: 'settings' },
]

// vitest runs without globals, so testing-library cannot auto-register cleanup.
afterEach(cleanup)

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-row-id="${id}"]`)
  if (row === null) throw new Error(`no row rendered for "${id}"`)
  return row as HTMLElement
}

/** Every row id in the order the settings page lists them. */
function listedIds(): string[] {
  return [...document.querySelectorAll('[data-row-id]')].map(
    row => (row as HTMLElement).dataset.rowId ?? '',
  )
}

function renderWith(profile: ProfileConfig): Harness {
  const harness = createHarness({ registered: REGISTERED, profile })
  const deps = {
    ...harness.deps,
    plan: (): Plan => buildPlan(REGISTERED, harness.profile()),
  }
  render(<Section deps={deps} />)
  return harness
}

describe('buildPlan: the pinned Settings row', () => {
  it('marks exactly the shell settings row, and no other row', () => {
    const plan = buildPlan(REGISTERED, emptyProfileConfig())

    expect(plan.rows.filter(row => row.pinned).map(row => row.id)).toEqual(['settings'])
    for (const row of plan.rows) {
      if (row.id !== 'settings') expect(row.pinned, row.id).toBe(false)
    }
  })

  it('lists the row even though its seat is not managed', () => {
    // The whole point: discovery reads the seat the row actually lives in, so a
    // shell with a settings row always shows one.
    const plan = buildPlan(REGISTERED, emptyProfileConfig())

    expect(plan.rows.map(row => row.id)).toContain('settings')
    expect(plan.orphans).not.toContain('settings')
  })

  it('puts the row in the bottom-left seat wherever the sequence places it', () => {
    // The user's request: "Settings always sits at the very bottom of the
    // bottom-left seat, no matter how the rows above it are ordered."
    const profile = emptyProfileConfig()
    profile.sequence = [
      { type: 'entry', id: 'settings' },
      { type: 'entry', id: 'plugins' },
      { type: 'entry', id: 'dsh-power-xc' },
    ]
    const plan = buildPlan(REGISTERED, profile)

    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['settings', 'footer'],
      ['plugins', 'top'],
      ['dsh-power-xc', 'footer'],
    ])
  })
})

describe('the settings page: the pinned row', () => {
  it('shows the shell settings row below every draggable row', () => {
    renderWith(emptyProfileConfig())

    expect(listedIds()).toEqual(['plugins', 'dsh-power-xc', 'settings'])
  })

  it('keeps it last even when the sequence leads with it', () => {
    const profile = emptyProfileConfig()
    profile.sequence = [
      { type: 'entry', id: 'settings' },
      { type: 'entry', id: 'plugins' },
      { type: 'entry', id: 'dsh-power-xc' },
    ]
    renderWith(profile)

    expect(listedIds()).toEqual(['plugins', 'dsh-power-xc', 'settings'])
  })

  it('offers no drag handle for it', () => {
    renderWith(emptyProfileConfig())

    expect(rowOf('settings').querySelector('[data-drag-handle]')).toBeNull()
    // Every other row still has one — the pin must not be a blanket "no handles".
    expect(rowOf('plugins').querySelector('[data-drag-handle]')).not.toBeNull()
    expect(rowOf('dsh-power-xc').querySelector('[data-drag-handle]')).not.toBeNull()
  })

  it('offers no hide, group or ungroup action for it', () => {
    renderWith(emptyProfileConfig())
    const row = rowOf('settings')

    for (const action of ['toggleHidden', 'groupWithNext', 'ungroup']) {
      expect(row.querySelector(`[data-action="${action}"]`), action).toBeNull()
    }
    // A draggable row keeps its actions.
    expect(rowOf('plugins').querySelector('[data-action="toggleHidden"]')).not.toBeNull()
  })

  it('refuses a drop on it', () => {
    const harness = renderWith(emptyProfileConfig())

    // A drop on the pinned row must leave the store untouched. (The event still
    // bubbles to the list, which calls `preventDefault` unconditionally — that is
    // the list's own bookkeeping, not this row accepting anything.)
    const row = rowOf('settings')
    row.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))

    expect(harness.updates).toEqual([])
    // And the row is still listed last, in the seat it was pinned to.
    expect(listedIds()).toEqual(['plugins', 'dsh-power-xc', 'settings'])
  })

  it('labels it as fixed in both languages', () => {
    renderWith(emptyProfileConfig())

    const badge = rowOf('settings').querySelector('[data-badge="pinned"]')
    expect(badge?.textContent).toBe('Always last')
    expect(badge?.getAttribute('title')?.length ?? 0).toBeGreaterThan(0)
  })

  it('marks the row in the DOM so styling can tell it apart', () => {
    renderWith(emptyProfileConfig())

    expect(rowOf('settings').dataset.pinned).toBe('true')
    expect(rowOf('plugins').dataset.pinned).toBeUndefined()
  })

  it('renders the three blocks in a fixed order', () => {
    renderWith(emptyProfileConfig())

    const headings = [...document.querySelectorAll('[data-seat]')].map(
      node => (node as HTMLElement).dataset.seat,
    )
    expect(headings).toEqual(['top', 'footer', 'pinned'])
  })

  it('never repeats or reorders a heading, however the rows are dragged', () => {
    // The regression the screenshot showed: two identical "Bottom left · actions"
    // headings, because a drag had pushed a footer row to the top of the sequence
    // and the old per-appearance runs split the list around it.
    const profile = emptyProfileConfig()
    profile.sequence = [
      { type: 'entry', id: 'dsh-power-xc', seat: 'footer' },
      { type: 'entry', id: 'plugins' },
      { type: 'entry', id: 'settings' },
    ]
    renderWith(profile)

    const headings = [...document.querySelectorAll('[data-seat]')].map(
      node => (node as HTMLElement).dataset.seat,
    )
    expect(headings).toEqual(['top', 'footer', 'pinned'])
    // And the row that changed seat is now listed under the other block, not in a
    // block of its own.
    expect(listedIds()).toEqual(['plugins', 'dsh-power-xc', 'settings'])
  })
})
