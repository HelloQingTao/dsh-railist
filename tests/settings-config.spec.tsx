/**
 * Configuration half of the settings page (task-4, item 4): the configuration
 * block now carries only the profile's file path and the plan's structural
 * warnings, and the section registration itself.
 *
 * The missing-panel list, JSON import/export, "open config file", reset and the
 * compatibility block were removed on request; their assertions went with them.
 * The one behavioural check that is worth keeping here is the removal itself:
 * the page must not grow those controls back.
 */
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSettingsUnit } from '../src/client/settings/index.tsx'
import { createHarness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import { SETTINGS_CSS } from '../src/client/settings/settings.css.ts'

afterEach(() => {
  // vitest runs without globals, so testing-library cannot auto-register cleanup.
  cleanup()
})

function renderPage(harness: ReturnType<typeof createHarness>): void {
  render(<Section deps={harness.deps} />)
}

describe('configuration block', () => {
  it('shows the host-reported configuration file path', () => {
    renderPage(createHarness())
    expect(screen.getByText('File: C:/Users/test/.dsh/railist.json')).toBeTruthy()
  })

  it('surfaces a store failure with the failure copy', () => {
    const harness = createHarness()
    const failing = { ...harness.deps, snapshot: () => ({ ...harness.snapshot(), error: 'disk is locked', status: 'ready' as const }) }
    render(<Section deps={failing} />)
    expect(screen.getByText('Could not save: disk is locked')).toBeTruthy()
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

describe('the removed controls stay removed', () => {
  it('renders no missing-panel, import/export, reset or compatibility UI', () => {
    renderPage(createHarness({
      profile: {
        sequence: [{ type: 'entry', id: 'ghost' }, { type: 'entry', id: 'plugins' }],
        entries: { ghost: { label: 'Ghost' } },
      },
    }))

    for (const name of [
      'Missing panels',
      'Clean up missing',
      'Import JSON',
      'Export JSON',
      'Open config file',
      'Reset to defaults',
      'Compatibility',
      'Re-run self-check',
    ]) {
      expect(screen.queryByRole('button', { name }), name).toBeNull()
      expect(screen.queryByText(name), name).toBeNull()
    }
    expect(screen.queryByRole('textbox')).toBeNull()
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
