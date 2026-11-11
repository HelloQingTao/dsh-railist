/**
 * Generic host-row adapters: turn shell-drawn sidebar buttons into ordinary
 * rail rows.
 *
 * `dsh-client-ui-sidebar` appends a few buttons (its "More" launcher among
 * them) straight into `nav.panelList` and never registers them in
 * `sidebar.panellist`, so the sequence editor cannot see them: such a button
 * can be neither ordered, hidden nor grouped. For every declaration in
 * `adapters.ts` this unit registers a proxy row in that slot instead, hides the
 * shell's real button (keeping it in the DOM so a `portal: true` menu still
 * has an anchor rect), and forwards a click on the proxy to the real button.
 *
 * Everything the plan then does to the proxy — order, label, hide, suppress
 * into a group — is the ordinary rail machinery; no config shape change, no
 * schema bump, no host-half change. The only private-shell dependency is each
 * host button's structure, isolated in the adapter's selector. Adding a new
 * wild button is ONE line in `adapters.ts`.
 *
 * This unit is created in the composition root (`index.tsx`), not inside the
 * controller: it owns document-level listeners and host-DOM lookups, which are
 * browser-mount concerns, and staying outside `createController` keeps the
 * controller's "real controller + fake ledger" specs free of a synthetic row
 * that has no real sidebar to be unrendered in.
 */
import type { ReactNode } from 'react'
import type { GlyphComponent, GlyphRequest } from '../contracts.ts'
import type { ClientContext } from '../ctx.ts'
import type { Translator } from '../i18n/index.ts'
import { PANEL_HOST_BUTTON_SELECTOR, hostRowsEvokeCss, hostRowsHideCss } from '../rail/css.ts'
import { ROW_ATTR } from '../rail/dom.ts'
import { RAIL_SLOT } from '../registry/rail.tsx'
import type { StyleRegistry } from '../styles.ts'
import {
  GROUP_MARKER_SELECTOR,
  HOST_ROW_ADAPTERS,
  resolveLabel,
  type HostRowAdapter,
} from './adapters.ts'

export interface MoreUnitDeps {
  ctx: ClientContext
  translate: Translator
  /** The single aggregated stylesheet; the host-button hide rule is registered here. */
  styles: StyleRegistry
  /** The plugin's single glyph decision point (see `icons/index.tsx`). */
  glyph: (request: GlyphRequest) => ReactNode
}

export interface MoreUnit {
  dispose(): void
}

/** Marker the glyph wrapper stamps while a grouped member is evoked. */
const EVOKED_ATTR = 'data-dsh-railist-evoked'

/** Horizontal gap between a trigger row and the menu that flies out to its right. */
const ANCHOR_GAP = 8

/**
 * Whether a click landed on one of our proxy rows.
 *
 * A visible proxy carries the DOM stamp; a grouped member is hidden while
 * evoked and is recognised by the wrapper's evoke marker instead. Both states
 * resolve to the adapter whose id was stamped, so clicking a proxy inside a
 * group opens that host button's own menu exactly like a standalone row.
 */
function adapterFor(button: Element, adapters: readonly HostRowAdapter[]): HostRowAdapter | null {
  const stamped = button.getAttribute(ROW_ATTR)
  if (stamped !== null) {
    const found = adapters.find(adapter => adapter.id === stamped)
    if (found !== undefined) return found
  }
  const evoked = button.querySelector(`[${EVOKED_ATTR}]`)
  if (evoked !== null) {
    const id = evoked.getAttribute(EVOKED_ATTR)
    const found = id === null ? undefined : adapters.find(adapter => adapter.id === id)
    if (found !== undefined) return found
  }
  return null
}

/**
 * The shell's real button for one adapter, matched structurally (never by
 * localized text). Scans a `:has()`-free selector so this also works where the
 * selector engine lacks `:has()`, then skips railist's own rows: group rows set
 * `aria-haspopup="menu"` too, and every stamped row carries `ROW_ATTR`.
 */
function findHostButton(adapter: HostRowAdapter): HTMLButtonElement | null {
  for (const button of document.querySelectorAll<HTMLButtonElement>(adapter.hostSelector)) {
    if (button.hasAttribute(ROW_ATTR)) continue
    if (button.querySelector(GROUP_MARKER_SELECTOR) !== null) continue
    return button
  }
  return null
}

/**
 * A measurable anchor for a grouped (evoked) proxy.
 *
 * `activateRow()` evokes the member and clicks its button a frame LATER. By
 * then the flyout card has unmounted, and our evoke rule hides the row outright
 * (0x0 rect). The group's trigger row in the rail is still there, though: anchor
 * the host menu to its RIGHT edge, top aligned — the same "submenu flies right"
 * rule the group flyout follows, so the pointer travels horizontally instead of
 * the menu popping up at the raw mouse point over the page content. When the
 * rail holds several groups, the row nearest the pointer wins.
 */
function evokeAnchor(lastX: number, lastY: number): { left: number; top: number } {
  let best: DOMRect | null = null
  let bestDistance = Infinity
  for (const button of document.querySelectorAll<HTMLButtonElement>(PANEL_HOST_BUTTON_SELECTOR)) {
    if (button.querySelector(GROUP_MARKER_SELECTOR) === null) continue
    const rect = button.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) continue
    const distance = Math.abs(rect.top + rect.height / 2 - lastY)
    if (distance < bestDistance) {
      bestDistance = distance
      best = rect
    }
  }
  if (best !== null) return { left: best.right + ANCHOR_GAP, top: best.top }
  return { left: lastX, top: lastY }
}

/**
 * Build the host-row unit. Returns a disposer that restores every shell
 * button. `createMoreUnit` is kept as a compatibility alias for the composition
 * root and the specs that predate the adapter table.
 */
export function createHostRowsUnit(deps: MoreUnitDeps): MoreUnit {
  const { ctx, translate, styles, glyph } = deps
  const adapters = HOST_ROW_ADAPTERS

  // One aggregated rule hides every declared host button. The buttons stay in
  // the DOM (so a portal menu keeps an anchor rect); the proxy rows take their
  // visible place and are ordered / hidden / grouped normally.
  styles.register('host-rows-hide', hostRowsHideCss(adapters))
  // A grouped proxy is evoked to be clicked. EVOKE_CSS would turn it into
  // `display: contents`, spilling its glyph + title into the rail as bare flex
  // children (that rule exists for footer popovers that render inside the row).
  // The host menu is a portal anchored to the parked button instead, so hiding
  // the row outright is safe and keeps the rail clean. Scoped by adapter id.
  styles.register('host-rows-evoke', hostRowsEvokeCss(adapters))

  const disposeRows: Array<() => void> = []
  for (const adapter of adapters) {
    // A plain icon, no hooks, no marker of its own: `wrapperFor` may replace
    // this component with the configured icon, and click interception must not
    // depend on the glyph being mounted.
    const HostGlyph: GlyphComponent = (props) => {
      const size = typeof props['size'] === 'number' ? props['size'] : 18
      return glyph({ icon: { kind: 'builtin', name: adapter.icon }, size, active: props['active'] === true })
    }

    // A real slot entry (NOT a `main` page): `hasPage` stays false, so a grouped
    // member click goes through `activateRow`, which evokes this row and clicks
    // its button — the same path any footer action without a page takes.
    try {
      disposeRows.push(ctx.slots.inject(RAIL_SLOT, () => ctx.slots.register(
        {
          name: RAIL_SLOT,
          id: adapter.id,
          order: adapter.order,
          label: () => resolveLabel(adapter, translate),
        } as never,
        HostGlyph as never,
      )))
    } catch {
      // A shell that refuses one registration keeps its own button: that rule's
      // hide selector matches nothing there and the rail is left as it was.
    }
  }

  /** Last real pointer position, for the evoke case (rect is hidden / 0x0). */
  let lastX = 0
  let lastY = 0
  const onPointerDown = (event: PointerEvent): void => {
    // A programmatic `.click()` reports 0,0; never let it erase the position of
    // the flyout item the user actually pressed.
    if (event.clientX !== 0 || event.clientY !== 0) {
      lastX = event.clientX
      lastY = event.clientY
    }
  }

  /**
   * Open the shell's own menu from a proxy row.
   *
   * `position: fixed` keeps the hidden host button measurable, but at (0,0);
   * move it to a sensible anchor for this interaction so the portal menu opens
   * beside the row the user clicked rather than in the viewport corner. A
   * visible proxy has its own rect; an evoked (grouped) one is anchored to its
   * group row instead (see `evokeAnchor`).
   */
  const forward = (adapter: HostRowAdapter, proxy: Element): void => {
    const host = findHostButton(adapter)
    if (host === null) return
    const rect = proxy.getBoundingClientRect()
    const measurable = rect.width > 0 || rect.height > 0
    const anchor = measurable ? { left: rect.left, top: rect.top } : evokeAnchor(lastX, lastY)
    host.style.left = `${anchor.left}px`
    host.style.top = `${anchor.top}px`
    host.click()
  }

  // Document CAPTURE runs before the shell's React root delegate, so
  // `stopPropagation` keeps `selectPanel(<adapter id>)` (which has no main page)
  // from ever running. Group rows install their own capture listener on their
  // button; they are not proxy rows, so this handler leaves them untouched.
  const onClick = (event: MouseEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (button === null) return
    const adapter = adapterFor(button, adapters)
    if (adapter === null) return
    event.preventDefault()
    event.stopPropagation()
    forward(adapter, button)
  }

  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('click', onClick, true)

  return {
    dispose: () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
      for (const adapter of adapters) {
        const host = findHostButton(adapter)
        if (host !== null) {
          host.style.removeProperty('left')
          host.style.removeProperty('top')
        }
      }
      for (const dispose of disposeRows) {
        try {
          dispose()
        } catch {
          // Idempotent disposal: a cascade may already have released it.
        }
      }
    },
  }
}

/** Compatibility alias: the composition root and older specs call this name. */
export const createMoreUnit = createHostRowsUnit
