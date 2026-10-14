/**
 * Which plugin contributed each panel — decoration for the settings list.
 *
 * The rail renderer stamps a `registrant` on every panel it registers, but the
 * value is `null` for the panels this page actually lists, so the answer has to
 * come from the profile's own files instead. Three of them carry it, and all
 * three are needed — the profile's own patch layer is *not* where the rail's
 * rows come from:
 *
 * 1. `<profile>/node_modules/<pkg>/cordis.patch.yml` — each installed bundle
 *    ships its own patch layer, and *that* is the one that names the id the
 *    package mounts under. This is where `dsh-power-xc` and `capability-panel`
 *    — the rows actually on this machine's rail — are declared. The list of
 *    installed bundles is `package.json`'s `dsh.profile.bundles`.
 * 2. `<profile>/cordis.patch.yml` — the profile's own patch layer, for bundles
 *    mounted by insert without shipping a patch of their own.
 * 3. `<profile>/package.json` — the dependency manifest, which is where the
 *    version of a package lives.
 *
 * **Nothing here may fail the request.** This is a label next to a row, not a
 * feature: a missing file, malformed YAML, an absent `dependencies` object or a
 * version that is not a release all degrade to "no label for that row", because
 * a settings page that refuses to open is far worse than a settings page whose
 * rows have no subtitle. Every failure path therefore returns a value rather
 * than throwing.
 * @module
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { PluginInfo, PluginsResponse } from '../shared/protocol.ts'

/** Per-profile directory under the harness home (mirrors `./store.ts`). */
const PROFILES_DIR_NAME = 'profiles'

/** The loader patch layer inside a profile, and inside every installed bundle. */
const PATCH_FILE_NAME = 'cordis.patch.yml'

/** The profile's dependency manifest. */
const MANIFEST_FILE_NAME = 'package.json'

/** Where a profile's installed bundles live. */
const BUNDLE_DIR_NAME = 'node_modules'

/**
 * One package name per path segment: `@scope/name` stays two segments, and
 * nothing that could climb out of `node_modules` is allowed through. A name
 * holding `..`, a leading `.` or a backslash is dropped rather than joined.
 */
const PACKAGE_NAME_RE = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Mirrors `profiles.propertyNames` in the schema; also keeps a crafted id out of the path join. */
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Longest package name / version rendered; anything past it is truncated, never shown raw. */
const MAX_TEXT_LENGTH = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A display-safe string: a non-blank, trimmed, length-capped string, or `undefined`. */
function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed
}

/**
 * Turn one recorded dependency value into something worth showing.
 *
 * The profile's `package.json` holds more than release ranges. This machine's
 * own profile is the proof: `dsh-power-xc` records `^0.1.6` while
 * `@chengdb/capability-panel` records a
 * `https://codeload.github.com/<owner>/<repo>/tar.gz/<sha>` tarball URL. A
 * range is shown without its leading operator — it is a constraint the user did
 * not choose to read — and a tarball URL collapses to its commit, because the
 * sha is the only part that identifies a build.
 * @param raw - the value as `package.json` stores it.
 * @returns the printable version, or `undefined` when nothing readable is left.
 */
export function normalizeVersion(raw: unknown): string | undefined {
  const value = text(raw)
  if (value === undefined) return undefined

  // A tarball URL, with or without an explicit `#<sha>` fragment.
  const tarball = /^https?:\/\/\S*?\/tar\.gz\/([0-9a-f]{7,40})\S*$/i.exec(value)
  if (tarball?.[1] !== undefined) return tarball[1].slice(0, 7)

  const hash = /#([0-9a-f]{7,40})$/i.exec(value)
  if (hash?.[1] !== undefined) return hash[1].slice(0, 7)

  // A git dependency (`git+https://…#v1.2.3`, `github:owner/repo`) names no
  // release of its own; the URL is noise next to a row label.
  if (/^(git\+|git:|github:|https?:)/i.test(value)) return undefined

  // A workspace/link/file dependency is a path into this machine, not a version
  // anyone can compare against a release. It has to be rejected before the
  // dist-tag fallback below, which would otherwise keep it as a bare label.
  if (/^(workspace:|link:|file:|portal:|npm:)/i.test(value)) return undefined

  // A plain range or exact version: drop the operator, keep the numbers. A
  // workspace/link dependency is a local path and is not a version.
  const version = /^[\^~=v\s]*([0-9][0-9A-Za-z.+-]*)$/.exec(value)
  if (version?.[1] !== undefined) return version[1]

  // A dist-tag or anything else short enough to be a label.
  return value
}

/**
 * Panel id → package name, from the loader patch layer.
 *
 * Only `insert` entries name a package and its id together; the `- id:` form
 * (an override of an already-composed entry) names no package, so it is skipped
 * — the insert that composed it is the one that knows the package.
 *
 * Parsing is silent on purpose. Bundle patches are allowed to carry the
 * loader's `!!js` tag for dynamic expressions, which this parser does not
 * register a handler for; the default logger would print an "Unresolved tag"
 * warning for each one straight into the host log, on every settings page
 * open, from a route whose entire job is a subtitle. The tag's content is an
 * expression string and never the `insert` shape read below, so ignoring it
 * silently is both correct and what the reader wants.
 * @param source - the raw YAML text.
 * @returns the mapping, empty when the layer holds none or cannot be read.
 */
export function parsePatchNames(source: string): Map<string, string> {
  const names = new Map<string, string>()
  let parsed: unknown
  try {
    parsed = parseYaml(source, { logLevel: 'silent' })
  } catch {
    // Malformed YAML is "this profile declares no insert ids".
    return names
  }
  if (!Array.isArray(parsed)) return names
  for (const entry of parsed) {
    if (!isRecord(entry)) continue
    const inserts = entry['insert']
    if (!Array.isArray(inserts)) continue
    for (const insert of inserts) {
      if (!isRecord(insert)) continue
      const id = text(insert['id'])
      const name = text(insert['name'])
      if (id === undefined || name === undefined) continue
      // First writer wins: an id declared twice keeps the entry that loads
      // first, which is the one the later patch entry would be overriding.
      if (!names.has(id)) names.set(id, name)
    }
  }
  return names
}

/**
 * The `dependencies` object of a profile manifest.
 * @param source - the raw JSON text.
 * @returns the mapping, empty when the manifest has none or cannot be read.
 */
export function parseManifestVersions(source: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const dependencies = parsed['dependencies']
  if (!isRecord(dependencies)) return {}
  const versions: Record<string, string> = {}
  for (const [name, value] of Object.entries(dependencies)) {
    const version = normalizeVersion(value)
    if (version !== undefined) versions[name] = version
  }
  return versions
}

/** One profile directory: the files whose union answers this route. */
function profileDir(home: string, profileId: string): string | null {
  if (!PROFILE_ID_RE.test(profileId)) return null
  return join(home, PROFILES_DIR_NAME, profileId)
}

/**
 * The bundle names a profile manifest declares.
 *
 * `dsh.profile.bundles` is the loader's own list of the packages it mounts, so
 * it is also the list of packages whose patch layers are worth reading. Names
 * that are not a plain package name are dropped here, before any path join.
 * @param source - the raw JSON text.
 * @returns the names, empty when the manifest has none or cannot be read.
 */
export function parseBundleNames(source: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    return []
  }
  if (!isRecord(parsed)) return []
  const dsh = parsed['dsh']
  if (!isRecord(dsh)) return []
  const profile = dsh['profile']
  if (!isRecord(profile)) return []
  const bundles = profile['bundles']
  if (!Array.isArray(bundles)) return []
  const names: string[] = []
  for (const bundle of bundles) {
    const name = text(bundle)
    if (name === undefined) continue
    if (!PACKAGE_NAME_RE.test(name)) continue
    names.push(name)
  }
  return names
}

/**
 * Panel id → package name, from every installed bundle's own patch layer.
 *
 * A bundle that ships no patch, is not installed, or ships an unreadable one
 * contributes nothing; so does a patch whose YAML will not parse.
 * @param directory - the profile directory.
 * @param names - the bundle names to read, as the manifest declared them.
 * @returns the mapping, empty when no bundle contributes one.
 */
async function parseBundlePatches(
  directory: string,
  names: readonly string[],
): Promise<Map<string, string>> {
  const sources = await Promise.all(
    names.map(bundle =>
      readOptional(join(directory, BUNDLE_DIR_NAME, ...bundle.split('/'), PATCH_FILE_NAME)),
    ),
  )
  const merged = new Map<string, string>()
  for (const source of sources) {
    if (source === undefined) continue
    for (const [id, name] of parsePatchNames(source)) {
      if (!merged.has(id)) merged.set(id, name)
    }
  }
  return merged
}

/** Read a file, or `undefined` when it is absent or unreadable. */
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Resolve the contributor of every panel id this profile declares.
 *
 * Never throws: an unreadable file, an unparsable one and an empty one all
 * contribute nothing, and the union of "nothing" is an empty map.
 * @param home - the harness home.
 * @param profileId - profile whose files are read; an out-of-shape id yields an empty map.
 * @returns the response body this route answers with.
 */
export async function resolvePlugins(home: string, profileId: string): Promise<PluginsResponse> {
  const directory = profileDir(home, profileId)
  if (directory === null) return { plugins: {} }

  const [patchSource, manifestSource] = await Promise.all([
    readOptional(join(directory, PATCH_FILE_NAME)),
    readOptional(join(directory, MANIFEST_FILE_NAME)),
  ])
  if (patchSource === undefined && manifestSource === undefined) return { plugins: {} }

  const versions = manifestSource === undefined ? {} : parseManifestVersions(manifestSource)
  const bundles = manifestSource === undefined ? [] : parseBundleNames(manifestSource)

  // Profile patch first, bundle patches second: the profile's own layer is the
  // user's override, so when both name the same id the profile wins.
  const names = patchSource === undefined ? new Map<string, string>() : parsePatchNames(patchSource)
  for (const [id, name] of await parseBundlePatches(directory, bundles)) {
    if (!names.has(id)) names.set(id, name)
  }

  const plugins: Record<string, PluginInfo> = {}
  for (const [id, name] of names) {
    const version = versions[name]
    plugins[id] = { package: name, ...(version === undefined ? {} : { version }) }
  }
  return { plugins }
}
