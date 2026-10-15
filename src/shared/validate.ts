/**
 * Lenient structural normalisation of the configuration document.
 *
 * The host half owns the *authoritative* check (ajv against
 * `docs/schema/config.schema.json`, mirroring that file exactly — see
 * `plugin/store.ts`). This module exists for the browser half and for tests:
 * it never throws, drops what it cannot understand, and reports whether it
 * repaired anything, so a hand-edited file degrades to "the parts I could read"
 * instead of breaking the rail.
 */
import {
  BUILTIN_ICON_NAMES,
  MAX_LABEL_LENGTH,
  MAX_PANEL_ID_LENGTH,
  MAX_SVG_LENGTH,
  MIN_SVG_LENGTH,
  SCHEMA_VERSION,
  emptyConfig,
  isManagedSeat,
  type BuiltinIconName,
  type Container,
  type EntryItem,
  type EntryOverride,
  type GroupItem,
  type IconRef,
  type RailistConfig,
  type ProfileConfig,
  type SequenceItem,
} from './config.ts'

/** Outcome of a lenient read. */
export type NormalizeResult =
  | { ok: true; config: RailistConfig; repaired: boolean }
  | { ok: false; errors: string[] }

const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const GROUP_ID_RE = /^group:[A-Za-z0-9_-]{1,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asPanelId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (id.length === 0 || id.length > MAX_PANEL_ID_LENGTH) return null
  return id
}

function asLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const label = value.trim()
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return undefined
  return label
}

/** Validate one icon reference; `null` means "not understood, drop it". */
function asIconRef(value: unknown): IconRef | null {
  if (!isRecord(value)) return null
  if (value['kind'] === 'original') return { kind: 'original' }
  if (value['kind'] === 'builtin') {
    const name = value['name']
    if (typeof name !== 'string') return null
    return (BUILTIN_ICON_NAMES as readonly string[]).includes(name)
      ? { kind: 'builtin', name: name as BuiltinIconName }
      : null
  }
  if (value['kind'] === 'custom') {
    const svg = value['svg']
    if (typeof svg !== 'string' || svg.length < MIN_SVG_LENGTH || svg.length > MAX_SVG_LENGTH) return null
    return { kind: 'custom', svg }
  }
  return null
}

/** Validate one per-panel override; unknown keys are dropped. */
function asEntryOverride(value: unknown): EntryOverride | null {
  if (!isRecord(value)) return null
  const override: EntryOverride = {}
  const label = asLabel(value['label'])
  if (label !== undefined) override.label = label
  const icon = asIconRef(value['icon'])
  if (icon !== null) override.icon = icon
  if (value['hidden'] === true) override.hidden = true
  else if (value['hidden'] !== undefined && value['hidden'] !== false) return null
  // An override that carries no opinion at all is not worth keeping: it would
  // only make the config look configured when nothing was chosen.
  if (override.label === undefined && override.icon === undefined && override.hidden !== true) return null
  return override
}

/**
 * Normalise one profile section. Always returns a usable section; `repaired`
 * reports whether anything was dropped or clamped.
 */
function normalizeProfileConfig(value: unknown): { profile: ProfileConfig; repaired: boolean } {
  const profile: ProfileConfig = { sequence: [], entries: {} }
  let repaired = false
  if (!isRecord(value)) return { profile, repaired: value !== undefined }

  const rawSequence = value['sequence']
  if (Array.isArray(rawSequence)) {
    const seen = new Set<string>()
    for (const raw of rawSequence) {
      const item = normalizeSequenceItem(raw, seen)
      if (item === null) {
        repaired = true
        continue
      }
      if (item.type === 'entry') seen.add(item.id)
      else for (const member of item.members) seen.add(member)
      profile.sequence.push(item)
    }
  } else if (rawSequence !== undefined) {
    repaired = true
  }

  const rawEntries = value['entries']
  if (isRecord(rawEntries)) {
    for (const [rawId, rawOverride] of Object.entries(rawEntries)) {
      const id = asPanelId(rawId)
      const override = id === null ? null : asEntryOverride(rawOverride)
      if (id === null || override === null) {
        repaired = true
        continue
      }
      profile.entries[id] = override
    }
  } else if (rawEntries !== undefined) {
    repaired = true
  }

  const meta = value['meta']
  if (isRecord(meta)) {
    const updatedAt = meta['updatedAt']
    if (typeof updatedAt === 'string') profile.meta = { updatedAt }
  }

  return { profile, repaired }
}

function normalizeSequenceItem(raw: unknown, seen: Set<string>): SequenceItem | null {
  if (!isRecord(raw)) return null
  if (raw['type'] === 'entry') {
    const id = asPanelId(raw['id'])
    if (id === null || seen.has(id)) return null
    const item: EntryItem = { type: 'entry', id }
    // A seat is only ever written by a cross-seat drag, so it is one of the
    // seats this plugin manages. Anything else — a retired seat name, a typo,
    // a value from a newer version — is dropped rather than rejected, and the
    // row falls back to its contributor's own seat (the pre-seat behaviour).
    if (isManagedSeat(raw['seat'])) item.seat = raw['seat']
    return item
  }
  if (raw['type'] === 'group') {
    const id = typeof raw['id'] === 'string' && GROUP_ID_RE.test(raw['id']) ? raw['id'] : null
    if (id === null) return null
    const rawMembers = raw['members']
    if (!Array.isArray(rawMembers)) return null
    const members: string[] = []
    for (const rawMember of rawMembers) {
      const member = asPanelId(rawMember)
      if (member === null || members.includes(member) || seen.has(member)) continue
      members.push(member)
    }
    if (members.length === 0) return null
    const group: GroupItem = { type: 'group', id, members }
    const label = asLabel(raw['label'])
    if (label !== undefined) group.label = label
    const icon = asIconRef(raw['icon'])
    if (icon !== null) group.icon = icon
    if (raw['hidden'] === true) group.hidden = true
    // Member seats recorded when the group was built (see `GroupItem.seats`):
    // kept only where they name a managed seat, mirroring how an entry's own
    // `seat` is kept above; anything else is dropped rather than rejected.
    const rawSeats = raw['seats']
    if (isRecord(rawSeats)) {
      const seats: Record<string, Container> = {}
      for (const [member, seat] of Object.entries(rawSeats)) {
        if (isManagedSeat(seat)) seats[member] = seat
      }
      if (Object.keys(seats).length > 0) group.seats = seats
    }
    return group
  }
  return null
}

/**
 * Normalise a whole document. A document that is not an object at all, or that
 * declares a *newer* schema version, is rejected outright (`ok: false`) — the
 * caller then backs the file up and serves defaults rather than guessing.
 */
export function normalizeConfigDocument(value: unknown): NormalizeResult {
  if (!isRecord(value)) return { ok: false, errors: ['document is not an object'] }
  const rawVersion = value['schemaVersion']
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
    return { ok: false, errors: ['schemaVersion is missing or not an integer'] }
  }
  if (rawVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`schemaVersion ${rawVersion} is newer than this plugin understands (${SCHEMA_VERSION})`] }
  }
  const config = emptyConfig()
  let repaired = rawVersion !== SCHEMA_VERSION
  const rawProfiles = value['profiles']
  if (rawProfiles !== undefined && !isRecord(rawProfiles)) {
    return { ok: false, errors: ['profiles is not an object'] }
  }
  for (const [id, rawProfile] of Object.entries(rawProfiles ?? {})) {
    if (!PROFILE_ID_RE.test(id)) {
      repaired = true
      continue
    }
    const normalized = normalizeProfileConfig(rawProfile)
    if (normalized.repaired) repaired = true
    config.profiles[id] = normalized.profile
  }
  return { ok: true, config, repaired }
}
