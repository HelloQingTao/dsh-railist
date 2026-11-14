/**
 * The group trigger glyph: the component the shell renders inside a group row
 * button, plus the row wiring that turns a whole-row click — or a moment's hover
 * — into "open the menu at the pointer".
 *
 * The row belongs to the shell (one `<button>` per entry), so this glyph must not
 * nest an interactive element. Instead it installs CAPTURE-phase `click` and
 * `keydown` listeners on its ancestor button: capture runs
 * before React's delegated handler at the root, so a single `stopPropagation()`
 * keeps the shell's own `selectPanel` from ever running while
 * `preventDefault()` cancels the row's default activation.
 *
 * Both triggers hand the menu the pointer position: click takes the event's
 * coordinates and hover takes the last position seen over the row when its delay
 * fires, so the card opens at the cursor's bottom-right (a keyboard press, having
 * no pointer, uses the row's bottom-right corner).
 *
 * Hover is a second, opt-in trigger (`ProfileBehavior.hoverOpenGroups`): resting
 * the pointer on the row opens the menu after a short delay, and a hover-opened
 * menu closes again once the pointer leaves — with a short grace so it can travel
 * the gap into the card. A click-opened menu is untouched by pointer movement.
 *
 * The marker span is the only DOM this unit owns in the row. It carries the group
 * id and, while any member is the active panel, `data-dsh-railist-group-active`
 * — the shell highlights a row only when the row *is* the active panel, which a
 * group row never is, so membership drives the highlight instead.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { GlyphComponent, GlyphProps } from '../contracts.ts'
import { Flyout, type FlyoutCloseReason } from './Flyout.tsx'
import type { GroupUnitRuntime } from './index.ts'

/**
 * Grace period after the pointer leaves a hover-opened menu before it closes.
 * Long enough to cross the 10 px gap between the row/pointer and the card
 * without the card flickering shut, short enough that the menu still feels
 * responsive.
 */
const HOVER_CLOSE_GRACE_MS = 220

/** Which trigger opened the menu; only a hover-open menu closes on pointer-out. */
type OpenMode = 'click' | 'hover'

/** A screen point the menu hangs from (bottom-right of the pointer). */
interface Point { x: number; y: number }

/**
 * Re-render on every plan/active change. `runtime.version()` is a monotonic
 * counter, so the snapshot is referentially stable between notifications — the
 * contract `useSyncExternalStore` requires.
 */
export function useGroupVersion(runtime: GroupUnitRuntime): number {
  return useSyncExternalStore(runtime.subscribe, runtime.version, runtime.version)
}

/**
 * Build the glyph component for one group.
 * @param runtime - the unit runtime (deps + change store).
 * @param groupId - config group id (`group:<name>`).
 */
export function createTriggerGlyph(runtime: GroupUnitRuntime, groupId: string): GlyphComponent {
  const { deps } = runtime

  return function TriggerGlyph(props: GlyphProps): ReactNode {
    const markerRef = useRef<HTMLSpanElement | null>(null)
    const buttonRef = useRef<HTMLElement | null>(null)
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<OpenMode>('click')
    const [point, setPoint] = useState<Point | null>(null)
    const openRef = useRef(false)
    openRef.current = open
    const modeRef = useRef<OpenMode>('click')
    modeRef.current = mode
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useGroupVersion(runtime)

    const clearOpenTimer = (): void => {
      if (openTimer.current !== null) { clearTimeout(openTimer.current); openTimer.current = null }
    }
    const clearCloseTimer = (): void => {
      if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null }
    }
    const clearTimers = (): void => {
      clearOpenTimer()
      clearCloseTimer()
    }
    /** Open the menu at a pointer position and record which trigger did it. */
    const openMenu = (source: OpenMode, at: Point | null): void => {
      clearTimers()
      setMode(source)
      setPoint(at)
      setOpen(true)
    }
    /** Close a hover-opened menu after the grace period. */
    const scheduleClose = (): void => {
      clearCloseTimer()
      closeTimer.current = setTimeout(() => {
        closeTimer.current = null
        setOpen(false)
      }, HOVER_CLOSE_GRACE_MS)
    }

    // Row wiring. Mount-only: a re-registration builds a fresh component, so the
    // shell mounts a new row and this effect runs again against the new button.
    useEffect(() => {
      const marker = markerRef.current
      const button = marker === null ? null : marker.closest('button')
      if (button === null) return undefined
      buttonRef.current = button
      const previousHaspopup = button.getAttribute('aria-haspopup')
      button.setAttribute('aria-haspopup', 'menu')
      // The last pointer position seen over the row. Hover opens after a delay, so
      // it must open where the pointer IS when the timer fires, not where it
      // entered — keep this fresh from mousemove as well.
      let lastPointer: Point | null = null
      const onClick = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        openMenu('click', { x: event.clientX, y: event.clientY })
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        event.stopPropagation()
        // No pointer for a keyboard press: drop the menu at the row's corner.
        const rect = button.getBoundingClientRect()
        openMenu('click', { x: rect.right, y: rect.bottom })
      }
      const onMouseMove = (event: MouseEvent): void => {
        lastPointer = { x: event.clientX, y: event.clientY }
      }
      // Hover opens the menu after the configured delay; leaving before it fires
      // cancels the pending open. Leaving an already-open hover menu is handled by
      // the card's own enter/leave (see `onCardLeave`), not here: this mouseleave
      // only arms the grace timer when the menu is a hover menu and stays open.
      const onMouseEnter = (event: MouseEvent): void => {
        lastPointer = { x: event.clientX, y: event.clientY }
        if (openRef.current) return
        const behavior = deps.behavior()
        if (!behavior.hoverOpenGroups) return
        clearOpenTimer()
        openTimer.current = setTimeout(() => {
          openTimer.current = null
          openMenu('hover', lastPointer)
        }, behavior.hoverOpenDelayMs)
      }
      const onMouseLeave = (): void => {
        clearOpenTimer()
        if (modeRef.current === 'hover') scheduleClose()
      }
      button.addEventListener('click', onClick, true)
      button.addEventListener('keydown', onKeyDown, true)
      button.addEventListener('mousemove', onMouseMove)
      button.addEventListener('mouseenter', onMouseEnter)
      button.addEventListener('mouseleave', onMouseLeave)
      return () => {
        button.removeEventListener('click', onClick, true)
        button.removeEventListener('keydown', onKeyDown, true)
        button.removeEventListener('mousemove', onMouseMove)
        button.removeEventListener('mouseenter', onMouseEnter)
        button.removeEventListener('mouseleave', onMouseLeave)
        clearTimers()
        if (previousHaspopup === null) button.removeAttribute('aria-haspopup')
        else button.setAttribute('aria-haspopup', previousHaspopup)
        if (buttonRef.current === button) buttonRef.current = null
      }
    }, [])

    if (runtime.isDisposed()) return null

    // Read the plan per render: an icon-only change does not re-register the row,
    // so the glyph has to pick the new icon up from the live plan.
    const group = deps.plan().groups.get(groupId)
    const activePanelId = deps.rail.activePanelId()
    const active = group !== undefined && group.members.some(member => member.id === activePanelId)
    const fallbackPanelId = group?.iconFallbackPanelId ?? null
    /**
     * A hidden trigger leaves the rail exactly like a hidden panel does: the
     * marker below is what `HIDE_CSS` matches, and being active keeps the row
     * visible (README §2.3). Without this the editor showed the group as hidden
     * while the rail kept rendering it.
     */
    const hidden = group?.hidden === true && !active

    const close = (reason: FlyoutCloseReason): void => {
      clearTimers()
      setOpen(false)
      if (reason === 'escape') buttonRef.current?.focus()
    }
    const select = (panelId: string): void => {
      clearTimers()
      setOpen(false)
      if (deps.rail.hasPage(panelId)) {
        // Guarded by the layout's own `main` probe inside the rail host.
        deps.rail.selectPanel(panelId)
        return
      }
      // No `main` page (a footer action button like the capability panel):
      // `selectPanel` is a guarded no-op there, so evoke the member's own row
      // and click its real button — the member keeps its native behaviour
      // inside the group instead of silently doing nothing.
      deps.rail.activateRow(panelId)
    }
    // Keep-alive for a hover menu: entering the card cancels the pending close,
    // leaving it restarts the grace timer. A click-opened menu ignores both.
    const onCardEnter = (): void => { if (modeRef.current === 'hover') clearCloseTimer() }
    const onCardLeave = (): void => { if (modeRef.current === 'hover') scheduleClose() }

    return (
      <>
        <span
          ref={markerRef}
          data-dsh-railist-group={groupId}
          {...(active ? { 'data-dsh-railist-group-active': '' } : {})}
          {...(hidden ? { 'data-dsh-railist-hidden': '' } : {})}
        />
        {group === undefined || hidden
          ? null
          : deps.glyph({
              icon: group.icon,
              native: fallbackPanelId === null ? null : deps.rail.nativeGlyph(fallbackPanelId),
              size: props.size,
              active,
            })}
        {open && group !== undefined && buttonRef.current !== null
          ? (
            <Flyout
              runtime={runtime}
              group={group}
              anchor={buttonRef.current}
              point={point}
              mode={mode}
              onCardEnter={onCardEnter}
              onCardLeave={onCardLeave}
              onSelect={select}
              onClose={close}
            />
          )
          : null}
      </>
    )
  }
}
