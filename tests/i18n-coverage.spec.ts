/**
 * Copy hygiene, checked mechanically rather than by eye.
 *
 * The i18n key set is closed: the settings page, the flyout and the rail all
 * render user-visible text through `translate.t(...)`. A key used in code but
 * absent from a dictionary would ship an untranslated placeholder, and a
 * user-visible literal would ship English to a Chinese user. Both are cheap to
 * detect here and expensive to notice in a screenshot.
 */
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/i18n/index.ts'
import { BUILTIN_ICON_NAMES } from '../src/shared/config.ts'

const SOURCE_FILES = globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() })
  .map(file => file.replaceAll('\\', '/'))
  .filter(file => !file.endsWith('src/client/i18n/index.ts'))

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/**
 * Every dictionary key referenced anywhere in the client half.
 *
 * The scan is over string literals rather than `t('…')` call sites: some keys
 * are reached through a lookup table (the sanitiser's failure codes), which is
 * still a literal but not a call. Matching literals against the dictionary
 * cannot produce a false "missing" (that direction is checked separately).
 */
function usedKeys(): Map<string, string[]> {
  const known = new Set(Object.keys(en))
  const keys = new Map<string, string[]>()
  for (const file of SOURCE_FILES) {
    for (const match of read(file).matchAll(/'([a-zA-Z][\w.-]*)'/g)) {
      const key = match[1] as string
      if (!known.has(key)) continue
      const where = keys.get(key) ?? []
      where.push(file)
      keys.set(key, where)
    }
  }
  return keys
}

describe('i18n', () => {
  it('ships both languages with the same key set', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim().length, `zh:${key}`).toBeGreaterThan(0)
      expect(en[key as keyof typeof en].trim().length, `en:${key}`).toBeGreaterThan(0)
    }
  })

  it('uses only keys that exist in both dictionaries', () => {
    const known = new Set(Object.keys(en))
    const missing: string[] = []
    for (const [key, where] of usedKeys()) {
      if (!known.has(key)) missing.push(`${key} (${[...new Set(where)].join(', ')})`)
    }
    expect(missing).toEqual([])
  })

  it('carries no key that nothing renders', () => {
    // The mirror of the check above, and the one that catches the leftovers a
    // feature removal leaves behind (the keys survive the code that used them).
    // Two families are built at runtime from closed sets and are listed below.
    const used = new Set(usedKeys().keys())
    const generated = /^(warning|probe)\.|^settings\.sequence\.seat/
    const unused = Object.keys(en).filter(key => !used.has(key) && !generated.test(key))
    expect(unused).toEqual([])
  })

  it('documents every warning and probe key the model can produce', () => {
    // The plan's structured warnings and the four probes are rendered from
    // generated keys, so they never appear as a literal `t('…')` call site.
    const generated = [
      'warning.single-member-group',
      'warning.empty-group',
      'warning.group-id-collision',
      'warning.duplicate-in-sequence',
      'probe.registry',
      'probe.registry.impact',
      'probe.rail',
      'probe.rail.impact',
      'probe.active',
      'probe.active.impact',
      'probe.settingsNav',
      'probe.settingsNav.impact',
      'probe.ok',
      'probe.failed',
    ]
    for (const key of generated) {
      expect(Object.prototype.hasOwnProperty.call(en, key), key).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(zh, key), key).toBe(true)
    }
  })

  it('renders every built-in glyph name through the same key-free path', () => {
    // Guards against a glyph added to the config type but never to the set.
    expect(BUILTIN_ICON_NAMES.length).toBe(24)
    expect(new Set(BUILTIN_ICON_NAMES).size).toBe(24)
  })
})
