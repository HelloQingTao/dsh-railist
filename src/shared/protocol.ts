/**
 * The host/browser wire contract: route paths and the JSON shapes crossing
 * them. Shared by both halves so a rename cannot drift.
 */
import type { RailistConfig, ProfileConfig } from './config.ts'

/** Loopback-only route prefix (README §4.3). */
export const API_PREFIX = '/railist/api'

export const API_ROUTES = {
  config: `${API_PREFIX}/config`,
  reset: `${API_PREFIX}/config/reset`,
  health: `${API_PREFIX}/health`,
  reveal: `${API_PREFIX}/reveal`,
  plugins: `${API_PREFIX}/plugins`,
} as const

/** Storage/field-level self-check reported by `GET /health`. */
export interface HealthReport {
  ok: boolean
  /** Profile section this host half reads and writes. */
  profileId: string
  /** Absolute path of the configuration file. */
  configPath: string
  schemaVersion: number
  storage: {
    /** The directory exists and the file (or its directory) accepts writes. */
    writable: boolean
    /** The file exists on disk. */
    exists: boolean
    /** Last write/read error, when any. */
    lastError?: string
  }
  /** A malformed file was found and set aside. */
  corruption: {
    detected: boolean
    /** Where the unreadable original was copied. */
    backupPath?: string
  }
  /** Non-empty when a migration was applied on this read. */
  migrations: string[]
  checkedAt: string
}

/** `GET /config` response. */
export interface ConfigResponse {
  /** The whole document, so the settings page can export it. */
  document: RailistConfig
  /** The section this client writes back. */
  profile: ProfileConfig
  profileId: string
  health: HealthReport
}

/** `PUT /config` request body. */
export interface PutConfigRequest {
  profile: ProfileConfig
}

/**
 * What is known about the plugin that contributed one panel.
 *
 * Both fields are display-only decoration for the settings list: `package` is
 * the npm name the profile installed, `version` the value its `package.json`
 * records (already shortened when it was not a plain release). Either may be
 * absent for a panel nothing maps to, and everything downstream must render
 * nothing at all rather than a placeholder.
 */
export interface PluginInfo {
  /** Package name the profile depends on, e.g. `@chengdb/capability-panel`. */
  package?: string
  /** Recorded dependency value, e.g. `1.1.0`; a git dependency keeps its short sha. */
  version?: string
}

/**
 * `GET /plugins` response.
 *
 * Keyed by panel id, so the settings page can decorate each row it already
 * renders without a second lookup. The map is legitimately empty — a profile
 * whose patch file or manifest is missing is not an error here, because this
 * endpoint is decoration and a settings page that cannot be decorated must
 * still open.
 */
export interface PluginsResponse {
  /** Panel id → its contributor, for every id the profile actually resolves. */
  plugins: Record<string, PluginInfo>
}

/** Any non-2xx body. */
export interface ApiFailure {
  error: string
  /** Field-level reasons from the authoritative schema check. */
  details?: string[]
}
