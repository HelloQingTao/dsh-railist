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
import { createRailDom, GHOST_ATTR, ROW_ATTR, SEAT_CONTAINER_SUFFIX, SEAT_SLOT_ATTR } from '../src/client/rail/dom.ts'
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
    .map(child => {
      // A ghost slot carries the contributor's text in a portal, which the
      // fixture has not rendered; the row is still identified by its stamp.
      if (child.hasAttribute(GHOST_ATTR)) return child.getAttribute(ROW_ATTR) ?? ''
      return (child.textContent ?? '').trim()
    })
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

  it('leaves a footer row where the shell put it when the plan keeps it there', () => {
    // The plan is the only authority on a row's seat. A footer row the plan has
    // NOT moved up stays in the footer: physically moving it is what crashed the
    // footer slot on a real shell (the power-button freeze), and the plan no
    // longer asks for it.
    document.body.append(
      buildSeat('top', []),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    dom = createRailDom()
    dom.apply([{ id: 'power', container: 'footer', order: 0, hidden: false }])
    expect(rowsIn('footer')).toEqual(['电源'])
    expect(rowsIn('top')).toEqual([])
  })

  it('does not physically move a footer row the plan moved into the panel list', () => {
    // The regression this file exists for, from the other side. The ghost owns
    // that row now: its slot is the element the plan sees, and the footer host
    // node React rendered stays exactly where React put it. Moving it by hand
    // is the `NotFoundError` that froze the page when the power menu opened.
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }]),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    dom = createRailDom()
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'power', container: 'top', order: 1, hidden: false },
    ])
    expect(rowsIn('footer')).toEqual(['电源'])
  })

  it('positions a ghost slot by the plan order among the panel list rows', () => {
    // A footer row moved up is rendered by the ghost, whose slot is a DIV (not a
    // BUTTON) that the ghost appends to the end of the nav. Recognising only
    // BUTTONs left it glued there regardless of the sequence — the reported
    // "moved it in settings but the rail did not follow".
    // The footer seat is empty: the ghost replaced the entry, so React renders
    // no host node there any more — only the slot element exists.
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }, { id: 'usage', text: '使用统计' }]),
      buildSeat('footer', []),
    )
    dom = createRailDom()
    const nav = document.querySelector('nav')
    const ghost = document.createElement('div')
    ghost.setAttribute(GHOST_ATTR, '')
    ghost.setAttribute(ROW_ATTR, 'capability')
    nav?.append(ghost)
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'capability', container: 'top', order: 1, hidden: false },
      { id: 'usage', container: 'top', order: 2, hidden: false },
    ])
    // The slot is stamped and sits between the rows that bracket its order.
    expect(ghost.getAttribute('data-dsh-railist-order')).toBe('1')
    expect(rowsIn('top')).toEqual(['插件', 'capability', '使用统计'])
    expect(rowsIn('footer')).toEqual([])
  })

  it('stamps the plan order on every top-seat row it can see', () => {
    // The order stamp is what lets a ghost slot find its place among the rows
    // that bracket it. A top row the shell renders through React carries it too
    // — ownership is about WHERE a node lives, not whether React built it, and
    // reading "React built it" as "footer owns it" skipped the whole top seat,
    // which is why the ghost sat at the end of the list forever.
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }, { id: 'usage', text: '使用统计' }]),
      buildSeat('footer', []),
    )
    dom = createRailDom()
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'usage', container: 'top', order: 1, hidden: false },
    ])
    const nav = document.querySelector('nav')
    expect(nav?.children[0]?.getAttribute('data-dsh-railist-order')).toBe('0')
    expect(nav?.children[1]?.getAttribute('data-dsh-railist-order')).toBe('1')
  })

  it('puts a moved row back on dispose', () => {
    // Only a row this module actually moved is restored: a ghost row's home is
    // the ghost itself, and the footer host node never left React's care.
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }]),
      buildSeat('footer', [{ id: 'stray', text: '流浪' }]),
    )
    const instance = createRailDom()
    instance.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'stray', container: 'top', order: 1, hidden: false },
    ])
    // The plan asked for the row in the top seat, but the DOM half no longer
    // moves a footer row: it is the ghost's slot that travels, not React's node.
    expect(rowsIn('footer')).toEqual(['流浪'])
    instance.dispose()
    // Uninstalling must leave the shell exactly as it was found.
    expect(rowsIn('top')).toEqual(['插件'])
    expect(rowsIn('footer')).toEqual(['流浪'])
  })

  it('restores a row it moved itself', () => {
    // A row this module DID move — a ghost slot, which is this module's own node
    // and therefore safe to move — goes home on dispose, so uninstalling leaves
    // no orphan behind. Its home is where the ghost's own effect first put it:
    // the footer slot React renders the ghost component into.
    document.body.append(
      buildSeat('top', [{ id: 'plugins', text: '插件' }]),
      buildSeat('footer', [{ id: 'capability', text: '能力面板' }]),
    )
    const footer = document.querySelector(`[data-slot="${SEAT_SLOT_ATTR.footer}"]`)
    const ghost = document.createElement('div')
    ghost.setAttribute(GHOST_ATTR, '')
    ghost.setAttribute(ROW_ATTR, 'capability')
    footer?.append(ghost)
    const instance = createRailDom()
    instance.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'capability', container: 'top', order: 1, hidden: false },
    ])
    // The ghost slot travelled into the panel list; the footer host node stayed.
    expect(rowsIn('top')).toContain('capability')
    instance.dispose()
    expect(rowsIn('top')).toEqual(['插件'])
  })
})

describe('rail DOM: the observer does not feed on itself', () => {
  it('does not re-run for mutations of its own making', async () => {
    // A ghost slot is the element the plan moves: the footer host node React
    // rendered stays put, and the slot is this module's own node.
    document.body.append(
      buildSeat('top', []),
      buildSeat('footer', [{ id: 'power', text: '电源' }]),
    )
    dom = createRailDom()
    const nav = document.querySelector('nav')
    const ghost = document.createElement('div')
    ghost.setAttribute(GHOST_ATTR, '')
    ghost.setAttribute(ROW_ATTR, 'power')
    nav?.append(ghost)
    const pending = vi.spyOn(MutationObserver.prototype, 'observe')
    dom.apply([{ id: 'power', container: 'top', order: 0, hidden: false }])
    expect(pending).toHaveBeenCalled()

    // Let every queued mutation callback run. If the pass reacted to its own move,
    // each callback would insert again and the queue would never drain.
    const insertBefore = vi.spyOn(Node.prototype, 'insertBefore')
    await new Promise(resolve => setTimeout(resolve, 60))
    await new Promise(resolve => setTimeout(resolve, 60))
    // No further moves were issued.
    expect(insertBefore).not.toHaveBeenCalled()
    const top = document.querySelector(`.hHd-Xa${SEAT_CONTAINER_SUFFIX.top}`)
    // The nav holds the ghost slot. It also holds the empty slot anchor the
    // fixture puts in a seat with no rows — that anchor is not a row, which is
    // what `rowsIn` filters on.
    expect(rowsIn('top')).toEqual(['power'])
    expect(top?.querySelector(`[${GHOST_ATTR}]`)).not.toBeNull()
    // And the footer host node React rendered is untouched.
    expect(rowsIn('footer')).toEqual(['电源'])
  })
})
