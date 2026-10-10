/**
 * The four startup self-checks (README §5, ARCHITECTURE §7).
 *
 * This plugin rests on four *internal* facts of the shell, so it measures each
 * one instead of assuming it, and degrades the affected feature — never
 * silently, never by refusing to load:
 *
 * | # | probe        | measures                                              | degradation              |
 * |---|--------------|-------------------------------------------------------|--------------------------|
 * | 1 | registry     | a stored entry accepts a post-hoc `order` write        | read-only: no rewriting  |
 * | 2 | rail         | `:has()` works and one row exists per rail entry       | hiding off               |
 * | 3 | active       | the shell passes `active` to a rail glyph              | hidden-but-active off    |
 * | 4 | settingsNav  | the settings nav row is findable by our own label      | keep the native gear     |
 */
import type { ClientContext } from '../ctx.ts'
import { RAIL_ID_PREFIX } from '../../shared/config.ts'
import type { ProbeResult, SelfCheckController, SelfCheckState } from '../contracts.ts'
import { RAIL_SLOT } from '../registry/rail.tsx'

const PROBE_REGISTRY_ID = `${RAIL_ID_PREFIX}probe`
const PROBE_ACTIVE_ID = `${RAIL_ID_PREFIX}probe-active`

/** Selector the hide rule depends on (ARCHITECTURE §4.4). */
const ROW_SELECTOR = 'nav[class*="_panelList"] > button[class*="_panelRow"]'

/** The settings navigation buttons the marker pass matches against. */
const SETTINGS_NAV_SELECTOR = '[role="dialog"] nav button'

/** Options for {@link createSelfCheck}. */
export interface SelfCheckOptions {
  /** Live label of our own settings section, for probe 4. */
  sectionLabel(): string
  /** How many rail entries the ledger currently holds (probe 2). */
  entryCount(): number
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Wait for `count` animation frames (falls back to a timer without rAF). */
function frames(count: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 32 * count)
      return
    }
    let left = count
    const step = (): void => {
      left -= 1
      if (left <= 0) resolve()
      else requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

/** `window.__DSH_BOOT__` shape, as far as this plugin reads it. */
interface BootPayload {
  version?: unknown
}

function measuredVersion(): string {
  const boot = (globalThis as { __DSH_BOOT__?: BootPayload }).__DSH_BOOT__
  const version = boot?.version
  return typeof version === 'string' ? version : ''
}

/** Probe 1: can we write to a stored entry at all? */
function probeRegistry(ctx: ClientContext): ProbeResult {
  let dispose: (() => void) | undefined
  try {
    dispose = ctx.slots.register(
      { name: RAIL_SLOT, id: PROBE_REGISTRY_ID, order: 424242 } as never,
      (() => null) as never,
    )
  } catch (error) {
    return { id: 'registry', ok: false, detail: `probe registration refused: ${reasonOf(error)}` }
  }
  try {
    const find = (): { options: { order?: number } } | undefined =>
      ctx.slots.entriesOfSlot(RAIL_SLOT).find(entry => entry.options.id === PROBE_REGISTRY_ID)
    const entry = find()
    if (entry === undefined) return { id: 'registry', ok: false, detail: 'registered entry is not visible in entriesOfSlot' }
    if (Object.isFrozen(entry) || Object.isFrozen(entry.options)) {
      return { id: 'registry', ok: false, detail: 'the stored entry (or its options) is frozen' }
    }
    const before = entry.options.order
    entry.options.order = 777001
    const after = find()?.options.order
    entry.options.order = before
    if (after !== 777001) {
      return { id: 'registry', ok: false, detail: `post-hoc write not visible (read back ${String(after)})` }
    }
    return { id: 'registry', ok: true, detail: `order ${String(before)} → 777001 read back through the ledger projection` }
  } catch (error) {
    return { id: 'registry', ok: false, detail: reasonOf(error) }
  } finally {
    try {
      dispose?.()
    } catch {
      // Disposal is idempotent.
    }
  }
}

/** Probe 2: does the selector the hide rule needs find one row per entry? */
function probeRail(options: SelfCheckOptions): ProbeResult {
  const supports = (): boolean => {
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
    try {
      return CSS.supports('selector(:has(*))') || CSS.supports('selector(:has(a))')
    } catch {
      return false
    }
  }
  if (!supports()) return { id: 'rail', ok: false, detail: ':has() selector support is missing' }
  if (typeof document === 'undefined') return { id: 'rail', ok: false, detail: 'no document' }
  const nav = document.querySelector('nav[class*="_panelList"]')
  if (nav === null) {
    return { id: 'rail', ok: true, detail: ':has() supported; the rail is not mounted right now (sidebar hidden)' }
  }
  const rows = document.querySelectorAll(ROW_SELECTOR).length
  const entries = options.entryCount()
  if (rows !== entries) {
    return { id: 'rail', ok: false, detail: `${rows} row(s) for ${entries} rail entr(ies) using ${ROW_SELECTOR}` }
  }
  return { id: 'rail', ok: true, detail: `${rows} row(s) match ${ROW_SELECTOR}` }
}

/** Probe 3: does the shell still hand our glyph an `active` prop? */
async function probeActive(ctx: ClientContext): Promise<ProbeResult> {
  let seen: { hasActive: boolean; active: unknown; size: unknown } | null = null
  const ProbeGlyph = (props: Record<string, unknown>): null => {
    seen = { hasActive: 'active' in props, active: props['active'], size: props['size'] }
    // Suppressed marker: our own stylesheet hides the throwaway row while the
    // probe measures it, so the user never sees an extra rail row.
    return null
  }
  let dispose: (() => void) | undefined
  try {
    dispose = ctx.slots.register(
      { name: RAIL_SLOT, id: PROBE_ACTIVE_ID, order: 424243 } as never,
      ProbeGlyph as never,
    )
  } catch (error) {
    return { id: 'active', ok: false, detail: `probe registration refused: ${reasonOf(error)}` }
  }
  try {
    await frames(2)
    if (seen === null) return { id: 'active', ok: false, detail: 'a registered probe glyph was never rendered' }
    const measured = seen as { hasActive: boolean; active: unknown; size: unknown }
    if (!measured.hasActive || typeof measured.active !== 'boolean') {
      return { id: 'active', ok: false, detail: `the glyph received no boolean "active" prop (${JSON.stringify(measured.active)})` }
    }
    return { id: 'active', ok: true, detail: `active=${String(measured.active)} size=${String(measured.size)}` }
  } finally {
    try {
      dispose?.()
    } catch {
      // Disposal is idempotent.
    }
  }
}

/** Probe 4: can the marker pass find our settings navigation row? */
function probeSettingsNav(options: SelfCheckOptions): ProbeResult {
  if (typeof document === 'undefined') return { id: 'settingsNav', ok: false, detail: 'no document' }
  const buttons = document.querySelectorAll(SETTINGS_NAV_SELECTOR)
  if (buttons.length === 0) {
    return { id: 'settingsNav', ok: true, detail: 'settings dialog is closed; the marker pass runs when it opens' }
  }
  const label = options.sectionLabel().trim()
  const found = [...buttons].some(button => button.textContent?.trim() === label)
  return found
    ? { id: 'settingsNav', ok: true, detail: `matched the nav row labelled "${label}"` }
    : { id: 'settingsNav', ok: false, detail: `no settings nav row is labelled "${label}"` }
}

/** Derive the aggregate degradation state from the four results. */
function stateOf(results: readonly ProbeResult[], version: string): SelfCheckState {
  const failed = (id: ProbeResult['id']): boolean => results.some(result => result.id === id && !result.ok)
  return {
    results: [...results],
    degraded: results.some(result => !result.ok),
    readOnly: failed('registry'),
    hidingDisabled: failed('rail'),
    activeRuleDisabled: failed('active'),
    settingsIconDisabled: failed('settingsNav'),
    version,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Create the self-check controller.
 * @param ctx - the browser-half context (probe registration goes through it).
 * @param options - label and entry-count readers.
 */
export function createSelfCheck(ctx: ClientContext, options: SelfCheckOptions): SelfCheckController {
  const listeners = new Set<() => void>()
  let running: Promise<void> | null = null
  let state: SelfCheckState = {
    results: [],
    degraded: false,
    readOnly: false,
    hidingDisabled: false,
    activeRuleDisabled: false,
    settingsIconDisabled: false,
    version: measuredVersion(),
    checkedAt: '',
  }

  const publish = (results: readonly ProbeResult[]): void => {
    state = stateOf(results, measuredVersion())
    for (const listener of listeners) listener()
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    rerun: () => {
      if (running !== null) return running
      running = (async () => {
        try {
          const registry = probeRegistry(ctx)
          // A read-only shell cannot be probed further: registrations are the
          // mechanism every other probe needs.
          const active = registry.ok ? await probeActive(ctx) : { id: 'active' as const, ok: true, detail: 'skipped: probing needs registrations' }
          publish([registry, probeRail(options), active, probeSettingsNav(options)])
        } catch (error) {
          publish([
            { id: 'registry', ok: false, detail: reasonOf(error) },
            { id: 'rail', ok: true, detail: 'not measured' },
            { id: 'active', ok: true, detail: 'not measured' },
            { id: 'settingsNav', ok: true, detail: 'not measured' },
          ])
        } finally {
          running = null
        }
      })()
      return running
    },
  }
}
