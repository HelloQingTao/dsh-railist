/**
 * The contributor subtitle for a row in the settings list (README §3.1).
 *
 * The list is about what the user owns; which plugin *is* a row is reference
 * information they only need when something is wrong, which is exactly what a
 * quiet line of secondary text next to the title is for. So the rules here are
 * about restraint, not completeness:
 *
 * - A row with nothing known about it renders nothing at all — no dash, no
 *   "unknown", no empty span. The list must look the same as it did before this
 *   feature existed whenever the answer is missing.
 * - The package name is shown short. `@chengdb/capability-panel` is 26
 *   characters of which the scope is the least informative part, so the scope
 *   is dropped when the name still identifies the plugin; an unpublished name
 *   with no scope is left alone.
 * - The version is prefixed `v` and is simply absent when unknown.
 * @module
 */
import type { I18nKey } from '../i18n/index.ts'
import type { PluginInfo } from './pluginInfo.ts'

/** Longest package name rendered before it is middle-truncated, in characters. */
const MAX_NAME_LENGTH = 32

/** Longest version rendered; a longer value is not a version worth showing. */
const MAX_VERSION_LENGTH = 24

/**
 * The name to show for a package.
 *
 * A scoped name keeps its scope only when dropping it would be ambiguous; the
 * decision is made on length alone, because "which of these two is the real
 * one" is not a question a subtitle should make the reader ask.
 * @param packageName - the npm name as the profile records it.
 * @returns the short display name, or `undefined` when there is nothing to show.
 */
export function shortPackageName(packageName: string | undefined): string | undefined {
  if (packageName === undefined) return undefined
  const trimmed = packageName.trim()
  if (trimmed === '') return undefined

  // `@scope/name` → `name`; the scope is shared by every plugin from the same
  // author and is the part the eye skips. A bare `@scope` (no slash) has
  // nothing to drop and is left as-is.
  const slash = trimmed.indexOf('/')
  const bare = trimmed.startsWith('@') && slash > 0 ? trimmed.slice(slash + 1) : trimmed
  const chosen = bare.length === 0 ? trimmed : bare

  if (chosen.length <= MAX_NAME_LENGTH) return chosen
  // Middle-truncate: the head names the family and the tail distinguishes it,
  // so neither end may be the one that is cut.
  const head = chosen.slice(0, MAX_NAME_LENGTH - 12)
  const tail = chosen.slice(-10)
  return `${head}…${tail}`
}

/**
 * The version to show, without its `v`.
 * @param version - the value the host resolved, already operator-free.
 * @returns the display version, or `undefined` when there is nothing to show.
 */
export function shortVersion(version: string | undefined): string | undefined {
  if (version === undefined) return undefined
  const trimmed = version.trim()
  if (trimmed === '' || trimmed.length > MAX_VERSION_LENGTH) return undefined
  return trimmed
}

/** What the subtitle renders: the copy key and the parameters it is filled with. */
export interface SourceLabel {
  key: I18nKey
  params: Record<string, string>
}

/**
 * The subtitle for one row, or `null` when the row must render none.
 *
 * Returning `null` rather than an empty string is the point: the caller then
 * omits the element entirely, so the row's layout is identical to the one it
 * had before this plugin knew anything about contributors.
 * @param info - what the host reported for this panel, if anything.
 * @returns the key/params pair to render through `t`, or `null`.
 */
export function sourceLabel(info: PluginInfo | undefined): SourceLabel | null {
  if (info === undefined) return null
  const name = shortPackageName(info.package)
  const version = shortVersion(info.version)
  if (name === undefined) {
    // A version with no package name identifies nothing the user can act on:
    // "v1.2.3" next to a row is a riddle, not information.
    return null
  }
  return version === undefined
    ? { key: 'settings.sequence.sourceNoVersion', params: { name } }
    : { key: 'settings.sequence.source', params: { name, version } }
}
