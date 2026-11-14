/**
 * The group flyout: a body-portal overlay opened by a group trigger row.
 *
 * The pattern is the ecosystem's proven `AnchoredPopover` (dsh-better-sidebar):
 * a `div` appended to `document.body` once, a card portaled into it, geometry
 * measured in a layout effect so the first paint is already in place (never a
 * visible jump), and dismissal driven by capture-phase document listeners.
 *
 * Differences that come from this shell:
 * - the menu drops straight down from the pointer's x (both click and hover open
 *   under the cursor), with a small breathing gap above it, and it never sits
 *   flush on the trigger row — when the pointer is over the row it drops just
 *   below it; it flips horizontally / above at the viewport edges, keeping an
 *   8 px margin. With no pointer (a keyboard press) it hangs from the row's
 *   bottom-right corner;
 * - a member that is hidden or whose contributor is not installed leaves the
 *   menu entirely (README §2.3); the group stays readable in the settings page,
 *   where a missing member is marked as missing.
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import type { PlanGroup } from '../../shared/model.ts'
import type { GroupUnitRuntime } from './index.ts'

/** Attribute on the portal target appended to `document.body`. */
const PORTAL_CONTAINER_ATTRIBUTE = 'data-dsh-railist-portal'

/** Breathing gap between the pointer (or row corner) and the card. */
const POINTER_GAP = 10
/** Free space kept at every viewport edge. */
const VIEWPORT_MARGIN = 8
/** Member glyph size inside the flyout; the shell's menu item icon is 14. */
const MEMBER_GLYPH_SIZE = 14

/** Lower bound of the "flip into the viewport" clamp, kept total for a 0-size viewport. */
function clampLow(limit: number): number {
  return Math.max(VIEWPORT_MARGIN, limit)
}

/**
 * The one portal container this plugin keeps in `document.body`.
 *
 * Adopted by attribute (not a module flag) so a re-evaluated bundle under HMR
 * cannot end up with two containers — the same lesson `styles.ts` records.
 */
function ensurePortalContainer(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>(`[${PORTAL_CONTAINER_ATTRIBUTE}]`)
  if (existing !== null) return existing
  const container = document.createElement('div')
  container.setAttribute(PORTAL_CONTAINER_ATTRIBUTE, '')
  document.body.appendChild(container)
  return container
}

/** Drop the portal container; safe to call when none exists. */
export function removePortalContainer(): void {
  if (typeof document === 'undefined') return
  for (const node of document.querySelectorAll(`[${PORTAL_CONTAINER_ATTRIBUTE}]`)) node.remove()
}

/** Why the menu is closing: an Escape restores focus to the row, a click does not. */
export type FlyoutCloseReason = 'escape' | 'outside'

/** A screen point the menu hangs from (bottom-right of the pointer). */
export interface FlyoutPoint { x: number; y: number }

export interface FlyoutProps {
  runtime: GroupUnitRuntime
  /** The group as the latest plan has it. */
  group: PlanGroup
  /** The row button the flyout is anchored to (dismissal + no-pointer fallback). */
  anchor: HTMLElement
  /**
   * Where the pointer was when the menu opened. The card hangs from the point's
   * bottom-right; when absent (a keyboard press) the row's bottom-right corner is
   * used instead.
   */
  point?: FlyoutPoint | null
  /**
   * Which trigger opened the menu. `click` (the default) moves focus into the
   * menu; `hover` does not steal focus. Placement is pointer-based for both.
   */
  mode?: 'click' | 'hover'
  /** Pointer entered the card: cancel any pending hover-close (keep-alive). */
  onCardEnter?(): void
  /** Pointer left the card: let the hover menu close after its grace period. */
  onCardLeave?(): void
  onSelect(panelId: string): void
  onClose(reason: FlyoutCloseReason): void
}

/** Stable id used by `aria-activedescendant`. */
function itemId(groupId: string, index: number): string {
  return `dsh-railist-flyout-${groupId}-${index}`
}

/** Keep a portal event from reaching the row that React-wise contains it. */
function stopRowLeak(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

/** One menu row: the member's effective glyph and name, or a disabled "missing" row. */
export function Flyout(props: FlyoutProps): ReactElement {
  const { runtime, group, anchor, point, onSelect, onClose, onCardEnter, onCardLeave } = props
  const hoverMode = props.mode === 'hover'
  const { deps } = runtime
  const translate = deps.translate
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onCardEnterRef = useRef(onCardEnter)
  onCardEnterRef.current = onCardEnter
  const onCardLeaveRef = useRef(onCardLeave)
  onCardLeaveRef.current = onCardLeave
  const container = useMemo(ensurePortalContainer, [])
  // Hidden members stay in the group (count, order, highlight) but leave the
  // menu: their rail row is already suppressed, so "hidden" for a member is
  // exactly "not in this menu" (README §2.3). A MISSING member leaves too —
  // its registration is gone, so a disabled "missing" row only took up room
  // the user cannot act on; the settings page is where one gets cleaned up.
  const members = group.members.filter(member => !member.hidden && !member.missing)
  const activePanelId = deps.rail.activePanelId()

  // Measure once the card is in the DOM; keyed on the member count / pointer so a
  // plan change or a fresh open re-measures instead of clipping.
  useLayoutEffect(() => {
    const card = rootRef.current
    if (card === null) return
    const width = card.offsetWidth
    const height = card.offsetHeight
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    // Anchor: the pointer when we have one (click and hover both open at the
    // cursor), else the row's bottom-right corner for a keyboard press. The card
    // hangs to the bottom-right, with a small breathing gap, and flips left /
    // above at the viewport edges.
    const rect = anchor.getBoundingClientRect()
    const baseX = point?.x ?? rect.right
    const baseY = point?.y ?? rect.bottom
    // Directly below the pointer: the card's left edge sits on the pointer's x.
    let left = baseX
    let top = baseY + POINTER_GAP
    // Never sit flush on the row that opened the menu: when the pointer is on
    // (or above the bottom of) the row, the pointer-anchored card would overlap
    // it — drop it just below the row instead, keeping the breathing gap.
    const overlapsRow = left < rect.right && left + width > rect.left
      && top < rect.bottom && top + height > rect.top
    if (overlapsRow) {
      top = rect.bottom + POINTER_GAP
    }
    // Flip at the viewport edges: left of the pointer, or above the row.
    if (left + width > viewportWidth - VIEWPORT_MARGIN) {
      left = clampLow(baseX - width - POINTER_GAP)
    }
    if (top + height > viewportHeight - VIEWPORT_MARGIN) {
      top = clampLow((overlapsRow ? rect.top : baseY) - height - POINTER_GAP)
    }
    left = clampLow(left)
    top = clampLow(top)
    setPosition(previous =>
      previous !== null && previous.left === left && previous.top === top ? previous : { left, top })
  }, [anchor, members.length, hoverMode, point?.x, point?.y])

  // Keep-alive, via NATIVE enter/leave on the portal root. React's synthetic
  // enter/leave is unreliable across this portal because the card's React parent
  // is the anchor button while its DOM parent is `document.body`: a pointer that
  // jumps straight from the row into the card can miss `onMouseEnter`. Native
  // listeners fire on the DOM node regardless.
  useEffect(() => {
    const el = rootRef.current
    if (el === null) return undefined
    const enter = (): void => { onCardEnterRef.current?.() }
    const leave = (): void => { onCardLeaveRef.current?.() }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
    }
  }, [])

  // Move focus into the menu so arrow keys and Enter reach it immediately — but
  // NOT for a hover-opened menu: hovering must not steal keyboard focus from
  // wherever the user was. A click still focuses it.
  useEffect(() => { if (!hoverMode) menuRef.current?.focus() }, [hoverMode])

  // Dismissal, following the selection-popup contract: a mousedown outside the
  // card (and outside its own trigger row) closes it; Escape closes it and hands
  // focus back to the trigger. Capture phase, so neither can be swallowed by a
  // handler deeper in the tree.
  useEffect(() => {
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      const card = rootRef.current
      if (card !== null && card.contains(target)) return
      if (anchor.contains(target)) return
      onCloseRef.current('outside')
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current('escape')
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [anchor])

  // Everything in the menu is selectable: hidden and missing members are
  // filtered out before this, so no row can trap the keyboard cursor.
  const selectable = members.map((_member, index) => index)

  const move = (delta: 1 | -1): void => {
    if (selectable.length === 0) return
    const at = selectable.indexOf(activeIndex)
    const next = at < 0
      ? (delta === 1 ? 0 : selectable.length - 1)
      : (at + delta + selectable.length) % selectable.length
    setActiveIndex(selectable[next] ?? -1)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const key = event.key
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      move(key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return
    const member = members[activeIndex]
    if (member === undefined) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(member.id)
  }

  const items = members.map((member, index) => {
    const current = member.id === activePanelId
    return (
      <button
        key={member.id}
        type="button"
        role="menuitem"
        id={itemId(group.id, index)}
        aria-current={current ? 'true' : undefined}
        data-dsh-railist-flyout-item=""
        {...(current ? { 'data-dsh-railist-flyout-current': '' } : {})}
        {...(index === activeIndex ? { 'data-dsh-railist-flyout-highlighted': '' } : {})}
        onMouseEnter={() => { setActiveIndex(index) }}
        onClick={() => { onSelect(member.id) }}
      >
        <span data-dsh-railist-flyout-glyph="">
          {deps.glyph({
            icon: member.icon,
            native: deps.rail.nativeGlyph(member.id),
            size: MEMBER_GLYPH_SIZE,
            active: current,
          })}
        </span>
        <span data-dsh-railist-flyout-label="">{member.label}</span>
      </button>
    )
  })

  return createPortal(
    <div
      ref={rootRef}
      data-dsh-railist-flyout={group.id}
      // A portal keeps its place in the REACT tree (inside the row button), so
      // without this a click or a keypress inside the card would also reach the
      // shell row's own handlers — selecting a member would then be overwritten
      // by the row selecting the group page. DOM-wise the card is outside the
      // button; React-wise it is not.
      onClick={stopRowLeak}
      onKeyDown={stopRowLeak}
      onMouseDown={stopRowLeak}
      // Keep-alive is wired with native listeners in an effect above; React's
      // synthetic enter/leave is unreliable across this portal (see the effect).
      // Geometry stays inline (the measurement owns `left`/`top`); everything
      // else is the registered CSS chunk. Hidden until measured so the card
      // never flashes at its default position.
      style={{
        position: 'fixed',
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        visibility: position === null ? 'hidden' : 'visible',
      }}
    >
      {/* The shell's own menu surface is TWO layers (MenuSurface: `_material_`
          paints the translucent fill, `_backing_` — macOS only — puts an opaque
          plate under it, because the menu fill there is only ~45–58% alpha). The
          card used to paint the fill on its root, so on macOS it had no plate to
          sit on and the rail's rows read straight through it while every native
          menu looked solid. Layer them the same way. */}
      <div data-dsh-railist-flyout-backing="" aria-hidden="true" />
      <div data-dsh-railist-flyout-material="" aria-hidden="true" />
      {/* No header: the members ARE the menu. A "Group: <name>" title above them
          only repeated what the trigger row already shows, and it pushed the
          first member down by a line (user feedback, 2026-10-25). */}
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        data-dsh-railist-flyout-menu=""
        aria-label={translate.t('rail.group.open', { name: group.label })}
        aria-activedescendant={activeIndex >= 0 ? itemId(group.id, activeIndex) : undefined}
        onKeyDown={onKeyDown}
      >
        {items.length === 0
          ? <p data-dsh-railist-flyout-empty="">{translate.t('rail.group.emptyMenu')}</p>
          : items}
      </div>
    </div>,
    container,
  )
}
