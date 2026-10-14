/**
 * The profile the host half addresses.
 *
 * The launcher publishes the running profile on the cordis context as
 * `profileContext.name` (`dsh web --profile web` boots the `web` profile); it
 * does NOT set `$DSH_PROFILE`. Resolving to `default` when neither is present
 * is what made a `web` host read a stale `default` section and rearrange the
 * rail to it on every reload.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RailistStore } from '../src/plugin/store.ts'
import { resolveProfileId } from '../src/plugin/profile.ts'

describe('resolveProfileId', () => {
  it('prefers the launcher profileContext over everything else', () => {
    expect(resolveProfileId({ name: 'web' }, { DSH_PROFILE: 'tui' })).toBe('web')
  })

  it('falls back to $DSH_PROFILE when the context is absent', () => {
    expect(resolveProfileId(undefined, { DSH_PROFILE: 'tui' })).toBe('tui')
    expect(resolveProfileId({}, { DSH_PROFILE: 'tui' })).toBe('tui')
    expect(resolveProfileId({ name: '   ' }, { DSH_PROFILE: 'tui' })).toBe('tui')
  })

  it('falls back to default only when neither source names a profile', () => {
    expect(resolveProfileId(undefined, {})).toBe('default')
    expect(resolveProfileId({ name: 42 }, { DSH_PROFILE: '' })).toBe('default')
  })
})

describe('RailistStore profile resolution', () => {
  it('addresses the section the launcher named, not a stale default', async () => {
    const home = await mkdtemp(join(tmpdir(), 'panellist-profile-'))
    try {
      const store = new RailistStore({ home, profileContext: { name: 'web' } })
      expect(store.profileId).toBe('web')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('keeps an explicit profileId as the highest override', async () => {
    const home = await mkdtemp(join(tmpdir(), 'panellist-profile-'))
    try {
      const store = new RailistStore({ home, profileId: 'explicit', profileContext: { name: 'web' } })
      expect(store.profileId).toBe('explicit')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
