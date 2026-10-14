/**
 * The footer seat's ghost: what a footer row becomes when the plan moves it up
 * into the panel list.
 *
 * ## Why a footer row cannot simply be moved
 *
 * The shell renders `sidebar.footer.action` as a `kind: 'list'` slot and
 * reconciles its children as React's own: every contributor's footer row (the
 * power button, a plugin's action card) is a node React inserted itself and
 * holds in its child bookkeeping for that container.
 *
 * `appendChild`-ing such a node out of the footer slot survives visually —
 * React leaves a node it no longer owns alone — but it leaves the slot's
 * bookkeeping holding a reference to a node that is no longer its child. The
 * next time the footer slot re-renders (opening the power menu is enough),
 * React calls `insertBefore` with that stale reference, the call throws
 * `NotFoundError`, the slot's error boundary reports
 * `slot entry crashed in 'sidebar.footer.action'`, the entry abdicates, the
 * version bumps, the slot re-renders and throws again: an error loop that
 * saturates the main thread and freezes the page. Verified live — the console
 * log holds tens of identical errors per second, and the page stops responding
 * to input until it is reloaded.
 *
 * ## What the ghost does instead
 *
 * The row's own slot entry is REPLACED by this component, which renders
 * nothing in place: React's footer bookkeeping then holds one entry that
 * produces no host node, so there is nothing left to go stale. The
 * contributor's own component is rendered by the ghost through a portal into a
 * slot element the ghost owns, which the DOM half places among the panel
 * list's rows.
 *
 * The portal is what makes this safe in both directions:
 *
 * - the slot element is created by this module, so React does not own IT —
 *   moving it between the panel list's children is an ordinary DOM write that
 *   no React bookkeeping can desynchronise;
 * - the portal's CONTENT is React's own, rendered into that slot, so the
 *   contributor keeps its hooks, context and state exactly as if the shell had
 *   rendered it — including the footer seat's own props (`{ wide }`), which the
 *   ghost forwards verbatim.
 *
 * The slot element carries {@link ROW_ATTR}, so the row still answers "is it on
 * screen?" and still takes part in the DOM half's placement pass.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

import { GHOST_ATTR as GHOST_ATTR_SOURCE, ROW_ATTR, rowHost } from '../rail/dom.ts'

/**
 * Attribute marking a slot element the ghost owns (see the module comment).
 *
 * Re-exported from `dom.ts` on purpose: the two halves of the plugin share one
 * DOM contract, and the DOM half is what reads it back to place the slot.
 */
export const GHOST_ATTR = GHOST_ATTR_SOURCE

/** What the plan currently says about the row a ghost stands in for. */
export interface GhostState {
  /** Hide unless the row's panel is the active one. */
  hidden: boolean
  /** Always hide: the row is shown inside a group instead. */
  suppressed: boolean
}

/** What one ghost needs from the rail adapter that builds it. */
export interface GhostDeps {
  /** Panel/group id the row renders. */
  id: string
  /**
   * The contributor's own component. Rendered into the slot element with the
   * props the footer seat passes, exactly as the shell would have rendered it.
   */
  component: unknown
  /** Live row state, or `null` when the plan no longer places this row here. */
  read(): GhostState | null
  /** Subscribe to plan changes; the ghost re-renders (and re-places) on each. */
  subscribe(listener: () => void): () => void
  /** Snapshot of the plan generation {@link GhostDeps.subscribe} reports. */
  version(): number
}

/** Any component, in the only shape this module needs. */
export type AnyComponent = (props: Record<string, unknown>) => ReactNode

/** Create the slot element one ghost renders into. */
function createSlot(id: string): HTMLDivElement {
  const element = document.createElement('div')
  element.setAttribute(GHOST_ATTR, '')
  // The DOM half matches rows by this stamp, and `renderedRowIds` counts the
  // row as on screen because of it.
  element.setAttribute(ROW_ATTR, id)
  // No box of its own: the contributor's own root is the panel list's flex
  // item, exactly as it was the footer's.
  element.style.display = 'contents'
  return element
}

/**
 * Build the ghost component for one footer row.
 *
 * Built once per captured registration and cached there (the adapter keeps it
 * next to the glyph wrapper), so a component identity survives every pass and
 * the shell's reconciliation is not restarted by a fresh closure.
 */
export function createGhost(deps: GhostDeps): AnyComponent {
  const ghost = function RailGhost(props: Record<string, unknown>): ReactNode {
    // The plan is read on every render, but only a generation bump makes the
    // ghost re-render: a drag that changes nothing visible must not re-mount
    // the contributor's component (that would drop its own state).
    useSyncExternalStore(deps.subscribe, deps.version)
    const state = deps.read()

    const ref = useRef<HTMLDivElement | null>(null)
    if (ref.current === null && typeof document !== 'undefined') ref.current = createSlot(deps.id)
    const element = ref.current

    // Unmount only: the row went back to the footer, the plugin is disposing,
    // or the sidebar is going away. Re-renders must NOT remove the slot — the
    // contributor's whole subtree lives inside it.
    useEffect(() => () => { ref.current?.remove() }, [])

    // Every render: visibility first, then the slot's place in the panel list.
    // Cheap and idempotent, and it needs no dependency list because the state
    // object is rebuilt per render on purpose.
    useEffect(() => {
      if (element === null) return
      const invisible = state === null || state.suppressed || state.hidden
      element.style.display = invisible ? 'none' : 'contents'
      if (invisible) return
      const host = rowHost('top')
      if (host !== null && element.parentNode !== host) host.appendChild(element)
    })

    if (element === null || state === null || state.suppressed || state.hidden) return null
    const Native = deps.component as AnyComponent | null
    if (Native === null) return null
    // The whole prop bag is forwarded verbatim through JSX — never called as a
    // plain function — so a contributor that consumes composed props (a locale
    // seat, a hook context) keeps working.
    return createPortal(<Native {...props} />, element)
  }
  return ghost
}
