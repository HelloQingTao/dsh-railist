/**
 * Configuration half of the settings page (task-4, items 4-6): orphan
 * clean-up, import / export / open file / reset, the compatibility block, and
 * the section registration itself.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSettingsUnit } from '../src/client/settings/index.tsx'
import { createHarness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import { SETTINGS_CSS } from '../src/client/settings/settings.css.ts'
import { cleanOrphans } from '../src/shared/edit.ts'
import { SCHEMA_VERSION, type ProfileConfig } from '../src/shared/config.ts'

function profileWith(ids: readonly string[]): ProfileConfig {
  return { sequence: ids.map(id => ({ type: 'entry' as const, id })), entries: {} }
}

function renderPage(harness: ReturnType<typeof createHarness>): void {
  render(<Section deps={harness.deps} />)
}

afterEach(() => {
  // vitest runs without globals, so testing-library cannot auto-register cleanup.
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
  Reflect.deleteProperty(document, 'execCommand')
})

describe('orphans block', () => {
  it('states the count and cleans up after an explicit confirmation', () => {
    const profile: ProfileConfig = {
      sequence: [{ type: 'entry', id: 'ghost' }, { type: 'entry', id: 'plugins' }],
      entries: { ghost: { label: 'Ghost' } },
    }
    const harness = createHarness({ profile })
    renderPage(harness)

    expect(screen.getByText('1 configured panel(s) are no longer registered. Their configuration is kept so reinstalling the plugin restores everything.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clean up missing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(harness.updates).toHaveLength(1)
    expect(harness.updates[0]).toEqual(cleanOrphans(profile, ['plugins', 'schedules', 'skills']))
    expect(harness.updates[0]?.sequence).toEqual([{ type: 'entry', id: 'plugins' }])
    expect(harness.updates[0]?.entries).toEqual({})
  })

  it('offers nothing to clean when everything is registered', () => {
    renderPage(createHarness({ profile: profileWith(['plugins']) }))
    expect(screen.getByText('Nothing is missing.')).toBeTruthy()
    const clean = screen.getByRole('button', { name: 'Clean up missing' }) as HTMLButtonElement
    expect(clean.disabled).toBe(true)
  })
})

describe('configuration block', () => {
  it('exports the document as valid JSON through the clipboard', async () => {
    const written: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    })
    const harness = createHarness({ profile: profileWith(['plugins']) })
    renderPage(harness)

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    await waitFor(() => { expect(written).toHaveLength(1) })
    const parsed = JSON.parse(String(written[0])) as { schemaVersion: number; profiles: Record<string, ProfileConfig> }
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parsed.profiles['desktop']?.sequence).toEqual([{ type: 'entry', id: 'plugins' }])
    await waitFor(() => { expect(document.querySelector('[data-state="export"]')).not.toBeNull() })
  })

  it('falls back to document.execCommand when the Clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    let command = ''
    let copied = ''
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: (name: string) => {
        command = name
        const areas = document.querySelectorAll('textarea')
        const last = areas[areas.length - 1]
        copied = last === undefined ? '' : (last as HTMLTextAreaElement).value
        return true
      },
    })
    const harness = createHarness({ profile: profileWith(['plugins']) })
    renderPage(harness)

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    await waitFor(() => { expect(command).toBe('copy') })
    const parsed = JSON.parse(copied) as { profiles: Record<string, ProfileConfig> }
    expect(parsed.profiles['desktop']?.sequence).toEqual([{ type: 'entry', id: 'plugins' }])
  })

  it('imports a document and reports a rejected one', async () => {
    const harness = createHarness({ profile: profileWith(['plugins']) })
    renderPage(harness)

    const box = screen.getByRole('textbox', { name: 'Import JSON' })
    fireEvent.change(box, { target: { value: '{ not json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON' }))
    expect(await screen.findByText(/Import rejected: /)).toBeTruthy()
    expect(harness.imports).toHaveLength(0)

    fireEvent.change(box, {
      target: { value: JSON.stringify({ schemaVersion: SCHEMA_VERSION, profiles: { desktop: profileWith(['skills']) } }) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import JSON' }))

    await waitFor(() => { expect(document.querySelector('[data-state="import"]')).not.toBeNull() })
    expect(harness.profile().sequence).toEqual([{ type: 'entry', id: 'skills' }])
  })

  it('reveals the configuration file and shows its host-reported path', async () => {
    const harness = createHarness({ profile: profileWith(['plugins']) })
    renderPage(harness)

    expect(screen.getByText('File: C:/Users/test/.dsh/railist.json')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open config file' }))
    await waitFor(() => { expect(harness.reveals).toBe(1) })
  })

  it('resets only after an explicit confirmation', async () => {
    const harness = createHarness({ profile: profileWith(['plugins']) })
    renderPage(harness)

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(screen.getByText(/Reset this profile/)).toBeTruthy()
    expect(harness.resets).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => { expect(harness.resets).toBe(1) })
    await waitFor(() => { expect(document.querySelector('[data-state="reset"]')).not.toBeNull() })
  })

  it('surfaces a store failure with the failure copy', () => {
    const harness = createHarness({ profile: profileWith(['plugins']) })
    const failing = { ...harness.deps, snapshot: () => ({ ...harness.snapshot(), error: 'disk is locked', status: 'ready' as const }) }
    render(<Section deps={failing} />)
    expect(screen.getByText('Could not save: disk is locked')).toBeTruthy()
  })
})

describe('compatibility block', () => {
  it('shows a failed probe with its impact copy and re-runs on demand', async () => {
    const harness = createHarness({
      profile: profileWith(['plugins']),
      selfCheck: {
        results: [
          { id: 'registry', ok: true },
          { id: 'rail', ok: false, detail: 'row count 3 != entry count 4' },
        ],
        degraded: true,
      },
    })
    renderPage(harness)

    expect(screen.getByText('Degraded: 1 check(s) failed.')).toBeTruthy()
    expect(screen.getByText('Hiding is disabled; everything else still applies.')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('row count 3 != entry count 4')).toBeTruthy()
    expect(screen.getByText('Measured on DSH 0.2.0-rc.2.')).toBeTruthy()
    expect(document.querySelector('[data-probe="rail"]')?.getAttribute('data-ok')).toBe('false')
    expect(document.querySelector('[data-probe="registry"]')?.getAttribute('data-ok')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Re-run self-check' }))
    await waitFor(() => { expect(harness.selfCheck.reruns).toBe(1) })
  })

  it('shows the all-clear and the read-only banner', () => {
    renderPage(createHarness({ profile: profileWith(['plugins']) }))
    expect(screen.getByText('All checks passed.')).toBeTruthy()

    renderPage(createHarness({
      profile: profileWith(['plugins']),
      selfCheck: { degraded: true, readOnly: true, results: [{ id: 'registry', ok: false }] },
    }))
    expect(screen.getByText('Read-only: rewriting is disabled, so nothing on the rail is modified.')).toBeTruthy()
  })

  it('renders the plan warnings with their parameters', () => {
    renderPage(createHarness({
      profile: {
        sequence: [{ type: 'group', id: 'group:g1', members: ['plugins'] }],
        entries: {},
      },
    }))

    const warning = document.querySelector('[data-warning="single-member-group"]')
    expect(warning?.textContent).toContain('group:g1')
    expect(warning?.textContent).toContain('holds a single panel')
  })
})

describe('createSettingsUnit', () => {
  it('registers one late settings section, its stylesheet, and disposes it', () => {
    const harness = createHarness()
    const unit = createSettingsUnit(harness.deps)

    expect(harness.injectKeys).toEqual(['settings.section'])
    expect(harness.sections).toHaveLength(1)
    const section = harness.sections[0]
    expect(section?.name).toBe('settings.section')
    expect(section?.id).toBe('dsh-railist')
    expect(section?.order).toBe(100)
    expect(section?.label?.()).toBe('Panel list')
    expect(harness.cssChunks.get('settings')).toBe(SETTINGS_CSS)
    expect(harness.cssChunks.get('settings')).toContain('dsh-railist-settings')

    const Component = section?.component as (() => ReactNode) | undefined
    if (Component === undefined) throw new Error('expected the section component')
    render(<Component />)
    expect(screen.getByRole('heading', { name: 'Panel list' })).toBeTruthy()
    // The shell's dialog owns the close affordance (its X); the page must not
    // grow a second button for the same action.
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()

    unit.dispose()
  })
})
