/**
 * `schemaVersion` migration, applied on every read before normalisation.
 *
 * Version 1 is the first shipped shape, so the step table is empty; the frame
 * exists so a v2 is a one-entry addition plus a normaliser branch. Each step
 * runs on the RAW parsed JSON (not on a normalised document), because the
 * older shape is by definition not the current shape.
 */
import { SCHEMA_VERSION, type PanellistConfig } from './config.ts'
import { normalizeConfigDocument } from './validate.ts'

/** One version step: rewrites the raw document from `from` to `from + 1`. */
export interface MigrationStep {
  /** Source version this step consumes. */
  from: number
  /** Human-readable description, surfaced in the health report. */
  summary: string
  /** Rewrites the raw document in place. Must not throw on malformed input. */
  apply(document: Record<string, unknown>): void
}

/** Ordered steps. Empty for v1 — the frame is the deliverable. */
export const MIGRATION_STEPS: readonly MigrationStep[] = []

/** Outcome of a raw read. */
export type MigrationResult =
  | { ok: true; config: PanellistConfig; from: number; migrated: boolean; applied: string[] }
  | { ok: false; errors: string[] }

/**
 * Migrate and normalise a raw parsed document.
 * @param value - the JSON parsed from disk (unknown shape by definition).
 * @returns the current-shape document, or the reasons it cannot be read.
 */
export function migrateConfigDocument(value: unknown): MigrationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['document is not an object'] }
  }
  const document = { ...(value as Record<string, unknown>) }
  const rawVersion = document['schemaVersion']
  const from = typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : SCHEMA_VERSION
  if (from > SCHEMA_VERSION) {
    return { ok: false, errors: [`schemaVersion ${from} is newer than this plugin understands (${SCHEMA_VERSION})`] }
  }
  const applied: string[] = []
  for (let version = from; version < SCHEMA_VERSION; version += 1) {
    const step = MIGRATION_STEPS.find(candidate => candidate.from === version)
    if (step === undefined) {
      return { ok: false, errors: [`no migration step from schemaVersion ${version}`] }
    }
    step.apply(document)
    applied.push(step.summary)
  }
  document['schemaVersion'] = SCHEMA_VERSION
  const normalized = normalizeConfigDocument(document)
  if (!normalized.ok) return { ok: false, errors: normalized.errors }
  return { ok: true, config: normalized.config, from, migrated: applied.length > 0, applied }
}
