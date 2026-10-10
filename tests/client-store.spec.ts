/**
 * The browser half's configuration state: optimistic apply, rollback, import
 * and export. The fetch stub is a recording double, so every case also asserts
 * the exact wire traffic.
 */
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'
import { API_ROUTES, type ConfigResponse, type HealthReport } from '../src/shared/protocol.ts'
import { createPanellistStore, type FetchLike } from '../src/client/config/store.ts'

const HEALTH: HealthReport = {
  ok: true,
  profileId: 'desktop',
  configPath: 'C:\\Users\\x\\.dsh\\panellist.json',
  schemaVersion: SCHEMA_VERSION,
  storage: { writable: true, exists: true },
  corruption: { detected: false },
  migrations: [],
  checkedAt: '2026-10-10T03:00:00.000Z',
}

interface Call {
  url: string
  method: string
  body: string | undefined
}

/** A recording fetch double. `fail` makes the next non-GET answer fail. */
function stubFetch(options: { profile?: ProfileConfig; failPut?: boolean; failStatus?: number } = {}): {
  fetch: FetchLike
  calls: Call[]
} {
  let profile = options.profile ?? emptyProfileConfig()
  const calls: Call[] = []
  const response = (payload: unknown, status = 200): {
    ok: boolean
    status: number
    json(): Promise<unknown>
    text(): Promise<string>
  } => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  })
  const fetchLike: FetchLike = (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body })
    if (method === 'POST' && url.startsWith(API_ROUTES.reveal)) return Promise.resolve(response(undefined, 204))
    if (method === 'POST' && url.startsWith(API_ROUTES.reset)) {
      profile = emptyProfileConfig()
      return Promise.resolve(response({ document: { schemaVersion: SCHEMA_VERSION, profiles: { desktop: profile } }, profile, profileId: 'desktop', health: HEALTH } satisfies ConfigResponse))
    }
    if (method === 'PUT') {
      if (options.failPut === true) return Promise.resolve(response({ error: 'nope' }, options.failStatus ?? 500))
      const body = JSON.parse(init?.body ?? '{}') as { profile: ProfileConfig }
      profile = body.profile
    }
    const payload: ConfigResponse = {
      document: { schemaVersion: SCHEMA_VERSION, profiles: { desktop: profile } },
      profile,
      profileId: 'desktop',
      health: HEALTH,
    }
    return Promise.resolve(response(payload))
  }
  return { fetch: fetchLike, calls }
}

describe('createPanellistStore', () => {
  it('loads the host section and keeps a stable snapshot identity between changes', async () => {
    const seeded = { ...emptyProfileConfig(), entries: { a: { label: 'Aye' } } }
    const { fetch, calls } = stubFetch({ profile: seeded })
    const store = createPanellistStore({ fetch })
    const first = store.getSnapshot()
    expect(first.status).toBe('loading')
    expect(store.getSnapshot()).toBe(first)

    await store.load()
    const loaded = store.getSnapshot()
    expect(loaded.status).toBe('ready')
    expect(loaded.profileId).toBe('desktop')
    expect(loaded.profile.entries['a']?.label).toBe('Aye')
    expect(loaded.health?.storage.writable).toBe(true)
    expect(calls[0]?.url).toBe(API_ROUTES.config)
    expect(calls[0]?.method).toBe('GET')
    store.dispose()
  })

  it('addresses an explicit profile through the query string', async () => {
    const { fetch, calls } = stubFetch()
    const store = createPanellistStore({ fetch, profileId: 'other' })
    await store.load()
    expect(calls[0]?.url).toBe(`${API_ROUTES.config}?profile=other`)
    store.dispose()
  })

  it('applies an edit optimistically and keeps the server answer', async () => {
    const { fetch, calls } = stubFetch()
    const store = createPanellistStore({ fetch })
    await store.load()
    const seen: number[] = []
    store.subscribe(() => seen.push(store.getSnapshot().revision))

    const ok = await store.update(profile => ({ ...profile, locked: ['a'] }))
    expect(ok).toBe(true)
    expect(store.getSnapshot().profile.locked).toEqual(['a'])
    expect(store.getSnapshot().error).toBeNull()
    const put = calls.find(call => call.method === 'PUT')
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ profile: { sequence: [], entries: {}, locked: ['a'] } })
    // One notification for the optimistic apply, one for the confirmed write.
    expect(seen.length).toBeGreaterThanOrEqual(2)
    store.dispose()
  })

  it('rolls back and reports the reason when the write fails', async () => {
    const { fetch } = stubFetch({ failPut: true })
    const store = createPanellistStore({ fetch })
    await store.load()
    const before = store.getSnapshot().profile
    const ok = await store.update(profile => ({ ...profile, locked: ['a'] }))
    expect(ok).toBe(false)
    expect(store.getSnapshot().profile).toEqual(before)
    expect(store.getSnapshot().error).toContain('nope')
    store.dispose()
  })

  it('imports a document by taking the matching profile section', async () => {
    const { fetch, calls } = stubFetch()
    const store = createPanellistStore({ fetch })
    await store.load()
    const text = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      profiles: { desktop: { sequence: [{ type: 'entry', id: 'b' }], entries: {}, locked: [] } },
    })
    const result = await store.importDocument(text)
    expect(result.ok).toBe(true)
    expect(store.getSnapshot().profile.sequence).toEqual([{ type: 'entry', id: 'b' }])
    expect(calls.some(call => call.method === 'PUT')).toBe(true)
    store.dispose()
  })

  it('falls back to the only profile section when the ids differ', async () => {
    const { fetch } = stubFetch()
    const store = createPanellistStore({ fetch })
    await store.load()
    const result = await store.importDocument(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      profiles: { tui: { sequence: [], entries: { z: { hidden: true } }, locked: [] } },
    }))
    expect(result.ok).toBe(true)
    expect(store.getSnapshot().profile.entries['z']).toEqual({ hidden: true })
    store.dispose()
  })

  it('rejects unreadable imports without touching the profile', async () => {
    const { fetch } = stubFetch()
    const store = createPanellistStore({ fetch })
    await store.load()
    const before = store.getSnapshot().profile
    expect((await store.importDocument('{')).ok).toBe(false)
    expect((await store.importDocument('{"schemaVersion":99}')).ok).toBe(false)
    expect((await store.importDocument(JSON.stringify({ schemaVersion: SCHEMA_VERSION, profiles: {} }))).ok).toBe(false)
    expect(store.getSnapshot().profile).toEqual(before)
    store.dispose()
  })

  it('exports the whole document as pretty JSON', async () => {
    const { fetch } = stubFetch({ profile: { ...emptyProfileConfig(), locked: ['a'] } })
    const store = createPanellistStore({ fetch })
    await store.load()
    const exported = store.exportDocument()
    expect(exported.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(exported) as { schemaVersion: number; profiles: Record<string, ProfileConfig> }
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.profiles['desktop']?.locked).toEqual(['a'])
    store.dispose()
  })

  it('resets and reveals through the host route', async () => {
    const { fetch, calls } = stubFetch({ profile: { ...emptyProfileConfig(), locked: ['a'] } })
    const store = createPanellistStore({ fetch })
    await store.load()
    expect(await store.reveal()).toBe(true)
    expect(await store.reset()).toBe(true)
    expect(store.getSnapshot().profile.locked).toEqual([])
    expect(calls.some(call => call.url === API_ROUTES.reveal && call.method === 'POST')).toBe(true)
    expect(calls.some(call => call.url === API_ROUTES.reset && call.method === 'POST')).toBe(true)
    store.dispose()
  })

  it('surfaces a transport failure instead of throwing', async () => {
    const store = createPanellistStore({
      fetch: () => Promise.reject(new Error('route unreachable')),
    })
    await store.load()
    expect(store.getSnapshot().status).toBe('error')
    expect(store.getSnapshot().error).toBe('route unreachable')
    expect(await store.update(profile => profile)).toBe(false)
    store.dispose()
  })
})
