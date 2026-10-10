/**
 * Lenient normalisation: a hand-edited file degrades to the parts that read
 * cleanly, and a document this plugin cannot understand is rejected outright
 * (the host then backs it up and serves defaults).
 */
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../src/shared/config.ts'
import { migrateConfigDocument } from '../src/shared/migrate.ts'
import { normalizeConfigDocument } from '../src/shared/validate.ts'

const VALID = {
  schemaVersion: 1,
  profiles: {
    desktop: {
      sequence: [
        { type: 'entry', id: 'plugins' },
        { type: 'group', id: 'group:work', label: 'More', members: ['schedules', 'skills'] },
      ],
      entries: { plugins: { label: 'Plugins', icon: { kind: 'builtin', name: 'star' } } },
      locked: ['ssh'],
      meta: { updatedAt: '2026-10-10T03:00:00.000Z' },
    },
  },
}

describe('normalizeConfigDocument', () => {
  it('accepts a valid document unchanged', () => {
    const result = normalizeConfigDocument(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repaired).toBe(false)
    expect(result.config.profiles['desktop']?.sequence).toHaveLength(2)
    expect(result.config.profiles['desktop']?.locked).toEqual(['ssh'])
  })

  it('rejects a non-object, a missing version and a future version', () => {
    expect(normalizeConfigDocument(null).ok).toBe(false)
    expect(normalizeConfigDocument([]).ok).toBe(false)
    expect(normalizeConfigDocument({ profiles: {} }).ok).toBe(false)
    expect(normalizeConfigDocument({ schemaVersion: 2, profiles: {} }).ok).toBe(false)
    expect(normalizeConfigDocument({ schemaVersion: 1, profiles: [] }).ok).toBe(false)
  })

  it('falls back to an empty document when profiles is missing', () => {
    const result = normalizeConfigDocument({ schemaVersion: SCHEMA_VERSION })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.profiles).toEqual({})
  })

  it('drops what it cannot understand and reports the repair', () => {
    const result = normalizeConfigDocument({
      schemaVersion: 1,
      profiles: {
        'bad id!': { sequence: [] },
        desktop: {
          sequence: [
            { type: 'entry', id: 'ok' },
            { type: 'entry', id: 'ok' },
            { type: 'entry', id: '' },
            { type: 'group', id: 'nope', members: ['a'] },
            { type: 'group', id: 'group:g', members: [] },
            { type: 'group', id: 'group:h', members: ['x', 'x'] },
            'junk',
          ],
          entries: {
            real: { label: 'x'.repeat(200), icon: { kind: 'builtin', name: 'not-a-glyph' }, hidden: 'yes' },
            other: { hidden: true },
          },
          locked: ['ssh', '', 42],
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repaired).toBe(true)
    const section = result.config.profiles['desktop']
    expect(section?.sequence.map(item => item.id)).toEqual(['ok', 'group:h'])
    // The over-long label and the unknown glyph are dropped; `hidden: 'yes'`
    // makes the whole override unreadable, so it disappears too.
    expect(section?.entries['real']).toBeUndefined()
    expect(section?.entries['other']).toEqual({ hidden: true })
    expect(section?.locked).toEqual(['ssh'])
  })

  it('keeps a custom SVG inside the size window only', () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'
    const ok = normalizeConfigDocument({
      schemaVersion: 1,
      profiles: { p: { entries: { a: { icon: { kind: 'custom', svg } } } } },
    })
    expect(ok.ok && ok.config.profiles['p']?.entries['a']?.icon).toEqual({ kind: 'custom', svg })
    const tooSmall = normalizeConfigDocument({
      schemaVersion: 1,
      profiles: { p: { entries: { a: { icon: { kind: 'custom', svg: '<svg/>' } } } } },
    })
    expect(tooSmall.ok && tooSmall.config.profiles['p']?.entries['a']).toBeUndefined()
  })
})

describe('migrateConfigDocument', () => {
  it('passes a current document through and reports no migration', () => {
    const result = migrateConfigDocument(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.from).toBe(SCHEMA_VERSION)
    expect(result.migrated).toBe(false)
    expect(result.applied).toEqual([])
  })

  it('rejects a document it cannot reach the current version from', () => {
    expect(migrateConfigDocument({ schemaVersion: 99 }).ok).toBe(false)
    // Version 0 has no step registered: the frame refuses rather than guessing.
    const zero = migrateConfigDocument({ schemaVersion: 0, profiles: {} })
    expect(zero.ok).toBe(false)
    if (zero.ok) return
    expect(zero.errors[0]).toContain('no migration step')
  })

  it('treats a missing version as current', () => {
    const result = migrateConfigDocument({ profiles: {} })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.schemaVersion).toBe(SCHEMA_VERSION)
  })
})
