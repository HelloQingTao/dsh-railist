/**
 * The host half's configuration store.
 *
 * One JSON document under `$DSH_HOME`, one section per DSH profile. It is the
 * only state this plugin owns on disk, so it is defensive in both directions:
 *
 * - **Read** never throws. A file that is missing, unparsable or
 *   schema-invalid yields the default document, and an unreadable original is
 *   copied aside as `panellist.json.corrupt-<timestamp>` rather than being
 *   overwritten or silently dropped (README §4.1).
 * - **Write** validates the *whole* document (with the caller's section
 *   replaced) against the normative schema before touching the disk, then
 *   writes a `0600` temp file next to the target and renames it, falling back
 *   to a direct write when Windows refuses the replace.
 *
 * `docs/config.schema.json` is the normative shape: ajv is the authority here,
 * while `src/shared/validate.ts` is the browser half's lenient mirror.
 * @module
 */
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import {
  SCHEMA_VERSION,
  emptyConfig,
  emptyProfileConfig,
  type PanellistConfig,
  type ProfileConfig,
} from '../shared/config.ts'
import { migrateConfigDocument } from '../shared/migrate.ts'
import type { HealthReport } from '../shared/protocol.ts'

/** File inside the harness home that holds the whole document. */
const CONFIG_FILE_NAME = 'panellist.json'

/** Per-profile directory under the harness home; an explicit `?profile=` is honoured only for one that exists. */
const PROFILES_DIR_NAME = 'profiles'

/**
 * Where the compiled schema may sit relative to this module: `src/plugin/`
 * when the source runs (tests, `tsc`), `lib/` after the build. First hit wins.
 */
const SCHEMA_CANDIDATES = ['../docs/config.schema.json', '../../docs/config.schema.json'] as const

/** Mirrors `profiles.propertyNames` in the schema; also keeps a crafted id out of the path join. */
const PROFILE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Constructor options; both default to the process environment. */
export interface StoreOptions {
  /** Harness home. Defaults to `$DSH_HOME`, else `<os.homedir()>/.dsh`. */
  home?: string
  /** Profile section this store reads and writes by default. */
  profileId?: string
}

/** A write was refused by the normative schema. */
export class InvalidConfigError extends Error {
  /** Field-level reasons, one per ajv error. */
  readonly details: string[]

  constructor(details: string[]) {
    super(details[0] ?? 'the configuration document is invalid')
    this.name = 'InvalidConfigError'
    this.details = details
  }
}

/** Cached compiled validator; compiling the schema is the expensive part. */
let validatorPromise: Promise<ValidateFunction> | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT'
}

/** The schema version a raw parsed document declares, if any. */
function rawSchemaVersion(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const version: unknown = value['schemaVersion']
  return typeof version === 'number' ? version : undefined
}

/** A short, stable fingerprint of the unreadable text, so one bad file is set aside once. */
function contentSignature(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${text.length}:${hash.toString(16)}`
}

/** One ajv error as a human-readable line. */
function describeError(error: ErrorObject): string {
  const at = error.instancePath === '' ? '/' : error.instancePath
  const extra = error.keyword === 'additionalProperties'
    ? ` (${String((error.params as { additionalProperty?: unknown }).additionalProperty)})`
    : ''
  return `${at} ${error.message ?? 'is invalid'}${extra}`
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(describeError)
}

/** Resolve the harness home: a non-blank explicit path, else a non-blank `$DSH_HOME`, else `~/.dsh`. */
export function resolveDshHome(configured?: string): string {
  const explicit = configured !== undefined && configured.trim().length > 0 ? configured : undefined
  const fromEnv = process.env['DSH_HOME']
  const chosen = explicit ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : undefined)
  return chosen === undefined ? join(homedir(), '.dsh') : resolve(chosen)
}

/** Resolve the default profile id: `$DSH_PROFILE`, else `default`. */
function resolveProfileId(): string {
  const fromEnv = process.env['DSH_PROFILE']
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : 'default'
}

/** Read the normative schema from whichever layout this module runs in. */
async function readSchema(): Promise<object> {
  for (const candidate of SCHEMA_CANDIDATES) {
    try {
      const raw = await readFile(new URL(candidate, import.meta.url), 'utf8')
      return JSON.parse(raw) as object
    } catch {
      // Try the next layout; the error below names both.
    }
  }
  throw new Error(
    `dsh-panellist: docs/config.schema.json not found next to ${import.meta.url} `
    + `(tried ${SCHEMA_CANDIDATES.join(', ')})`,
  )
}

async function compileValidator(): Promise<ValidateFunction> {
  const schema = await readSchema()
  // `strict: false`: the schema is data we ship, not user input to police, and
  // ajv's strict dialect opinions must not decide whether the plugin loads.
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  return ajv.compile(schema)
}

/** Compile the schema once per process, retrying after a failure. */
async function loadValidator(): Promise<ValidateFunction> {
  if (validatorPromise === undefined) {
    const pending = compileValidator()
    validatorPromise = pending
    try {
      return await pending
    } catch (error) {
      if (validatorPromise === pending) validatorPromise = undefined
      throw error
    }
  }
  return validatorPromise
}

/**
 * Replace one profile section inside a stored document, leaving every other
 * byte of it — root keys included — as it was.
 */
function withProfile(base: unknown, profileId: string, profile: ProfileConfig): PanellistConfig {
  const record = isRecord(base) ? base : {}
  const profiles = isRecord(record['profiles']) ? record['profiles'] : {}
  return {
    ...record,
    schemaVersion: SCHEMA_VERSION,
    profiles: { ...profiles, [profileId]: profile },
  } as unknown as PanellistConfig
}

/** The best-effort document inside `raw`: migration + normalisation, or defaults. */
function repairRaw(raw: string): PanellistConfig {
  try {
    const migrated = migrateConfigDocument(JSON.parse(raw))
    return migrated.ok ? migrated.config : emptyConfig()
  } catch {
    return emptyConfig()
  }
}

/** Health facts the store tracks between calls. */
interface StoreState {
  exists: boolean
  writable: boolean
  lastError: string | undefined
  corruption: { detected: boolean; backupPath: string | undefined }
  /** `schemaVersion` migration summaries applied by the last read. */
  migrations: string[]
  /** Fingerprint of the unreadable text already copied aside by this instance. */
  corruptSignature: string | undefined
}

/**
 * The file store behind `GET`/`PUT /panellist/api/config`.
 *
 * Every method is safe to call on a fresh process: nothing is read at
 * construction time and no method throws on a bad file (only `write` throws,
 * and only when the caller's own input fails the schema).
 */
export class PanellistStore {
  /** Resolved harness home. */
  readonly home: string
  /** Profile section this store reads and writes when no id is given. */
  readonly profileId: string
  /** Absolute path of the configuration file. */
  readonly configPath: string

  private readonly state: StoreState = {
    exists: false,
    writable: true,
    lastError: undefined,
    corruption: { detected: false, backupPath: undefined },
    migrations: [],
    corruptSignature: undefined,
  }

  constructor(options: StoreOptions = {}) {
    this.home = resolveDshHome(options.home)
    this.profileId = options.profileId ?? resolveProfileId()
    this.configPath = join(this.home, CONFIG_FILE_NAME)
  }

  /**
   * Read, migrate and validate the whole document.
   *
   * Never throws: a missing file is the empty document, an unreadable file is
   * copied aside and reported through {@link health}, and anything else is
   * served as defaults with the failure recorded.
   * @returns the current-shape document.
   */
  async readDocument(): Promise<PanellistConfig> {
    const state = this.state
    state.lastError = undefined
    state.migrations = []
    await this.refreshWritable()

    let raw: string
    try {
      raw = await readFile(this.configPath, 'utf8')
    } catch (error) {
      if (isNotFound(error)) {
        state.exists = false
        state.corruption = { detected: false, backupPath: undefined }
        state.corruptSignature = undefined
        return emptyConfig()
      }
      state.lastError = describe(error)
      return emptyConfig()
    }
    state.exists = true

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      await this.quarantine(raw, 'the stored configuration is not valid JSON')
      return emptyConfig()
    }

    const migrated = migrateConfigDocument(parsed)
    if (!migrated.ok) {
      await this.quarantine(raw, migrated.errors.join('; '))
      return emptyConfig()
    }

    // The schema is authoritative for a document that already declares the
    // current version — that is the shape a hand edit has to match. A document
    // from an older version is, by definition, shaped like *that* version, so
    // migration output is what the schema judges.
    const judged = rawSchemaVersion(parsed) === SCHEMA_VERSION ? parsed : migrated.config
    let errors: string[] | null
    try {
      errors = await this.validateDocument(judged)
    } catch (error) {
      // The schema itself could not be loaded (a broken install). Serving what
      // the migration produced, with the failure in the health report, beats
      // throwing out of a read.
      state.lastError = `could not validate the configuration: ${describe(error)}`
      return migrated.config
    }
    if (errors !== null) {
      await this.quarantine(raw, `the stored configuration does not match the schema: ${errors.join('; ')}`)
      return emptyConfig()
    }

    state.corruption = { detected: false, backupPath: undefined }
    state.corruptSignature = undefined
    state.migrations = migrated.applied
    return migrated.config
  }

  /**
   * One profile's section, or defaults when it has none.
   * @param profileId - section to read; defaults to this store's own profile.
   */
  async read(profileId: string = this.profileId): Promise<ProfileConfig> {
    const document = await this.readDocument()
    return document.profiles[profileId] ?? emptyProfileConfig()
  }

  /**
   * Replace one profile's section after validating the whole document.
   *
   * Other sections are carried through exactly as stored, so a write can never
   * rewrite a profile it was not asked about.
   * @param profile - the section to store.
   * @param profileId - section to replace; defaults to this store's own profile.
   * @throws {InvalidConfigError} when the resulting document fails the schema.
   */
  async write(profile: ProfileConfig, profileId: string = this.profileId): Promise<void> {
    const base = await this.loadBase()
    const errors = await this.validateDocument(withProfile(base.document, profileId, profile))
    if (errors === null) {
      await this.writeDocument(withProfile(base.document, profileId, profile))
      return
    }
    // The candidate failed, which may be another profile's section rather than
    // the caller's. Retry through the read path's migration so one hand-edited
    // section cannot make this plugin permanently unwritable; if the retry also
    // fails, the caller's own input is the problem and is reported verbatim.
    const repaired = base.raw === undefined ? emptyConfig() : repairRaw(base.raw)
    const repairedErrors = await this.validateDocument(withProfile(repaired, profileId, profile))
    if (repairedErrors !== null) throw new InvalidConfigError(errors)

    if (base.raw !== undefined) {
      const backupPath = await this.setAside(base.raw)
      this.state.corruption = { detected: true, backupPath }
    }
    await this.writeDocument(withProfile(repaired, profileId, profile))
  }

  /**
   * Replace one profile's section with the default one.
   * @param profileId - section to reset; defaults to this store's own profile.
   * @returns the default section that was written.
   */
  async resetProfile(profileId: string = this.profileId): Promise<ProfileConfig> {
    const profile = emptyProfileConfig()
    await this.write(profile, profileId)
    return profile
  }

  /**
   * Whether `<home>/profiles/<id>` exists. The route honours an explicit
   * `?profile=` only for a profile the harness has actually initialized.
   * @param profileId - candidate id; an out-of-shape id is never a profile.
   */
  async profileExists(profileId: string): Promise<boolean> {
    if (!PROFILE_ID_RE.test(profileId)) return false
    try {
      await stat(join(this.home, PROFILES_DIR_NAME, profileId))
      return true
    } catch {
      return false
    }
  }

  /**
   * The last-known storage state. Synchronous by contract; every read and write
   * refreshes it, so a route reads the state it just produced.
   */
  health(): HealthReport {
    const { corruption, lastError, migrations } = this.state
    return {
      ok: !corruption.detected && lastError === undefined,
      profileId: this.profileId,
      configPath: this.configPath,
      schemaVersion: SCHEMA_VERSION,
      storage: {
        writable: this.state.writable,
        exists: this.state.exists,
        ...(lastError === undefined ? {} : { lastError }),
      },
      corruption: {
        detected: corruption.detected,
        ...(corruption.backupPath === undefined ? {} : { backupPath: corruption.backupPath }),
      },
      migrations: [...migrations],
      checkedAt: new Date().toISOString(),
    }
  }

  /** Whether the harness home exists and accepts writes; creates it if absent. */
  private async refreshWritable(): Promise<void> {
    try {
      await mkdir(this.home, { recursive: true })
      await access(this.home, constants.W_OK)
      this.state.writable = true
    } catch (error) {
      this.state.writable = false
      this.state.lastError = describe(error)
    }
  }

  /** Validate one value against the normative schema; `null` means it passed. */
  private async validateDocument(document: unknown): Promise<string[] | null> {
    const validate = await loadValidator()
    if (validate(document)) return null
    return formatErrors(validate.errors)
  }

  /**
   * The document a write should start from: the stored JSON parsed as-is, so
   * every section — and every root key — survives at the object level until
   * validation says otherwise. A file that cannot be read is set aside first
   * and contributes nothing.
   */
  private async loadBase(): Promise<{ document: unknown; raw: string | undefined }> {
    let raw: string
    try {
      raw = await readFile(this.configPath, 'utf8')
    } catch (error) {
      if (!isNotFound(error)) this.state.lastError = describe(error)
      return { document: emptyConfig(), raw: undefined }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      await this.quarantine(raw, 'the stored configuration is not valid JSON')
      return { document: emptyConfig(), raw: undefined }
    }
    if (!isRecord(parsed) || !isRecord(parsed['profiles'])) {
      await this.quarantine(raw, 'the stored configuration has no profiles object')
      return { document: emptyConfig(), raw: undefined }
    }
    return { document: parsed, raw }
  }

  /** Write the document atomically, falling back to a direct write on a Windows lock. */
  private async writeDocument(document: PanellistConfig): Promise<void> {
    const text = `${JSON.stringify(document, null, 2)}\n`
    await mkdir(dirname(this.configPath), { recursive: true })
    const tempPath = `${this.configPath}.${process.pid.toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
    await writeFile(tempPath, text, { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(tempPath, this.configPath)
    } catch (error) {
      const code = errorCode(error)
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
        await rm(tempPath, { force: true })
        throw error
      }
      // Windows refuses to replace a file another handle holds open. Write in
      // place instead; a torn write is recovered by the corrupt-file path on
      // the next read, and the previous content is still in the temp file.
      await writeFile(this.configPath, text, { encoding: 'utf8', mode: 0o600 })
      await rm(tempPath, { force: true })
    }
    this.state.exists = true
    this.state.writable = true
  }

  /** Set a bad original aside (once per distinct content) and record the corruption. */
  private async quarantine(raw: string, reason: string): Promise<void> {
    const backupPath = await this.setAside(raw)
    this.state.corruption = { detected: true, backupPath }
    this.state.lastError = reason
  }

  /** Copy the original next to itself, unless this exact content already was. */
  private async setAside(raw: string): Promise<string | undefined> {
    const signature = contentSignature(raw)
    if (this.state.corruptSignature === signature) return this.state.corruption.backupPath
    const stamp = new Date().toISOString().replaceAll(':', '')
    const target = `${this.configPath}.corrupt-${stamp}`
    try {
      await copyFile(this.configPath, target)
      this.state.corruptSignature = signature
      return target
    } catch (error) {
      this.state.lastError = `could not set the unreadable configuration aside: ${describe(error)}`
      return undefined
    }
  }
}
