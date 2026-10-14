/**
 * `GET /railist/api/plugins` — the contributor label behind each settings row.
 *
 * This endpoint is decoration, and the tests are written from that premise: the
 * interesting cases are the *broken* profiles, because the failure the feature
 * must never cause is a settings page that cannot open. Every degraded input
 * below is therefore asserted to answer 200 with an empty (or partial) map
 * rather than to raise.
 *
 * Two layers are covered because they fail differently: `resolvePlugins` for
 * the parsing rules (a malformed layer, a name nothing pins a version to), and
 * the real HTTP handler for the route wiring and the profile fence.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { API_ROUTES, type PluginsResponse } from '../src/shared/protocol.ts'
import { RailistStore } from '../src/plugin/store.ts'
import { createApiHandler } from '../src/plugin/routes.ts'
import {
  normalizeVersion,
  parseBundleNames,
  parseManifestVersions,
  parsePatchNames,
  resolvePlugins,
} from '../src/plugin/plugins.ts'

const PROFILE = 'desktop'

let home = ''

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'panellist-plugins-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** Write one file inside the profile directory, creating the directory first. */
async function writeProfileFile(name: string, contents: string): Promise<void> {
  const directory = join(home, 'profiles', PROFILE)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, name), contents, 'utf8')
}

/**
 * Write a bundle's own patch layer, the way `dsh plugin add` installs one:
 * `<profile>/node_modules/<pkg>/cordis.patch.yml`.
 */
async function writeBundlePatch(pkg: string, contents: string): Promise<void> {
  const directory = join(home, 'profiles', PROFILE, 'node_modules', ...pkg.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'cordis.patch.yml'), contents, 'utf8')
}

/** A manifest declaring the bundles a profile mounts, plus their versions. */
function bundleManifest(bundles: readonly string[], dependencies: Record<string, string> = {}): string {
  return JSON.stringify({ name: 'profile-desktop', dsh: { profile: { bundles } }, dependencies })
}

/** The patch layer this machine actually has, trimmed to the entries that matter. */
const PATCH = `
- insert:
    - id: capability-panel
      name: '@chengdb/capability-panel'
    - id: usage-stats
      name: dsh-usage-statistics-panel
    - id: dsh-power-xc
      name: dsh-power-xc
`

const MANIFEST = JSON.stringify({
  name: 'profile-desktop',
  dependencies: {
    '@chengdb/capability-panel': 'https://codeload.github.com/chengdb/capability-panel/tar.gz/94fc90d1a2b3c4d5e6f708192a3b4c5d6e7f8091',
    'dsh-usage-statistics-panel': '^0.1.6',
    'dsh-power-xc': '0.2.4',
  },
})

describe('resolvePlugins', () => {
  it('maps each insert id to its package and version', async () => {
    await writeProfileFile('cordis.patch.yml', PATCH)
    await writeProfileFile('package.json', MANIFEST)

    const { plugins } = await resolvePlugins(home, PROFILE)

    expect(plugins['usage-stats']).toEqual({ package: 'dsh-usage-statistics-panel', version: '0.1.6' })
    expect(plugins['dsh-power-xc']).toEqual({ package: 'dsh-power-xc', version: '0.2.4' })
    // The tarball dependency keeps only its commit: the URL is 90 characters of
    // noise next to a row label, and the sha is the part that identifies a build.
    expect(plugins['capability-panel']).toEqual({ package: '@chengdb/capability-panel', version: '94fc90d' })
  })

  it('keeps the package when a dependency records no usable version', async () => {
    await writeProfileFile('cordis.patch.yml', `
- insert:
    - id: linked
      name: my-local-plugin
`)
    await writeProfileFile('package.json', JSON.stringify({
      dependencies: { 'my-local-plugin': 'workspace:*' },
    }))

    const { plugins } = await resolvePlugins(home, PROFILE)

    // The name is what the user can act on, so it survives; a version key that
    // is absent (not an empty string) is what tells the page to render the
    // one-part subtitle.
    expect(plugins['linked']).toEqual({ package: 'my-local-plugin' })
    expect('version' in (plugins['linked'] ?? {})).toBe(false)
  })

  it('answers an empty map for a missing profile directory', async () => {
    const { plugins } = await resolvePlugins(home, 'no-such-profile')
    expect(plugins).toEqual({})
  })

  it('answers an empty map when only one of the two files exists, and still resolves that half', async () => {
    // Patch without manifest: names resolve, versions cannot.
    await writeProfileFile('cordis.patch.yml', PATCH)
    const patchOnly = await resolvePlugins(home, PROFILE)
    expect(patchOnly.plugins['usage-stats']).toEqual({ package: 'dsh-usage-statistics-panel' })

    // Manifest without patch: no id pairs a package to a row, so nothing maps.
    await rm(join(home, 'profiles', PROFILE, 'cordis.patch.yml'))
    await writeProfileFile('package.json', MANIFEST)
    const manifestOnly = await resolvePlugins(home, PROFILE)
    expect(manifestOnly.plugins).toEqual({})
  })

  it('degrades instead of throwing on malformed YAML and malformed JSON', async () => {
    await writeProfileFile('cordis.patch.yml', "- insert: [\n  unclosed: 'quote\n")
    await writeProfileFile('package.json', '{ this is not json')

    // The whole point: the route still answers, and answers 200.
    await expect(resolvePlugins(home, PROFILE)).resolves.toEqual({ plugins: {} })
  })

  it('ignores a patch layer that is valid YAML but not a list of inserts', async () => {
    await writeProfileFile('cordis.patch.yml', 'insert:\n  - id: half\n')
    await writeProfileFile('package.json', MANIFEST)

    const { plugins } = await resolvePlugins(home, PROFILE)
    expect(plugins).toEqual({})
  })

  it('refuses a profile id that would escape the profiles directory', async () => {
    // The id reaches a path join, so a crafted one must not read elsewhere. The
    // schema already rejects these; this is the second fence.
    for (const id of ['../secrets', 'a/b', '', '.hidden']) {
      await expect(resolvePlugins(home, id)).resolves.toEqual({ plugins: {} })
    }
  })
})

/*
 * The bundle patch layer. This is the one that actually answers this machine's
 * rail: the four rows on it (`dsh-power-xc`, `capability-panel`, and the two
 * kernel rows) appear nowhere in the profile's own patch, so resolving only
 * that file reported nothing for every row the user can see.
 */
describe('resolvePlugins / bundle patch layers', () => {
  it('resolves an id that only a bundle declares, not the profile', async () => {
    await writeBundlePatch('dsh-power-xc', `
- insert:
    - id: dsh-power-xc
      name: 'dsh-power-xc'
`)
    await writeProfileFile('package.json', bundleManifest(['dsh-power-xc'], { 'dsh-power-xc': '^0.1.6' }))

    const { plugins } = await resolvePlugins(home, PROFILE)

    // The regression this covers: with only the profile patch read, this id
    // was absent from the map entirely.
    expect(plugins['dsh-power-xc']).toEqual({ package: 'dsh-power-xc', version: '0.1.6' })
  })

  it('reads a scoped bundle through its two-segment path', async () => {
    await writeBundlePatch('@chengdb/capability-panel', `
- insert:
    - id: capability-panel
      name: '@chengdb/capability-panel'
`)
    await writeProfileFile('package.json', bundleManifest(
      ['@chengdb/capability-panel'],
      { '@chengdb/capability-panel': 'https://codeload.github.com/chengdb/capability-panel/tar.gz/94fc90d1a2b3c4' },
    ))

    const { plugins } = await resolvePlugins(home, PROFILE)

    // The version is looked up by *package* name (`@chengdb/…`), not by the id
    // the panel registers under (`capability-panel`).
    expect(plugins['capability-panel']).toEqual({ package: '@chengdb/capability-panel', version: '94fc90d' })
  })

  it('unions the profile patch and the bundle patches', async () => {
    await writeProfileFile('cordis.patch.yml', `
- insert:
    - id: profile-only
      name: dsh-obsidian-bridge
`)
    await writeBundlePatch('dsh-power-xc', `
- insert:
    - id: dsh-power-xc
      name: 'dsh-power-xc'
`)
    await writeProfileFile('package.json', bundleManifest(['dsh-power-xc'], { 'dsh-power-xc': '0.1.6' }))

    const { plugins } = await resolvePlugins(home, PROFILE)

    // Both sources survive: a bundle patch does not displace the profile's own
    // layer, it adds to it.
    expect(Object.keys(plugins).sort()).toEqual(['dsh-power-xc', 'profile-only'])
    expect(plugins['dsh-power-xc']).toEqual({ package: 'dsh-power-xc', version: '0.1.6' })
    expect(plugins['profile-only']).toEqual({ package: 'dsh-obsidian-bridge' })
  })

  it('lets the profile patch win a contested id, since it is the user override', async () => {
    await writeProfileFile('cordis.patch.yml', `
- insert:
    - id: contested
      name: pkg-from-profile
`)
    await writeBundlePatch('pkg-b', `
- insert:
    - id: contested
      name: pkg-from-bundle
`)
    await writeProfileFile('package.json', bundleManifest(['pkg-b']))

    const { plugins } = await resolvePlugins(home, PROFILE)

    expect(plugins['contested']).toEqual({ package: 'pkg-from-profile' })
  })

  it('silently skips a bundle whose directory is not installed', async () => {
    // A kernel bundle (`@deepseek-ai/dsh-base`) sits in `dsh.profile.bundles`
    // but ships no separate directory under the profile's `node_modules`.
    await writeBundlePatch('dsh-power-xc', `
- insert:
    - id: dsh-power-xc
      name: 'dsh-power-xc'
`)
    await writeProfileFile('package.json', bundleManifest(
      ['@deepseek-ai/dsh-base', 'dsh-power-xc', 'never-installed'],
      { 'dsh-power-xc': '0.1.6', 'never-installed': '9.9.9' },
    ))

    const { plugins } = await resolvePlugins(home, PROFILE)

    // The installed one resolves; the missing ones contribute nothing and — the
    // point of the case — do not take the whole answer down with them.
    expect(Object.keys(plugins)).toEqual(['dsh-power-xc'])
  })

  it('degrades instead of throwing when a bundle patch is malformed or unreadable', async () => {
    await writeBundlePatch('broken-yaml', "- insert: [\n  unclosed: 'quote\n")
    await writeBundlePatch('good', `
- insert:
    - id: good
      name: pkg-good
`)
    await writeProfileFile('package.json', bundleManifest(['broken-yaml', 'good']))

    const { plugins } = await resolvePlugins(home, PROFILE)

    // One bad bundle must not suppress a good one read in the same pass.
    expect(Object.keys(plugins)).toEqual(['good'])
  })

  it('ignores a manifest that declares no bundles', async () => {
    await writeProfileFile('package.json', JSON.stringify({ name: 'profile-desktop', dependencies: {} }))
    await writeBundlePatch('dsh-power-xc', `
- insert:
    - id: dsh-power-xc
      name: 'dsh-power-xc'
`)

    // Without `dsh.profile.bundles` there is nothing that says which patch
    // layers belong to this profile, so nothing is read.
    await expect(resolvePlugins(home, PROFILE)).resolves.toEqual({ plugins: {} })
  })

  it('keeps a bundle name out of the path join when it is not a package name', async () => {
    await writeProfileFile('package.json', bundleManifest(['../../etc', 'a/b/c', '.hidden', 'ok-pkg']))
    await writeBundlePatch('ok-pkg', `
- insert:
    - id: ok
      name: pkg-ok
`)

    const { plugins } = await resolvePlugins(home, PROFILE)

    // A crafted name is dropped before it is joined, so the only thing read is
    // the one name that could only ever be a package.
    expect(Object.keys(plugins)).toEqual(['ok'])
  })
})

describe('parseBundleNames', () => {
  it('reads dsh.profile.bundles and drops entries that are not package names', () => {
    expect(parseBundleNames(bundleManifest(['@deepseek-ai/dsh-base', 'dsh-qol']))).toEqual([
      '@deepseek-ai/dsh-base',
      'dsh-qol',
    ])
    expect(parseBundleNames(bundleManifest(['ok', '../x', 'a/b/c', '', ' lead-trail ']))).toEqual(['ok', 'lead-trail'])
    expect(parseBundleNames(bundleManifest(['ok', 42, null] as unknown as string[]))).toEqual(['ok'])
  })

  it('answers an empty list for a manifest with no bundles or no JSON', () => {
    expect(parseBundleNames('{}')).toEqual([])
    expect(parseBundleNames('{"dsh":{}}')).toEqual([])
    expect(parseBundleNames('{"dsh":{"profile":{}}}')).toEqual([])
    expect(parseBundleNames('{"dsh":{"profile":{"bundles":"nope"}}}')).toEqual([])
    expect(parseBundleNames('not json')).toEqual([])
  })
})

describe('parsePatchNames', () => {
  it('skips override entries, which name no package', () => {
    // `- id: x` alone is an override of an entry composed elsewhere; only the
    // `insert` that created it knows which package it came from.
    const names = parsePatchNames(`
- insert:
    - id: alpha
      name: pkg-alpha
- id: alpha
  config:
    some: value
`)
    expect([...names]).toEqual([['alpha', 'pkg-alpha']])
  })

  it('keeps the first package an id is declared under', () => {
    const names = parsePatchNames(`
- insert:
    - id: alpha
      name: pkg-first
- insert:
    - id: alpha
      name: pkg-second
`)
    expect(names.get('alpha')).toBe('pkg-first')
  })

  it('skips malformed entries and blank fields rather than emitting them', () => {
    const names = parsePatchNames(`
- insert:
    - id: good
      name: pkg-good
    - id: ''
      name: pkg-blank-id
    - name: pkg-no-id
    - 'not an object'
    - id: blank-name
      name: '   '
`)
    expect([...names]).toEqual([['good', 'pkg-good']])
  })

  it('ignores the loader\'s !!js tag without logging a warning', () => {
    // Three of this machine's bundles (`dsh-better-sidebar`,
    // `dsh-usage-statistics-panel`, `dsh-web-startup-auth`) carry `!!js`
    // expressions. The parser has no handler for the tag, and yaml's default
    // logger would print "Unresolved tag" for each one — into the host log, on
    // every settings page open. `logLevel: 'silent'` is what keeps this route
    // from being a source of log noise, so the warning must not appear.
    const warnings: string[] = []
    const original = process.emitWarning
    process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
      warnings.push(typeof warning === 'string' ? warning : warning.message)
      return (original as (...args: unknown[]) => void).call(process, warning, ...rest)
    }) as typeof process.emitWarning

    let names: Map<string, string>
    try {
      names = parsePatchNames(`
- id: sidebar
  config:
    disabled: !!js "[...ctx.loader.entries()].some((e) => e.options.name === 'x')"
- insert:
    - id: usage-stats
      name: dsh-usage-statistics-panel
`)
    } finally {
      process.emitWarning = original
    }

    // The valid insert beside the tagged one still resolves…
    expect([...names]).toEqual([['usage-stats', 'dsh-usage-statistics-panel']])
    // …and nothing was logged about the tag.
    expect(warnings.filter(warning => /Unresolved tag|TAG_RESOLVE/i.test(warning))).toEqual([])
  })
})

describe('normalizeVersion', () => {
  it('strips a range operator and keeps plain versions', () => {
    expect(normalizeVersion('^0.1.6')).toBe('0.1.6')
    expect(normalizeVersion('~2.0.0')).toBe('2.0.0')
    expect(normalizeVersion('=1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('0.2.4')).toBe('0.2.4')
  })

  it('collapses a tarball URL to its short commit', () => {
    expect(normalizeVersion('https://codeload.github.com/o/r/tar.gz/94fc90d1a2b3c4d5')).toBe('94fc90d')
    expect(normalizeVersion('https://example.test/p.tar.gz/abcdef1234567890#abcdef1234567890')).toBe('abcdef1')
  })

  it('drops dependencies that name no release of their own', () => {
    // A git URL, a local path and a dist-tag are not versions a row should
    // print, and an empty value is not one either.
    expect(normalizeVersion('git+https://github.com/o/r.git')).toBeUndefined()
    expect(normalizeVersion('github:owner/repo')).toBeUndefined()
    expect(normalizeVersion('workspace:*')).toBeUndefined()
    expect(normalizeVersion('link:../local')).toBeUndefined()
    expect(normalizeVersion('')).toBeUndefined()
    expect(normalizeVersion(42)).toBeUndefined()
    expect(normalizeVersion(null)).toBeUndefined()
  })

  it('keeps a short dist-tag, which is still a label', () => {
    expect(normalizeVersion('latest')).toBe('latest')
    expect(normalizeVersion('next')).toBe('next')
  })
})

describe('parseManifestVersions', () => {
  it('answers an empty map for a manifest with no dependencies object', () => {
    expect(parseManifestVersions('{}')).toEqual({})
    expect(parseManifestVersions('{"dependencies": []}')).toEqual({})
    expect(parseManifestVersions('not json at all')).toEqual({})
  })

  it('drops only the entries that carry no usable version', () => {
    const versions = parseManifestVersions(JSON.stringify({
      dependencies: { good: '^1.0.0', local: 'file:../x', git: 'git+ssh://host/r.git' },
    }))
    expect(versions).toEqual({ good: '1.0.0' })
  })
})

/* ------------------------------------------------------------- the route -- */

interface RequestOptions {
  method: string
  url: string
  remoteAddress?: string
  host?: string
}

/** A request that satisfies the handler's wire contract (mirrors host-routes.spec.ts). */
function fakeRequest(options: RequestOptions): IncomingMessage {
  const stream = Readable.from([])
  const request = stream as unknown as IncomingMessage
  Object.assign(request, {
    method: options.method,
    url: options.url,
    headers: { host: options.host ?? '127.0.0.1:19387' },
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  })
  return request
}

class FakeResponse {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body = ''

  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.statusCode = status
    if (headers !== undefined) this.headers = { ...this.headers, ...headers }
    return this
  }

  setHeader(name: string, value: unknown): void {
    this.headers[name.toLowerCase()] = value
  }

  getHeader(name: string): unknown {
    return this.headers[name.toLowerCase()]
  }

  end(chunk?: unknown): this {
    if (typeof chunk === 'string') this.body += chunk
    return this
  }

  json<T>(): T {
    return JSON.parse(this.body) as T
  }
}

describe('GET /railist/api/plugins', () => {
  let store: RailistStore
  let handler: ReturnType<typeof createApiHandler>

  beforeEach(() => {
    store = new RailistStore({ home, profileId: PROFILE })
    handler = createApiHandler(store, { reveal: () => {} })
  })

  async function call(options: RequestOptions): Promise<FakeResponse> {
    const res = new FakeResponse()
    await handler(fakeRequest(options), res as unknown as ServerResponse)
    return res
  }

  it('answers the resolved map with 200', async () => {
    await writeProfileFile('cordis.patch.yml', PATCH)
    await writeProfileFile('package.json', MANIFEST)

    const res = await call({ method: 'GET', url: API_ROUTES.plugins })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const body = res.json<PluginsResponse>()
    expect(body.plugins['usage-stats']).toEqual({ package: 'dsh-usage-statistics-panel', version: '0.1.6' })
  })

  it('answers 200 with an empty map when the profile has no files at all', async () => {
    // The tolerant answer is the contract: a fresh profile, or a host whose
    // layout differs, must still let the settings page open.
    const res = await call({ method: 'GET', url: API_ROUTES.plugins })

    expect(res.statusCode).toBe(200)
    expect(res.json<PluginsResponse>()).toEqual({ plugins: {} })
  })

  it('answers 200 rather than 500 for a corrupt profile', async () => {
    await writeProfileFile('cordis.patch.yml', '\t- broken: [yaml')
    await writeProfileFile('package.json', '{,}')

    const res = await call({ method: 'GET', url: API_ROUTES.plugins })

    expect(res.statusCode).toBe(200)
    expect(res.json<PluginsResponse>()).toEqual({ plugins: {} })
  })

  it('honours the profile query parameter', async () => {
    await writeProfileFile('cordis.patch.yml', PATCH)
    await writeProfileFile('package.json', MANIFEST)

    const res = await call({ method: 'GET', url: `${API_ROUTES.plugins}?profile=${PROFILE}` })
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.json<PluginsResponse>().plugins)).toHaveLength(3)

    // A profile that does not exist is refused by the same fence every other
    // endpoint uses — the caller is the settings page, which asked for a
    // profile it read off the snapshot and therefore knows this is a fault.
    const unknown = await call({ method: 'GET', url: `${API_ROUTES.plugins}?profile=ghost` })
    expect(unknown.statusCode).toBe(400)
    expect(unknown.json<{ error: string }>().error).toContain('unknown profile')
  })

  it('refuses a non-loopback peer and a foreign Host', async () => {
    const remote = await call({ method: 'GET', url: API_ROUTES.plugins, remoteAddress: '10.1.2.3' })
    expect(remote.statusCode).toBe(403)

    const foreign = await call({ method: 'GET', url: API_ROUTES.plugins, host: 'evil.example' })
    expect(foreign.statusCode).toBe(403)
  })
})
