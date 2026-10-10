/**
 * The client controller: the one place that knows how the units fit together.
 *
 * Data flow (ARCHITECTURE §1):
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
import type { PanellistStore, StoreSnapshot } from './config/store.ts'
import { createGroupUnit } from './groups/index.ts'
import type { Translator } from './i18n/index.ts'
import { settingsNavDataUri } from './icons/builtin.tsx'
import { createRailAdapter } from './registry/rail.tsx'
import { createSettingsUnit } from './settings/index.tsx'
import { createSelfCheck } from './rail/probe.ts'
import { createSettingsNavMarker, HIDE_CSS, settingsNavCss } from './rail/css.ts'
import type { StyleRegistry } from './styles.ts'

/** What the wiring needs from the outside (all pure inputs). */
export interface ControllerDeps {
  ctx: ClientContext
  store: PanellistStore
  translate: Translator
  styles: StyleRegistry
  glyph: (request: GlyphRequest) => ReactNode
  builtinNames: readonly BuiltinIconName[]
  sanitizeSvg: (source: string) => SanitizeResult
}

/** The wired plugin, as the entry point and the tests see it. */
export interface PanellistController {
  plan(): Plan
  snapshot(): StoreSnapshot
  registered(): readonly RegisteredPanel[]
  health(): HealthReport | null
  selfCheck: SelfCheckController
  store: PanellistStore
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
export function createController(deps: ControllerDeps): PanellistController {
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

  const selfCheck = createSelfCheck(ctx, {
    sectionLabel: () => translate.t('settings.nav'),
    entryCount: () => {
      try {
        return ctx.slots.entriesOfSlot('sidebar.panellist').length
      } catch {
        return 0
      }
    },
  })

  const plan = (): Plan => {
    if (cachedPlan === null) cachedPlan = degrade(buildPlan(rail.panels(), store.getSnapshot().profile), selfCheck.getState())
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
    styles,
  })

  const settingsNavMarker = createSettingsNavMarker(() => translate.t('settings.nav'))

  // --- the loop -------------------------------------------------------------
  const recompute = (): void => {
    if (disposed || inRecompute) return
    inRecompute = true
    try {
      cachedPlan = degrade(buildPlan(rail.panels(), store.getSnapshot().profile), selfCheck.getState())
      if (!selfCheck.getState().readOnly) rail.applyOverrides()
      groupUnit.sync()
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
        console.warn(`[dsh-panellist] recomputation did not settle after ${CASCADE_LIMIT} passes; pausing until the next change`)
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
      settingsNavMarker()
      rail.dispose()
      styles.dispose()
    },
  }
}
