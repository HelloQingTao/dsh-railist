/**
 * The four startup self-checks (README §5).
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
import { createElement, type ReactNode } from 'react'
import { RAIL_ID_PREFIX } from '../../shared/config.ts'
import type { ProbeResult, SelfCheckController, SelfCheckState } from '../contracts.ts'
import { RAIL_SLOT } from '../registry/rail.tsx'
import { PANEL_ROW_SELECTOR } from './css.ts'

const PROBE_REGISTRY_ID = `${RAIL_ID_PREFIX}probe`
const PROBE_ACTIVE_ID = `${RAIL_ID_PREFIX}probe-active`

/** How many times the rail probe re-measures while the DOM catches up. */
const RAIL_PROBE_ATTEMPTS = 3

/**
 * How long the probes wait for `sidebar.panellist` to be declared before
 * measuring. The sidebar entry declares it during boot; a shell that never
 * declares it is reported honestly after this.
 */
const PROBE_DECLARATION_TIMEOUT_MS = 5000

/**
 * The selector the hide rule uses — imported, never restated: a probe that
 * measures a different shape than the rule matches is worse than no probe
 * (`rail/css.ts` owns the string).
 */
const ROW_SELECTOR = PANEL_ROW_SELECTOR

/** The settings navigation buttons the marker pass matches against. */
const SETTINGS_NAV_SELECTOR = '[role="dialog"] nav button'

/** Options for {@link createSelfCheck}. */
export interface SelfCheckOptions {
  /** Live label of our own settings section, for probe 4. */
  sectionLabel(): string
  /** How many rail entries the ledger currently holds (probe 2). */
  entryCount(): number
  /**
   * How long to wait for the rail slot's declaration before measuring
   * (default {@link PROBE_DECLARATION_TIMEOUT_MS}); tests shorten it.
   */
  declarationTimeoutMs?: number
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

/**
 * Register one throwaway rail row.
 *
 * Same seam as the rail adapter's (`registry/rail.tsx`): the arguments are typed
 * against a local shape instead of being cast, and the call goes through `ctx`
 * so the service method keeps its receiver.
 */
function registerProbeRow(
  ctx: ClientContext,
  id: string,
  order: number,
  glyph: (props: Record<string, unknown>) => ReactNode,
): () => void {
  return ctx.slots.register({ name: RAIL_SLOT, id, order } as never, glyph as never)
}

/** Probe 1: can we write to a stored entry at all? */
function probeRegistry(ctx: ClientContext): ProbeResult {
  let dispose: (() => void) | undefined
  try {
    dispose = registerProbeRow(ctx, PROBE_REGISTRY_ID, 424242, () => null)
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
async function probeRail(options: SelfCheckOptions): Promise<ProbeResult> {
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

  let last = { rows: 0, entries: 0, detail: '' }
  for (let attempt = 0; attempt < RAIL_PROBE_ATTEMPTS; attempt += 1) {
    const nav = document.querySelector('nav[class*="_panelList"]')
    if (nav === null) {
      return { id: 'rail', ok: true, detail: ':has() supported; the rail is not mounted right now (sidebar hidden)' }
    }
    const rows = document.querySelectorAll(ROW_SELECTOR).length
    const entries = options.entryCount()
    if (rows === entries) {
      return { id: 'rail', ok: true, detail: `${rows} row(s) match ${ROW_SELECTOR}` }
    }
    last = { rows, entries, detail: describeMismatch(rows, entries) }
    // The DOM trails the ledger by a frame whenever a row was registered or
    // disposed a moment ago (React commits on the next frame, not synchronously
    // inside the call that mutated the ledger). Re-measure before concluding
    // anything — the first version of this probe counted a throwaway row that
    // the previous probe had already disposed, and reported a false failure.
    if (attempt < RAIL_PROBE_ATTEMPTS - 1) await frames(1)
  }
  return { id: 'rail', ok: false, detail: last.detail }
}

/** Name the surplus rows, so a genuine mismatch is diagnosable from the page. */
function describeMismatch(rows: number, entries: number): string {
  const base = `${rows} row(s) for ${entries} rail entr(ies) using ${ROW_SELECTOR}`
  if (rows <= entries) return base
  const labels: string[] = []
  for (const row of document.querySelectorAll(ROW_SELECTOR)) {
    if (labels.length >= entries + 3 || labels.length >= rows) break
    const label = row.getAttribute('aria-label') ?? row.textContent?.trim() ?? ''
    if (label.length > 0) labels.push(label)
  }
  return labels.length === 0 ? base : `${base}; rows seen: ${labels.join(' | ')}`
}

/** Probe 3: does the shell still hand our glyph an `active` prop? */
async function probeActive(ctx: ClientContext): Promise<ProbeResult> {
  let seen: { hasActive: boolean; active: unknown; size: unknown } | null = null
  const ProbeGlyph = (props: Record<string, unknown>): ReactNode => {
    seen = { hasActive: 'active' in props, active: props['active'], size: props['size'] }
    // The throwaway row hides itself with the same suppressed marker a group
    // member uses, so HIDE_CSS takes it off the rail while the probe waits its
    // two frames — the user never sees an extra row.
    return createElement('span', { 'data-dsh-panellist-suppressed': '' })
  }
  let dispose: (() => void) | undefined
  try {
    dispose = registerProbeRow(ctx, PROBE_ACTIVE_ID, 424243, ProbeGlyph)
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
    activeRuleDisabled: failed('active'),
    version,
  }
}

/**
 * Resolve `true` once the rail slot is declared, `false` after `timeoutMs`.
 *
 * `sidebar.panellist` is declared by the SIDEBAR entry's `children` table, and
 * this plugin can mount before that entry exists: registering a probe row (or a
 * group row) straight away is refused with "slot … is not declared", and the
 * self-check then reported the whole plugin read-only on a boot-order race.
 * `slots.inject` is the shell's own "run this when the seat exists" seam, so the
 * probes wait on it instead of racing it. A shell that never declares the slot
 * still ends the wait and is reported honestly.
 */
function whenRailDeclared(ctx: ClientContext, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    let settled = false
    const finish = (declared: boolean): void => {
      if (settled) return
      settled = true
      resolve(declared)
    }
    let stop: (() => void) | undefined
    try {
      stop = ctx.slots.inject(RAIL_SLOT, () => {
        // `inject` may fire before `stop` is assigned, so release and settle
        // on a microtask rather than inline.
        queueMicrotask(() => {
          try { stop?.() } catch { /* idempotent */ }
          finish(true)
        })
        return () => {}
      })
    } catch {
      finish(false)
      return
    }
    setTimeout(() => {
      try { stop?.() } catch { /* idempotent */ }
      finish(false)
    }, timeoutMs)
  })
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
    activeRuleDisabled: false,
    version: measuredVersion(),
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
          // The rail slot is declared by the sidebar entry's children table and
          // this plugin can mount first: wait for it, so a boot-order race can
          // never fail the check and park the whole plugin in read-only.
          await whenRailDeclared(ctx, options.declarationTimeoutMs ?? PROBE_DECLARATION_TIMEOUT_MS)
          // Order matters: the rail probe counts DOM rows, so it runs BEFORE any
          // probe registers a throwaway row. Counting after probe 3 (which parks
          // a row in the DOM for two frames) is what produced a false "7 rows for
          // 6 entries" on the first real DSH run.
          const rail = await probeRail(options)
          const registry = probeRegistry(ctx)
          // A read-only shell cannot be probed further: registrations are the
          // mechanism the remaining probe needs.
          const active = registry.ok
            ? await probeActive(ctx)
            : { id: 'active' as const, ok: true, detail: 'skipped: probing needs registrations' }
          publish([registry, rail, active, probeSettingsNav(options)])
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
