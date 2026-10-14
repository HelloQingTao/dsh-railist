/**
 * The DOM half: placing rows into the three seats of the left column.
 *
 * The shell renders the panel list, the footer action row and the Settings seat as
 * separate containers, so a row can only change seat if its element physically
 * moves. These specs pin the two properties that make that safe:
 *
 * 1. A row whose seat differs from the one it is rendered in is moved, and the
 *    order inside the target seat follows the sequence.
 * 2. The pass does not feed on its own mutations. A `MutationObserver` callback
 *    runs after the synchronous pass, so a naive implementation re-runs forever —
 *    on a real shell that surfaced as "recomputation did not settle after 60
 *    passes", which is the regression these specs exist for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRailDom, ROW_ATTR, SEAT_CONTAINER_SUFFIX, SEAT_SLOT_ATTR } from '../src/client/rail/dom.ts'
import type { ManagedSeat } from '../src/client/registry/rail.tsx'

/**
 * Build one seat container with its slot anchor, the way the shell renders it.
 *
 * The two shapes differ, and the difference is load-bearing:
 * - `top` — the anchor lives INSIDE each row, so the rows are the nav's children.
 * - `footer` — the anchor wraps the rows, so they are its children.
 */
function buildSeat(seat: ManagedSeat, rows: Array<{ id: string | null; text: string }>): HTMLElement {
  const host = document.createElement(seat === 'top' ? 'nav' : 'div')
  host.className = `hHd-Xa${SEAT_CONTAINER_SUFFIX[seat]}`
  const makeAnchor = (): HTMLElement => {
    const anchor = document.createElement('div')
    anchor.setAttribute('data-slot', SEAT_SLOT_ATTR[seat])
    anchor.style.display = 'contents'
    return anchor
  }
  if (seat === 'top') {
    // The anchor belongs to the CONTRIBUTOR here, so it is built per row.
    if (rows.length === 0) host.append(makeAnchor())
    for (const row of rows) {
      const element = document.createElement('button')
      element.className = 'hHd-Xa_panelRow'
      element.textContent = row.text
      element.append(makeAnchor())
      if (row.id !== null) element.setAttribute(ROW_ATTR, row.id)
      host.append(element)
    }
    return host
  }
  const anchor = makeAnchor()
  for (const row of rows) {
    const element = document.createElement('div')
    element.className = `row-${row.text}`
    element.textContent = row.text
    if (row.id !== null) element.setAttribute(ROW_ATTR, row.id)
    anchor.append(element)
  }
  host.append(anchor)
  return host
}

/** The row texts currently rendered in one seat, in DOM order. */
function rowsIn(seat: ManagedSeat): string[] {
  const host = document.querySelector(`.hHd-Xa${SEAT_CONTAINER_SUFFIX[seat]}`)
  if (host === null) return []
  const scope = seat === 'top'
    ? (host.tagName === 'NAV' ? host : host.querySelector('nav'))
    // A wrapping seat renders its rows inside its own anchor.
    : host.querySelector(`[data-slot="${SEAT_SLOT_ATTR[seat]}"]`)
  if (scope === null) return []
  return [...scope.children]
    .filter(child => child.tagName !== 'STYLE' && !child.hasAttribute('data-slot'))
    .map(child => (child.textContent ?? '').trim())
}

let dom: ReturnType<typeof createRailDom> | null = null

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  dom?.dispose()
  dom = null
  vi.restoreAllMocks()
})

describe('rail DOM: seat placement', () => {
  it('reports which seats it could locate', () => {
    document.body.append(buildSeat('top', []), buildSeat('footer', []))
    dom = createRailDom()
    expect(dom.seats()).toEqual({ top: true, footer: true })
  })

  it('reports a missing seat instead of throwing', () => {
    document.body.append(buildSeat('top', []))
    dom = createRailDom()
    expect(dom.seats()).toEqual({ top: true, footer: false })
  })

  it('never reports the shell Settings seat, which it does not manage', () => {
    // The Settings row declares `settings.section`, so the plugin must not claim
    // that seat: reporting it would invite a caller to place rows there.
    document.body.append(buildSeat('top', []), buildSeat('footer', []))
    dom = createRailDom()
    expect(Object.keys(dom.seats())).toEqual(['top', 'footer'])
  })

  it('finds the seat through the anchor, not the class alone', () => {
    // A plugin is free to name a class after ours; only the host that actually
    // owns the seat's anchor counts.
    const impostor = document.createElement('div')
    impostor.className = `x${SEAT_CONTAINER_SUFFIX.footer}`
    document.body.append(impostor, buildSeat('top', []), buildSeat('footer', []))
    dom = createRailDom()
    expect(dom.seats().footer).toBe(true)
    dom.apply([])
    // Nothing threw, and the impostor is untouched.
    expect(impostor.children).toHaveLength(0)
  })

  it('leaves the rows in place when the plan already matches the shell', () => {
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }]),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    dom = createRailDom()
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'power', container: 'footer', order: 0, hidden: false },
    ])
    expect(rowsIn('top')).toEqual(['插件'])
    expect(rowsIn('footer')).toEqual(['电源'])
  })

  it('moves a row from the footer into the panel list', () => {
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }]),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    dom = createRailDom()
    // The confirmed example: power is dragged above Settings, i.e. into the seat
    // the row above it lives in.
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'power', container: 'top', order: 1, hidden: false },
    ])
    expect(rowsIn('top')).toEqual(['插件', '电源'])
    expect(rowsIn('footer')).toEqual([])
  })

  it('appends a moved row and leaves in-seat ordering to the registry', () => {
    // The shell sorts a slot by the `order` the rewrite pass writes, and re-asserts
    // it on every render; a node moved between siblings of one container therefore
    // fights the shell and feeds this module's own observer. So the DOM half only
    // ever changes containers — position within the seat is the registry's job, and
    // the sequence's order reaches the shell through `PlanPanel.order`.
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }, { id: 'usage', text: '使用统计' }]),
      buildSeat('footer', [{ id: 'capability', text: '能力面板' }]),
    )
    dom = createRailDom()
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'capability', container: 'top', order: 1, hidden: false },
      { id: 'usage', container: 'top', order: 2, hidden: false },
    ])
    // The row crossed into the top seat; where it sits among its new siblings is
    // whatever the shell's `order` decides.
    const moved = rowsIn('top')
    expect(moved).toContain('能力面板')
    expect(moved).toContain('插件')
    expect(moved).toContain('使用统计')
    expect(rowsIn('footer')).toEqual([])
  })

  it('leaves a hidden row where the shell put it', () => {
    document.body.append(
      buildSeat('top', []),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    dom = createRailDom()
    dom.apply([{ id: 'power', container: 'top', order: 0, hidden: true }])
    expect(rowsIn('footer')).toEqual(['电源'])
  })

  it('puts every moved row back on dispose', () => {
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }]),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    const instance = createRailDom()
    instance.apply([{ id: 'power', container: 'top', order: 1, hidden: false }])
    expect(rowsIn('top')).toEqual(['插件', '电源'])
    instance.dispose()
    // Uninstalling must leave the shell exactly as it was found.
    expect(rowsIn('top')).toEqual(['插件'])
    expect(rowsIn('footer')).toEqual(['电源'])
  })
})

describe('rail DOM: the observer does not feed on itself', () => {
  it('does not re-run for mutations of its own making', async () => {
    document.body.append(buildSeat('top', []), buildSeat('footer', [{ id: 'power', text: '电源' }]))
    dom = createRailDom()
    const pending = vi.spyOn(MutationObserver.prototype, 'observe')
    dom.apply([{ id: 'power', container: 'top', order: 0, hidden: false }])
    expect(pending).toHaveBeenCalled()

    // Let every queued mutation callback run. If the pass reacted to its own move,
    // each callback would insert again and the queue would never drain.
    const insertBefore = vi.spyOn(Node.prototype, 'insertBefore')
    await new Promise(resolve => setTimeout(resolve, 60))
    await new Promise(resolve => setTimeout(resolve, 60))
    // The row sits in its new seat and no further moves were issued.
    expect(insertBefore).not.toHaveBeenCalled()
    const top = document.querySelector(`.hHd-Xa${SEAT_CONTAINER_SUFFIX.top}`)
    expect(top?.textContent).toBe('电源')
  })
})
