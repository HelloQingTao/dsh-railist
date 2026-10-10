/**
 * The groups unit: it reconciles the plan's groups into real rail rows and owns
 * the flyout they open.
 *
 * A group row is a genuine registration into `sidebar.panellist`
 * so the shell places it by `order`, renders its `label` and reuses both as
 * the accessible name and the collapsed tooltip. This module owns only the
 * reconcile/registration lifecycle; `Row.tsx` owns the glyph and its wiring,
 * `Flyout.tsx` the overlay, `Overview.tsx` the insurance `main` page.
 *
 * `sync()` is idempotent by design: it compares the order and resolved label of
 * every already-registered group against the plan and only re-registers the rows
 * that actually changed, because a needless re-registration would remount a row
 * the user may be interacting with.
 */
import type { GroupUnit, GroupUnitDeps } from '../contracts.ts'
import { removePortalContainer } from './Flyout.tsx'
import { createOverviewPage } from './Overview.tsx'
import { createTriggerGlyph } from './Row.tsx'
import { GROUPS_CSS, GROUPS_STYLE_ID } from './groups.css.ts'

/** What the unit hands its components: the deps plus a change store. */
export interface GroupUnitRuntime {
  deps: GroupUnitDeps
  /** Subscribe to plan/active changes (the React store contract). */
  subscribe(listener: () => void): () => void
  /** Monotonic snapshot counter; stable until the next change. */
  version(): number
  /** True once `dispose()` ran, so a still-mounted row can stop rendering. */
  isDisposed(): boolean
}

/** One row this unit currently has registered. */
interface RowRecord {
  readonly railId: string
  /** Order at registration time, for the idempotence comparison. */
  readonly order: number
  /** Resolved label at registration time, for the idempotence comparison. */
  readonly label: string
  readonly disposeRow: () => void
}

/**
 * Create the group unit.
 * @param deps - the frozen group seam (`contracts.ts`).
 */
export function createGroupUnit(deps: GroupUnitDeps): GroupUnit {
  deps.styles.register(GROUPS_STYLE_ID, GROUPS_CSS)

  const listeners = new Set<() => void>()
  const rows = new Map<string, RowRecord>()
  let version = 0
  let disposed = false

  const notify = (): void => {
    version += 1
    for (const listener of [...listeners]) listener()
  }

  const runtime: GroupUnitRuntime = {
    deps,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    version: () => version,
    isDisposed: () => disposed,
  }

  const sync = (): void => {
    if (disposed) return
    const seen = new Set<string>()
    for (const group of deps.plan().groups.values()) {
      const { id, railId } = group
      // A dormant group (no member has a registration) has no row at all; the
      // plan keeps it only so the settings page can report it (README §2.8).
      if (group.liveMembers.length === 0) continue
      seen.add(id)
      const order = group.order ?? 0
      const label = group.label
      const current = rows.get(id)
      if (current !== undefined && current.order === order && current.label === label) continue
      // Dispose before registering: a real `SlotRegistry` rejects a second
      // entry with the same id and priority.
      current?.disposeRow()
      rows.delete(id)
      const disposeRow = deps.rail.registerRow({
        railId,
        order,
        // Resolved at read time, so a locale switch needs no re-registration.
        label: () => deps.plan().groups.get(id)?.label ?? label,
        glyph: createTriggerGlyph(runtime, id),
        rowAttributes: { 'aria-haspopup': 'menu' },
      }, createOverviewPage(runtime, id))
      rows.set(id, { railId, order, label, disposeRow })
    }
    for (const [groupId, record] of [...rows]) {
      if (seen.has(groupId)) continue
      record.disposeRow()
      rows.delete(groupId)
    }
  }

  // The controller calls `sync()` itself on every recomputation; this
  // subscription keeps the unit correct when it is driven standalone (tests,
  // or a future host that does not own the loop).
  const unsubscribePlan = deps.subscribe(() => {
    if (disposed) return
    sync()
    notify()
  })
  const unsubscribeActive = deps.rail.subscribeActive(() => {
    if (disposed) return
    notify()
  })

  sync()

  return {
    sync,
    dispose: () => {
      if (disposed) return
      disposed = true
      // Wake still-mounted rows first: they stop rendering, which unmounts any
      // open flyout while its portal target is still in the document.
      notify()
      unsubscribePlan()
      unsubscribeActive()
      for (const record of rows.values()) record.disposeRow()
      rows.clear()
      listeners.clear()
      removePortalContainer()
    },
  }
}

export { GROUPS_CSS, GROUPS_STYLE_ID } from './groups.css.ts'
