/**
 * The group trigger glyph: the component the shell renders inside a group row
 * button, plus the row wiring that turns a whole-row click into "open the menu".
 *
 * The row belongs to the shell (one `<button>` per entry), so this glyph must not
 * nest an interactive element. Instead it installs CAPTURE-phase `click` and
 * `keydown` listeners on its ancestor button (ARCHITECTURE §5): capture runs
 * before React's delegated handler at the root, so a single `stopPropagation()`
 * keeps the shell's own `selectPanel` from ever running while
 * `preventDefault()` cancels the row's default activation.
 *
 * The marker span is the only DOM this unit owns in the row. It carries the group
 * id and, while any member is the active panel, `data-dsh-panellist-group-active`
 * — the shell highlights a row only when the row *is* the active panel, which a
 * group row never is, so membership drives the highlight instead.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { GlyphComponent, GlyphProps } from '../contracts.ts'
import { Flyout, type FlyoutCloseReason } from './Flyout.tsx'
import type { GroupUnitRuntime } from './index.ts'

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
    useGroupVersion(runtime)

    // Row wiring. Mount-only: a re-registration builds a fresh component, so the
    // shell mounts a new row and this effect runs again against the new button.
    useEffect(() => {
      const marker = markerRef.current
      const button = marker === null ? null : marker.closest('button')
      if (button === null) return undefined
      buttonRef.current = button
      const previousHaspopup = button.getAttribute('aria-haspopup')
      button.setAttribute('aria-haspopup', 'menu')
      const openMenu = (): void => { setOpen(true) }
      const onClick = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        openMenu()
      }
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        event.stopPropagation()
        openMenu()
      }
      button.addEventListener('click', onClick, true)
      button.addEventListener('keydown', onKeyDown, true)
      return () => {
        button.removeEventListener('click', onClick, true)
        button.removeEventListener('keydown', onKeyDown, true)
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
      setOpen(false)
      if (reason === 'escape') buttonRef.current?.focus()
    }
    const select = (panelId: string): void => {
      setOpen(false)
      // Guarded by the layout's own `main` probe inside the rail host.
      deps.rail.selectPanel(panelId)
    }

    return (
      <>
        <span
          ref={markerRef}
          data-dsh-panellist-group={groupId}
          {...(active ? { 'data-dsh-panellist-group-active': '' } : {})}
          {...(hidden ? { 'data-dsh-panellist-hidden': '' } : {})}
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
              onSelect={select}
              onOverview={() => { select(group.railId) }}
              onClose={close}
            />
          )
          : null}
      </>
    )
  }
}
