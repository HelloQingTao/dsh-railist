/**
 * The configuration document: shape, defaults and small structural helpers.
 *
 * This module is imported by BOTH halves (node plugin and browser client) and
 * therefore must stay free of side effects and of any value import from
 * outside `src/shared/`.
 *
 * The normative shape is `docs/schema/config.schema.json`; this file is its typed
 * mirror. The host half validates with the schema (ajv); the browser half
 * normalises leniently through `./validate.ts`.
 */

/** Bumped whenever the stored shape changes; see `./migrate.ts`. */
export const SCHEMA_VERSION = 2 as const

/**
 * Names in the icon set bundled with this plugin (see `client/icons/builtin`).
 * The runtime list is the source of truth for both the type and validation;
 * the icon module is asserted against it at build time.
 */
export const BUILTIN_ICON_NAMES = [
  'grid',
  'puzzle',
  'sparkles',
  'clock',
  'memory',
  'terminal',
  'plug',
  'star',
  'folder',
  'book',
  'code',
  'gear',
  'chart',
  'list',
  'bell',
  'bolt',
  'shield',
  'globe',
  'database',
  'box',
  'wrench',
  'layers',
  'compass',
  'more',
] as const

export type BuiltinIconName = (typeof BUILTIN_ICON_NAMES)[number]

/** Longest accepted override name, in UTF-16 code units (schema: 64). */
export const MAX_LABEL_LENGTH = 64

/** Longest accepted panel id (schema: 200). */
export const MAX_PANEL_ID_LENGTH = 200

/** Custom-SVG size window (schema: 16 .. 65536). */
export const MIN_SVG_LENGTH = 16
export const MAX_SVG_LENGTH = 65536

/** Where a row's glyph comes from. */
export type IconRef =
  | { kind: 'original' }
  | { kind: 'builtin'; name: BuiltinIconName }
  | { kind: 'custom'; svg: string }

/** Per-panel display overrides. Absent keys mean "no opinion". */
export interface EntryOverride {
  /** Display-name override: rail row text, collapsed tooltip, accessible name. */
  label?: string
  icon?: IconRef
  hidden?: boolean
}

/** One panel placed in the rail sequence. */
export interface EntryItem {
  type: 'entry'
  id: string
}

/**
 * One group: a single rail row that opens a flyout of its members.
 * `members` is ordered and holds panel ids (never another group).
 */
export interface GroupItem {
  type: 'group'
  /** Group identity, namespaced by the `group:` prefix (see {@link groupRailId}). */
  id: string
  /** Trigger name; defaults to the first live member's effective name. */
  label?: string
  /** Trigger glyph; defaults to the first live member's effective glyph. */
  icon?: IconRef
  /** Hides the trigger row itself (a hidden active group still shows, as panels do). */
  hidden?: boolean
  /** Ordered panel ids. A member may not be another group. */
  members: string[]
}

export type SequenceItem = EntryItem | GroupItem

/** One profile's section of the document. */
export interface ProfileConfig {
  /**
   * Partially authoritative: listed items appear in this order; every other
   * registered panel is appended after them in its own native order. An empty
   * sequence means "no order is written at all" (see `./model.ts`).
   */
  sequence: SequenceItem[]
  /** Display overrides keyed by panel id. Keys with no registration are orphans. */
  entries: Record<string, EntryOverride>
  meta?: {
    updatedAt?: string
  }
}

/** The whole document: one section per DSH profile. */
export interface PanellistConfig {
  schemaVersion: typeof SCHEMA_VERSION
  profiles: Record<string, ProfileConfig>
}

/** Prefix every group id carries, in config and in the rail. */
export const GROUP_ID_PREFIX = 'group:'

/** Rail ids this plugin registers stay in its own namespace, so a group row can
 *  never collide with a panel id contributed by another plugin. */
export const RAIL_ID_PREFIX = 'dsh-panellist:'

/** The rail id (and `main` key) of one group row. */
export function groupRailId(groupId: string): string {
  return `${RAIL_ID_PREFIX}${groupId}`
}

/**
 * Whether a rail id lives in this plugin's namespace — a group row, or the
 * throwaway row the sync nudge registers. Everything in that namespace belongs
 * to this plugin and is never mistaken for a panel contributed by someone else.
 */
export function isOwnRailId(railId: string): boolean {
  return railId.startsWith(RAIL_ID_PREFIX)
}

/** A fresh, valid group id that does not collide with `taken`. */
export function mintGroupId(taken: Iterable<string>): string {
  const used = new Set(taken)
  for (let index = 1; index < 1000; index += 1) {
    const id = `${GROUP_ID_PREFIX}g${index}`
    if (!used.has(id)) return id
  }
  // Unreachable in practice; keeps the return type total.
  return `${GROUP_ID_PREFIX}${Date.now().toString(36)}`
}

/** Whether a sequence item is a group. */
export function isGroupItem(item: SequenceItem): item is GroupItem {
  return item.type === 'group'
}

/** Whether a sequence item is a single panel. */
export function isEntryItem(item: SequenceItem): item is EntryItem {
  return item.type === 'entry'
}

/** An empty profile section. */
export function emptyProfileConfig(): ProfileConfig {
  return { sequence: [], entries: {} }
}

/** An empty document holding no profile sections. */
export function emptyConfig(): PanellistConfig {
  return { schemaVersion: SCHEMA_VERSION, profiles: {} }
}

/** A structured clone of one profile section (never shares arrays with the input). */
export function cloneProfileConfig(profile: ProfileConfig): ProfileConfig {
  return {
    sequence: profile.sequence.map(item => (isGroupItem(item)
      ? { ...item, members: [...item.members], ...(item.icon === undefined ? {} : { icon: { ...item.icon } }) }
      : { ...item })),
    entries: Object.fromEntries(
      Object.entries(profile.entries).map(([id, override]) => [id, {
        ...override,
        ...(override.icon === undefined ? {} : { icon: { ...override.icon } }),
      }]),
    ),
    ...(profile.meta === undefined ? {} : { meta: { ...profile.meta } }),
  }
}
