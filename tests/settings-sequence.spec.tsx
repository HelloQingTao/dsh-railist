/**
 * Sequence editor behaviour (task-4, item 2).
 *
 * Every structural assertion goes through `shared/edit.ts` so the spec pins the
 * *contract* — materialize first, then the edit — rather than a hand-rolled
 * expectation that could drift from the model.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import { emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'
import { materializeSequence, moveRow, setGroupHidden, setPanelHidden, type LiveRow } from '../src/shared/edit.ts'

function profileWith(ids: readonly string[]): ProfileConfig {
  return { sequence: ids.map(id => ({ type: 'entry' as const, id })), entries: {} }
}

// vitest runs without globals, so testing-library cannot auto-register cleanup.
afterEach(cleanup)

function panelRows(ids: readonly string[]): LiveRow[] {
  return ids.map(id => ({ kind: 'panel', id }))
}

function renderPage(profile: ProfileConfig): ReturnType<typeof createHarness> {
  const harness = createHarness({ profile })
  render(<Section deps={harness.deps} close={() => {}} />)
  return harness
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-row-id="${id}"]`)
  if (row === null) throw new Error(`no row rendered for "${id}"`)
  return row as HTMLElement
}

describe('SequenceEditor', () => {
  it('renders a row per plan row, with its glyph, name and badges', () => {
    const harness = renderPage({
      sequence: [
        { type: 'entry', id: 'plugins' },
        { type: 'group', id: 'group:g1', members: ['schedules', 'skills', 'ghost'] },
      ],
      entries: { plugins: { hidden: true } },
    })

    expect(harness.plan().rows.map(row => row.id)).toEqual(['plugins', 'group:g1'])

    const plugins = rowOf('plugins')
    expect(within(plugins).getByText('Plugins')).toBeTruthy()
    expect(plugins.querySelector('[data-badge="hidden"]')?.textContent).toBe('Hidden')
    expect(plugins.querySelector('[data-glyph]')).not.toBeNull()

    const group = rowOf('group:g1')
    expect(group.querySelector('[data-badge="group"]')?.textContent).toBe('3 panels')
    // The group's own label defaults to its first live member's name.
    expect((group.querySelector('[data-action="select"]') as HTMLElement).textContent).toContain('Scheduled tasks')
    const ghost = group.querySelector('[data-member-id="ghost"]')
    expect(ghost).not.toBeNull()
    expect((ghost as HTMLElement).querySelector('[data-badge="missing"]')).not.toBeNull()
  })

  it('moves a row down through materializeSequence', () => {
    const profile = profileWith(['plugins', 'schedules', 'skills'])
    const harness = renderPage(profile)

    fireEvent.click(within(rowOf('plugins')).getByRole('button', { name: 'Move down' }))

    expect(harness.updates).toHaveLength(1)
    expect(harness.updates[0]).toEqual(moveRow(materializeSequence(profile, panelRows(['plugins', 'schedules', 'skills'])), 'plugins', 1))
    expect(harness.updates[0]?.sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])
  })

  it('keeps the move-up button disabled on the first row', () => {
    renderPage(profileWith(['plugins', 'schedules']))
    const up = within(rowOf('plugins')).getByRole('button', { name: 'Move up' })
    expect((up as HTMLButtonElement).disabled).toBe(true)
  })

  it('groups a row with the next row', () => {
    const harness = renderPage(profileWith(['plugins', 'schedules', 'skills']))

    fireEvent.click(within(rowOf('plugins')).getByRole('button', { name: 'Group with next' }))

    const next = harness.updates[0]
    expect(next?.sequence).toHaveLength(2)
    const group = next?.sequence[0]
    expect(group?.type).toBe('group')
    if (group?.type !== 'group') throw new Error('expected the first item to be a group')
    expect(group.members).toEqual(['plugins', 'schedules'])
    // No explicit name is written: README §2.6 makes the trigger's default
    // identity the first member's own name, resolved when it renders (so it also
    // follows a language switch instead of freezing the creation-time one).
    expect(group.label).toBeUndefined()
    expect(next?.sequence[1]).toEqual({ type: 'entry', id: 'skills' })
  })

  it('dissolves a group back into bare rows', () => {
    const profile: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }, { type: 'entry', id: 'skills' }],
      entries: {},
    }
    const harness = renderPage(profile)

    fireEvent.click(within(rowOf('group:g1')).getByRole('button', { name: 'Ungroup' }))

    expect(harness.updates[0]?.sequence).toEqual([
      { type: 'entry', id: 'plugins' },
      { type: 'entry', id: 'schedules' },
      { type: 'entry', id: 'skills' },
    ])
  })

  it('adds a dragged row to the group row it is dropped on', () => {
    const profile: ProfileConfig = {
      sequence: [
        { type: 'entry', id: 'plugins' },
        { type: 'group', id: 'group:g1', members: ['schedules', 'skills'] },
      ],
      entries: {},
    }
    const harness = renderPage(profile)
    const source = rowOf('plugins')
    const target = rowOf('group:g1')

    fireEvent.dragStart(source)
    fireEvent.dragOver(target)
    fireEvent.drop(target)

    const next = harness.updates[0]
    expect(next?.sequence).toHaveLength(1)
    const group = next?.sequence[0]
    if (group?.type !== 'group') throw new Error('expected one group to remain')
    expect(group.members).toEqual(['schedules', 'skills', 'plugins'])
  })

  it('takes a member out of its group when it is dropped on the top level', () => {
    const profile: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }, { type: 'entry', id: 'skills' }],
      entries: {},
    }
    const harness = renderPage(profile)
    const member = document.querySelector('[data-member-id="plugins"]')
    if (member === null) throw new Error('no member rendered')

    fireEvent.dragStart(member)
    fireEvent.drop(screen.getByTestId('dsh-panellist-settings-dropZone'))

    const next = harness.updates[0]
    expect(next?.sequence.map(item => item.type)).toEqual(['group', 'entry', 'entry'])
    const group = next?.sequence[0]
    if (group?.type !== 'group') throw new Error('expected the group to survive')
    expect(group.members).toEqual(['schedules'])
    expect(next?.sequence[1]).toEqual({ type: 'entry', id: 'plugins' })
  })

  it('lists the whole rail from the start, with the gate explained', () => {
    const harness = renderPage(emptyProfileConfig())

    expect(harness.plan().reordering).toBe(false)
    expect(screen.getByText(/no order is written/)).toBeTruthy()
    // Every registered panel is a row from the first open: there is no
    // "configured yet?" pool to opt into.
    expect(document.querySelectorAll('[data-row-kind]')).toHaveLength(3)
    expect(document.querySelector('[data-row-id="schedules"]')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Use the current rail order as a starting point' }))

    expect(harness.updates[0]?.sequence.map(item => item.id)).toEqual(['plugins', 'schedules', 'skills'])
  })

  it('hides and shows a row straight from the list', () => {
    const initial = profileWith(['plugins', 'schedules'])
    const harness = renderPage(initial)

    // The button is a command whose name is the action ("Hide" / "Show"), so the
    // label flips with the state instead of an aria-pressed toggle.
    fireEvent.click(within(rowOf('plugins')).getByRole('button', { name: 'Hide' }))
    expect(harness.updates[0]).toEqual(setPanelHidden(initial, 'plugins', true))

    // The store accepts it: the same button now offers the way back.
    const hidden = setPanelHidden(initial, 'plugins', true)
    harness.setProfile(hidden)
    fireEvent.click(within(rowOf('plugins')).getByRole('button', { name: 'Show' }))
    expect(harness.updates[1]).toEqual(setPanelHidden(hidden, 'plugins', false))
  })

  it('hides a row WITHOUT materializing the sequence', () => {
    // The redesign's central property: hiding is one row's override, not a
    // structural edit. Started from an empty profile on purpose — with an
    // already-materialized sequence, `apply` and `applyStructural` would produce
    // the same update and the property would go untested.
    const harness = renderPage(emptyProfileConfig())
    fireEvent.click(within(rowOf('plugins')).getByRole('button', { name: 'Hide' }))
    expect(harness.updates[0]).toEqual({
      sequence: [],
      entries: { plugins: { hidden: true } },
    })
    // The rail order is still the contributors' own: nothing was taken over.
    expect(harness.plan().reordering).toBe(false)
  })

  it('hides a group trigger through the same button', () => {
    const initial: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }],
      entries: {},
    }
    const harness = renderPage(initial)
    fireEvent.click(within(rowOf('group:g1')).getByRole('button', { name: 'Hide' }))
    expect(harness.updates[0]).toEqual(setGroupHidden(initial, 'group:g1', true))
  })

  it('says so when nothing is registered at all', () => {
    const harness = createHarness({ profile: emptyProfileConfig(), registered: [] })
    render(<Section deps={harness.deps} close={() => {}} />)
    expect(screen.getByText('No panel is registered on this profile yet.')).toBeTruthy()
  })
})
