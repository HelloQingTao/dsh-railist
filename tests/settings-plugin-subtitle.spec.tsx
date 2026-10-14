/**
 * The contributor subtitle in the settings list, rendered — the end of the
 * feature path that starts at the profile's files.
 *
 * The unit tests next door cover the formatting; this suite covers the promise
 * made to the rest of the page: that a resolved plugin shows up beside its row,
 * and that a panel with no answer is rendered EXACTLY as it was before this
 * feature existed. The second half is the one worth guarding, because the
 * regression it catches — an empty `<span>` widening every row in the list — is
 * invisible to a test that only ever supplies a full mapping.
 */
import { cleanup, render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { RegisteredPanel } from '../src/shared/model.ts'
import { Section } from '../src/client/settings/Section.tsx'
import { createHarness } from './helpers/settings-harness.tsx'

const REGISTERED: readonly RegisteredPanel[] = [
  { id: 'capability-panel', label: 'Capability Panel', order: 10, container: 'top' },
  { id: 'usage-stats', label: 'Usage statistics', order: 20, container: 'top' },
  { id: 'dsh-power-xc', label: 'Power XC', order: 30, container: 'top' },
]

// vitest runs without globals, so testing-library cannot auto-register cleanup.
afterEach(cleanup)

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-row-id="${id}"]`)
  if (row === null) throw new Error(`no row rendered for "${id}"`)
  return row as HTMLElement
}

/**
 * Render the page and let the `/plugins` read land.
 *
 * The store publishes asynchronously (its `load` is a promise, and the panel
 * resolves it through `useSyncExternalStore`), so a test that asserted right
 * after `render` would be testing the pre-answer frame — the one where nothing
 * is shown. Draining inside `act` is what makes the assertion below about the
 * settled page, which is what a user actually sees a frame later.
 */
async function renderSettled(harness: ReturnType<typeof createHarness>): Promise<void> {
  render(<Section deps={harness.deps} />)
  await act(async () => { await harness.deps.plugins.load() })
}

describe('the settings page: the plugin subtitle', () => {
  it('shows the package and version beside the row it belongs to', async () => {
    const harness = createHarness({
      registered: REGISTERED,
      plugins: {
        'usage-stats': { package: 'dsh-usage-statistics-panel', version: '0.1.6' },
      },
    })
    await renderSettled(harness)

    const row = rowOf('usage-stats')
    const source = row.querySelector('.dsh-panellist-settings-source')
    expect(source).not.toBeNull()
    // The scope is dropped and the version is prefixed by the copy, not by the
    // data: the text a user reads is one string assembled in one place.
    expect(source?.textContent).toBe('dsh-usage-statistics-panel · v0.1.6')
    expect(source?.getAttribute('title')).toBe('dsh-usage-statistics-panel · v0.1.6')

    // It sits inside the row's main line, after the name.
    expect(row.querySelector('.dsh-panellist-settings-rowMain')?.contains(source)).toBe(true)
  })

  it('shows the package alone when no version was recorded', async () => {
    const harness = createHarness({
      registered: REGISTERED,
      plugins: { 'capability-panel': { package: '@chengdb/capability-panel' } },
    })
    await renderSettled(harness)

    const source = rowOf('capability-panel').querySelector('.dsh-panellist-settings-source')
    expect(source?.textContent).toBe('capability-panel')
    // No dangling separator where the version would have been.
    expect(source?.textContent).not.toContain('·')
  })

  it('renders nothing at all for a panel the store does not know', async () => {
    const harness = createHarness({ registered: REGISTERED })
    await renderSettled(harness)

    for (const id of REGISTERED.map(panel => panel.id)) {
      expect(rowOf(id).querySelector('.dsh-panellist-settings-source'), id).toBeNull()
    }
    // No placeholder text anywhere in the list: the rows must be byte-identical
    // to the version of this page without the feature.
    expect(document.body.textContent).not.toContain('undefined')
    expect(document.querySelectorAll('.dsh-panellist-settings-source')).toHaveLength(0)
  })

  it('leaves the list editable and keeps the row selection working', async () => {
    // The real risk of decorating a row is breaking the row. Selecting the panel
    // must still open its appearance editor.
    const harness = createHarness({
      registered: REGISTERED,
      plugins: { 'dsh-power-xc': { package: 'dsh-power-xc', version: '0.2.4' } },
    })
    await renderSettled(harness)

    const row = rowOf('dsh-power-xc')
    expect(row.querySelector('.dsh-panellist-settings-source')?.textContent).toBe('dsh-power-xc · v0.2.4')

    const select = row.querySelector('[data-action="select"]')
    expect(select).not.toBeNull()
    await act(async () => { (select as HTMLElement).click() })
    // The appearance editor is mounted for the selected row.
    expect(document.querySelector('[data-editor="panel"][data-editor-id="dsh-power-xc"]')).not.toBeNull()
  })

  it('renders no subtitle on a group row, which has no contributor', async () => {
    const harness = createHarness({
      registered: REGISTERED,
      plugins: { 'dsh-power-xc': { package: 'dsh-power-xc', version: '0.2.4' } },
    })
    // Group the second row with the third, producing a group row whose id is a
    // minted group id that the plugin map can never contain.
    const profile = harness.profile()
    harness.setProfile({
      ...profile,
      sequence: [
        { type: 'entry', id: 'capability-panel' },
        { type: 'group', id: 'g1', members: ['usage-stats', 'dsh-power-xc'] },
      ],
    })
    await renderSettled(harness)

    const groupRow = document.querySelector('[data-row-id="g1"]') as HTMLElement | null
    expect(groupRow).not.toBeNull()
    expect(groupRow?.querySelector('.dsh-panellist-settings-source')).toBeNull()
  })
})
