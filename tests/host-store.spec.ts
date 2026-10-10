/**
 * Host-half store: home resolution, round trip, corruption quarantine,
 * migration passthrough and write validation.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'
import { InvalidConfigError, PanellistStore, resolveDshHome } from '../src/plugin/store.ts'

const PROFILE = 'desktop'

let home = ''
let store: PanellistStore

function sampleProfile(): ProfileConfig {
  return {
    sequence: [{ type: 'entry', id: 'plugins' }, { type: 'group', id: 'group:g1', members: ['ssh'] }],
    entries: { plugins: { label: 'Plugin market', icon: { kind: 'builtin', name: 'puzzle' } } },
    locked: ['ssh'],
  }
}

/** The document exactly as it should be stored. */
function documentWith(profiles: Record<string, ProfileConfig>): string {
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, profiles }, null, 2)}\n`
}

async function backupNames(): Promise<string[]> {
  const names = await readdir(home)
  return names.filter(name => name.startsWith('panellist.json.corrupt-')).sort()
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'panellist-store-'))
  store = new PanellistStore({ home, profileId: PROFILE })
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('home resolution', () => {
  it('prefers $DSH_HOME and normalizes it', () => {
    const previous = process.env['DSH_HOME']
    try {
      process.env['DSH_HOME'] = resolve(tmpdir(), 'panellist-home')
      expect(resolveDshHome()).toBe(resolve(tmpdir(), 'panellist-home'))
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('treats a blank $DSH_HOME as unset and falls back to ~/.dsh', () => {
    const previous = process.env['DSH_HOME']
    try {
      process.env['DSH_HOME'] = '   '
      expect(resolveDshHome()).toBe(resolve(join(homedir(), '.dsh')))
      expect(resolveDshHome('  ')).toBe(resolve(join(homedir(), '.dsh')))
    } finally {
      if (previous === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previous
    }
  })

  it('places the file at <home>/panellist.json and defaults the profile id', () => {
    expect(store.configPath).toBe(join(home, 'panellist.json'))
    const previous = process.env['DSH_PROFILE']
    try {
      delete process.env['DSH_PROFILE']
      expect(new PanellistStore({ home }).profileId).toBe('default')
      process.env['DSH_PROFILE'] = 'work'
      expect(new PanellistStore({ home }).profileId).toBe('work')
    } finally {
      if (previous === undefined) delete process.env['DSH_PROFILE']
      else process.env['DSH_PROFILE'] = previous
    }
  })
})

describe('read', () => {
  it('serves defaults for a missing file without throwing', async () => {
    await expect(store.read()).resolves.toEqual(emptyProfileConfig())
    const report = store.health()
    expect(report.ok).toBe(true)
    expect(report.storage.exists).toBe(false)
    expect(report.corruption.detected).toBe(false)
    await expect(stat(store.configPath)).rejects.toThrow()
  })

  it('round-trips a written profile', async () => {
    const profile = sampleProfile()
    await store.write(profile)

    await expect(store.read()).resolves.toEqual(profile)
    expect(store.health().storage.exists).toBe(true)

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      schemaVersion: number
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION)
    expect(Object.keys(stored.profiles)).toEqual([PROFILE])
    expect(stored.profiles[PROFILE]).toEqual(profile)
  })

  it('writes 0600 on platforms that enforce file modes', async () => {
    await store.write(sampleProfile())
    if (process.platform !== 'win32') {
      expect((await stat(store.configPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('preserves another profile byte-for-byte at the object level', async () => {
    const other: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:z', label: 'More', members: ['a', 'b'] }],
      entries: { a: { hidden: true } },
      locked: ['b'],
      meta: { updatedAt: '2026-10-10T03:00:00.000Z' },
    }
    await writeFile(store.configPath, documentWith({ other }), 'utf8')

    await store.write(sampleProfile())

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.profiles['other']).toEqual(other)
    // Key order is part of "untouched": the section is re-serialized from the
    // stored object, not rebuilt by the normaliser.
    expect(JSON.stringify(stored.profiles['other'])).toBe(JSON.stringify(other))
    expect(stored.profiles[PROFILE]).toEqual(sampleProfile())
  })

  it('reads a profile other than its own on request', async () => {
    await writeFile(store.configPath, documentWith({ other: sampleProfile() }), 'utf8')
    await expect(store.read('other')).resolves.toEqual(sampleProfile())
    await expect(store.read('missing')).resolves.toEqual(emptyProfileConfig())
  })

  it('passes a current-version document through migration untouched', async () => {
    const other = sampleProfile()
    await writeFile(store.configPath, documentWith({ [PROFILE]: other }), 'utf8')

    await expect(store.read()).resolves.toEqual(other)
    const report = store.health()
    expect(report.migrations).toEqual([])
    expect(report.corruption.detected).toBe(false)
    expect(await backupNames()).toEqual([])
  })
})

describe('corruption', () => {
  it('sets an unparsable file aside and serves defaults', async () => {
    const original = '{ this is not json'
    await writeFile(store.configPath, original, 'utf8')

    await expect(store.read()).resolves.toEqual(emptyProfileConfig())

    const backups = await backupNames()
    expect(backups).toHaveLength(1)
    const backupPath = join(home, backups[0] as string)
    await expect(readFile(backupPath, 'utf8')).resolves.toBe(original)
    // The unreadable original is not overwritten by the fallback.
    await expect(readFile(store.configPath, 'utf8')).resolves.toBe(original)

    const report = store.health()
    expect(report.ok).toBe(false)
    expect(report.corruption.detected).toBe(true)
    expect(report.corruption.backupPath).toBe(backupPath)
  })

  it('sets aside a parseable document that fails the schema', async () => {
    const original = documentWith({ [PROFILE]: sampleProfile() }).replace(
      `"schemaVersion": ${SCHEMA_VERSION},`,
      `"schemaVersion": ${SCHEMA_VERSION}, "comment": "hand edited",`,
    )
    await writeFile(store.configPath, original, 'utf8')

    await expect(store.read()).resolves.toEqual(emptyProfileConfig())
    expect(await backupNames()).toHaveLength(1)
    expect(store.health().corruption.detected).toBe(true)
  })

  it('treats an unknown (newer) schemaVersion as unreadable', async () => {
    await writeFile(store.configPath, `${JSON.stringify({ schemaVersion: 99, profiles: {} })}\n`, 'utf8')

    await expect(store.read()).resolves.toEqual(emptyProfileConfig())
    expect(await backupNames()).toHaveLength(1)
    expect(store.health().corruption.detected).toBe(true)
  })

  it('backs the same content up only once', async () => {
    await writeFile(store.configPath, 'nope', 'utf8')

    await store.read()
    const first = store.health().corruption.backupPath
    await store.read()

    expect(await backupNames()).toHaveLength(1)
    expect(store.health().corruption.backupPath).toBe(first)
  })

  it('recovers: a write after corruption reports a valid file', async () => {
    await writeFile(store.configPath, 'broken', 'utf8')
    await store.read()
    await store.write(sampleProfile())

    expect(store.health().corruption.detected).toBe(true)
    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.profiles[PROFILE]).toEqual(sampleProfile())
  })
})

describe('write', () => {
  it('rejects a profile the schema refuses and leaves the file alone', async () => {
    const invalid: ProfileConfig = { sequence: [{ type: 'entry', id: '' }], entries: {}, locked: [] }
    await expect(store.write(invalid)).rejects.toBeInstanceOf(InvalidConfigError)
    await expect(store.write(invalid)).rejects.toMatchObject({ details: expect.any(Array) })
    await expect(stat(store.configPath)).rejects.toThrow()
  })

  it('rejects an override with an unknown icon kind', async () => {
    const invalid = {
      ...sampleProfile(),
      entries: { plugins: { icon: { kind: 'emoji', name: 'x' } } },
    } as unknown as ProfileConfig
    await expect(store.write(invalid)).rejects.toBeInstanceOf(InvalidConfigError)
  })

  it('writes into the requested profile only', async () => {
    await store.write(sampleProfile(), 'work')
    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(Object.keys(stored.profiles)).toEqual(['work'])
    await expect(store.read('work')).resolves.toEqual(sampleProfile())
    await expect(store.read(PROFILE)).resolves.toEqual(emptyProfileConfig())
  })

  it('repairs a schema-invalid sibling section instead of staying unwritable', async () => {
    await writeFile(store.configPath, documentWith({ other: sampleProfile() }).replace(
      `"schemaVersion": ${SCHEMA_VERSION},`,
      `"schemaVersion": ${SCHEMA_VERSION}, "comment": "hand edited",`,
    ), 'utf8')

    await store.write(sampleProfile())

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.profiles['other']).toEqual(sampleProfile())
    expect(stored.profiles[PROFILE]).toEqual(sampleProfile())
    expect(store.health().corruption.detected).toBe(true)
    expect(await backupNames()).toHaveLength(1)
  })
})

describe('resetProfile', () => {
  it('replaces the section with defaults', async () => {
    await store.write(sampleProfile())
    await expect(store.resetProfile()).resolves.toEqual(emptyProfileConfig())
    await expect(store.read()).resolves.toEqual(emptyProfileConfig())

    const stored = JSON.parse(await readFile(store.configPath, 'utf8')) as {
      profiles: Record<string, ProfileConfig>
    }
    expect(stored.profiles[PROFILE]).toEqual(emptyProfileConfig())
  })
})

describe('profileExists', () => {
  it('is true only for an id that has a profile directory', async () => {
    await expect(store.profileExists('work')).resolves.toBe(false)
    await mkdir(join(home, 'profiles', 'work'), { recursive: true })
    await expect(store.profileExists('work')).resolves.toBe(true)
    await expect(store.profileExists('../escape')).resolves.toBe(false)
    await expect(store.profileExists('')).resolves.toBe(false)
  })
})
