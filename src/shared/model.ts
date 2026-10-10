/**
 * The plan: one pure projection of (what the rail has registered) × (what the
 * user configured) into "what every row should be". Nothing in here touches
 * DSH, React or the DOM, which is what makes the whole behaviour testable
 * without a browser.
 *
 * Rules (README §2):
 * - The sequence is a partition of panels: each panel appears exactly once,
 *   either as a bare row or inside exactly one group. One nesting level only.
 * - A panel the user never configured is *unmanaged*: no name/icon/hide write.
 * - A locked panel is never touched at all, not even reordered.
 * - Reordering (writing `order` at all) happens only when the sequence has at
 *   least one live row, so a fresh install is a strict no-op on the rail.
 * - Unmanaged panels land after the configured block, keeping their own
 *   relative order (README §2.8).
 * - A group member's own rail row is suppressed; a member that is currently
 *   active highlights the group trigger instead (README §2.6).
 */
import {
  groupRailId,
  isEntryItem,
  isGroupItem,
  type EntryOverride,
  type GroupItem,
  type IconRef,
  type ProfileConfig,
} from './config.ts'

/** Spacing between two neighbouring rows, leaving room for manual inserts. */
export const ORDER_STEP = 10

/** One panel as the rail currently has it registered (native facts only). */
export interface RegisteredPanel {
  id: string
  /** Native display label, already resolved through the shell's label thunk. */
  label: string
  /** Native order (0 when the contributor declared none). */
  order: number
}

/** One group member as the flyout should render it. */
export interface PlanMember {
  id: string
  /** Effective name (override ?? native), or the raw id when unregistered. */
  label: string
  /** Effective glyph override, or `null` for "the member's own icon". */
  icon: IconRef | null
  /** No registration carries this id (orphan kept for the reinstall case). */
  missing: boolean
}

/** One panel row. */
export interface PlanPanel {
  id: string
  /** Rail order to write, or `null` for "leave the native order alone". */
  order: number | null
  /** Effective row text. */
  label: string
  /** Effective glyph override, or `null` for "keep the contributor's component". */
  icon: IconRef | null
  /** Hide the row unless it is the active panel (README §2.3). */
  hidden: boolean
  /** Always hide the row: it is shown inside a group instead (README §2.6). */
  suppressed: boolean
  /** Locked panels are left exactly as registered (README §2.9). */
  locked: boolean
  /** Whether this plugin writes anything for this panel beyond `order`. */
  managed: boolean
}

/** One group row. */
export interface PlanGroup {
  /** Config identity, `group:<name>`. */
  id: string
  /** Rail row id / `main` key: `dsh-panellist:group:<name>`. */
  railId: string
  /** Rail order to write; never `null` for a rendered group. */
  order: number | null
  /** Trigger text: explicit, else the first live member's effective name. */
  label: string
  /** Whether the trigger text was set by the user. */
  labelExplicit: boolean
  /** Trigger glyph, when the user picked one. */
  icon: IconRef | null
  /** Hidden trigger (a hidden active group still shows, README §2.3). */
  hidden: boolean
  /** Panel whose native/effective glyph the trigger borrows when `icon` is null. */
  iconFallbackPanelId: string | null
  /** Ordered members, including missing ones. */
  members: readonly PlanMember[]
  /** Members that still have a registration (only these render). */
  liveMembers: readonly PlanMember[]
}

/** One rail row, in render order. */
export interface PlanRow {
  railId: string
  kind: 'panel' | 'group'
  /** Panel id (`kind: 'panel'`) or group id (`kind: 'group'`). */
  id: string
  order: number
  label: string
}

/** A structured, translatable diagnostic for the settings page. */
export type PlanWarning =
  | { code: 'single-member-group'; groupId: string }
  | { code: 'empty-group'; groupId: string }
  | { code: 'group-id-collision'; groupId: string }
  | { code: 'locked-member'; groupId: string; panelId: string }
  | { code: 'locked-in-sequence'; panelId: string }
  | { code: 'duplicate-in-sequence'; panelId: string }

/** The whole projection. */
export interface Plan {
  /** Every registered panel, by panel id. */
  panels: ReadonlyMap<string, PlanPanel>
  /**
   * Every configured group, keyed by group id — including a *dormant* group
   * (one whose members all lost their registration): it stays in `config` so the
   * reinstall case is lossless, carries `order: null`, and is listed in
   * {@link Plan.dormantGroups} so a consumer never registers a row for it.
   */
  groups: ReadonlyMap<string, PlanGroup>
  /** Rail rows in render order (configured block, then unmanaged panels). */
  rows: readonly PlanRow[]
  /** Configured ids with no registration (README §2.8: preserved, marked missing). */
  orphans: readonly string[]
  /** Group members with no registration. */
  missingMembers: readonly string[]
  /** Registered panels in no sequence and with no override. */
  unmanaged: readonly string[]
  /** Config groups that cannot render a row (all members missing). */
  dormantGroups: readonly string[]
  warnings: readonly PlanWarning[]
  /** Whether order writes are in play at all. */
  reordering: boolean
}

interface Slot {
  order: number
  kind: 'panel' | 'group'
  id: string
  railId: string
}

function effectiveLabel(native: string | undefined, override: EntryOverride | undefined): string {
  const chosen = override?.label
  if (chosen !== undefined && chosen.trim().length > 0) return chosen
  return native ?? ''
}

function effectiveIcon(override: EntryOverride | undefined): IconRef | null {
  const icon = override?.icon
  if (icon === undefined || icon.kind === 'original') return null
  return icon
}

/**
 * Build the plan.
 * @param registered - native rail registrations (never our own group rows).
 * @param profile - the profile's configuration section.
 * @returns the projection described by this module's doc comment.
 */
export function buildPlan(registered: readonly RegisteredPanel[], profile: ProfileConfig): Plan {
  const native = new Map<string, RegisteredPanel>()
  for (const panel of registered) native.set(panel.id, panel)

  const locked = new Set(profile.locked)
  const warnings: PlanWarning[] = []
  /**
   * Placement per panel. `order: null` means "this panel is shown inside a
   * group", so it keeps its own rail order untouched — a suppressed row's order
   * is unobservable, and not writing it keeps the takeover minimal.
   */
  const assigned = new Map<string, { order: number | null; groupId: string | null }>()
  const orphans: string[] = []
  const missing: string[] = []
  const dormantGroups: string[] = []
  const groupItems: GroupItemPlan[] = []
  const slots: Slot[] = []
  let nextOrder = 0

  const orphan = (id: string): void => {
    if (!orphans.includes(id)) orphans.push(id)
  }

  for (const item of profile.sequence) {
    if (isEntryItem(item)) {
      if (locked.has(item.id)) {
        warnings.push({ code: 'locked-in-sequence', panelId: item.id })
        continue
      }
      if (!native.has(item.id)) {
        orphan(item.id)
        continue
      }
      if (assigned.has(item.id)) {
        warnings.push({ code: 'duplicate-in-sequence', panelId: item.id })
        continue
      }
      nextOrder += 1
      assigned.set(item.id, { order: nextOrder, groupId: null })
      slots.push({ order: nextOrder, kind: 'panel', id: item.id, railId: item.id })
      continue
    }
    if (!isGroupItem(item)) continue
    // Two identities can collide: the bare group id (`group:g1`, a panel id in
    // the same strings) and — the one that actually matters — the rail id this
    // plugin registers and uses as its `main` key. ADR-0001 reserves that id
    // space, so a group whose rail id is already taken never renders.
    if (native.has(item.id) || native.has(groupRailId(item.id))) {
      warnings.push({ code: 'group-id-collision', groupId: item.id })
      continue
    }
    const members: PlanMember[] = []
    const liveMembers: PlanMember[] = []
    for (const memberId of item.members) {
      if (locked.has(memberId)) {
        warnings.push({ code: 'locked-member', groupId: item.id, panelId: memberId })
        continue
      }
      const panel = native.get(memberId)
      if (panel === undefined) {
        const entry: PlanMember = {
          id: memberId,
          label: effectiveLabel(undefined, profile.entries[memberId]) || memberId,
          icon: effectiveIcon(profile.entries[memberId]),
          missing: true,
        }
        members.push(entry)
        if (!missing.includes(memberId)) missing.push(memberId)
        orphan(memberId)
        continue
      }
      if (assigned.has(memberId)) {
        warnings.push({ code: 'duplicate-in-sequence', panelId: memberId })
        continue
      }
      const override = profile.entries[memberId]
      const entry: PlanMember = {
        id: memberId,
        label: effectiveLabel(panel.label, override) || memberId,
        icon: effectiveIcon(override),
        missing: false,
      }
      members.push(entry)
      liveMembers.push(entry)
      // A member does NOT consume a rail position: its row is suppressed, so
      // only the group's own slot advances the sequence.
      assigned.set(memberId, { order: null, groupId: item.id })
    }
    if (members.length === 0) {
      warnings.push({ code: 'empty-group', groupId: item.id })
      continue
    }
    if (liveMembers.length === 0) {
      dormantGroups.push(item.id)
      groupItems.push({ item, members, liveMembers, order: null })
      continue
    }
    if (members.length === 1) warnings.push({ code: 'single-member-group', groupId: item.id })
    nextOrder += 1
    slots.push({ order: nextOrder, kind: 'group', id: item.id, railId: groupRailId(item.id) })
    groupItems.push({ item, members, liveMembers, order: nextOrder })
  }

  // Unmanaged panels: everything registered that the sequence did not place and
  // the user did not lock, kept in their own native order, appended after the
  // configured block (README §2.8).
  //
  // The sort is by `order` ONLY, and `Array.prototype.sort` is stable, so panels
  // that declare the same order (or none at all) keep the order the ledger
  // handed them — which is exactly what the shell does when it projects the same
  // slot. An alphabetical tie-break looks harmless and is not: it silently
  // reorders the "not configured" list against the rail the user is looking at.
  const unmanaged: string[] = []
  const unmanagedSorted = [...native.values()]
    .filter(panel => !assigned.has(panel.id) && !locked.has(panel.id))
    .sort((a, b) => a.order - b.order)
  for (const panel of unmanagedSorted) {
    if (isUntouched(profile, panel.id)) unmanaged.push(panel.id)
  }

  const reordering = slots.length > 0
  if (reordering) {
    for (const panel of unmanagedSorted) {
      nextOrder += 1
      assigned.set(panel.id, { order: nextOrder, groupId: null })
      slots.push({ order: nextOrder, kind: 'panel', id: panel.id, railId: panel.id })
    }
  }

  // Panels.
  const panels = new Map<string, PlanPanel>()
  for (const panel of native.values()) {
    const placement = assigned.get(panel.id)
    if (locked.has(panel.id)) {
      panels.set(panel.id, {
        id: panel.id,
        order: null,
        label: panel.label,
        icon: null,
        hidden: false,
        suppressed: false,
        locked: true,
        managed: false,
      })
      continue
    }
    const override = profile.entries[panel.id]
    panels.set(panel.id, {
      id: panel.id,
      order: reordering && placement !== undefined && placement.order !== null
        ? placement.order * ORDER_STEP
        : null,
      label: effectiveLabel(panel.label, override) || panel.id,
      icon: effectiveIcon(override),
      hidden: override?.hidden === true,
      suppressed: placement?.groupId != null,
      locked: false,
      managed: placement !== undefined || !isUntouched(profile, panel.id),
    })
  }

  // Groups.
  const groups = new Map<string, PlanGroup>()
  for (const group of groupItems) {
    const { item, members, liveMembers } = group
    const explicitLabel = item.label !== undefined && item.label.trim().length > 0 ? item.label : null
    groups.set(item.id, {
      id: item.id,
      railId: groupRailId(item.id),
      order: group.order === null ? null : group.order * ORDER_STEP,
      label: explicitLabel ?? liveMembers[0]?.label ?? item.id,
      labelExplicit: explicitLabel !== null,
      icon: item.icon === undefined || item.icon.kind === 'original' ? null : item.icon,
      hidden: item.hidden === true,
      iconFallbackPanelId: liveMembers[0]?.id ?? null,
      members,
      liveMembers,
    })
  }

  // Orphans: anything configured that no registration answers.
  for (const [id] of Object.entries(profile.entries)) if (!native.has(id)) orphan(id)
  for (const id of profile.locked) if (!native.has(id)) orphan(id)

  const rows: PlanRow[] = slots
    .sort((a, b) => a.order - b.order)
    .map(slot => ({
      railId: slot.railId,
      kind: slot.kind,
      id: slot.id,
      order: slot.order * ORDER_STEP,
      label: slot.kind === 'group'
        ? groups.get(slot.id)?.label ?? slot.id
        : panels.get(slot.id)?.label ?? slot.id,
    }))

  return {
    panels,
    groups,
    rows,
    orphans,
    missingMembers: missing,
    unmanaged,
    dormantGroups,
    warnings,
    reordering,
  }
}

interface GroupItemPlan {
  item: GroupItem
  members: PlanMember[]
  liveMembers: PlanMember[]
  order: number | null
}

/** Whether the user expressed no opinion at all about this panel. */
function isUntouched(profile: ProfileConfig, id: string): boolean {
  if (Object.prototype.hasOwnProperty.call(profile.entries, id)) {
    const override = profile.entries[id]
    if (override !== undefined && (override.label !== undefined || override.icon !== undefined || override.hidden === true)) {
      return false
    }
  }
  return !profile.locked.includes(id)
}
