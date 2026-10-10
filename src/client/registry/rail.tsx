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
import type { Plan, PlanPanel, RegisteredPanel } from '../../shared/model.ts'
import { RAIL_ID_PREFIX, isOwnRailId } from '../../shared/config.ts'
import type { ClientContext } from '../ctx.ts'
import type { GlyphComponent, GlyphProps, GlyphRequest, RailRowRegistration } from '../contracts.ts'
import { optionalService } from '../service.ts'

/** The rail slot every sidebar row lives in. */
export const RAIL_SLOT = 'sidebar.panellist'

/** The keyed slot that addresses each rail row's page. */
export const MAIN_SLOT = 'main'

/** Identity of the throwaway registration used to make the shell re-read. */
export const NUDGE_ID = `${RAIL_ID_PREFIX}nudge`

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

/**
 * Page-global registry of the glyph wrappers THIS plugin built, each mapped to
 * a getter for the contributor's own component.
 *
 * A wrapped entry carries the contributor's component nowhere but inside the
 * wrapper's closure, so anything that reads `entry.component` back can pick up
 * one of our own wrappers: `nativeGlyph` feeds the settings previews from it,
 * and {@link createRailAdapter}'s capture adopts it when it meets an entry it
 * has not seen. A wrapper renders the suppression marker instead of an icon
 * when its panel is a group member, so a preview fed our own wrapper was blank
 * — every icon inside a group disappeared from the settings page.
 *
 * The map lives on `globalThis`, not in module scope, for the same reason the
 * mount guard does (`mount.ts`): the shell may evaluate this bundle again while
 * the entries it wrapped are still installed, and a module-local map would not
 * recognise the previous evaluation's wrapper.
 */
const WRAPPER_REGISTRY_KEY = '__dshPanellistGlyphWrappers'

/** Tells one of our wrappers apart from a contributor's component, and unwraps it. */
interface WrapperRegistry extends WeakMap<GlyphComponent, () => unknown> {}

function wrapperRegistry(): WrapperRegistry {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[WRAPPER_REGISTRY_KEY]
  if (existing instanceof WeakMap) return existing as WrapperRegistry
  const created: WrapperRegistry = new WeakMap()
  scope[WRAPPER_REGISTRY_KEY] = created
  return created
}

/** The contributor component behind one of our wrappers, or `null` for anything else. */
function unwrap(component: unknown): GlyphComponent | null {
  if (typeof component !== 'function') return null
  const origin = wrapperRegistry().get(component as GlyphComponent)
  if (origin === undefined) return null
  const value = origin()
  return typeof value === 'function' ? value as GlyphComponent : null
}

/** One glyph choice, in a form two plans can be compared by. */
function iconKey(icon: PlanPanel['icon']): string {
  if (icon === null) return '-'
  if (icon.kind === 'builtin') return `builtin:${icon.name}`
  // The whole SVG: a re-paste that renders differently must re-project too.
  if (icon.kind === 'custom') return `custom:${icon.svg}`
  return 'original'
}

/**
 * Everything the shell renders for one rail row: the fields it reads off the
 * ledger (`order`, `label`) and the values our own glyph reads out of the live
 * plan (`icon`, `hidden`, `suppressed`). See {@link createRailAdapter}'s rewrite
 * pass for why a plan is compared by this digest at all.
 */
function renderingDigest(plan: Plan): string {
  const parts: string[] = []
  for (const [id, panel] of plan.panels) {
    parts.push([
      id,
      String(panel.order),
      panel.label,
      iconKey(panel.icon),
      panel.hidden ? 'hidden' : '-',
      panel.suppressed ? 'suppressed' : '-',
    ].join('\u0001'))
  }
  parts.push('\u0002')
  for (const [id, group] of plan.groups) {
    parts.push([
      id,
      String(group.order),
      group.label,
      iconKey(group.icon),
      group.hidden ? 'hidden' : '-',
      group.iconFallbackPanelId ?? '-',
      group.members.map(member => `${member.id}=${member.label}${member.missing ? '?' : ''}`).join(','),
    ].join('\u0001'))
  }
  return parts.join('\u0003')
}

/** Structural view of the shell's locale-free panel source (`ctx.layout`). */
interface LayoutLike {
  panelInfo?: {
    getSnapshot(): { activePanelId?: unknown }
    subscribe(listener: () => void): () => void
  }
  selectPanel?(panelId: unknown): void
}

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
  /** Digest of the last plan this adapter reconciled against; see the pass below. */
  let lastDigest: string | null = null

  /**
   * The one structural seam to the shell's slot registry.
   *
   * `ctx.slots.register` is generic over the whole `SlotMap`, which a caller
   * holding slot names as strings cannot satisfy. Casting the ARGUMENTS with
   * `as never` would silence every mistake in them (a `key` where a `list` wants
   * an `id`, a component whose props drifted). These two wrappers are typed
   * against LOCAL shapes instead, so the check moves to the call sites — and
   * they call through `slots` rather than extracting the method, which would
   * lose its receiver (`register` is a cordis service method).
   */
  const registerList = (options: {
    name: string
    id: string
    order: number
    label?: () => string
  }, component: unknown): (() => void) => slots.register(options as never, component as never)
  const registerKeyed = (options: { name: string; key: string }, component: unknown): (() => void) =>
    slots.register(options as never, component as never)

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
    // The entry may still hold OUR wrapper from an earlier controller over this
    // ledger (a second `apply`, or a re-evaluated bundle). Adopting it as the
    // contributor's component is what produced an icon-less settings page: the
    // wrapper renders a marker, not a glyph. Unwrapping also claims the slot, so
    // the pass that no longer needs a wrapper puts the contributor's own
    // component back instead of leaving ours installed.
    const origin = unwrap(entry.component)
    const fresh: Capture = {
      entry,
      order: entry.options.order,
      label: entry.options.label,
      component: origin ?? entry.component,
      touchedOrder: false,
      touchedComponent: origin !== null,
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
        const dispose = registerList({ name: RAIL_SLOT, id: NUDGE_ID, order: -1 }, () => null)
        dispose()
      } catch {
        // The slot is not declared on this shell (or the ledger refused the
        // row): there is nothing to nudge.
      }
    })
  }

  /** The glyph a managed panel renders: a marker plus the effective visual. */
  const wrapperFor = (captured: Capture, id: string): GlyphComponent => {
    const wrapper = function RailGlyph(props: GlyphProps): ReactNode {
      const panel = plan().panels.get(id)
      const icon = panel?.icon ?? null
      const suppressed = panel?.suppressed === true
      const hidden = !suppressed && panel?.hidden === true && props['active'] !== true
      // The marker span carries the two state hooks HIDE_CSS matches on, and
      // nothing else: an extra identity attribute would be a hook with no reader.
      const marker: Record<string, string> = {}
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
          const Native = captured.component as GlyphComponent | null
          // The contributor's component may consume composed props this plugin
          // knows nothing about (locale seats, hooks), so the whole prop bag is
          // forwarded verbatim through JSX — never called as a plain function.
          visual = Native === null ? null : <Native {...props} />
        }
      }
      return <><span {...marker} />{visual}</>
    }
    // Registered against the CAPTURE, not against the live map: the getter must
    // keep answering after this instance cleared its captures, and it must never
    // re-enter `capture` (asking a wrapper for its origin while the origin is
    // that same wrapper would recurse).
    wrapperRegistry().set(wrapper, () => captured.component)
    return wrapper
  }

  const applyOverrides = (): void => {
    if (disposed) return
    const currentPlan = plan()
    /**
     * Everything the shell renders a row from, in one comparable string.
     *
     * The rewrite pass only writes what it would CHANGE on the ledger, which
     * leaves one hole: an edit that changes nothing but the values our wrapper
     * reads (`panel.icon`, `panel.hidden`, `panel.suppressed`) or the value a
     * cached label thunk resolves to. Picking a second built-in icon for a panel
     * already carrying one writes no field at all — the wrapper is installed, it
     * reads the live plan, and the ledger never moves, so the shell has no reason
     * to re-render the row and the rail kept the previous glyph. Comparing this
     * digest and nudging on a difference closes that hole for every such edit.
     */
    const digest = renderingDigest(currentPlan)
    const appearanceChanged = lastDigest !== null && digest !== lastDigest
    lastDigest = digest
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
        captured.wrapper ??= wrapperFor(captured, id)
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
    // The first pass of a mount never nudges on the digest alone: a fresh
    // install is a strict no-op, and `lastDigest` starts empty for exactly that
    // reason. Everything after it re-projects as soon as the rail would look
    // different, whether or not this pass had a field to write.
    if (changed || appearanceChanged) nudge()
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
      // Prefer the captured original: once we wrap an entry, `entry.component`
      // is OUR wrapper, and handing that back would recurse.
      if (captured !== undefined && captured.touchedComponent) return captured.component as GlyphComponent | null
      const live = entriesFor().find(entry => entry.options.id === panelId)
      const component = live?.component ?? captured?.component ?? null
      // An entry another instance wrapped (or this one wrapped while its captures
      // were dropped) still holds a wrapper: unwrap it rather than hand a
      // marker-rendering function to the caller that asked for an icon.
      return unwrap(component) ?? (component as GlyphComponent | null)
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
        disposers.push(slots.inject(RAIL_SLOT, () => registerList(
          {
            name: RAIL_SLOT,
            id: registration.railId,
            order: registration.order,
            label: registration.label,
          },
          registration.glyph,
        )))
      } catch {
        // Registration refused: the group row simply does not exist.
      }
      try {
        disposers.push(slots.inject(MAIN_SLOT, () => registerKeyed(
          { name: MAIN_SLOT, key: registration.railId },
          page,
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
  }

  return adapter
}
