/**
 * Pure sequence/override editing. Every function takes a profile section and
 * returns a NEW one; nothing here mutates its input, touches DSH, or knows
 * about React. The settings page is a thin view over these.
 *
 * The one invariant all of these preserve: **a panel id appears at most once
 * anywhere in the sequence** (README §2.2). Every insertion therefore first
 * removes the panel from wherever it currently is, and a group that loses its
 * last member dissolves instead of lingering empty (the schema forbids empty
 * groups).
 *
 * `sequence` is a *partial* order (see `./config.ts`), so structural edits
 * should be preceded by {@link materializeSequence} while the caller still
 * knows the live rail order — that turns the current picture into an explicit
 * order the user can then rearrange.
 */
import {
  cloneProfileConfig,
  isEntryItem,
  isGroupItem,
  type EntryOverride,
  type GroupItem,
  type IconRef,
  type ProfileConfig,
  type SequenceItem,
} from './config.ts'

/** One live rail row, as `Plan.rows` reports it. */
export interface LiveRow {
  kind: 'panel' | 'group'
  id: string
}

function sequenceOf(profile: ProfileConfig): SequenceItem[] {
  return profile.sequence.map(item => (isGroupItem(item) ? { ...item, members: [...item.members] } : { ...item }))
}

/** Remove a panel from wherever it sits; drop any group left with no members. */
function withoutPanel(items: SequenceItem[], panelId: string): SequenceItem[] {
  const result: SequenceItem[] = []
  for (const item of items) {
    if (isEntryItem(item)) {
      if (item.id !== panelId) result.push(item)
      continue
    }
    const members = item.members.filter(member => member !== panelId)
    if (members.length > 0) result.push({ ...item, members })
  }
  return result
}

/** Index of a top-level sequence item by its identity (panel id or group id). */
function indexOfItem(items: readonly SequenceItem[], id: string): number {
  return items.findIndex(item => item.id === id)
}

/** A copy with `entries` normalised so removals actually delete keys. */
function base(profile: ProfileConfig): ProfileConfig {
  const next = cloneProfileConfig(profile)
  for (const [id, override] of Object.entries(next.entries)) {
    if (override.label === undefined && override.icon === undefined && override.hidden !== true) delete next.entries[id]
  }
  return next
}

/** Replace one panel's override field-by-field; `undefined` clears that field. */
function patchOverride(profile: ProfileConfig, id: string, patch: Partial<EntryOverride>): ProfileConfig {
  const next = base(profile)
  const override: EntryOverride = { ...next.entries[id] }
  if ('label' in patch) {
    const label = patch.label?.trim()
    if (label === undefined || label.length === 0) delete override.label
    else override.label = label
  }
  if ('icon' in patch) {
    const icon = patch.icon
    if (icon === undefined || icon.kind === 'original') delete override.icon
    else override.icon = { ...icon }
  }
  if ('hidden' in patch) {
    if (patch.hidden === true) override.hidden = true
    else delete override.hidden
  }
  if (override.label === undefined && override.icon === undefined && override.hidden !== true) delete next.entries[id]
  else next.entries[id] = override
  return next
}

/** Set (or clear, with `null`) a panel's display name. */
export function setPanelLabel(profile: ProfileConfig, panelId: string, label: string | null): ProfileConfig {
  return patchOverride(profile, panelId, { label: label ?? undefined })
}

/** Set (or clear, with `null`) a panel's glyph override. */
export function setPanelIcon(profile: ProfileConfig, panelId: string, icon: IconRef | null): ProfileConfig {
  return patchOverride(profile, panelId, { icon: icon ?? undefined })
}

/** Show/hide a panel row (README §2.3). */
export function setPanelHidden(profile: ProfileConfig, panelId: string, hidden: boolean): ProfileConfig {
  return patchOverride(profile, panelId, { hidden })
}

/** Rename a group trigger (empty clears the override → first member's name). */
export function setGroupLabel(profile: ProfileConfig, groupId: string, label: string | null): ProfileConfig {
  const next = base(profile)
  const item = next.sequence.find(candidate => isGroupItem(candidate) && candidate.id === groupId)
  if (item === undefined || !isGroupItem(item)) return next
  const trimmed = label?.trim()
  if (trimmed === undefined || trimmed.length === 0) delete item.label
  else item.label = trimmed
  return next
}

/** Set (or clear, with `null`) a group trigger glyph. */
export function setGroupIcon(profile: ProfileConfig, groupId: string, icon: IconRef | null): ProfileConfig {
  const next = base(profile)
  const item = next.sequence.find(candidate => isGroupItem(candidate) && candidate.id === groupId)
  if (item === undefined || !isGroupItem(item)) return next
  if (icon === null || icon.kind === 'original') delete item.icon
  else item.icon = { ...icon }
  return next
}

/** Hide/show a group trigger row. */
export function setGroupHidden(profile: ProfileConfig, groupId: string, hidden: boolean): ProfileConfig {
  const next = base(profile)
  const item = next.sequence.find(candidate => isGroupItem(candidate) && candidate.id === groupId)
  if (item === undefined || !isGroupItem(item)) return next
  if (hidden) item.hidden = true
  else delete item.hidden
  return next
}

/**
 * Turn the live rail order into an explicit sequence, keeping every orphan
 * config entry. Group members are preserved; a dormant group (no live member)
 * is kept at the end so its configuration survives until the plugin returns.
 */
export function materializeSequence(profile: ProfileConfig, rows: readonly LiveRow[]): ProfileConfig {
  const next = base(profile)
  const existing = new Map(next.sequence.filter(isGroupItem).map(item => [item.id, item]))
  const rebuilt: SequenceItem[] = []
  for (const row of rows) {
    if (row.kind === 'group') {
      const group = existing.get(row.id)
      if (group !== undefined && group.members.length > 0) rebuilt.push(group)
      continue
    }
    rebuilt.push({ type: 'entry', id: row.id })
  }
  const liveIds = new Set(rebuilt.map(item => item.id))
  for (const item of next.sequence) {
    if (liveIds.has(item.id)) continue
    // Orphans and dormant groups keep their configuration, parked at the end.
    if (isEntryItem(item)) rebuilt.push(item)
    else rebuilt.push(item)
  }
  next.sequence = rebuilt
  return next
}

/**
 * Move a top-level row (panel or group) by `delta` positions. Both
 * `moveRow` and `moveRowTo` are no-ops when the row is not in the sequence —
 * call {@link materializeSequence} first (the settings page does).
 */
export function moveRow(profile: ProfileConfig, itemId: string, delta: number): ProfileConfig {
  const next = base(profile)
  const from = indexOfItem(next.sequence, itemId)
  if (from < 0) return next
  const to = Math.max(0, Math.min(next.sequence.length - 1, from + delta))
  if (to === from) return next
  const [item] = next.sequence.splice(from, 1)
  if (item === undefined) return next
  next.sequence.splice(to, 0, item)
  return next
}

/** Move a top-level row to an absolute index (drag-and-drop drop position). */
export function moveRowTo(profile: ProfileConfig, itemId: string, index: number): ProfileConfig {
  const next = base(profile)
  const from = indexOfItem(next.sequence, itemId)
  if (from < 0) return next
  const [item] = next.sequence.splice(from, 1)
  if (item === undefined) return next
  const to = Math.max(0, Math.min(next.sequence.length, index))
  next.sequence.splice(to, 0, item)
  return next
}

/**
 * Collect `panelIds` into a new group placed at the position of the topmost
 * member (README §2.6), or at `index` when given.
 */
export function createGroup(
  profile: ProfileConfig,
  groupId: string,
  panelIds: readonly string[],
  options: { label?: string; icon?: IconRef } = {},
): ProfileConfig {
  if (panelIds.length === 0) return base(profile)
  const next = base(profile)
  /**
   * The insertion point is remembered as the **identity of the row just above
   * the topmost member**, never as an index: removing the members can shrink
   * the sequence to the left of that index (taking the last member out of a
   * group dissolves it), and an index taken before the removals would then
   * point one row too far down.
   *
   * "Topmost member" is the first sequence ITEM that contains any of the
   * members — a member that currently lives inside another group counts too,
   * which an id-only scan would miss.
   */
  const topmost = next.sequence.findIndex(item => (isEntryItem(item)
    ? panelIds.includes(item.id)
    : item.members.some(member => panelIds.includes(member))))
  const anchor = topmost > 0 ? next.sequence[topmost - 1]?.id ?? null : null
  let items = sequenceOf(next)
  for (const panelId of panelIds) items = withoutPanel(items, panelId)
  const group: GroupItem = { type: 'group', id: groupId, members: [...panelIds] }
  if (options.label !== undefined && options.label.trim().length > 0) group.label = options.label.trim()
  if (options.icon !== undefined && options.icon.kind !== 'original') group.icon = { ...options.icon }
  let insertAt = 0
  if (anchor !== null) {
    const anchorIndex = indexOfItem(items, anchor)
    // A vanished anchor is unreachable today (an anchor is never a member of the
    // new group, and a group only dissolves when it loses its last member), but
    // staying total keeps the operator safe to reuse.
    insertAt = anchorIndex < 0 ? items.length : anchorIndex + 1
  }
  items.splice(Math.max(0, Math.min(items.length, insertAt)), 0, group)
  next.sequence = items
  return next
}

/** Break a group apart: its members become bare rows where the group was. */
export function dissolveGroup(profile: ProfileConfig, groupId: string): ProfileConfig {
  const next = base(profile)
  const index = indexOfItem(next.sequence, groupId)
  if (index < 0) return next
  const item = next.sequence[index]
  if (item === undefined || !isGroupItem(item)) return next
  const replacements: SequenceItem[] = item.members.map(member => ({ type: 'entry', id: member }))
  next.sequence.splice(index, 1, ...replacements)
  return next
}

/** Add a panel to a group (removing it from wherever it was), at `index` inside the group. */
export function addToGroup(
  profile: ProfileConfig,
  groupId: string,
  panelId: string,
  index?: number,
): ProfileConfig {
  const next = base(profile)
  let items = withoutPanel(sequenceOf(next), panelId)
  const target = items.find(item => isGroupItem(item) && item.id === groupId)
  if (target === undefined || !isGroupItem(target)) return next
  const at = index === undefined ? target.members.length : Math.max(0, Math.min(target.members.length, index))
  target.members.splice(at, 0, panelId)
  next.sequence = items
  return next
}

/** Take a panel out of its group; the panel becomes a bare row right after the group. */
export function removeFromGroup(profile: ProfileConfig, groupId: string, panelId: string): ProfileConfig {
  const next = base(profile)
  const items = sequenceOf(next)
  const index = items.findIndex(item => isGroupItem(item) && item.id === groupId)
  const group = items[index]
  if (index < 0 || group === undefined || !isGroupItem(group)) return next
  if (!group.members.includes(panelId)) return next
  group.members = group.members.filter(member => member !== panelId)
  if (group.members.length === 0) items.splice(index, 1, { type: 'entry', id: panelId })
  else items.splice(index + 1, 0, { type: 'entry', id: panelId })
  next.sequence = items
  return next
}

/** Reorder a panel inside its group. */
export function moveMember(profile: ProfileConfig, groupId: string, panelId: string, delta: number): ProfileConfig {
  const next = base(profile)
  const group = next.sequence.find(item => isGroupItem(item) && item.id === groupId)
  if (group === undefined || !isGroupItem(group)) return next
  const from = group.members.indexOf(panelId)
  if (from < 0) return next
  const to = Math.max(0, Math.min(group.members.length - 1, from + delta))
  if (to === from) return next
  const [member] = group.members.splice(from, 1)
  if (member === undefined) return next
  group.members.splice(to, 0, member)
  return next
}

/** Move a panel to an absolute index inside its group. */
export function moveMemberTo(profile: ProfileConfig, groupId: string, panelId: string, index: number): ProfileConfig {
  const next = base(profile)
  const group = next.sequence.find(item => isGroupItem(item) && item.id === groupId)
  if (group === undefined || !isGroupItem(group)) return next
  const from = group.members.indexOf(panelId)
  if (from < 0) return next
  const [member] = group.members.splice(from, 1)
  if (member === undefined) return next
  group.members.splice(Math.max(0, Math.min(group.members.length, index)), 0, member)
  return next
}

/**
 * Drop every configured id that has no registration. The one destructive
 * action in this module, so the settings page asks for confirmation first.
 */
export function cleanOrphans(profile: ProfileConfig, registeredIds: Iterable<string>): ProfileConfig {
  const live = new Set(registeredIds)
  const next = base(profile)
  const kept: SequenceItem[] = []
  for (const item of next.sequence) {
    if (isEntryItem(item)) {
      if (live.has(item.id)) kept.push(item)
      continue
    }
    const members = item.members.filter(member => live.has(member))
    if (members.length > 0) kept.push({ ...item, members })
  }
  next.sequence = kept
  for (const id of Object.keys(next.entries)) if (!live.has(id)) delete next.entries[id]
  return next
}
