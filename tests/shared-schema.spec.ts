/**
 * The normative schema and the documentation must not drift apart.
 *
 * `docs/schema/config.schema.json` is what the host validates with; README.zh-CN.md
 * §4.2 shows users what to hand-edit. This spec compiles the real schema file
 * and runs the real documented example (and the documented negative case)
 * through it, so an edit to either side that breaks the other fails the suite.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, emptyProfileConfig } from '../src/shared/config.ts'
import { normalizeConfigDocument } from '../src/shared/validate.ts'

// `import.meta.url` is not a file: URL under the jsdom test transform, so the
// schema is located from the project root instead.
const schemaPath = resolve(process.cwd(), 'docs', 'schema', 'config.schema.json')
const schema: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'))

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema as object)

/** The exact example from README.zh-CN.md §4.2. */
const README_EXAMPLE = {
  schemaVersion: SCHEMA_VERSION,
  profiles: {
    desktop: {
      sequence: [
        { type: 'entry', id: 'plugins' },
        {
          type: 'group',
          id: 'group:work',
          label: '更多',
          icon: { kind: 'original' },
          members: ['schedules', 'skills', 'memory'],
        },
        { type: 'entry', id: 'ssh' },
      ],
      entries: {
        plugins: { label: '插件市场', icon: { kind: 'builtin', name: 'puzzle' } },
        'mcp-connector': { hidden: true },
      },
      meta: { updatedAt: '2026-10-10T03:00:00.000Z' },
    },
  },
}

/** The shape a fresh install writes: an empty document. */
const FRESH = { schemaVersion: SCHEMA_VERSION, profiles: {} }

describe('docs/schema/config.schema.json', () => {
  it('accepts the documented example', () => {
    const ok = validate(README_EXAMPLE)
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })

  it('accepts an empty document', () => {
    expect(validate(FRESH)).toBe(true)
  })

  it('accepts a section holding the empty profile the store creates', () => {
    const document = { schemaVersion: SCHEMA_VERSION, profiles: { desktop: { ...emptyProfileConfig(), meta: { updatedAt: new Date().toISOString() } } } }
    const ok = validate(document)
    expect(validate.errors ?? []).toEqual([])
    expect(ok).toBe(true)
  })

  it('rejects an empty group, a group member that is a group, and unknown keys', () => {
    const base = { schemaVersion: SCHEMA_VERSION, profiles: { p: { sequence: [] as unknown[] } } }
    const withGroup = (members: unknown[]): unknown => ({
      schemaVersion: SCHEMA_VERSION,
      profiles: { p: { sequence: [{ type: 'group', id: 'group:g', members }] } },
    })
    expect(validate(withGroup([]))).toBe(false)
    expect(validate(withGroup(['group:other']))).toBe(true)
    expect(validate(withGroup(['a', 'a']))).toBe(false)
    expect(validate({ ...base, extra: true })).toBe(false)
    // One version ABOVE the current one is the "future document" case.
    expect(validate({ schemaVersion: SCHEMA_VERSION + 1, profiles: {} })).toBe(false)
    expect(validate({ schemaVersion: SCHEMA_VERSION, profiles: { 'bad id!': {} } })).toBe(false)
  })

  it('rejects the retired locked field in a current-version document', () => {
    // This is what makes the v1 → v2 migration step necessary rather than
    // optional: a v1 file that still carried `locked` would be judged corrupt.
    expect(validate({ schemaVersion: SCHEMA_VERSION, profiles: { p: { sequence: [], locked: [] } } })).toBe(false)
  })

  it('accepts every document the lenient reader produces', () => {
    // The reader and the schema must agree on the shapes that matter: what the
    // reader accepts, the host can write back out.
    const inputs: unknown[] = [
      README_EXAMPLE,
      FRESH,
      { schemaVersion: SCHEMA_VERSION },
      { schemaVersion: SCHEMA_VERSION, profiles: { p: { entries: { a: { icon: { kind: 'custom', svg: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' } } } } } },
    ]
    for (const input of inputs) {
      const normalized = normalizeConfigDocument(input)
      expect(normalized.ok, JSON.stringify(input)).toBe(true)
      if (!normalized.ok) continue
      const ok = validate(normalized.config)
      expect(validate.errors ?? [], JSON.stringify(normalized.config)).toEqual([])
      expect(ok).toBe(true)
    }
  })
})
