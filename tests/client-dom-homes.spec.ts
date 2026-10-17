/**
 * The bug this spec pins: a row that moves back and forth between seats.
 *
 * A ghost slot's home is where the GHOST's own effect put it — inside the footer
 * slot's anchor, the element React renders it into. `dom.apply` used to record
 * that home on the FIRST pass that saw the row, which is the pass that also moved
 * it: the slot's parent at that instant was already the panel list, so "home"
 * was the top seat. Moving the row back to the footer then restored it into the
 * panel list, which the next pass corrected again — one write per pass, forever.
 * On a real shell that saturated the main thread; the console showed
 * "recomputation did not settle after 60 passes" and the whole page stuttered.
 *
 * The home must therefore be a property of the ELEMENT (whoever renders it owns
 * it), not of the plan: it is learned once and never overwritten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRailDom, GHOST_ATTR, ROW_ATTR, SEAT_CONTAINER_SUFFIX, SEAT_SLOT_ATTR } from '../src/client/rail/dom.ts'

/**
 * The two seats, shaped the way the shell renders them.
 *
 * `top` puts its slot anchor INSIDE each row (`button > [data-slot]`), so the
 * nav's children are rows; the fixture mirrors that with one row that is not
 * part of any plan, because `seatContainer` requires the seat's anchor to live
 * inside the container it matches.
 */
function seats(): { nav: HTMLElement; footer: HTMLElement; footerHost: HTMLElement } {
  const nav = document.createElement('nav')
  nav.className = `hHd-Xa${SEAT_CONTAINER_SUFFIX.top}`
  const anchor = document.createElement('div')
  anchor.setAttribute('data-slot', SEAT_SLOT_ATTR.top)
  const anchorRow = document.createElement('button')
  anchorRow.append(anchor)
  nav.append(anchorRow)

  const footerHost = document.createElement('div')
  footerHost.className = `hHd-Xa${SEAT_CONTAINER_SUFFIX.footer}`
  const footer = document.createElement('div')
  footer.setAttribute('data-slot', SEAT_SLOT_ATTR.footer)
  footer.style.display = 'contents'
  footerHost.append(footer)
  return { nav, footer, footerHost }
}

function ghost(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.setAttribute(GHOST_ATTR, '')
  element.setAttribute(ROW_ATTR, id)
  element.style.display = 'contents'
  return element
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

describe('rail DOM: a row’s home belongs to the element, not the plan', () => {
  it('moves a footer-ghosted row back to the footer after it was placed in the panel list', () => {
    const { nav, footer, footerHost } = seats()
    document.body.append(nav, footerHost)
    // The ghost's own effect put it inside the footer slot's anchor; the plan
    // then sends it up into the panel list.
    const slot = ghost('capability')
    footer.append(slot)
    dom = createRailDom()
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'capability', container: 'top', order: 1, hidden: false },
    ])
    expect(slot.parentNode).toBe(nav)

    // The user drags the row back into the footer. Building the footer home from
    // the CURRENT parent (the panel list) appended it back to the panel list and
    // every following pass moved it again.
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'capability', container: 'footer', order: 0, hidden: false },
    ])
    expect(slot.parentNode).toBe(footer)

    // …and it stays put: a settled rail issues no write at all.
    const append = vi.spyOn(Node.prototype, 'appendChild')
    const insert = vi.spyOn(Node.prototype, 'insertBefore')
    dom.apply([
      { id: 'plugins', container: 'top', order: 0, hidden: false },
      { id: 'capability', container: 'footer', order: 0, hidden: false },
    ])
    expect(append).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(slot.parentNode).toBe(footer)
  })

  it('records the home of a row it did not move as the seat it is rendered in', () => {
    const { nav, footer, footerHost } = seats()
    document.body.append(nav, footerHost)
    const slot = ghost('power')
    footer.append(slot)
    dom = createRailDom()
    dom.apply([{ id: 'power', container: 'footer', order: 0, hidden: false }])
    expect(slot.parentNode).toBe(footer)

    // The plan moves it up, then back: dispose must return it to the FOOTER, the
    // element's real home, not to the panel list it last occupied.
    dom.apply([{ id: 'power', container: 'top', order: 0, hidden: false }])
    dom.apply([{ id: 'power', container: 'footer', order: 0, hidden: false }])
    expect(slot.parentNode).toBe(footer)
    dom.dispose()
    dom = null
    expect(slot.parentNode).toBe(footer)
  })

  it('leaves a footer row it did not move exactly where the renderer put it', () => {
    const { nav, footer, footerHost } = seats()
    document.body.append(nav, footerHost)
    // A NON-ghost footer row (React's own node) must never be physically moved:
    // the footer slot is `kind: 'list'`, so taking its node away leaves React's
    // child bookkeeping stale and the next footer render throws NotFoundError.
    // It carries no ghost attribute, so it is not placed by order either — it is
    // simply left alone, pass after pass, and on dispose.
    const reactRow = document.createElement('div')
    reactRow.setAttribute(ROW_ATTR, 'cordis')
    footer.append(reactRow)
    dom = createRailDom()
    for (let pass = 0; pass < 5; pass += 1) {
      dom.apply([
        { id: 'plugins', container: 'top', order: 0, hidden: false },
        { id: 'cordis', container: 'footer', order: 0, hidden: false },
      ])
      expect(reactRow.parentNode).toBe(footer)
    }
    const append = vi.spyOn(Node.prototype, 'appendChild')
    const insert = vi.spyOn(Node.prototype, 'insertBefore')
    dom.dispose()
    dom = null
    expect(append).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(reactRow.parentNode).toBe(footer)
  })
})

