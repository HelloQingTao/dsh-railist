/**
 * The plan: one pure projection of (what the rail has registered) × (what the
 * user configured) into "what every row should be". Nothing in here touches
 * DSH, React or the DOM, which is what makes the whole behaviour testable
 * without a browser.
 *
 * Rules (README §2):
 * - The sequence is a partition of panels: each panel appears exactly once,
 *   either as a bare row or inside exactly one group. One nesting level only.
 * - `rows` is the WHOLE rail, so the settings page can list and edit
 *   every entry from the first open; there is no "configured subset" to opt into.
 * - What is gated is the WRITE: while the sequence holds no live row, every
 *   `PlanPanel.order` is `null` ("leave the native order alone") and a panel the
 *   user never configured gets no name/icon/hide write either — so a fresh
 *   install is a strict no-op on a rail other plugins also touch.
 * - `reordering` says which of those two modes the plan is in.
 * - Unconfigured panels land after the configured block, keeping their own
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

/**
 * One rail row, as the settings page lists it.
 *
 * Display order IS array order. The order this row would be written at lives on
 * `PlanPanel.order` (panels) or `PlanGroup.order` (groups) — the one field the
 * rewrite pass actually reads — so it is not duplicated here.
 */
export interface PlanRow {
  railId: string
  kind: 'panel' | 'group'
  /** Panel id (`kind: 'panel'`) or group id (`kind: 'group'`). */
  id: string
  label: string
}

/** A structured, translatable diagnostic for the settings page. */
export type PlanWarning =
  | { code: 'single-member-group'; groupId: string }
  | { code: 'empty-group'; groupId: string }
  | { code: 'group-id-collision'; groupId: string }
  | { code: 'duplicate-in-sequence'; panelId: string }

/** The whole projection. */
export interface Plan {
  /** Every registered panel, by panel id. */
  panels: ReadonlyMap<string, PlanPanel>
  /**
   * Every configured group, keyed by group id — including a *dormant* group
   * (one whose members all lost their registration): it stays in `config` so the
   * reinstall case is lossless and carries `order: null`. A consumer registers a
   * row only for a group with at least one live member.
   */
  groups: ReadonlyMap<string, PlanGroup>
  /**
   * Every rail row, in the order the rail shows them: the configured
   * block first, then the registered-but-unconfigured panels in their own order.
   *
   * This is the whole rail on purpose. The settings page edits this list
   * directly — there is no separate "not configured yet" pool — so a row's
   * absence here would mean an entry the user cannot reach.
   */
  rows: readonly PlanRow[]
  /** Configured ids with no registration (README §2.8: preserved, marked missing). */
  orphans: readonly string[]
  /** Group members with no registration. */
  missingMembers: readonly string[]
  warnings: readonly PlanWarning[]
  /** Whether order writes are in play at all. */
  reordering: boolean
}

interface Slot {
  /** Position within the row list; also the source of the written order. */
  key: number
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

  const warnings: PlanWarning[] = []
  /**
   * Placement per panel. `order: null` means "this panel is shown inside a
   * group", so it keeps its own rail order untouched — a suppressed row's order
   * is unobservable, and not writing it keeps the takeover minimal.
   */
  const assigned = new Map<string, { order: number | null; groupId: string | null }>()
  const orphans: string[] = []
  const missing: string[] = []
  const groupItems: GroupItemPlan[] = []
  const slots: Slot[] = []
  let nextKey = 0

  const orphan = (id: string): void => {
    if (!orphans.includes(id)) orphans.push(id)
  }

  for (const item of profile.sequence) {
    if (isEntryItem(item)) {
      if (!native.has(item.id)) {
        orphan(item.id)
        continue
      }
      if (assigned.has(item.id)) {
        warnings.push({ code: 'duplicate-in-sequence', panelId: item.id })
        continue
      }
      nextKey += 1
      assigned.set(item.id, { order: nextKey, groupId: null })
      slots.push({ key: nextKey, kind: 'panel', id: item.id, railId: item.id })
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
      groupItems.push({ item, members, liveMembers, order: null })
      continue
    }
    if (members.length === 1) warnings.push({ code: 'single-member-group', groupId: item.id })
    nextKey += 1
    slots.push({ key: nextKey, kind: 'group', id: item.id, railId: groupRailId(item.id) })
    groupItems.push({ item, members, liveMembers, order: nextKey })
  }

  // The rest of the rail: everything registered that the sequence did not place
  // and the user did not lock, kept in the contributors' own order and shown
  // after the configured block (README §2.8).
  //
  // The sort is by `order` ONLY, and `Array.prototype.sort` is stable, so panels
  // that declare the same order (or none at all) keep the order the ledger
  // handed them — which is exactly what the shell does when it projects the same
  // slot. An alphabetical tie-break looks harmless and is not: it silently
  // reorders the list against the rail the user is looking at.
  const tail = [...native.values()]
    .filter(panel => !assigned.has(panel.id))
    .sort((a, b) => a.order - b.order)

  /**
   * Whether anything is configured at all.
   *
   * With nothing configured this plugin writes no `order` at all — the rail
   * keeps its native order and every row below is listed exactly where the
   * contributors put it. A STRUCTURAL change (a drag, creating or dissolving a
   * group) turns the sequence into an explicit order and this switches on; a
   * rename or a hide only writes that one row's override and leaves the order
   * alone.
   */
  const reordering = slots.length > 0

  for (const panel of tail) {
    nextKey += 1
    if (reordering) assigned.set(panel.id, { order: nextKey, groupId: null })
    slots.push({ key: nextKey, kind: 'panel', id: panel.id, railId: panel.id })
  }

  // Panels.
  const panels = new Map<string, PlanPanel>()
  for (const panel of native.values()) {
    const placement = assigned.get(panel.id)
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

  const rows: PlanRow[] = slots
    .sort((a, b) => a.key - b.key)
    .map(slot => ({
      railId: slot.railId,
      kind: slot.kind,
      id: slot.id,
      // No order is written until something is configured: the contributors'
      // own order stands.
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
