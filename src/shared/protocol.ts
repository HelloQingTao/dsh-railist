/**
 * The host/browser wire contract: route paths and the JSON shapes crossing
 * them. Shared by both halves so a rename cannot drift.
 */
import type { PanellistConfig, ProfileConfig } from './config.ts'

/** Loopback-only route prefix (README §4.3). */
export const API_PREFIX = '/panellist/api'

export const API_ROUTES = {
  config: `${API_PREFIX}/config`,
  reset: `${API_PREFIX}/config/reset`,
  health: `${API_PREFIX}/health`,
  reveal: `${API_PREFIX}/reveal`,
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
  document: PanellistConfig
  /** The section this client writes back. */
  profile: ProfileConfig
  profileId: string
  health: HealthReport
}

/** `PUT /config` request body. */
export interface PutConfigRequest {
  profile: ProfileConfig
}

/** Any non-2xx body. */
export interface ApiFailure {
  error: string
  /** Field-level reasons from the authoritative schema check. */
  details?: string[]
}
