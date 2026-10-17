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
 *    shell (verified against the slot registry's own source). Every original field is
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
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import type { StoredEntry, SlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { Plan, PlanPanel, RegisteredPanel } from '../../shared/model.ts'
import type { Container } from '../../shared/config.ts'
import { RAIL_ID_PREFIX, isOwnRailId } from '../../shared/config.ts'
import type { ClientContext } from '../ctx.ts'
import type { GlyphComponent, GlyphProps, GlyphRequest, RailRowRegistration } from '../contracts.ts'
import { optionalService } from '../service.ts'
import { createGhost, type AnyComponent } from './Ghost.tsx'

/** The rail slot every sidebar row lives in. */
export const RAIL_SLOT = 'sidebar.panellist'

/**
 * The slots whose rows this plugin rewrites and moves.
 *
 * The shell builds the left column from separate seats rather than one list, so
 * "the rail" spans more than one slot. A row's seat is carried through the plan
 * (`PlanPanel.container` / `PlanRow.container`) and the registry half only ever
 * writes a row's order WITHIN its own seat; carrying a row between seats is the
 * DOM half's job (`rail/dom.ts`), because the shell sorts one slot at a time.
 *
 * `top` is `sidebar.panellist` with its historically hardcoded name kept in
 * {@link RAIL_SLOT}, because the nudge and the older call sites address it by
 * that constant.
 *
 * The shell's own Settings seat is read too — but only to LIST its row in the
 * settings page as a read-only landmark (README §2.12). Nothing there is ever
 * rewritten, and the seat's entries are not part of {@link allEntries}, which
 * feeds the rewrite pass.
 */
export const SEAT_SLOTS = {
  top: RAIL_SLOT,
  footer: 'sidebar.footer.action',
} as const

/**
 * The Settings seat is deliberately NOT taken over.
 *
 * `sidebar.settings` holds the shell's Settings row — and that row is what
 * DECLARES `settings.section` (the settings dialog's content slot) through its own
 * `children` table. Managing it as just another movable row breaks that
 * declaration: the slot becomes "not declared", every plugin's settings page fails
 * to register, and the dialog's whole content column renders empty.
 *
 * The model still carries a `settings` container so a plan can express "the
 * settings row belongs here" — it is simply never rewritten or moved.
 */
export const SETTINGS_SLOT = 'sidebar.settings' as const

/** The seat names this plugin actually manages (the Settings seat is excluded). */
export type ManagedSeat = keyof typeof SEAT_SLOTS

/** The slot names this plugin manages, as the shell's slot map declares them. */
export type SeatSlotName = (typeof SEAT_SLOTS)[ManagedSeat]

/** The seats this plugin manages, in the order the left column stacks them. */
export const MANAGED_SEATS = ['top', 'footer'] as const satisfies readonly ManagedSeat[]

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
const WRAPPER_REGISTRY_KEY = '__dshRailistGlyphWrappers'

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

/**
 * The element inside a footer row that holds its icon.
 *
 * A footer contributor is the whole row: a button, an icon element and a label
 * element, all its own. Honouring an icon override means redrawing that icon
 * element, and there is no contract for naming it — every contributor picked
 * its own class. The search is therefore structural and deliberately
 * conservative:
 *
 * 1. an element explicitly marked as the row's icon (`data-panellist-icon`),
 *    which a contributor can opt into;
 * 2. an element whose class ENDS with `icon` (word-boundary on `-icon`), the
 *    shape every footer contributor seen so far uses (`skp-foot-icon`). The
 *    match is anchored rather than a substring on purpose: `[class*=icon]`
 *    also hits classes like `no-icon-here` or `iconography-note`, and painting
 *    a glyph over one of those corrupts a row this plugin does not understand.
 *
 * Anything else returns `null`, and the caller leaves the row untouched: not
 * applying the override is strictly better than mangling the row. A row with no
 * override keeps its contributor's icon either way, because an unmarked element
 * is never chosen.
 */
function findIconTarget(slot: HTMLElement): HTMLElement | null {
  const explicit = slot.querySelector<HTMLElement>('[data-panellist-icon]')
  if (explicit !== null) return explicit
  for (const element of slot.querySelectorAll<HTMLElement>('[class]')) {
    for (const name of element.classList) {
      // `-icon` / `_icon` / bare `icon`, but never `iconography` or `no-icon-here`.
      if (name === 'icon' || name.endsWith('-icon') || name.endsWith('_icon')) return element
    }
  }
  return null
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
  /**
   * Bring a group member's own row back for one interaction and click its real
   * button — the activation path for a member whose contributor registers no
   * `main` page, where `selectPanel` is a guarded no-op (the flyout's member
   * click lands here).
   */
  activateRow(id: string): void
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
  /** The seat the captured registration lives in. */
  container: Container
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
   * Built lazily, once per captured FOOTER registration that the plan moves
   * into the panel list. Replaces `entry.component` outright (see the footer
   * ghost pass); `touchedComponent` covers putting the original back.
   */
  ghost?: AnyComponent
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

  /**
   * The footer seat's ghost components, one per captured footer row.
   *
   * A footer row the plan moves into the panel list cannot be carried there by
   * moving its element: the footer slot is `kind: 'list'`, so React owns every
   * node it rendered and holds a reference to it. Taking such a node away with
   * `appendChild` (what the DOM half used to do) leaves that reference stale,
   * and the next footer re-render — opening the power menu is enough — throws
   * `NotFoundError` from `insertBefore`, trips the slot's error boundary
   * (`slot entry crashed in 'sidebar.footer.action'`), abdicates the entry,
   * bumps the version and re-renders: an error loop that saturates the main
   * thread and freezes the page. Verified live; see `Ghost.tsx` for the full
   * mechanism.
   *
   * The fix is to REPLACE the row's slot entry with a ghost that renders
   * nothing in place, and to render the contributor's own component through a
   * portal into a slot element the ghost owns. React's footer bookkeeping then
   * holds one entry that produces no host node, so there is nothing to go
   * stale; the slot element is this module's, so placing it among the panel
   * list's rows is an ordinary DOM write no bookkeeping can desynchronise; and
   * the contributor still gets the footer seat's props and its own hooks.
   */
  /**
   * Row ids currently evoked out of their group for ONE interaction.
   *
   * A member whose contributor registers no `main` page cannot be activated
   * through `selectPanel`: its whole behaviour lives in its own row button,
   * which the group hides (`HIDE_CSS` / the ghost's `display: none`). Evoking a
   * row drops its `suppressed` state for that one interaction — the wrapper and
   * the ghost read this set (see `wrapperFor` / `ghostFor`) — and the
   * document-level pointerdown installed with `activateRow` ends the evoke once
   * the user clicks somewhere else.
   */
  const evokedRows = new Set<string>()

  const ghosts = new Map<string, AnyComponent>()

  /**
   * One React root per ghost slot that is currently painting a glyph override.
   *
   * Keyed by the slot element and held weakly, so a slot the ghost unmounted
   * does not keep its renderer alive. A fresh root on every paint would mount a
   * SECOND renderer over the same element and leak the first.
   */
  const iconRoots = new WeakMap<HTMLElement, Root>()

  /** The ghost for one footer row, built once and cached for the entry's life. */
  const ghostFor = (captured: Capture, id: string): AnyComponent => {
    const existing = ghosts.get(id)
    if (existing !== undefined) return existing
    const built = createGhost({
      id,
      component: captured.component,
      /**
       * Redraw the row's own icon element with the configured glyph.
       *
       * The contributor rendered the row; this only replaces what sits inside
       * its icon span, so the button, the label and the flex layout all stay
       * exactly as the contributor drew them. Each slot gets at most one React
       * root, cached in a WeakMap so repeated paints REUSE it instead of
       * mounting a second renderer over the same element.
       */
      paintIcon: (slot) => {
        const icon = plan().panels.get(id)?.icon ?? null
        const target = icon === null ? null : findIconTarget(slot)
        const previous = iconRoots.get(slot)
        if (target === null) {
          // No override (or nowhere to put it): tear our root down and let the
          // contributor's own markup stand untouched.
          if (previous !== undefined) {
            previous.unmount()
            iconRoots.delete(slot)
          }
          return
        }
        const root = previous ?? createRoot(target)
        if (previous === undefined) iconRoots.set(slot, root)
        root.render(glyph({ icon, native: null, size: 16, active: false }))
      },
      read: () => {
        const panel = plan().panels.get(id)
        if (panel === undefined) return null
        // An evoked member renders in place for one interaction (see the evoke
        // notes on `evokedRows`): drop `suppressed` while the evoke lasts.
        return {
          hidden: panel.hidden === true,
          suppressed: panel.suppressed === true && !evokedRows.has(id),
        }
      },
      subscribe: subscribeGhosts,
      version: ghostVersion,
    })
    // Registered against the CAPTURE, exactly like the glyph wrapper: a second
    // evaluation of this bundle must recognise the ghost an earlier one wrote
    // into `entry.component`, or the capture would adopt it as the
    // contributor's component and render the ghost inside a portal forever.
    wrapperRegistry().set(built as unknown as GlyphComponent, () => captured.component)
    ghosts.set(id, built)
    return built
  }
  /**
   * Plan-generation plumbing the ghosts subscribe to.
   *
   * The adapter already has a natural generation counter — the rewrite pass
   * runs on every plan change — so the ghosts reuse it rather than keeping a
   * second one that could drift.
   */
  let ghostGeneration = 0
  const ghostVersion = (): number => ghostGeneration
  const ghostSubscribers = new Set<() => void>()
  // `useSyncExternalStore` wants the React contract — a function that returns
  // the unsubscribe — so the raw set is adapted here rather than in the ghost.
  const subscribeGhosts = (listener: () => void): (() => void) => {
    ghostSubscribers.add(listener)
    return () => {
      ghostSubscribers.delete(listener)
    }
  }
  const notifyGhosts = (): void => {
    ghostGeneration += 1
    for (const listener of [...ghostSubscribers]) listener()
  }

  const entriesOf = (slot: SeatSlotName | typeof SETTINGS_SLOT): readonly StoredEntry[] => {
    try {
      return slots.entriesOfSlot(slot)
    } catch {
      return []
    }
  }

  /**
   * Every registration across the managed seats, each paired with its seat.
   *
   * A slot the shell does not declare contributes nothing instead of throwing —
   * the self-check reports the missing seat, and the other keeps working.
   */
  const allEntries = (): Array<{ entry: StoredEntry; container: ManagedSeat }> => {
    const found: Array<{ entry: StoredEntry; container: ManagedSeat }> = []
    for (const container of MANAGED_SEATS) {
      for (const entry of entriesOf(SEAT_SLOTS[container])) found.push({ entry, container })
    }
    return found
  }

  /**
   * The shell's own Settings row, if the shell registers one.
   *
   * READ-ONLY discovery: the entry is projected into a `RegisteredPanel` so the
   * settings page can list it (README §2.12), and is never captured, rewritten,
   * wrapped or moved. Its `container` is `settings`, which the model pins to the
   * bottom of the bottom-left seat, and which the DOM half skips.
   */
  const settingsRow = (): RegisteredPanel | null => {
    for (const entry of entriesOf(SETTINGS_SLOT)) {
      const id = entry.options.id
      if (typeof id !== 'string' || isOwnRailId(id)) continue
      const label = resolveLabel(entry.options.label)
      return {
        id,
        label: label ?? id,
        order: entry.options.order ?? 0,
        container: 'settings',
      }
    }
    return null
  }

  const capture = (entry: StoredEntry, id: string, container: Container): Capture => {
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
      container,
      order: entry.options.order,
      label: entry.options.label,
      component: origin ?? entry.component,
      touchedOrder: false,
      touchedComponent: origin !== null,
    }
    captures.set(id, fresh)
    return fresh
  }

  /**
   * Make the shell re-project the rail: one ledger mutation pair per seat slot,
   * one task.
   *
   * Every MANAGED seat gets its own probe, not just the panel list: a nudge's
   * purpose is to re-render the glyph wrappers, and the wrappers the evoke needs
   * to re-render usually live in the FOOTER seat (a suppressed group member's
   * row is a footer card). A panel-list-only probe leaves that slot's React
   * subtree untouched, so the evoked marker would never surface.
   */
  const nudge = (): void => {
    if (nudged || disposed) return
    nudged = true
    queueMicrotask(() => {
      nudged = false
      if (disposed) return
      for (const slot of [...Object.values(SEAT_SLOTS), RAIL_SLOT]) {
        try {
          const dispose = registerList({ name: slot, id: NUDGE_ID, order: -1 }, () => null)
          dispose()
        } catch {
          // The slot is not declared on this shell (or the ledger refused the
          // row): there is nothing to nudge there.
        }
      }
    })
  }

  /** The glyph a managed panel renders: a marker plus the effective visual. */
  const wrapperFor = (captured: Capture, id: string): GlyphComponent => {
    const wrapper = function RailGlyph(props: GlyphProps): ReactNode {
      const panel = plan().panels.get(id)
      const icon = panel?.icon ?? null
      // An EVOKE lifts `suppressed` for one interaction: the flyout just asked
      // for this member's native behaviour (its contributor has no `main`
      // page), so the row renders as its plain self and hides again when the
      // document-level pointerdown clears the evoke (see `evokedRows`).
      const evoked = panel?.suppressed === true && evokedRows.has(id)
      const suppressed = panel?.suppressed === true && !evoked
      const hidden = !suppressed && panel?.hidden === true && props['active'] !== true
      // The marker span carries the state hooks HIDE_CSS matches on — plus the
      // evoke stamp `activateRow` clicks through. Nothing else: an extra
      // identity attribute would be a hook with no reader.
      const marker: Record<string, string> = {}
      if (evoked) marker['data-dsh-railist-evoked'] = id
      else if (suppressed) marker['data-dsh-railist-suppressed'] = ''
      else if (hidden) marker['data-dsh-railist-hidden'] = ''
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
    for (const { entry, container } of allEntries()) {
      const id = entry.options.id
      if (typeof id !== 'string' || isOwnRailId(id)) continue
      live.add(id)
      const captureOf = (): Capture => capture(entry, id, container)
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
      /**
       * Re-installing a wrapper the shell just threw away is NOT a change.
       *
       * `nudge` re-projects the rail by registering and disposing a probe row,
       * and that re-projection rebuilds each entry's `component` from the
       * contributor's registration — dropping our wrapper. Counting the
       * re-install as a change asked for another nudge, which dropped it again:
       * measured live as an endless 60-pass cascade (7.2k installs/minute).
       * `touchedComponent` therefore means "this entry still HOLDS our
       * component", read from the entry itself rather than remembered.
       */
      const needsWrapper = panel.icon !== null || panel.hidden || panel.suppressed
      if (needsWrapper) {
        captured.wrapper ??= wrapperFor(captured, id)
        if (entry.component !== captured.wrapper) {
          const wasOurs = captured.touchedComponent || entry.component === captured.ghost
          entry.component = captured.wrapper
          captured.touchedComponent = true
          // Only a row whose appearance we changed needs the shell to redraw it.
          if (!wasOurs) changed = true
        }
      } else if (captured.touchedComponent) {
        if (entry.component === captured.wrapper || entry.component === captured.ghost) {
          entry.component = captured.component
          captured.touchedComponent = false
          changed = true
        } else {
          // The shell already re-projected this row back to its own component.
          captured.touchedComponent = false
        }
      }

      // --- footer ghost ----------------------------------------------------
      /**
       * A FOOTER row the plan moves into the top seat gets a ghost entry
       * instead of a glyph wrapper, and that replacement is unconditional —
       * the footer seat passes no glyph props, so a wrapper installed here
       * would render nothing at all and the row would vanish.
       *
       * A footer row that STAYS in the footer keeps its own component (and its
       * glyph wrapper, when it has one): the shell renders it where it was, and
       * nothing has to be moved.
       */
      const wantsGhost = container === 'footer' && panel.container !== 'footer'
      if (wantsGhost) {
        captured.ghost ??= ghostFor(captured, id)
        if (entry.component !== captured.ghost) {
          const wasOurs = captured.touchedComponent
          entry.component = captured.ghost
          captured.touchedComponent = true
          // Same rule as the wrapper: a ghost put back after the shell dropped it
          // is not news, and asking for a nudge would drop it again.
          if (!wasOurs) changed = true
        }
      } else if (captured.ghost !== undefined && entry.component === captured.ghost) {
        // The row went back to the footer: put the contributor's own component
        // (or its glyph wrapper) back so the shell renders it in place again.
        const fallback = needsWrapper ? (captured.wrapper ??= wrapperFor(captured, id)) : captured.component
        entry.component = fallback
        captured.touchedComponent = fallback !== captured.component
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
    // The ghosts read the plan on every render but only re-render on a
    // generation bump, so a pass that changed nothing still has to tell them
    // when the appearance did change — that is exactly the digest's job.
    if (appearanceChanged) notifyGhosts()
  }

  /**
   * Bring one group member's own row back and click its real button.
   *
   * The flyout's member click ends here when the member has no `main` page: the
   * row has to reappear because the contributor's own popover renders INSIDE
   * its row (the capability panel's is a plain child of its action div), and
   * then its button takes the click exactly as if the user had pressed it in
   * the rail. An evoke is not a ledger change — the wrapper reads the set, the
   * ledger fields stay put — so the digest sees nothing and the re-projection
   * is forced: `nudge` makes the shell re-render the rows, `notifyGhosts`
   * wakes the portals. The rewrite itself is synchronous, but the shell's
   * re-projection and React's render are not, so the click waits for the evoked
   * marker to surface, bounded so a refusal degrades to "nothing happened"
   * instead of spinning forever.
   */
  const activateRow = (id: string): void => {
    if (disposed) return
    evokedRows.clear()
    evokedRows.add(id)
    applyOverrides()
    nudge()
    notifyGhosts()
    const deadline = Date.now() + 1_000
    const click = (): void => {
      if (disposed) return
      const marker = document.querySelector(`[data-dsh-railist-evoked="${CSS.escape(id)}"]`)
      const button = marker === null ? null : evokedButtonFor(marker)
      if (button === null) {
        if (Date.now() < deadline) requestAnimationFrame(click)
        return
      }
      button.click()
    }
    requestAnimationFrame(click)
  }

  /**
   * The real button an evoked row renders. A top-seat row IS a button (the
   * marker sits inside it); a footer row is the contributor's own component,
   * whose button follows the marker in the slot's container.
   */
  const evokedButtonFor = (marker: Element): HTMLButtonElement | null => {
    const row = marker.closest('button')
    if (row !== null) return row as HTMLButtonElement
    const host = marker.parentElement
    if (host === null) return null
    for (const button of host.querySelectorAll('button')) {
      // The wrapper renders the marker before the contributor's subtree, so the
      // first button after the marker is the member's own.
      if ((marker.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return button
    }
    return null
  }

  /**
   * An outside pointerdown ends the evoke: the row hides back into its group.
   * Clicks inside the evoked row keep it (the contributor's popover lives
   * there); the contributor's own outside-click handling — the capability
   * panel's backdrop, for one — closes its popover in step.
   */
  const onDocumentPointerDown = (event: PointerEvent): void => {
    if (disposed || evokedRows.size === 0) return
    const target = event.target
    if (!(target instanceof Node)) return
    const marker = document.querySelector('[data-dsh-railist-evoked]')
    if (marker !== null && marker.parentElement !== null && marker.parentElement.contains(target)) return
    evokedRows.clear()
    applyOverrides()
    nudge()
    notifyGhosts()
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
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
      // A ghost stands in for the contributor's component, so restoring it also
      // takes the ghost out of the footer slot: React unmounts the portal, and
      // the ghost's own cleanup removes the slot element from the panel list.
      captured.entry.component = captured.component
      captured.touchedComponent = false
      changed = true
    }
    return changed
  }

  const adapter: RailAdapter = {
    panels: () => [
      ...allEntries()
        .filter(({ entry }) => typeof entry.options.id === 'string' && !isOwnRailId(entry.options.id as string))
        .map(({ entry, container }) => {
          const id = entry.options.id as string
          const captured = captures.get(id)
          const order = captured !== undefined && captured.entry === entry ? captured.order : entry.options.order
          const label = captured !== undefined && captured.entry === entry ? captured.label : entry.options.label
          return { id, label: resolveLabel(label) ?? id, order: order ?? 0, container }
        }),
      // Last, so it reads as the end of the rail; the settings page pins it
      // anyway (README §2.12).
      ...(settingsRow() === null ? [] : [settingsRow() as RegisteredPanel]),
    ],
    subscribe: (listener) => {
      const disposers: Array<() => void> = []
      // The Settings seat is watched too — never rewritten — so the row the
      // settings page lists as read-only appears and disappears with the shell.
      for (const slot of [...Object.values(SEAT_SLOTS), SETTINGS_SLOT]) {
        try {
          disposers.push(slots.subscribe(slot, listener))
        } catch {
          // Seat not declared on this shell: nothing to subscribe to.
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // Idempotent disposal.
          }
        }
      }
    },
    nativeGlyph: (panelId) => {
      /**
       * ONLY the top seat contributes glyphs, and only if it still registers this
       * id there.
       *
       * A `sidebar.panellist` entry's component IS a glyph: the shell renders it
       * with `{size, active}` and nothing else. A `sidebar.footer.action` entry's
       * component is a whole button that expects the footer's own props (a
       * translator among them), so handing one back as an icon makes the settings
       * page render that button with glyph props and it throws — the
       * `t is not a function` this used to produce.
       *
       * The seat check comes FIRST, before the capture map: a capture is keyed by
       * panel id alone, so a footer row's capture would otherwise be handed back
       * for an id that only ever meant a footer row.
       */
      const live = entriesOf(SEAT_SLOTS.top).find(entry => entry.options.id === panelId)
      if (live === undefined) return null
      // Prefer the captured original: once we wrap an entry, `entry.component`
      // is OUR wrapper, and handing that back would recurse.
      const captured = captures.get(panelId)
      if (captured !== undefined && captured.touchedComponent) return captured.component as GlyphComponent | null
      const component = live.component ?? captured?.component ?? null
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
    activateRow,
    registerRow: (registration, page) => {
      const disposers: Array<() => void> = []
      // A row we contribute goes into the seat the plan placed it in (a group the
      // user dragged into the footer belongs there); the top seat is the default
      // because that is where the shell's panel list lives. A registration aimed
      // at the Settings seat is refused: that seat is the shell's own and is never
      // taken over (see SETTINGS_SLOT).
      const seat = registration.container === 'footer' ? 'footer' : 'top'
      const slot = SEAT_SLOTS[seat]
      try {
        disposers.push(slots.inject(slot, () => registerList(
          {
            name: slot,
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
      evokedRows.clear()
      if (typeof document !== 'undefined') {
        document.removeEventListener('pointerdown', onDocumentPointerDown, true)
      }
      let changed = false
      for (const captured of captures.values()) changed = restore(captured) || changed
      captures.clear()
      ghosts.clear()
      ghostSubscribers.clear()
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
