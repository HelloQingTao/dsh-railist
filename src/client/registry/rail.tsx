/**
 * The rail adapter: everything this plugin does to the shell's left column.
 *
 * Three jobs, in this order of importance:
 *
 * 1. **Discovery** — read `sidebar.panellist` and project it into the plain
 *    `RegisteredPanel` facts the pure model reasons about.
 * 2. **Rewriting** — write `order`, `label` and the glyph `component` of the
 *    entries the plan manages. The stored entry object is not frozen and is
 *    handed back by `entriesOfSlot`, so a post-hoc write is visible to the
 *    shell (verified fact 3 in docs/ARCHITECTURE.md). Every original field is
 *    captured the first time an entry is seen, so "no opinion" always means
 *    "restore the contributor's own value".
 * 3. **Contribution** — register our own group rows (and their `main` pages)
 *    through the same public `slots.inject`/`slots.register` pair every shipped
 *    plugin uses.
 *
 * A raw field write bumps no ledger version, so the shell has no reason to
 * re-read. {@link RailAdapter.applyOverrides} therefore ends with a *nudge*: a
 * throwaway registration that is disposed in the same task, which mutates the
 * ledger twice and makes the shell re-project `order`/`label`.
 */
import type { ReactNode } from 'react'
import type { StoredEntry, SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { Plan, RegisteredPanel } from '../../shared/model.ts'
import { RAIL_ID_PREFIX } from '../../shared/config.ts'
import type { ClientContext } from '../ctx.ts'
import type { GlyphComponent, GlyphProps, GlyphRequest, RailRowRegistration } from '../contracts.ts'
import { optionalService } from '../service.ts'

/** The rail slot every sidebar row lives in. */
export const RAIL_SLOT = 'sidebar.panellist'

/** The keyed slot that addresses each rail row's page. */
export const MAIN_SLOT = 'main'

/** Identity of the throwaway registration used to make the shell re-read. */
export const NUDGE_ID = `${RAIL_ID_PREFIX}nudge`

/** Whether an id belongs to this plugin (group rows, the nudge row). */
export function isOwnRailId(id: string): boolean {
  return id.startsWith(RAIL_ID_PREFIX)
}

/** `resolveSlotLabel` without a value import from ui-slots (forbidden in the browser bundle). */
function resolveLabel(label: SlotLabel | undefined): string | undefined {
  if (label === undefined) return undefined
  if (typeof label === 'function') {
    try {
      return label()
    } catch {
      return undefined
    }
  }
  return label
}

/** Structural view of the shell's locale-free panel source (`ctx.layout`). */
interface LayoutLike {
  panelInfo?: {
    getSnapshot(): { activePanelId?: unknown }
    subscribe(listener: () => void): () => void
  }
  selectPanel?(panelId: unknown): void
}

/** Read an optional cordis service without letting a missing one throw. */
/** Everything another unit may ask of the rail. */
export interface RailAdapter {
  /** Native rail facts, in the contributors' own order. */
  panels(): readonly RegisteredPanel[]
  /** Subscribe to ledger changes for the rail slot. */
  subscribe(listener: () => void): () => void
  /** The contributor's own glyph component for a panel, or `null`. */
  nativeGlyph(panelId: string): GlyphComponent | null
  /** Whether a `main` page carries this key (so `selectPanel` cannot throw). */
  hasPage(id: string): boolean
  /** Select a panel behind {@link RailAdapter.hasPage}. */
  selectPanel(id: string): void
  /** Currently selected panel id, or an empty string. */
  activePanelId(): string
  /** Observe selection changes. */
  subscribeActive(listener: () => void): () => void
  /** Reconcile every managed entry with the current plan, then nudge. */
  applyOverrides(): void
  /** Register one row of ours plus its page. */
  registerRow(registration: RailRowRegistration, page: () => ReactNode): () => void
  /** How many rail row buttons the DOM currently has (self-check probe 2). */
  railRowCount(): number
  /** Restore every entry we touched, drop every capture and pending nudge. */
  dispose(): void
}

interface Capture {
  entry: StoredEntry
  order: number | undefined
  label: SlotLabel | undefined
  component: unknown
  /** True while `entry.options.order` holds a value we wrote. */
  touchedOrder: boolean
  /** True while `entry.component` is our wrapper. */
  touchedComponent: boolean
  /** Built lazily, once per captured registration. */
  wrapper?: GlyphComponent
  /**
   * Built lazily, once per captured registration. It MUST be cached: a fresh
   * closure on every pass would never compare equal, so the pass would report a
   * change, nudge the ledger, and re-enter itself forever.
   */
  labelThunk?: () => string
}

/**
 * Create the rail adapter.
 * @param ctx - the browser-half context.
 * @param plan - live plan reader; the wrapper and the label thunks call it on
 *   every render/read, so a plan change needs no re-registration.
 * @param glyph - the icon renderer (icons unit).
 */
export function createRailAdapter(
  ctx: ClientContext,
  plan: () => Plan,
  glyph: (request: GlyphRequest) => ReactNode,
): RailAdapter {
  const slots = ctx.slots
  /**
   * Resolved per call, never cached: this plugin's browser half may mount
   * before the bundle that provides `ctx.layout`, and selection plus the active
   * highlight must start working the moment it appears.
   */
  const layoutOf = (): LayoutLike | undefined => optionalService<LayoutLike>(ctx, 'layout')
  const captures = new Map<string, Capture>()
  let nudged = false
  let disposed = false

  const entriesFor = (): readonly StoredEntry[] => {
    try {
      return slots.entriesOfSlot(RAIL_SLOT)
    } catch {
      return []
    }
  }

  const capture = (entry: StoredEntry, id: string): Capture => {
    const existing = captures.get(id)
    if (existing !== undefined && existing.entry === entry) return existing
    const fresh: Capture = {
      entry,
      order: entry.options.order,
      label: entry.options.label,
      component: entry.component,
      touchedOrder: false,
      touchedComponent: false,
    }
    captures.set(id, fresh)
    return fresh
  }

  /** Make the shell re-project the rail: two ledger mutations, one task. */
  const nudge = (): void => {
    if (nudged || disposed) return
    nudged = true
    queueMicrotask(() => {
      nudged = false
      if (disposed) return
      try {
        const dispose = slots.register(
          { name: RAIL_SLOT, id: NUDGE_ID, order: -1 } as never,
          (() => null) as never,
        )
        dispose()
      } catch {
        // The slot is not declared on this shell (or the ledger refused the
        // row): there is nothing to nudge.
      }
    })
  }

  /** The glyph a managed panel renders: a marker plus the effective visual. */
  const wrapperFor = (captureOf: () => Capture, id: string): GlyphComponent => {
    return function RailGlyph(props: GlyphProps): ReactNode {
      const panel = plan().panels.get(id)
      const icon = panel?.icon ?? null
      const suppressed = panel?.suppressed === true
      const hidden = !suppressed && panel?.hidden === true && props['active'] !== true
      const marker: Record<string, string> = { 'data-dsh-panellist-entry': id }
      if (suppressed) marker['data-dsh-panellist-suppressed'] = ''
      else if (hidden) marker['data-dsh-panellist-hidden'] = ''
      const size = typeof props['size'] === 'number' ? props['size'] : 0
      const active = props['active'] === true
      // A hidden row renders no visual at all: the CSS layer removes the row,
      // and the contributor's component is unmounted rather than called with
      // different hook counts (which would break React's hook order).
      let visual: ReactNode = null
      if (!suppressed && !hidden) {
        if (icon !== null) {
          visual = glyph({ icon, native: null, size, active })
        } else {
          const Native = captureOf().component as GlyphComponent | null
          // The contributor's component may consume composed props this plugin
          // knows nothing about (locale seats, hooks), so the whole prop bag is
          // forwarded verbatim through JSX — never called as a plain function.
          visual = Native === null ? null : <Native {...props} />
        }
      }
      return <><span {...marker} />{visual}</>
    }
  }

  const applyOverrides = (): void => {
    if (disposed) return
    const currentPlan = plan()
    let changed = false
    const live = new Set<string>()
    for (const entry of entriesFor()) {
      const id = entry.options.id
      if (typeof id !== 'string' || isOwnRailId(id)) continue
      live.add(id)
      const captureOf = (): Capture => capture(entry, id)
      const captured = captureOf()
      const panel = currentPlan.panels.get(id)

      if (panel === undefined) {
        changed = restore(captured) || changed
        continue
      }

      // --- order -----------------------------------------------------------
      const desiredOrder = panel.order === null ? captured.order : panel.order
      if (desiredOrder === undefined) {
        if (captured.touchedOrder) {
          delete entry.options.order
          captured.touchedOrder = false
          changed = true
        }
      } else if (entry.options.order !== desiredOrder) {
        entry.options.order = desiredOrder
        captured.touchedOrder = desiredOrder !== captured.order
        changed = true
      }

      // --- label -----------------------------------------------------------
      // The shell renders `resolveSlotLabel(options.label) ?? id`, so a
      // registration without a label already displays its id. Comparing against
      // that effective value (not against `undefined`) is what keeps a fresh
      // install a strict no-op instead of writing a thunk that returns the same
      // string the shell would have shown anyway.
      const nativeLabel = resolveLabel(captured.label) ?? id
      if (panel.label !== nativeLabel) {
        // One cached thunk per registration (see `Capture.labelThunk`): the
        // comparison below must be stable or this pass re-enters itself.
        captured.labelThunk ??= (): string => plan().panels.get(id)?.label ?? nativeLabel
        if (entry.options.label !== captured.labelThunk) {
          entry.options.label = captured.labelThunk
          changed = true
        }
      } else if (captured.label !== undefined && entry.options.label !== captured.label) {
        entry.options.label = captured.label
        changed = true
      } else if (captured.label === undefined && entry.options.label !== undefined) {
        delete entry.options.label
        changed = true
      }

      // --- glyph -----------------------------------------------------------
      const needsWrapper = panel.icon !== null || panel.hidden || panel.suppressed
      if (needsWrapper) {
        captured.wrapper ??= wrapperFor(captureOf, id)
        if (entry.component !== captured.wrapper) {
          entry.component = captured.wrapper
          captured.touchedComponent = true
          changed = true
        }
      } else if (captured.touchedComponent) {
        entry.component = captured.component
        captured.touchedComponent = false
        changed = true
      }
    }
    // Drop captures for entries that left the ledger, so a later reinstall
    // starts from the fresh registration's own values.
    for (const id of [...captures.keys()]) if (!live.has(id)) captures.delete(id)
    if (changed) nudge()
  }

  const restore = (captured: Capture): boolean => {
    let changed = false
    if (captured.touchedOrder) {
      if (captured.order === undefined) delete captured.entry.options.order
      else captured.entry.options.order = captured.order
      captured.touchedOrder = false
      changed = true
    }
    if (captured.entry.options.label !== captured.label) {
      if (captured.label === undefined) delete captured.entry.options.label
      else captured.entry.options.label = captured.label
      changed = true
    }
    if (captured.touchedComponent) {
      captured.entry.component = captured.component
      captured.touchedComponent = false
      changed = true
    }
    return changed
  }

  const railRows = (): number => {
    if (typeof document === 'undefined') return 0
    return document.querySelectorAll('nav[class*="_panelList"] > button[class*="_panelRow"]').length
  }

  const adapter: RailAdapter = {
    panels: () => entriesFor()
      .filter(entry => typeof entry.options.id === 'string' && !isOwnRailId(entry.options.id as string))
      .map(entry => {
        const id = entry.options.id as string
        const captured = captures.get(id)
        const order = captured !== undefined && captured.entry === entry ? captured.order : entry.options.order
        const label = captured !== undefined && captured.entry === entry ? captured.label : entry.options.label
        return { id, label: resolveLabel(label) ?? id, order: order ?? 0 }
      }),
    subscribe: (listener) => {
      try {
        return slots.subscribe(RAIL_SLOT, listener)
      } catch {
        return () => {}
      }
    },
    nativeGlyph: (panelId) => {
      const captured = captures.get(panelId)
      return (captured?.component ?? null) as GlyphComponent | null
    },
    hasPage: (id) => {
      try {
        return slots.entries(MAIN_SLOT).some(entry => entry.options.key === id)
      } catch {
        return false
      }
    },
    selectPanel: (id) => {
      const layout = layoutOf()
      if (layout?.selectPanel === undefined) return
      if (!adapter.hasPage(id)) return
      try {
        layout.selectPanel(id)
      } catch {
        // The layout's own guard disagreed with ours; a stale config must never
        // throw across the shell.
      }
    },
    activePanelId: () => {
      const active = layoutOf()?.panelInfo?.getSnapshot().activePanelId
      return typeof active === 'string' ? active : ''
    },
    subscribeActive: (listener) => {
      const source = layoutOf()?.panelInfo
      if (source === undefined) return () => {}
      try {
        return source.subscribe(listener)
      } catch {
        return () => {}
      }
    },
    applyOverrides,
    registerRow: (registration, page) => {
      const disposers: Array<() => void> = []
      try {
        disposers.push(slots.inject(RAIL_SLOT, () => slots.register(
          {
            name: RAIL_SLOT,
            id: registration.railId,
            order: registration.order,
            label: registration.label,
          } as never,
          registration.glyph as never,
        )))
      } catch {
        // Registration refused: the group row simply does not exist.
      }
      try {
        disposers.push(slots.inject(MAIN_SLOT, () => slots.register(
          { name: MAIN_SLOT, key: registration.railId } as never,
          page as never,
        )))
      } catch {
        // Without a page the row is still usable: `selectPanel` is guarded by
        // `hasPage`, so a click on it is a no-op instead of a throw.
      }
      return () => {
        for (const dispose of disposers.reverse()) {
          try {
            dispose()
          } catch {
            // Idempotent disposal: a cascade may already have released it.
          }
        }
      }
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      let changed = false
      for (const captured of captures.values()) changed = restore(captured) || changed
      captures.clear()
      if (changed) {
        // The restorations are raw field writes like any other: the shell still
        // needs one ledger mutation to re-read them.
        disposed = false
        nudge()
        disposed = true
      }
    },
    railRowCount: railRows,
  }

  return adapter
}
