/**
 * The client half of the row subtitle: the store that reads `GET /plugins`,
 * the formatting that turns one answer into copy, and the fact that the page
 * ships the polish chunk.
 *
 * The theme of these tests is restraint. A subtitle is decoration on a list the
 * user is editing, so the failure that matters is not "the label is wrong" but
 * "the label broke the list": an unresolved panel must render exactly what the
 * row rendered before this feature existed, and no code path may put the
 * string "undefined" or an empty element into the markup.
 */
import { describe, expect, it, vi } from 'vitest'
import { API_ROUTES } from '../src/shared/protocol.ts'
import {
  createPluginInfoStore,
  label,
  normalizePluginsResponse,
  type FetchLike,
} from '../src/client/settings/pluginInfo.ts'
import { shortPackageName, shortVersion, sourceLabel } from '../src/client/settings/sourceLabel.ts'
import { SETTINGS_POLISH_CSS } from '../src/client/settings/polish.css.ts'

/** A fetch stub that answers one canned response and records its calls. */
function stubFetch(response: { ok?: boolean; status?: number; body?: unknown; throws?: boolean }): {
  fetch: FetchLike
  calls: string[]
} {
  const calls: string[] = []
  const fetch: FetchLike = async (input) => {
    calls.push(input)
    if (response.throws === true) throw new Error('network down')
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    }
  }
  return { fetch, calls }
}

describe('normalizePluginsResponse', () => {
  it('keeps entries that carry at least one printable field', () => {
    const result = normalizePluginsResponse({
      plugins: {
        a: { package: 'pkg-a', version: '1.0.0' },
        b: { package: 'pkg-b' },
        c: { version: '2.0.0' },
      },
    })
    expect(result).toEqual({
      a: { package: 'pkg-a', version: '1.0.0' },
      b: { package: 'pkg-b' },
      c: { version: '2.0.0' },
    })
  })

  it('drops every shape the page cannot render', () => {
    // A wrong answer must degrade to "no subtitle", never to a broken row: this
    // is the boundary that keeps an unexpected host from putting `undefined` on
    // the page.
    expect(normalizePluginsResponse(null)).toEqual({})
    expect(normalizePluginsResponse('nope')).toEqual({})
    expect(normalizePluginsResponse({})).toEqual({})
    expect(normalizePluginsResponse({ plugins: [] })).toEqual({})
    expect(normalizePluginsResponse({ plugins: { a: null, b: 7, c: 'text' } })).toEqual({})
    expect(normalizePluginsResponse({ plugins: { a: {} } })).toEqual({})
    expect(normalizePluginsResponse({ plugins: { a: { package: '   ', version: '' } } })).toEqual({})
  })

  it('trims printable values and drops non-strings', () => {
    expect(normalizePluginsResponse({
      plugins: { a: { package: '  pkg-a  ', version: 42 } },
    })).toEqual({ a: { package: 'pkg-a' } })
  })
})

describe('label', () => {
  it('accepts only a non-blank string', () => {
    expect(label('x')).toBe('x')
    expect(label('  x  ')).toBe('x')
    expect(label('   ')).toBeUndefined()
    expect(label('')).toBeUndefined()
    expect(label(undefined)).toBeUndefined()
    expect(label(null)).toBeUndefined()
    expect(label(1)).toBeUndefined()
  })
})

describe('createPluginInfoStore', () => {
  it('reads the route once and publishes the normalized map', async () => {
    const { fetch, calls } = stubFetch({
      body: { plugins: { 'usage-stats': { package: 'dsh-usage-statistics-panel', version: '0.1.6' } } },
    })
    const store = createPluginInfoStore({ fetch })
    expect(store.get()).toEqual({})

    await store.load()

    expect(calls).toEqual([API_ROUTES.plugins])
    expect(store.get()).toEqual({ 'usage-stats': { package: 'dsh-usage-statistics-panel', version: '0.1.6' } })
  })

  it('notifies subscribers when an answer lands, and stops after dispose', async () => {
    const { fetch } = stubFetch({ body: { plugins: { a: { package: 'pkg-a' } } } })
    const store = createPluginInfoStore({ fetch })
    const listener = vi.fn()
    store.subscribe(listener)

    await store.load()
    expect(listener).toHaveBeenCalledTimes(1)

    store.dispose()
    await store.load()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stays silent and empty when the host refuses, fails, or answers nonsense', async () => {
    const cases: Array<{ ok?: boolean; status?: number; body?: unknown; throws?: boolean }> = [
      { ok: false, status: 404, body: { error: 'no' } },
      { ok: false, status: 500, body: {} },
      { throws: true },
      { body: 'not an object' },
      { body: { plugins: 'not an object' } },
    ]
    for (const response of cases) {
      const { fetch } = stubFetch(response)
      const store = createPluginInfoStore({ fetch })
      // `load` must never reject: the settings page calls it without a catch.
      await expect(store.load()).resolves.toBeUndefined()
      expect(store.get()).toEqual({})
    }
  })

  it('returns the same object identity until an answer lands', () => {
    const store = createPluginInfoStore({ fetch: stubFetch({ body: { plugins: {} } }).fetch })
    // `useSyncExternalStore` compares snapshots by identity, so a getter that
    // rebuilt its value would re-render the page on every notification.
    expect(store.get()).toBe(store.get())
  })
})

describe('shortPackageName', () => {
  it('drops the scope, which is the least informative part of the name', () => {
    expect(shortPackageName('@chengdb/capability-panel')).toBe('capability-panel')
    expect(shortPackageName('dsh-usage-statistics-panel')).toBe('dsh-usage-statistics-panel')
  })

  it('leaves a bare scope or a blank alone rather than inventing a name', () => {
    expect(shortPackageName('@scope')).toBe('@scope')
    expect(shortPackageName('@scope/')).toBe('@scope/')
    expect(shortPackageName('   ')).toBeUndefined()
    expect(shortPackageName(undefined)).toBeUndefined()
  })

  it('middle-truncates a name that is too long to sit next to a row', () => {
    const long = 'a'.repeat(60)
    const short = shortPackageName(long)
    expect(short).toBeDefined()
    expect(short?.length).toBeLessThan(long.length)
    // Both ends survive: the head names the family and the tail distinguishes it.
    expect(short?.startsWith('a')).toBe(true)
    expect(short?.endsWith('a')).toBe(true)
    expect(short).toContain('…')
  })
})

describe('shortVersion', () => {
  it('accepts a plausible version and rejects a non-version', () => {
    expect(shortVersion('1.0.0')).toBe('1.0.0')
    expect(shortVersion('94fc90d')).toBe('94fc90d')
    expect(shortVersion('  1.0.0  ')).toBe('1.0.0')
    expect(shortVersion('')).toBeUndefined()
    expect(shortVersion('   ')).toBeUndefined()
    expect(shortVersion(undefined)).toBeUndefined()
    // A value longer than any real version is not a version; it is a URL that
    // slipped through, and printing it would blow up the row.
    expect(shortVersion('x'.repeat(64))).toBeUndefined()
  })
})

describe('sourceLabel', () => {
  it('renders name and version together when both are known', () => {
    expect(sourceLabel({ package: '@chengdb/capability-panel', version: '1.1.0' }))
      .toEqual({ key: 'settings.sequence.source', params: { name: 'capability-panel', version: '1.1.0' } })
  })

  it('falls back to the name alone, with no dangling separator', () => {
    expect(sourceLabel({ package: 'dsh-power-xc' }))
      .toEqual({ key: 'settings.sequence.sourceNoVersion', params: { name: 'dsh-power-xc' } })
  })

  it('renders nothing at all when the row is unknown or unusable', () => {
    // `null` — not an empty string — is what makes the caller omit the element,
    // which is the difference between "no subtitle" and "an empty gap".
    expect(sourceLabel(undefined)).toBeNull()
    expect(sourceLabel({})).toBeNull()
    // A version with no package identifies nothing the user can act on.
    expect(sourceLabel({ version: '1.0.0' })).toBeNull()
    expect(sourceLabel({ package: '   ' })).toBeNull()
  })
})

describe('SETTINGS_POLISH_CSS', () => {
  it('styles the classes the settings page actually renders', () => {
    for (const className of [
      'dsh-panellist-settings-source',
      'dsh-panellist-settings-rows',
      'dsh-panellist-settings-row',
      'dsh-panellist-settings-badge',
      'dsh-panellist-settings-action',
      'dsh-panellist-settings-members',
      'dsh-panellist-settings-member',
      'dsh-panellist-settings-dropZone',
    ]) {
      expect(SETTINGS_POLISH_CSS, className).toContain(`.${className}`)
    }
  })

  it('adapts to any badge type through an attribute selector', () => {
    // The row list's badge set is expected to grow (a "currently not shown"
    // state is being added alongside this chunk), so the rules must key off the
    // attribute rather than enumerating today's types.
    expect(SETTINGS_POLISH_CSS).toContain("[data-badge='hidden']")
    expect(SETTINGS_POLISH_CSS).toContain("[data-badge='missing']")
    expect(SETTINGS_POLISH_CSS).toMatch(/\.dsh-panellist-settings-badge\s*\{/)
  })

  it('carries no hardcoded colour literal, so both themes come from the shell', () => {
    // Every colour must arrive as a `var(--dsw-…, <neutral fallback>)`. A hex
    // or rgb() literal here would be a light-only value painted onto a dark
    // page, which is the failure this assertion exists to prevent.
    const withoutTokens = SETTINGS_POLISH_CSS.replace(/var\(--dsw-[a-zA-Z0-9-]+,\s*/g, 'var(')
    expect(withoutTokens).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(withoutTokens).not.toMatch(/\brgba?\(/)
    expect(withoutTokens).not.toMatch(/\bhsla?\(/)
    expect(SETTINGS_POLISH_CSS).toContain('var(--dsw-')
  })

  it('honours reduced-motion and keeps the layout usable without hover', () => {
    expect(SETTINGS_POLISH_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(SETTINGS_POLISH_CSS).toContain('@media (hover: none)')
  })
})
