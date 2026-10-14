/**
 * The client controller: the one place that knows how the units fit together.
 *
 * Data flow:
 *
 *   store ──profile──┐
 *                    ├─▶ buildPlan ──▶ rail.applyOverrides()  (order/label/glyph writes)
 *   rail.panels ─────┘            └──▶ groupUnit.sync()       (group rows + pages)
 *   selfCheck ──degradation───────┘
 *
 * Everything is pull-based: the plan is recomputed on a coalesced schedule from
 * three change sources (config store, slot ledger, self-check), and the units
 * read the plan through a getter, so a plan change never requires a
 * re-registration to become visible.
 */
import type { ReactNode } from 'react'
import type { BuiltinIconName } from '../shared/config.ts'
import { buildPlan, type Plan, type PlanPanel, type RegisteredPanel } from '../shared/model.ts'
import type { HealthReport } from '../shared/protocol.ts'
import type { ClientContext } from './ctx.ts'
import type { GlyphRequest, SanitizeResult, SelfCheckController, SelfCheckState } from './contracts.ts'
import type { RailistStore, StoreSnapshot } from './config/store.ts'
import { createGroupUnit } from './groups/index.ts'
import type { Translator } from './i18n/index.ts'
import { settingsNavDataUri } from './icons/builtin.tsx'
import { createRailAdapter, SEAT_SLOTS } from './registry/rail.tsx'
import { createSettingsUnit } from './settings/index.tsx'
import { createPluginInfoStore, type FetchLike } from './settings/pluginInfo.ts'
import { createSelfCheck } from './rail/probe.ts'
import { createSettingsNavMarker, HIDE_CSS, settingsNavCss } from './rail/css.ts'
import { createRailDom, ROW_ATTR, type DomRow } from './rail/dom.ts'
import type { StyleRegistry } from './styles.ts'

/** What the wiring needs from the outside (all pure inputs). */
export interface ControllerDeps {
  ctx: ClientContext
  store: RailistStore
  translate: Translator
  styles: StyleRegistry
  glyph: (request: GlyphRequest) => ReactNode
  builtinNames: readonly BuiltinIconName[]
  sanitizeSvg: (source: string) => SanitizeResult
  /**
   * Fetch used for the optional `/plugins` decoration read. Injected so a test
   * can answer it without a network; absent means the global `fetch`, and a
   * shell without one is simply a shell with no subtitles.
   */
  fetch?: FetchLike
}

/** The wired plugin, as the entry point and the tests see it. */
export interface RailistController {
  plan(): Plan
  snapshot(): StoreSnapshot
  registered(): readonly RegisteredPanel[]
  health(): HealthReport | null
  selfCheck: SelfCheckController
  store: RailistStore
  translate: Translator
  styles: StyleRegistry
  subscribe(listener: () => void): () => void
  /** Force a recomputation (used by the initial mount). */
  refresh(): void
  dispose(): void
}

/**
 * Recomputations allowed inside one task before the burst is cut. Every writer
 * in this plugin compares before it writes, so a healthy cascade settles in two
 * or three passes; the limit only ever fires when a writer is not idempotent.
 */
const CASCADE_LIMIT = 60

/**
 * The `railId`s the rail is currently rendering an element for.
 *
 * Read back off the DOM rather than derived from the ledger: a registration is
 * a *promise* to render (a footer entry whose component returns `null` while its
 * feature is off still holds one), so the only thing that answers "is this row
 * on screen?" is the row element itself. {@link ROW_ATTR} is what the DOM half
 * stamps on every row it has placed, and the shell renders no id of its own.
 *
 * `undefined` — not an empty set — when there is nothing to read from: no
 * document, or no sidebar mounted yet. `buildPlan` treats "no answer" as
 * "assume everything renders", which is what keeps a transient empty rail (a
 * settings page opened before the sidebar paints) from labelling every row as
 * unrendered.
 *
 * A registered row that is present but HIDDEN is still rendered: the shell
 * mounts it and CSS takes it out of the flow, and "hidden" is its own badge.
 */
function renderedRowIds(): ReadonlySet<string> | undefined {
  if (typeof document === 'undefined') return undefined
  const found = document.querySelectorAll(`[${ROW_ATTR}]`)
  // An empty document means the sidebar has not rendered yet, not that every row
  // is missing: report "cannot say" and let the next pass answer.
  if (found.length === 0) return undefined
  const ids = new Set<string>()
  for (const element of found) {
    const id = element.getAttribute(ROW_ATTR)
    if (id !== null && id.length > 0) ids.add(id)
  }
  return ids
}

/**
 * Whether a second reading of the rail says something the first one did not.
 *
 * Only *growing* information counts. `undefined` means "could not read", so:
 * - reading a set after reading nothing is news (the sidebar mounted) → re-run;
 * - reading nothing after a set is noise (a re-render blanked the sidebar for a
 *   frame) → keep the answer that was actually observed;
 * - a set that gained a row is news; a set that merely re-lists the same ids is
 *   not.
 *
 * This asymmetry is deliberate and it is what terminates the loop: a pass whose
 * second reading adds nothing never schedules a third.
 */
function renderedSetChanged(before: ReadonlySet<string> | undefined, after: ReadonlySet<string> | undefined): boolean {
  if (after === undefined) return false
  if (before === undefined) return true
  if (after.size !== before.size) return true
  for (const id of after) if (!before.has(id)) return true
  return false
}

/**
 * Schedule a recomputation whenever the rail starts rendering a row it did not
 * before.
 *
 * This is the other half of the timing problem, and the one a single read cannot
 * solve. The rows arrive strictly after the page mounts: React renders the
 * entries, then the placement pass stamps them. A controller that read the rail
 * once would either claim every row is unrendered (if it guessed from an empty
 * document) or never notice the rows that later appeared (if it treated the
 * first empty read as final). Neither is acceptable, and neither can be fixed by
 * re-reading inside one pass — the row simply does not exist yet.
 *
 * The observer therefore watches for row elements appearing and asks for a
 * recomputation — but only when the set of `railId`s it can see actually GAINED
 * a row ({@link renderedSetChanged}). Without that guard the plugin's own
 * placement writes would come back through the observer and re-schedule forever;
 * with it, the first pass that learns nothing new is the last one.
 *
 * A throw must never escape the callback: it runs outside the render path, and
 * an exception here would take the whole sidebar's layout down with it.
 *
 * @returns a teardown that disconnects the observer.
 */
function watchRenderedRows(notify: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  let last = renderedRowIds()
  const observer = new MutationObserver(() => {
    try {
      const now = renderedRowIds()
      if (!renderedSetChanged(last, now)) return
      last = now
      notify()
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[dsh-railist] rail observer failed; rows left as they are', error)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => { observer.disconnect() }
}

/**
 * Apply the read-only degradations a failed self-check implies.
 *
 * `activeRuleDisabled` is the only one that changes the plan: without the
 * `active` prop the "a hidden panel that is active still shows its row" rule is
 * unreachable, so a hidden row becomes unconditionally hidden (the same marker
 * a group member uses) rather than flickering.
 */
function degrade(plan: Plan, state: SelfCheckState): Plan {
  if (!state.activeRuleDisabled) return plan
  const panels = new Map<string, PlanPanel>()
  for (const [id, panel] of plan.panels) {
    panels.set(id, panel.hidden ? { ...panel, hidden: false, suppressed: true } : panel)
  }
  return { ...plan, panels }
}

/** Create the wired controller. */
export function createController(deps: ControllerDeps): RailistController {
  const { ctx, store, translate, styles } = deps
  const listeners = new Set<() => void>()
  let cachedPlan: Plan | null = null
  let scheduled = false
  let inRecompute = false
  let disposed = false
  /** Recomputations inside one task; see {@link schedule}. */
  let cascade = 0

  styles.register('rail', HIDE_CSS)
  styles.register('settings-nav', settingsNavCss(settingsNavDataUri()))

  // --- plan -----------------------------------------------------------------
  const rail = createRailAdapter(ctx, () => plan(), deps.glyph)
  const dom = createRailDom()

  /**
   * The row subtitles' source. It is loaded lazily by the settings page (one
   * read on mount) rather than here, because the rail never renders a subtitle:
   * paying for the request at startup would cost every shell a round-trip for
   * information only the settings dialog shows.
   */
  const plugins = createPluginInfoStore({ fetch: deps.fetch })

  const selfCheck = createSelfCheck(ctx, {
    sectionLabel: () => translate.t('settings.nav'),
    // Every seat counts: the panel list, the footer action row and the Settings
    // seat all contribute rows, and the hide check compares the rows it can find
    // against this number.
    entryCount: () => {
      let total = 0
      for (const slot of Object.values(SEAT_SLOTS)) {
        try {
          total += ctx.slots.entriesOfSlot(slot).length
        } catch {
          // Seat not declared on this shell: it contributes nothing.
        }
      }
      return total
    },
    // The DOM half needs the seat containers; a shell that renamed one is reported
    // rather than silently leaving rows where they were.
    seats: () => dom.seats(),
  })

  const plan = (): Plan => {
    if (cachedPlan === null) {
      const current = store.getSnapshot()
      cachedPlan = degrade(
        buildPlan(rail.panels(), current.profile, renderedRowIds(), current.movedRow),
        selfCheck.getState(),
      )
    }
    return cachedPlan
  }

  // --- units ----------------------------------------------------------------
  const groupUnit = createGroupUnit({
    ctx,
    rail,
    plan,
    translate,
    glyph: deps.glyph,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    styles,
  })

  const settingsUnit = createSettingsUnit({
    ctx,
    store,
    plan,
    registered: () => rail.panels(),
    snapshot: () => store.getSnapshot(),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    selfCheck,
    translate,
    glyph: deps.glyph,
    nativeGlyph: (panelId) => rail.nativeGlyph(panelId),
    builtinNames: deps.builtinNames,
    sanitizeSvg: deps.sanitizeSvg,
    health: () => store.getSnapshot().health,
    plugins,
    styles,
  })

  const settingsNavMarker = createSettingsNavMarker(() => translate.t('settings.nav'))

  /**
   * Place every row into the seat the sequence gave it.
   *
   * The registry half orders rows within a seat; only a physical move can carry a
   * row between seats (the shell sorts one slot at a time), so the plan's
   * `container` is applied here. Group rows are included, because a group the user
   * dragged into the footer belongs in the footer.
   */
  const placeRows = (current: Plan): void => {
    const rows: DomRow[] = []
    /** Position within each seat, so the DOM pass compares like with like. */
    const seatIndex = new Map<string, number>()
    for (const row of current.rows) {
      // The Settings seat is not managed: its row is skipped rather than sent to
      // the DOM half, which only ever moves rows between the seats it owns.
      if (row.container === 'settings') continue
      const panel = row.kind === 'panel' ? current.panels.get(row.id) : undefined
      const group = row.kind === 'group' ? current.groups.get(row.id) : undefined
      const next = seatIndex.get(row.container) ?? 0
      seatIndex.set(row.container, next + 1)
      rows.push({
        id: row.railId,
        container: row.container,
        order: next,
        hidden: panel?.hidden === true || panel?.suppressed === true || group?.hidden === true,
      })
    }
    dom.apply(rows)
  }

  // --- the loop -------------------------------------------------------------
  const recompute = (): void => {
    if (disposed || inRecompute) return
    inRecompute = true
    try {
      const current = store.getSnapshot()
      cachedPlan = degrade(
        buildPlan(rail.panels(), current.profile, renderedRowIds(), current.movedRow),
        selfCheck.getState(),
      )
      if (!selfCheck.getState().readOnly) rail.applyOverrides()
      groupUnit.sync()
      // After the registry and the group rows settled: the DOM pass needs the
      // elements the shell rendered for the rows whose order we just wrote.
      if (!selfCheck.getState().readOnly) placeRows(cachedPlan)
      for (const listener of listeners) listener()
    } finally {
      inRecompute = false
    }
  }

  const schedule = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      cascade += 1
      if (cascade === CASCADE_LIMIT + 1) {
        // A recomputation never ends when a writer on the ledger is not
        // idempotent: every pass mutates, which notifies, which reschedules.
        // Rather than freeze the page, the burst is cut here and reported —
        // the next user action starts a fresh burst.
        console.warn(`[dsh-railist] recomputation did not settle after ${CASCADE_LIMIT} passes; pausing until the next change`)
      }
      if (cascade > CASCADE_LIMIT) return
      recompute()
    })
    if (cascade === 0) {
      // A fresh burst: the counter is cleared once the current task drains, so
      // a chain of legitimate microtask-batched changes is still unbounded.
      setTimeout(() => {
        if (disposed) return
        const wasRunaway = cascade > CASCADE_LIMIT
        cascade = 0
        if (wasRunaway) recompute()
      }, 0)
    }
  }

  const unsubscribers = [
    store.subscribe(schedule),
    rail.subscribe(schedule),
    selfCheck.subscribe(schedule),
    translate.subscribe(schedule),
    // The rail's rows are the last input to arrive: the plan is built before the
    // shell has rendered the entries it registers. Watching for them is what
    // turns "could not read the rail yet" into a real answer — see
    // {@link watchRenderedRows}.
    watchRenderedRows(schedule),
  ]
  // The locale service drives our copy AND the labels we hand the shell, so a
  // language switch has to re-project every row.

  return {
    plan,
    snapshot: () => store.getSnapshot(),
    registered: () => rail.panels(),
    health: () => store.getSnapshot().health,
    selfCheck,
    store,
    translate,
    styles,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    refresh: () => {
      cachedPlan = null
      recompute()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const unsubscribe of unsubscribers) unsubscribe()
      listeners.clear()
      settingsUnit.dispose()
      groupUnit.dispose()
      // Drops any in-flight `/plugins` answer: the store must not notify a page
      // that the teardown above already unmounted.
      plugins.dispose()
      settingsNavMarker()
      // Restore the shell's own layout before the registry puts its orders back,
      // so a disposed plugin leaves no row in a seat it does not belong to.
      dom.dispose()
      rail.dispose()
      styles.dispose()
    },
  }
}
