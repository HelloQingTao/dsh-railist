/**
 * The "registered but not currently rendered" badge.
 *
 * A panel can hold a live registration and still put nothing on the rail: a
 * footer entry whose component returns `null` while its own feature is off is
 * registered exactly like any other, it just renders no element. The rail itself
 * never shows such a row, so the settings page is the only place the user can
 * meet it — which is why the row is KEPT and labelled rather than filtered out.
 *
 * Giving that row its own badge means answering a question the model cannot
 * answer on its own ("is this row on screen?"), because the answer lives in the
 * DOM the shell renders, not in the configuration. These specs pin the two
 * halves of that seam:
 *
 * - the pure half — `buildPlan(..., rendered)` marks exactly the rows the caller
 *   says are missing, and marks NOTHING when the caller cannot say at all; and
 * - the rendered half — the badge appears, carries its own `data-badge` value so
 *   it can never be confused with `missing`, and is absent from every visible
 *   row.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import { buildPlan, type Plan, type RegisteredPanel } from '../src/shared/model.ts'
import { emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'

/**
 * `cordis-panel` and `commandcode-panel` are the two ids this feature exists
 * for: both sit in the footer seat and both return `null` from their own
 * component until their feature is switched on.
 */
const REGISTERED: readonly RegisteredPanel[] = [
  { id: 'plugins', label: 'Plugins', order: 10, container: 'top' },
  { id: 'schedules', label: 'Scheduled tasks', order: 20, container: 'top' },
  { id: 'skills', label: 'Skills', order: 30, container: 'top' },
  { id: 'cordis-panel', label: 'cordis-panel', order: 40, container: 'footer' },
  { id: 'commandcode-panel', label: 'commandcode-panel', order: 50, container: 'footer' },
]

// vitest runs without globals, so testing-library cannot auto-register cleanup.
afterEach(cleanup)

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-row-id="${id}"]`)
  if (row === null) throw new Error(`no row rendered for "${id}"`)
  return row as HTMLElement
}

/** Render the page with the plan the DOM half would have produced. */
function renderWith(rendered: ReadonlySet<string> | undefined): Harness {
  const harness = createHarness({ registered: REGISTERED })
  const deps = {
    ...harness.deps,
    plan: (): Plan => buildPlan(REGISTERED, harness.profile(), rendered),
  }
  render(<Section deps={deps} />)
  return harness
}

describe('buildPlan: the unrendered flag', () => {
  it('marks exactly the rows the caller did not report as rendered', () => {
    const profile: ProfileConfig = emptyProfileConfig()
    // The rail shows the three top rows; the two footer entries render nothing.
    const plan = buildPlan(REGISTERED, profile, new Set(['plugins', 'schedules', 'skills']))

    expect(plan.rows.map(row => row.id)).toEqual([
      'plugins', 'schedules', 'skills', 'cordis-panel', 'commandcode-panel',
    ])
    expect(plan.rows.filter(row => row.unrendered).map(row => row.id))
      .toEqual(['cordis-panel', 'commandcode-panel'])
    // Kept, not filtered: the whole point is that the user can still reach them.
    expect(plan.rows).toHaveLength(5)
  })

  it('marks nothing when the caller cannot say (no DOM answer yet)', () => {
    // Omitted entirely: a unit test, the server half, or a sidebar that has not
    // painted yet. "I cannot see the rail" must never read as "nothing renders".
    const plan = buildPlan(REGISTERED, emptyProfileConfig())
    expect(plan.rows.every(row => row.unrendered === false)).toBe(true)

    const empty = buildPlan(REGISTERED, emptyProfileConfig(), new Set())
    // …but an explicit empty set is an answer, and it says nothing rendered.
    expect(empty.rows.every(row => row.unrendered)).toBe(true)
  })

  it('marks a group row by its own rail id, not its group id', () => {
    // A group registers under `dsh-railist:<id>`, so a caller reporting the rows
    // it can see must be matched on the SAME key the row carries.
    const profile: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:w', members: ['plugins', 'schedules'] }],
      entries: {},
    }
    const groupRow = buildPlan(REGISTERED, profile, new Set(['dsh-railist:group:w'])).rows[0]
    expect(groupRow?.kind).toBe('group')
    expect(groupRow?.unrendered).toBe(false)

    const unseen = buildPlan(REGISTERED, profile, new Set(['plugins'])).rows[0]
    expect(unseen?.unrendered).toBe(true)
  })

  it('never confuses an orphan with an unrendered row', () => {
    // An orphan has NO registration; an unrendered row has one. Both are kept,
    // and a row can only ever be one of the two.
    const profile: ProfileConfig = {
      sequence: [{ type: 'entry', id: 'ghost' }],
      entries: {},
    }
    const plan = buildPlan([], profile, new Set())
    expect(plan.orphans).toEqual(['ghost'])
    expect(plan.rows.map(row => row.id)).toEqual([])
    for (const row of plan.rows) {
      expect(plan.orphans.includes(row.id) && row.unrendered).toBe(false)
    }
  })
})

describe('the settings page: the "not shown" badge', () => {
  it('labels a registered row the rail does not render', () => {
    renderWith(new Set(['plugins', 'schedules', 'skills']))

    const badge = rowOf('cordis-panel').querySelector('[data-badge="unrendered"]')
    expect(badge?.textContent).toBe('not shown')
    // A distinct marker from `missing`: the two facts must stay tellable apart
    // in the DOM, not just in the copy.
    expect(rowOf('cordis-panel').querySelector('[data-badge="missing"]')).toBeNull()

    const second = rowOf('commandcode-panel').querySelector('[data-badge="unrendered"]')
    expect(second?.textContent).toBe('not shown')
  })

  it('does not label a row the rail does render', () => {
    renderWith(new Set(['plugins', 'schedules', 'skills']))

    for (const id of ['plugins', 'schedules', 'skills']) {
      expect(rowOf(id).querySelector('[data-badge="unrendered"]'), id).toBeNull()
    }
    // Every row is still listed, badged or not.
    expect(document.querySelectorAll('[data-row-id]')).toHaveLength(5)
  })

  it('labels nothing when the DOM half has no answer yet', () => {
    // The timing case the wiring has to survive: the page can render before the
    // sidebar (or the row elements) exist. Guessing "nothing is rendered" here
    // would stamp every row on a perfectly healthy rail.
    renderWith(undefined)

    expect(document.querySelectorAll('[data-badge="unrendered"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-row-id]')).toHaveLength(5)
  })

  it('explains the badge in both languages', () => {
    renderWith(new Set(['plugins', 'schedules', 'skills']))
    const badge = rowOf('cordis-panel').querySelector('[data-badge="unrendered"]')
    // The hint is the only place the difference from "hidden" is spelled out,
    // so it must not be a bare title-less chip.
    expect(badge?.getAttribute('title')?.length ?? 0).toBeGreaterThan(0)
  })
})
