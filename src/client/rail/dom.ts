/**
 * The left column's DOM half: placing rows into the seat the plan gives them.
 *
 * The registry half can order rows *within* one slot, but the shell renders the
 * three seats as separate containers, so no single `order` value can move a row
 * from the footer up into the panel list. That move is physical: this module
 * takes the element that renders a row and puts it into the container of the seat
 * the sequence assigned, at the position the sequence gave it.
 *
 * Three facts make that safe (all three verified against a live shell):
 *
 * 1. **A cross-container move survives React.** Reconciliation only corrects
 *    positions inside the subtree a component owns; once an element is moved out
 *    of that subtree the shell no longer touches it. Moving a node between
 *    siblings of the SAME container *is* undone — which is why this module never
 *    does that, and why same-seat ordering is left to the registry.
 * 2. **The seat anchors are stable by suffix.** Every class name carries a build
 *    hash (`hHd-Xa_footerActions`), so selectors match a stable suffix
 *    (`[class*="_footerActions"]`) and the match is re-made on every pass.
 * 3. **A moved element can be put back exactly.** Every move records the parent
 *    and the following sibling it came from, so disposal restores the shell's own
 *    layout rather than an approximation of it.
 *
 * Rows are matched to registrations by walking the React fiber chain, because the
 * shell stamps no id on the DOM. The two managed row shapes need different anchors
 * (both verified live):
 *
 * | seat | row element | where the id lives |
 * | --- | --- | --- |
 * | `top` | `nav._panelList > button` | the `PanelRow` fiber's `props.id` |
 * | `footer` | the anchor's element children | a `RootEntry` fiber's `props.entry.options.id` |
 *
 * The shell's own **Settings seat is never touched** (see `SETTINGS_SLOT` in
 * `registry/rail.tsx`): the Settings row declares `settings.section` through its
 * `children` table, so relocating it takes every plugin's settings page down with
 * it.
 *
 * The module never touches a row's own styling, so a row keeps the appearance its
 * contributor gave it: only its parent changes.
 */

import { MANAGED_SEATS, type ManagedSeat } from '../registry/rail.tsx'

/**
 * Class-name suffixes of the managed seat containers.
 *
 * The shell renders each slot's entries into a `data-slot` anchor that is itself
 * `display: contents`, so the element that actually participates in the layout is
 * the anchor's PARENT. Matching the parent by suffix is what the ecosystem does
 * (`dsh-better-sidebar`, `dsh-footer-order`) and is the only option that survives
 * a re-hashed build.
 */
export const SEAT_CONTAINER_SUFFIX: Record<ManagedSeat, string> = {
  top: '_panelList',
  footer: '_footerActions',
}

/** The `data-slot` anchor the shell declares for each managed seat. */
export const SEAT_SLOT_ATTR: Record<ManagedSeat, string> = {
  top: 'sidebar.panellist',
  footer: 'sidebar.footer.action',
}

/**
 * Attribute this module stamps on a row element to remember which registration it
 * renders. The shell puts no id on the DOM, so the identity has to live somewhere
 * for the next pass to read back.
 */
export const ROW_ATTR = 'data-dsh-railist-row'

/**
 * Attribute a footer row's ghost stamps on the slot element it renders into.
 *
 * Declared here, next to {@link ROW_ATTR}, because this module is what reads it
 * back: the two halves of the plugin share one DOM contract, and the ghost
 * (`registry/Ghost.tsx`) imports it from here rather than the other way round.
 *
 * The element is created by the ghost, not by React, which is precisely what
 * makes it safe to move — see the footer guard in `applyNow`.
 */
export const GHOST_ATTR = 'data-dsh-railist-ghost'

/** Where one row element was before this module moved it. */
interface Home {
  parent: Node
  /** The sibling it sat in front of, or `null` when it was last. */
  next: Node | null
}

/** One row the plan wants placed. */
export interface DomRow {
  /** Panel/group id the element renders. */
  id: string
  /** Seat the row belongs in. */
  container: ManagedSeat
  /** Position within that seat, ascending. */
  order: number
  /** Row is hidden: leave the element wherever the shell put it. */
  hidden: boolean
}

/** The DOM surface the controller drives. */
export interface RailDom {
  /** Reconcile every row element with the plan, then observe for re-renders. */
  apply(rows: readonly DomRow[]): void
  /** Whether each seat container could be located on this shell. */
  seats(): Record<ManagedSeat, boolean>
  /** Put every moved element back and stop observing. */
  dispose(): void
}

/** The set of React fiber fields this module reads, in one place. */
interface FiberLike {
  type?: unknown
  memoizedProps?: Record<string, unknown>
  return?: FiberLike | null
}

/** The fiber attached to a DOM node by the React renderer, or `null`. */
function fiberOf(element: Element): FiberLike | null {
  const key = Object.keys(element).find(name =>
    name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'))
  if (key === undefined) return null
  const fiber = (element as unknown as Record<string, unknown>)[key]
  return typeof fiber === 'object' && fiber !== null ? fiber as FiberLike : null
}

/** Component display name of one fiber, or an empty string. */
function fiberName(fiber: FiberLike | null | undefined): string {
  const type = fiber?.type
  if (typeof type === 'function') return (type as { name?: string }).name ?? ''
  return ''
}

/**
 * The registration id a row element renders, or `null` when it cannot be read.
 *
 * The React fiber chain is the primary source, because the shell stamps no id on
 * the DOM. Both shapes are tried on every hop, so a shell that changes which
 * component carries the props still resolves: `PanelRow`'s own `id`, or the
 * `entry` a `RootEntry` fiber carries.
 *
 * A `data-railist-row` attribute is honoured first: it is what this module stamps
 * on a row it has already placed, so a re-render that keeps the attribute keeps
 * its identity even if the fiber chain is briefly unreadable.
 */
function rowIdFromElement(element: Element): string | null {
  try {
    return readRowId(element)
  } catch {
    // Reading the fiber chain means touching React internals: a detached fiber, a
    // node mid-unmount or a renderer this build has never seen can all make a hop
    // throw. Returning `null` costs this row one placement pass; letting it escape
    // would abort the observer callback, and a throw from inside a slot render
    // blanks the shell's whole sidebar (observed on a live instance).
    return null
  }
}

/** The body of {@link rowIdFromElement}, isolated so a failure cannot escape. */
function readRowId(element: Element): string | null {
  const stamped = element.getAttribute(ROW_ATTR)
  if (stamped !== null && stamped.length > 0) return stamped
  let fiber = fiberOf(element)
  let hops = 0
  while (fiber !== null && hops < 24) {
    const props = fiber.memoizedProps
    if (props !== undefined) {
      const id = props['id']
      if (typeof id === 'string' && fiberName(fiber) === 'PanelRow') return id
      const entry = props['entry']
      if (typeof entry === 'object' && entry !== null) {
        const options = (entry as { options?: { id?: unknown } }).options
        if (typeof options?.id === 'string') return options.id
      }
    }
    fiber = fiber.return ?? null
    hops += 1
  }
  return null
}

/**
 * Whether an element is a node the footer slot's React renderer owns.
 *
 * Such an element must never be moved by this module: the footer slot is
 * `kind: 'list'`, so React holds a reference to every node it rendered there and
 * re-uses that reference on the next footer re-render. Moving the node away with
 * `appendChild` leaves the reference stale, the re-render throws
 * `NotFoundError` from `insertBefore`, the slot's error boundary abdicates the
 * entry, the version bumps and the slot re-renders again — an error loop that
 * saturates the main thread and freezes the page. Verified live on a real
 * instance: the console log holds tens of identical
 * `slot entry crashed in 'sidebar.footer.action'` errors per second, and the page
 * stops responding until it is reloaded.
 *
 * A ghost's slot element is NOT such a node — it is created by this module, so no
 * renderer holds a reference to it — and it is recognised here so it is still
 * placed normally. The test is the attribute the ghost stamps, because a node
 * with no React owner has no fiber to consult and a node with one may have
 * been re-rendered since it was stamped.
 */
function isFooterOwned(element: HTMLElement): boolean {
  if (element.hasAttribute(GHOST_ATTR)) return false
  const fiber = fiberOf(element)
  return fiber !== null
}

/**
 * Whether a top-seat element takes part in the shell's own ordering.
 *
 * The panel list is `flex-direction: column`, so within it a row's position IS
 * its order — and the shell asserts that order by re-rendering its own rows on
 * every pass. A ghost slot is a foreign node: React re-asserts around it, never
 * through it, so it has to be positioned by this module or it would sit wherever
 * the shell's last render left the rows. A ghost slot is therefore placed by
 * `order`, not appended.
 */
function isPlacedByOrder(element: HTMLElement): boolean {
  return element.hasAttribute(GHOST_ATTR)
}

/**
 * Position a ghost slot at `order` among `host`'s children, and report whether
 * the move happened.
 *
 * The rows around it carry their order as {@link ROW_ATTR} siblings; this module
 * stamped those attributes on its own passes, and the shell renders its rows in
 * the order the rewrite pass wrote, so the sibling sequence IS the seat's order.
 * The slot goes after the last sibling whose order is at or below its own, which
 * keeps it stable across re-renders instead of oscillating between two rows.
 *
 * A `hidden` ghost is not here: the pass skips it, and the ghost hides its own
 * slot with `display: none`, so the visible sequence never has a hole in it.
 */
function placeByOrder(host: HTMLElement, element: HTMLElement, order: number): boolean {
  const rows = [...host.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child !== element && child.hasAttribute(ROW_ATTR))
  const before = rows.find(row => Number(row.getAttribute(ROW_ATTR) === null ? 0 : orderOf(row)) > order)
  if (before === undefined) {
    if (element.parentNode === host && host.lastElementChild === element) return false
    host.appendChild(element)
    return true
  }
  if (element.parentNode === host && element.nextSibling === before) return false
  host.insertBefore(element, before)
  return true
}

/** The placement order a stamped row element carries. */
function orderOf(element: HTMLElement): number {
  const value = element.getAttribute('data-dsh-railist-order')
  return value === null ? 0 : Number(value)
}

/**
 * Find the layout container of one seat, or `null` when the shell lacks it. */
export function seatContainer(seat: ManagedSeat): HTMLElement | null {
  if (typeof document === 'undefined') return null
  for (const candidate of document.querySelectorAll<HTMLElement>(`[class*="${SEAT_CONTAINER_SUFFIX[seat]}"]`)) {
    // The suffix is unique among the three seats, but a plugin may name a class
    // after ours: require the seat's own anchor to be inside.
    if (candidate.querySelector(`[data-slot="${SEAT_SLOT_ATTR[seat]}"]`) !== null) return candidate
  }
  return null
}

/**
 * The element a seat's rows are direct children of — where a row has to be put.
 *
 * This mirrors {@link rowElements}: the anchor of a wrapping seat, the nav of the
 * panel list. A row must land exactly where the shell renders its siblings, or the
 * seat's own layout ignores it.
 */
export function rowHost(seat: ManagedSeat): HTMLElement | null {
  const host = seatContainer(seat)
  if (host === null) return null
  if (seat === 'top') return host.tagName === 'NAV' ? host : host.querySelector('nav')
  return host.querySelector<HTMLElement>(`[data-slot="${SEAT_SLOT_ATTR[seat]}"]`)
}

/**
 * Every row element the shell currently renders in one seat.
 *
 * `top` puts its anchors INSIDE each row button (`button > … > [data-slot]`), so
 * the rows are the nav's own `button` children. The other two seats put the
 * anchors around their rows, so the rows are the anchor's element children minus
 * the stylesheet a contributor may inject alongside.
 */
/**
 * Every row element the shell currently renders in one seat.
 *
 * The two shapes differ, and the difference is load-bearing — it was read off a
 * live shell rather than assumed:
 *
 * - `top` puts its anchors INSIDE each row (`button > … > [data-slot]`), so the
 *   rows are the nav's own `button` children.
 * - `footer` puts the anchor AROUND its rows, so the rows are the anchor's element
 *   children. (Looking at the host's children instead finds only the anchor itself
 *   and silently matches nothing.)
 *
 * A contributor may inject a stylesheet next to its row, so `STYLE` is skipped.
 */
function rowElements(seat: ManagedSeat): HTMLElement[] {
  if (typeof document === 'undefined') return []
  const host = seatContainer(seat)
  if (host === null) return []
  const isRowTag = (element: Element): element is HTMLElement =>
    element instanceof HTMLElement && element.tagName !== 'STYLE'
  if (seat === 'top') {
    const nav = host.tagName === 'NAV' ? host : host.querySelector('nav')
    if (nav === null) return []
    return [...nav.children].filter((child): child is HTMLElement => child.tagName === 'BUTTON')
  }
  // Rows live inside the seat's own anchor.
  const anchor = host.querySelector(`[data-slot="${SEAT_SLOT_ATTR[seat]}"]`)
  if (anchor === null) return []
  return [...anchor.children].filter(isRowTag)
}

/**
 * Create the DOM half.
 *
 * The instance is deliberately tolerant: an unmounted sidebar, a shell that
 * renamed a class, or a row element that has not rendered yet all mean "nothing
 * to do this pass" rather than an error. `seats()` reports what was found so the
 * self-check can turn a silent no-op into a visible one.
 */
export function createRailDom(): RailDom {
  const homes = new WeakMap<HTMLElement, Home>()
  const moved = new Set<HTMLElement>()
  let observer: MutationObserver | null = null
  let disposed = false
  /**
   * How many of this module's own mutation batches are still in flight towards the
   * observer. Incremented after a pass that moved nodes, decremented by the
   * callbacks those moves produce.
   */
  let selfMutations = 0
  /** Latest rows the controller asked for; the observer replays these. */
  let desired: readonly DomRow[] = []

  /**
   * Reconcile once, ignoring the mutations this very pass causes.
   *
   * A `MutationObserver` callback runs as a microtask AFTER the synchronous pass
   * that moved the nodes, so a plain `applying` flag is already false by then and
   * the pass would re-trigger itself forever (the shell's own recomputation guard
   * reported exactly that: "did not settle after 60 passes"). The pass therefore
   * counts the mutations it makes and the observer drops that many callbacks,
   * which is what keeps one placement from being mistaken for a change worth
   * reacting to.
   */
  const applyNow = (reason: 'call' | 'observer'): void => {
    if (disposed || typeof document === 'undefined') return
    if (reason === 'observer' && selfMutations > 0) {
      selfMutations -= 1
      return
    }
    let writes = 0
    try {
      /**
       * Every row element the document currently holds, paired with the row it
       * renders — gathered across ALL seats rather than one at a time.
       *
       * This is what makes the pass idempotent: a row this module already moved sits
       * in its target seat, so a per-seat scan would never meet it again and could
       * neither re-order it nor move it back. Identity comes from the stamp, so an
       * element is recognised wherever it currently is.
       */
      const pairs: Array<{ element: HTMLElement; row: DomRow }> = []
      const seen = new Set<HTMLElement>()
      for (const seat of MANAGED_SEATS) {
        for (const element of rowElements(seat)) {
          if (seen.has(element)) continue
          seen.add(element)
          // Every managed seat resolves its rows by the id the registration carries.
          const id = rowIdFromElement(element)
          const row = id === null ? undefined : desired.find(candidate => candidate.id === id)
          if (row !== undefined) pairs.push({ element, row })
        }
      }
      for (const { element, row } of pairs) {
        const host = rowHost(row.container)
        if (host === null) continue
        if (row.hidden) continue
        // Remember the identity on the element so the next pass (and a re-render
        // that keeps the attribute) still knows what this row is.
        if (element.getAttribute(ROW_ATTR) !== row.id) element.setAttribute(ROW_ATTR, row.id)
        /**
         * A footer row the plan moved into the top seat is never physically
         * moved here.
         *
         * The footer slot is `kind: 'list'`, so every row element in it is a
         * node React inserted and still holds in its child bookkeeping for that
         * container. Taking one away with `appendChild` leaves that reference
         * stale, and the next footer re-render — opening the power menu is
         * enough — throws `NotFoundError` from `insertBefore`, trips the slot's
         * error boundary, abdicates the entry, bumps the version and
         * re-renders: an error loop that saturates the main thread and freezes
         * the page. Verified live.
         *
         * `registry/Ghost.tsx` places such a row instead: the row's slot entry
         * becomes a component that renders nothing in place and portals the
         * contributor's own component into a slot element this plugin owns.
         * The element seen here — the ghost's slot, carrying the same
         * {@link ROW_ATTR} stamp — belongs to nobody but this module, so moving
         * it is the ordinary DOM write the rest of this module is built on.
         */
        if (row.container === 'top' && isFooterOwned(element)) continue
        // A ghost slot is positioned by the plan's order among its new siblings,
        // so the order travels with the row.
        element.setAttribute('data-dsh-railist-order', String(row.order))
        if (target(host, element, row.order)) writes += 1
      }
    } finally {
      // One callback per DOM mutation batch: the observer may coalesce several
      // `insertBefore` calls into one record set, so a small allowance is kept
      // rather than an exact count.
      selfMutations += writes
    }
  }

  /**
   * Put one element into the container its seat needs, if it is not already there.
   *
   * **Only cross-container moves happen here.** Ordering WITHIN a container is the
   * registry's job: the shell sorts a slot by the `order` the rewrite pass writes,
   * and it re-asserts that arrangement on every re-render. Moving a node between
   * siblings of one container therefore fights the shell — and, worse, it makes the
   * plugin's own observer fire, which re-runs the pass, which moves again: the
   * endless loop the shell reports as "recomputation did not settle".
   *
   * The one exception is a ghost slot: it is a foreign node the shell's React
   * renderer never re-asserts, so it has to be positioned here, at the `order` the
   * plan gave it, among the rows that bracket it.
   *
   * @returns whether the element had to change container or position.
   */
  const target = (host: HTMLElement, element: HTMLElement, order?: number): boolean => {
    if (element.parentNode === host && !isPlacedByOrder(element)) return false
    if (!homes.has(element)) homes.set(element, { parent: element.parentNode as Node, next: element.nextSibling })
    if (isPlacedByOrder(element)) {
      if (placeByOrder(host, element, order ?? 0)) {
        moved.add(element)
        return true
      }
      if (element.parentNode === host) return false
    }
    // Appended, not inserted: the shell's own `order` decides where within the
    // container the row ends up, and it will place it there on the next render.
    host.appendChild(element)
    moved.add(element)
    return true
  }

  const observe = (): void => {
    if (observer !== null || typeof document === 'undefined') return
    observer = new MutationObserver(() => {
      // A re-render may re-create a row element (losing its recorded home) or put
      // a moved element back; re-running is how the plugin keeps its placement.
      // The pass's OWN mutations come back through here too (a callback runs after
      // the synchronous pass), so they are discounted — see `applyNow`.
      //
      // A throw must never escape a MutationObserver callback: the shell renders
      // the sidebar inside a slot boundary that blanks the entire left column when
      // an entry throws (observed live). A failed pass just leaves the rows where
      // they are, and the next change tries again.
      try {
        applyNow('observer')
      } catch (error) {
        if (typeof console !== 'undefined') console.warn('[dsh-railist] placement pass failed; rows left as they are', error)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  return {
    apply: (rows) => {
      desired = rows
      if (typeof document === 'undefined') return
      observe()
      try {
        applyNow('call')
      } catch (error) {
        // Same reasoning as the observer path: placement is a best-effort
        // enhancement, and it runs from inside the plugin's own recompute loop.
        if (typeof console !== 'undefined') console.warn('[dsh-railist] placement pass failed; rows left as they are', error)
      }
    },
    seats: () => Object.fromEntries(
      MANAGED_SEATS.map(seat => [seat, seatContainer(seat) !== null]),
    ) as Record<ManagedSeat, boolean>,
    dispose: () => {
      if (disposed) return
      disposed = true
      observer?.disconnect()
      observer = null
      for (const element of [...moved].reverse()) {
        const home = homes.get(element)
        if (home === undefined) continue
        try {
          if (home.next !== null && home.next.parentNode === home.parent) home.parent.insertBefore(element, home.next)
          else home.parent.appendChild(element)
        } catch {
          // The shell re-rendered the original parent away: nothing to restore.
        }
      }
      moved.clear()
      desired = []
    },
  }
}
