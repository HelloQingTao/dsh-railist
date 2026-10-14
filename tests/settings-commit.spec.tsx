/**
 * The pending-edit bar's behaviour (task-4, item 3).
 *
 * A structural edit is a preview: it lands in memory, and the page shows a bar
 * offering the two ways out. These specs pin that contract from both ends —
 * what appears in the DOM, and what the store was actually asked to write.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import type { ProfileConfig } from '../src/shared/config.ts'

function profileWith(ids: readonly string[]): ProfileConfig {
  return { sequence: ids.map(id => ({ type: 'entry' as const, id })), entries: {} }
}

function renderPage(profile: ProfileConfig): ReturnType<typeof createHarness> {
  const harness = createHarness({ profile })
  render(<Section deps={harness.deps} />)
  return harness
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-row-id="${id}"]`)
  if (row === null) throw new Error(`no row rendered for "${id}"`)
  return row as HTMLElement
}

function handleOf(scope: HTMLElement): HTMLElement {
  const handle = scope.querySelector('[data-drag-handle="true"]')
  if (handle === null) throw new Error('the row has no drag handle')
  return handle as HTMLElement
}

// vitest runs without globals, so testing-library cannot auto-register cleanup.
afterEach(cleanup)

describe('commit bar', () => {
  it('stays out of the way until a drag changes something', () => {
    renderPage(profileWith(['plugins', 'schedules']))

    // A freshly opened page has no unsaved state, so the bar is hidden rather
    // than merely empty — an empty row would still take vertical space.
    expect(document.querySelector('[data-testid="dsh-railist-settings-commitBar"]')?.getAttribute('hidden')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
  })

  it('appears on the first structural edit, and names both ways out', () => {
    renderPage(profileWith(['plugins', 'schedules']))

    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })

    const bar = document.querySelector('[data-testid="dsh-railist-settings-commitBar"]')
    expect(bar?.getAttribute('hidden')).toBeNull()
    expect(bar?.getAttribute('data-dirty')).toBe('true')
    // The hint says the order is a preview, which is the part a user would
    // otherwise have to guess at.
    expect(bar?.textContent).toContain('only on screen for now')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
  })

  it('writes once, for however many moves led up to it', () => {
    const profile = profileWith(['plugins', 'schedules', 'skills'])
    const harness = renderPage(profile)

    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })
    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })
    fireEvent.keyDown(handleOf(rowOf('skills')), { key: 'ArrowUp' })

    // Three moves, no writes: the whole point of the preview path.
    expect(harness.updates).toHaveLength(0)
    // The previewed order is what the page shows, and it is the accumulated one
    // rather than the first move's: plugins went down twice (past skills), then
    // skills stepped up over it.
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['skills', 'schedules', 'plugins'])

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    // One write, carrying the accumulated order.
    expect(harness.updates).toHaveLength(1)
    const written = harness.updates[0]
    if (written === undefined) throw new Error('the save button did not write')
    expect(written.sequence.map(item => item.id)).toEqual(['skills', 'schedules', 'plugins'])
    // The seats are written down too: a reorder must not lose the seat each row
    // already resolved, or the reload would put it back where it came from.
    expect(written.sequence.every(item => item.type === 'entry' && item.seat === 'top')).toBe(true)

    // And the bar retires, because there is nothing left pending.
    expect(document.querySelector('[data-testid="dsh-railist-settings-commitBar"]')?.getAttribute('hidden')).not.toBeNull()
  })

  it('drops every unpersisted move when discarded', () => {
    const profile = profileWith(['plugins', 'schedules', 'skills'])
    const harness = renderPage(profile)

    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    // The page shows the file again, and nothing was ever written.
    expect(harness.profile()).toEqual(profile)
    expect(harness.updates).toHaveLength(0)
    expect(document.querySelector('[data-testid="dsh-railist-settings-commitBar"]')?.getAttribute('hidden')).not.toBeNull()
  })

  it('stays offered after a failed write, so nothing is lost to a silent rollback', async () => {
    const profile = profileWith(['plugins', 'schedules', 'skills'])
    const harness = renderPage(profile)
    // A rejected PUT: the store keeps the previewed order on screen and reports
    // the failure through its own error banner, rather than silently restoring
    // the old order and losing the user's arrangement.
    harness.failWrites = true

    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await Promise.resolve()
    await Promise.resolve()

    // The order the user arranged is still on screen, and the bar is still
    // offered — the write did not happen.
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])
    expect(document.querySelector('[data-testid="dsh-railist-settings-commitBar"]')?.getAttribute('hidden')).toBeNull()
    // The failure is visible through the page's own error channel.
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('HTTP 500')
  })
})
