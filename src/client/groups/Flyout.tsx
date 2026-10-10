/**
 * The group flyout: a body-portal overlay opened by a group trigger row.
 *
 * The pattern is the ecosystem's proven `AnchoredPopover` (dsh-better-sidebar):
 * a `div` appended to `document.body` once, a card portaled into it, geometry
 * measured from the anchor's `getBoundingClientRect()` in a layout effect so the
 * first paint is already in place (never a visible jump), and dismissal driven by
 * capture-phase document listeners.
 *
 * Differences that come from this shell (ARCHITECTURE §5):
 * - the anchor is a rail row, so placement depends on the rail's state: a
 *   collapsed 56 px rail flies out to the RIGHT of the row, a wide rail drops
 *   BELOW it; both flip at the viewport edges with an 8 px margin;
 * - a missing member (no registration answers its id) is rendered disabled and
 *   labelled as missing rather than silently dropped, so the configured group
 *   stays readable while its contributor is uninstalled.
 */
import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import type { PlanGroup } from '../../shared/model.ts'
import type { GroupUnitRuntime } from './index.ts'

/** Attribute on the portal target appended to `document.body`. */
export const PORTAL_CONTAINER_ATTRIBUTE = 'data-dsh-panellist-portal'

/** Gap between the anchor row and the card. */
const ANCHOR_GAP = 8
/** Free space kept at every viewport edge. */
const VIEWPORT_MARGIN = 8
/** Widest row that still means "the rail is collapsed" (56 px track + padding). */
const COLLAPSED_ROW_MAX_WIDTH = 60
/** Member glyph size inside the flyout. */
const MEMBER_GLYPH_SIZE = 18

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
export function ensurePortalContainer(): HTMLDivElement {
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

export interface FlyoutProps {
  runtime: GroupUnitRuntime
  /** The group as the latest plan has it. */
  group: PlanGroup
  /** The row button the flyout is anchored to. */
  anchor: HTMLElement
  onSelect(panelId: string): void
  onOverview(): void
  onClose(reason: FlyoutCloseReason): void
}

/** Stable id used by `aria-activedescendant`. */
function itemId(groupId: string, index: number): string {
  return `dsh-panellist-flyout-${groupId}-${index}`
}

/** Keep a portal event from reaching the row that React-wise contains it. */
function stopRowLeak(event: { stopPropagation(): void }): void {
  event.stopPropagation()
}

/** One menu row: the member's effective glyph and name, or a disabled "missing" row. */
export function Flyout(props: FlyoutProps): ReactElement {
  const { runtime, group, anchor, onSelect, onOverview, onClose } = props
  const { deps } = runtime
  const translate = deps.translate
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const container = useMemo(ensurePortalContainer, [])
  const members = group.members
  const activePanelId = deps.rail.activePanelId()

  // Measure once the card is in the DOM; keyed on the member count so a plan
  // change while the menu is open re-measures instead of clipping.
  useLayoutEffect(() => {
    const card = rootRef.current
    if (card === null) return
    const rect = anchor.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    let left: number
    let top: number
    if (rect.width <= COLLAPSED_ROW_MAX_WIDTH) {
      // Collapsed rail: fly out to the right, unless that clips the right edge.
      left = rect.right + ANCHOR_GAP
      if (left + width > viewportWidth - VIEWPORT_MARGIN) {
        left = clampLow(rect.left - width - ANCHOR_GAP)
      }
      top = Math.min(clampLow(rect.top), clampLow(viewportHeight - height - VIEWPORT_MARGIN))
    } else {
      // Wide rail: drop below the row, unless that clips the bottom edge.
      left = rect.left
      top = rect.bottom + ANCHOR_GAP
      if (top + height > viewportHeight - VIEWPORT_MARGIN) {
        top = clampLow(rect.top - height - ANCHOR_GAP)
      }
      left = Math.min(clampLow(left), clampLow(viewportWidth - width - VIEWPORT_MARGIN))
    }
    setPosition(previous =>
      previous !== null && previous.left === left && previous.top === top ? previous : { left, top })
  }, [anchor, members.length])

  // Move focus into the menu so arrow keys and Enter reach it immediately.
  useEffect(() => { menuRef.current?.focus() }, [])

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

  // Only members that still have a page can be selected; a missing member is
  // skipped by arrow navigation rather than trapping the keyboard.
  const selectable = members.map((member, index) => (member.missing ? -1 : index)).filter(index => index >= 0)

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
    if (member === undefined || member.missing) return
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
        disabled={member.missing}
        aria-disabled={member.missing ? 'true' : undefined}
        aria-current={current ? 'true' : undefined}
        data-dsh-panellist-flyout-item=""
        {...(member.missing ? { 'data-dsh-panellist-flyout-missing': '' } : {})}
        {...(current ? { 'data-dsh-panellist-flyout-current': '' } : {})}
        {...(index === activeIndex ? { 'data-dsh-panellist-flyout-highlighted': '' } : {})}
        onMouseEnter={() => { setActiveIndex(index) }}
        onClick={() => {
          if (member.missing) return
          onSelect(member.id)
        }}
      >
        <span data-dsh-panellist-flyout-glyph="">
          {deps.glyph({
            icon: member.icon,
            native: deps.rail.nativeGlyph(member.id),
            size: MEMBER_GLYPH_SIZE,
            active: current,
          })}
        </span>
        <span data-dsh-panellist-flyout-label="">{member.label}</span>
        {member.missing
          ? <span data-dsh-panellist-flyout-missing-label="">{translate.t('rail.group.missing')}</span>
          : null}
      </button>
    )
  })

  return createPortal(
    <div
      ref={rootRef}
      data-dsh-panellist-flyout={group.id}
      // A portal keeps its place in the REACT tree (inside the row button), so
      // without this a click or a keypress inside the card would also reach the
      // shell row's own handlers — selecting a member would then be overwritten
      // by the row selecting the group page. DOM-wise the card is outside the
      // button; React-wise it is not.
      onClick={stopRowLeak}
      onKeyDown={stopRowLeak}
      onMouseDown={stopRowLeak}
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
      <div data-dsh-panellist-flyout-header="">
        <span data-dsh-panellist-flyout-title="">
          {translate.t('rail.group.menuTitle', { name: group.label })}
        </span>
        <button
          type="button"
          data-dsh-panellist-flyout-overview=""
          onClick={() => { onOverview() }}
        >
          {translate.t('rail.group.overview')}
        </button>
      </div>
      <div
        ref={menuRef}
        role="menu"
        tabIndex={-1}
        data-dsh-panellist-flyout-menu=""
        aria-label={translate.t('rail.group.open', { name: group.label })}
        aria-activedescendant={activeIndex >= 0 ? itemId(group.id, activeIndex) : undefined}
        onKeyDown={onKeyDown}
      >
        {items}
      </div>
    </div>,
    container,
  )
}
