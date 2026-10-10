/**
 * Frozen seams between the client units.
 *
 * Three units are implemented side by side (`icons/`, `groups/`,
 * `settings/`) and one owns the rail (`registry/`). They never import each
 * other's internals — each one is handed exactly the collaborating surface
 * declared here, so a unit can be replaced or tested alone.
 *
 * Type-only module: nothing here runs.
 */
import type { ReactNode } from 'react'
import type { BuiltinIconName, IconRef } from '../shared/config.ts'
import type { Plan, RegisteredPanel } from '../shared/model.ts'
import type { HealthReport } from '../shared/protocol.ts'
import type { ClientContext } from './ctx.ts'
import type { PanellistStore, StoreSnapshot } from './config/store.ts'
import type { Translator } from './i18n/index.ts'
import type { StyleRegistry } from './styles.ts'

/* ------------------------------------------------------------------ glyphs */

/** Props every rail glyph honours (the two the sidebar passes). */
export interface GlyphProps {
  size: number
  active?: boolean
  [extra: string]: unknown
}

/** A glyph component as the rail and the flyout render it. */
export type GlyphComponent = (props: GlyphProps) => ReactNode

/** Everything needed to render one effective icon. */
export interface GlyphRequest {
  /** Effective override; `null` renders the native component (or the fallback glyph). */
  icon: IconRef | null
  /** The contributor's own glyph component, when known. */
  native?: GlyphComponent | null
  /** Requested square edge in px. */
  size: number
  /** Whether the row owns the current selection. */
  active?: boolean
}

/**
 * Why the allow-list refused an icon, as a closed set the UI can translate.
 * The `reason` string stays for logs and for a developer reading the page's
 * tooltip; the code is what a localized message is chosen from.
 */
export type SanitizeFailure =
  | 'size'
  | 'malformed'
  | 'forbidden'
  | 'reference'

/** Result of the SVG allow-list pass. */
export type SanitizeResult =
  | { ok: true; svg: string }
  | { ok: false; reason: string; code?: SanitizeFailure }

/** What `client/icons/index.tsx` must export (enforced by the type import below). */
export interface IconModule {
  /** Render one effective glyph. */
  Glyph: (props: GlyphRequest) => ReactNode
  /** One built-in glyph by name. */
  BuiltinGlyph: (props: { name: BuiltinIconName; size: number }) => ReactNode
  /** Allow-list pass over pasted SVG source. */
  sanitizeSvg: (source: string) => SanitizeResult
  /** A `data:` URI of one built-in glyph, for CSS masks (settings nav icon). */
  glyphDataUri: (name: BuiltinIconName) => string
}

/* ------------------------------------------------------------------- rail */

/** One row this plugin contributes to the sidebar (a group row). */
export interface RailRowRegistration {
  /** Rail id and `main` key: `dsh-panellist:<groupId>`. */
  railId: string
  /** Rail order (already computed by the plan). */
  order: number
  /** Row text, resolved at read time so a locale switch needs no re-registration. */
  label: () => string
  /** Glyph component rendered inside the row button. */
  glyph: GlyphComponent
  /** Attributes the glyph stamps on its own row button (aria-haspopup etc.). */
  rowAttributes?: Readonly<Record<string, string>>
}

/** The rail surface the groups unit is allowed to use. */
export interface RailHost {
  /** Native glyph of a registered panel, for a group's default icon. */
  nativeGlyph(panelId: string): GlyphComponent | null
  /** Whether a panel's page exists in `main` (so selection cannot throw). */
  hasPage(panelId: string): boolean
  /** Select a panel behind the layout's own `main` probe. */
  selectPanel(panelId: string): void
  /** Register one rail row plus its `main` page; returns a disposer. */
  registerRow(registration: RailRowRegistration, page: () => ReactNode): () => void
  /** Active panel id, or an empty string. */
  activePanelId(): string
  /** Observe active-panel changes. */
  subscribeActive(listener: () => void): () => void
}

/* ------------------------------------------------------------- self-check */

/** One of the four startup probes (README §5). */
export interface ProbeResult {
  id: 'registry' | 'rail' | 'active' | 'settingsNav'
  ok: boolean
  /** Raw measurement detail, shown verbatim in the settings page. */
  detail?: string
}

/** Aggregate self-check state. */
export interface SelfCheckState {
  results: readonly ProbeResult[]
  /** Any failure at all: the settings page shows the degraded banner. */
  degraded: boolean
  /** Probe 1 failed: no rewriting happens at all. */
  readOnly: boolean
  /** Probe 2 failed: hiding is off. */
  hidingDisabled: boolean
  /** Probe 3 failed: "hidden but active stays visible" is off. */
  activeRuleDisabled: boolean
  /** Probe 4 failed: the settings tab keeps the default gear. */
  settingsIconDisabled: boolean
  /** DSH version as measured, or an empty string. */
  version: string
  /** ISO timestamp of the last run. */
  checkedAt: string
}

export interface SelfCheckController {
  getState(): SelfCheckState
  subscribe(listener: () => void): () => void
  /** Re-run every probe (the "Re-run self-check" button). */
  rerun(): Promise<void>
}

/* --------------------------------------------------------------- settings */

/** Everything the settings page is handed. */
export interface SettingsUnitDeps {
  ctx: ClientContext
  store: PanellistStore
  /** Current plan (recomputed by the controller on every change). */
  plan: () => Plan
  /** Native rail registrations, as the discovery pass sees them. */
  registered: () => readonly RegisteredPanel[]
  /** Latest store snapshot. */
  snapshot: () => StoreSnapshot
  /**
   * Subscribe to controller changes (plan/registry/store). Returns the
   * unsubscribe handle: the settings page mounts and unmounts with the dialog,
   * so every subscription it opens must be closable.
   */
  subscribe: (listener: () => void) => () => void
  selfCheck: SelfCheckController
  translate: Translator
  glyph: (request: GlyphRequest) => ReactNode
  /**
   * The contributor's own glyph component for a panel, or `null` when the rail
   * cannot offer one. The page must pass this alongside an `original`/absent
   * icon override, otherwise an unconfigured panel would be previewed with the
   * generic fallback instead of the icon the user actually sees on the rail.
   */
  nativeGlyph: (panelId: string) => GlyphComponent | null
  builtinNames: readonly BuiltinIconName[]
  sanitizeSvg: (source: string) => SanitizeResult
  /** Host-reported storage health, for the diagnostics block. */
  health: () => HealthReport | null
  /** Aggregated plugin stylesheet: register the page's CSS chunk once. */
  styles: StyleRegistry
}

/** The settings unit's lifecycle handle. */
export interface SettingsUnit {
  dispose(): void
}

/* ----------------------------------------------------------------- groups */

/** Everything the groups unit is handed. */
export interface GroupUnitDeps {
  ctx: ClientContext
  /** Rail actions (registration, selection, active tracking). */
  rail: RailHost
  /** Current plan: the source of truth for which rows exist. */
  plan: () => Plan
  translate: Translator
  glyph: (request: GlyphRequest) => ReactNode
  /** Watch plan changes so rows can be re-registered. Returns the unsubscribe handle. */
  subscribe: (listener: () => void) => () => void
  /** Aggregated plugin stylesheet: register the flyout's CSS chunk once. */
  styles: StyleRegistry
}

/** The group unit's lifecycle handle. */
export interface GroupUnit {
  /** Reconcile the registered group rows with the current plan. */
  sync(): void
  dispose(): void
}
