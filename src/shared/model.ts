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
  isContainer,
  isManagedSeat,
  MANAGED_SEATS,
  SETTINGS_ROW_ID,
  type Container,
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
  /** The seat the contributor registered this row into. */
  container: Container
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
  /**
   * Hidden inside the group: the member's rail row is already suppressed, so
   * "hidden" for a member means the flyout leaves it out (README §2.3). The
   * member stays in the group — the count, the order and the group highlight
   * still see it.
   */
  hidden: boolean
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
  /** The seat this row should occupy after the sequence is applied. */
  container: Container
}

/** One group row. */
export interface PlanGroup {
  /** Config identity, `group:<name>`. */
  id: string
  /** Rail row id / `main` key: `dsh-railist:group:<name>`. */
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
  /** The seat this group's trigger row should occupy. */
  container: Container
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
  /** Seat the row occupies once the sequence is applied. */
  container: Container
  /**
   * The row is REGISTERED but currently renders no element on the rail.
   *
   * Not the same thing as {@link Plan.orphans} (`missing`): an orphan has no
   * registration at all, while an unrendered row has a live registration whose
   * own component happens to return `null` right now — a footer entry that only
   * shows itself while a feature is on, say. The settings page keeps both and
   * labels them differently; neither is dropped, because a row the user cannot
   * see is still a row the user has to be able to reach (README §2.8).
   *
   * Only the DOM half can answer this question — the shell renders the entry,
   * not us — so it is an input to {@link buildPlan}, not something it can
   * discover. With no answer available every row counts as rendered, which is
   * what keeps this a pure function of its arguments.
   */
  unrendered: boolean
  /**
   * The row is the shell's own settings row, which this plugin never takes over.
   *
   * It is listed so the user can see where it sits, and it is pinned: it always
   * renders last in the bottom-left seat and cannot be dragged anywhere, because
   * the slot it lives in declares the settings page itself (moving it there
   * blanked the settings content area once — see README §2.12).
   */
  pinned: boolean
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
  /** Seat this row is placed in (see {@link seatFor}). */
  container: Container
  /**
   * Order to write within {@link container}; filled by the seat pass below.
   * Optional at construction time so the sequence walk can push a row before the
   * pass that knows every neighbouring seat has run.
   */
  seatOrder?: number
  /**
   * Whether the user actually placed this row (it came from the configured
   * sequence) rather than being appended as an unconfigured tail row. Only a placed
   * row may anchor the seat of the row below it (see {@link seatFor}).
   */
  configured: boolean
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
 * One of the seats this plugin places rows in — see {@link MANAGED_SEATS} in
 * `./config.ts` for why `settings` is not one of them.
 */
type ManagedSeat = (typeof MANAGED_SEATS)[number]

/**
 * The seat a row occupies once the user has dragged something.
 *
 * The rule (README §2.11): **only the row the user dragged changes seat; every
 * other row keeps the seat it already has** — the one stored in its sequence
 * entry when the user dragged it there, and its contributor's seat before that.
 * The dragged row takes the seat of the nearest row above it that is *not* itself
 * dragged.
 *
 * This replaces an earlier rule ("a row takes the seat of the nearest seat-bearing
 * row above it") which applied to EVERY row. That rule re-seated the whole run
 * below a drag: dropping a footer row at the top turned the first top row below
 * it into a footer row, which turned the next row into a top row, and so on. Rows
 * whose seat flipped like that were appended into a host the shell does not
 * render, so they left the rail entirely and the sidebar went blank (a real
 * regression the user hit). Looking only at the dragged row cannot cascade,
 * because a row that did not move is never re-seated and therefore never becomes
 * the reason the next row moves.
 *
 * @param ordered - the configured rows, in sequence order.
 * @param seats - each row's seat as carried by its slot: the stored seat when it
 *   has one, its contributor's otherwise.
 * @param moved - the id of the row the user just dragged, or `null` for "no drag
 *   is in flight", in which case every row keeps the seat it already has.
 * @returns each row's seat, by id.
 */
function resolveSeats(
  ordered: readonly { id: string }[],
  seats: ReadonlyMap<string, ManagedSeat>,
  moved: string | null,
): Map<string, ManagedSeat> {
  const out = new Map<string, ManagedSeat>()
  for (const [index, row] of ordered.entries()) {
    const own = seats.get(row.id)
    if (own === undefined) continue
    if (moved === null || row.id !== moved) {
      out.set(row.id, own)
      continue
    }
    // The dragged row: anchor to the nearest row above it that did not move.
    let seat: ManagedSeat | null = null
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const above = ordered[cursor]
      if (above === undefined || above.id === moved) continue
      const aboveSeat = seats.get(above.id)
      if (aboveSeat !== undefined) {
        seat = aboveSeat
        break
      }
    }
    out.set(row.id, seat ?? own)
  }
  return out
}

/**
 * The seat of a row that has **no seat of its own** — a Group row, or a panel row
 * registered into a seat this plugin does not manage (the shell's Settings row).
 *
 * Such a row renders wherever the row above it renders, so it follows that row's
 * *resolved* seat rather than its contributor seat. That is the one place a seat
 * propagates downward, and it cannot cascade through panel rows: only a seat-less
 * row can be followed this way, panels in between still keep their own seat.
 *
 * A seat-less row with nothing seat-bearing above it (or no resolved seat to read)
 * falls back to `fallback`, which for the Settings row is its own seat.
 */
function seatBelow(
  ordered: readonly { id: string }[],
  resolved: ReadonlyMap<string, ManagedSeat>,
  index: number,
  fallback: Container,
): Container {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const above = ordered[cursor]
    if (above === undefined) continue
    const seat = resolved.get(above.id)
    if (seat !== undefined) return seat
  }
  return fallback
}


/**
 * Build the plan.
 * @param registered - native rail registrations (never our own group rows).
 * @param profile - the profile's configuration section.
 * @param rendered - the `railId`s the rail currently renders an element for, or
 *   `undefined` when the caller cannot say (no DOM yet, a unit test, the server
 *   half). An omitted answer marks nothing as unrendered, so the "is it on
 *   screen?" question never changes a row's identity — only its `unrendered`
 *   flag — and this function stays pure.
 * @param moved - the id of the row the user just dragged, or `null`/omitted when
 *   no drag is in flight. Only this row may change seat (README §2.11); the model
 *   cannot infer it from the sequence, because a row can be dragged to a position
 *   its contributor seat already implied. When a drag is in flight the dragged
 *   row's seat is ALSO written into the sequence by the caller, so this argument
 *   only decides how long the re-seat lasts in the current session: the stored
 *   `seat` outlives a reload, `moved` does not.
 * @returns the projection described by this module's doc comment.
 */
export function buildPlan(
  registered: readonly RegisteredPanel[],
  profile: ProfileConfig,
  rendered?: ReadonlySet<string>,
  moved?: string | null,
): Plan {
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
      // The stored seat wins over the contributor's: it is the seat the user last
      // dragged this row into, and it has to survive a reload. A `seat` naming a
      // seat this plugin no longer manages is treated as absent. A contributor in a
      // seat this plugin does not manage (the shell's own Settings row) keeps that
      // seat — it is never re-seated into a managed one.
      const stored = item.seat !== undefined && isManagedSeat(item.seat) ? item.seat : null
      const contributor = native.get(item.id)?.container
      const container = stored
        ?? (isContainer(contributor) ? contributor : 'top')
      slots.push({ key: nextKey, kind: 'panel', id: item.id, railId: item.id, container, configured: true })
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
          hidden: profile.entries[memberId]?.hidden === true,
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
        hidden: override?.hidden === true,
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
    slots.push({ key: nextKey, kind: 'group', id: item.id, railId: groupRailId(item.id), container: 'top', configured: true })
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
    slots.push({ key: nextKey, kind: 'panel', id: panel.id, railId: panel.id, container: panel.container, configured: false })
  }

  /**
   * The seat pass runs SECOND, after {@link reordering} is known, because it needs
   * the whole sequence before it can decide where a dragged row lands.
   * Seat resolution only reorders rows across containers — it never changes `key`,
   * so the within-seat order (the `order` field written to the registry) is exactly
   * the sequence order.
   *
   * Like the order writes, the seat pass is gated on {@link reordering}: a fresh
   * install must be a strict no-op, and "no row moved" means no row changes seat
   * either. Re-seating without a configured sequence would move rows the user never
   * touched, purely because a contributor happened to declare a lower order.
   */
  const ordered = [...slots].sort((a, b) => a.key - b.key)
  if (reordering) {
    /**
     * Resolve the seat of every row (README §2.11).
     *
     * **Only {@link moved} changes seat; every other row keeps the seat it already
     * has** — the one stored in its sequence entry when the user dragged it there,
     * and its contributor's seat before that. A group row has no seat of its own —
     * it can never be the dragged row (dragging a group moves it within a seat,
     * not across seats), so it keeps the first managed seat and renders wherever
     * its members do.
     */
    const seats = new Map<string, ManagedSeat>()
    for (const slot of ordered) {
      // Only configured panel rows take part: a tail row is never re-seated, and a
      // group row has no seat to contribute. Giving either of them an entry would
      // let them anchor a drag.
      if (slot.kind !== 'panel' || !slot.configured || !isManagedSeat(slot.container)) continue
      seats.set(slot.id, slot.container)
    }
    const resolved = resolveSeats(ordered, seats, moved ?? null)
    for (const [index, slot] of ordered.entries()) {
      if (slot.kind === 'group') {
        // A group row has no seat of its own: it renders wherever the row above it
        // does. Its members go with it through the rewrite pass.
        if (slot.configured) slot.container = seatBelow(ordered, resolved, index, 'top')
        continue
      }
      const seat = resolved.get(slot.id)
      if (seat !== undefined) slot.container = seat
      else if (slot.kind === 'panel' && isManagedSeat(slot.container) === false) {
        // A row registered into a seat we do not manage — the shell's Settings row
        // — is PINNED to the bottom of the bottom-left seat (README §2.12). It is
        // not carried along with whatever row happens to lead the list: the user
        // asked for a fixed "Settings is always last" landmark, and a landmark that
        // moves is not one. The DOM half never touches it, so this only decides
        // which section of the settings page lists it.
        slot.container = 'footer'
      }
    }
  }

  /**
   * The order written to the registry is a within-seat counter, not the global
   * sequence position: the shell sorts one slot at a time, and handing it global
   * keys would leave gaps (and therefore odd spacing) in every seat.
   */
  const seatCounters = new Map<Container, number>()
  for (const slot of ordered) {
    const next = (seatCounters.get(slot.container) ?? 0) + 1
    seatCounters.set(slot.container, next)
    slot.seatOrder = next * ORDER_STEP
  }

  // Panels.
  const seatOf = new Map<string, Slot>()
  for (const slot of ordered) seatOf.set(slot.railId, slot)
  const panels = new Map<string, PlanPanel>()
  for (const panel of native.values()) {
    const placement = assigned.get(panel.id)
    const override = profile.entries[panel.id]
    const slot = seatOf.get(panel.id)
    panels.set(panel.id, {
      id: panel.id,
      order: reordering && placement !== undefined && placement.order !== null && slot?.seatOrder !== undefined
        ? slot.seatOrder
        : null,
      label: effectiveLabel(panel.label, override) || panel.id,
      icon: effectiveIcon(override),
      hidden: override?.hidden === true,
      suppressed: placement?.groupId != null,
      // A suppressed (grouped) row never renders its own rail row, so its seat is
      // unobservable; keep it where its contributor put it.
      container: placement?.groupId != null ? panel.container : slot?.container ?? panel.container,
    })
  }

  // Groups.
  const groups = new Map<string, PlanGroup>()
  for (const group of groupItems) {
    const { item, members, liveMembers } = group
    const explicitLabel = item.label !== undefined && item.label.trim().length > 0 ? item.label : null
    const slot = seatOf.get(groupRailId(item.id))
    groups.set(item.id, {
      id: item.id,
      railId: groupRailId(item.id),
      order: group.order === null || slot?.seatOrder === undefined ? null : slot.seatOrder,
      label: explicitLabel ?? liveMembers[0]?.label ?? item.id,
      labelExplicit: explicitLabel !== null,
      icon: item.icon === undefined || item.icon.kind === 'original' ? null : item.icon,
      hidden: item.hidden === true,
      iconFallbackPanelId: liveMembers[0]?.id ?? null,
      members,
      liveMembers,
      container: slot?.container ?? 'top',
    })
  }

  // Orphans: anything configured that no registration answers.
  for (const [id] of Object.entries(profile.entries)) if (!native.has(id)) orphan(id)

  const rows: PlanRow[] = ordered
    .map(slot => ({
      railId: slot.railId,
      kind: slot.kind,
      id: slot.id,
      // No order is written until something is configured: the contributors'
      // own order stands.
      label: slot.kind === 'group'
        ? groups.get(slot.id)?.label ?? slot.id
        : panels.get(slot.id)?.label ?? slot.id,
      container: slot.container,
      // No answer from the DOM half means "assume it renders": the flag must
      // never flip a row's meaning on a caller that cannot see the rail.
      unrendered: rendered !== undefined && !rendered.has(slot.railId),
      // The shell's own Settings row: listed, never moved (README §2.12).
      pinned: slot.kind === 'panel' && slot.id === SETTINGS_ROW_ID,
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
