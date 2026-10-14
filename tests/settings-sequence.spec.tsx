/**
 * Sequence editor behaviour (task-4, item 2).
 *
 * Every structural assertion goes through `shared/edit.ts` so the spec pins the
 * *contract* — materialize first, then the edit — rather than a hand-rolled
 * expectation that could drift from the model.
 *
 * A structural edit is a *preview*: it lands in memory only, so the assertions
 * read `harness.profile()` (what the page shows) and leave `harness.updates`
 * (what was written) to the specs that exercise the write path itself.
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
  return ids.map(id => ({ kind: 'panel', id, container: 'top' }))
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

/**
 * The grab handle inside a row (or member) element: the row's drag origin and,
 * now that the ↑/↓ buttons are gone, its keyboard reorder control.
 */
function handleOf(scope: HTMLElement): HTMLElement {
  const handle = scope.querySelector('[data-drag-handle="true"]')
  if (handle === null) throw new Error('the row has no drag handle')
  return handle as HTMLElement
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

    // The row's grab handle is the keyboard control now that the ↑/↓ buttons are
    // gone: focus it and press the arrow key.
    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })

    // A preview, not a write: the order lands in memory, the file is untouched
    // until the save button commits it.
    expect(harness.updates).toHaveLength(0)
    expect(harness.profile()).toEqual(moveRow(materializeSequence(profile, panelRows(['plugins', 'schedules', 'skills'])), 'plugins', 1))
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])
    // Every row is in the top seat, and materializing writes that seat down: a
    // same-seat reorder must not lose the seat the plan already resolved.
    expect(harness.profile().sequence.every(item => item.type === 'entry' && item.seat === 'top')).toBe(true)
  })

  it('moves a row back up with the arrow keys, and stops at the ends', () => {
    const profile = profileWith(['plugins', 'schedules', 'skills'])
    const harness = renderPage(profile)

    fireEvent.keyDown(handleOf(rowOf('schedules')), { key: 'ArrowUp' })
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])

    // The row that is now first has nowhere to go: the key is swallowed, not
    // applied, which is the behaviour the old disabled "Move up" button used to
    // express with a `disabled` attribute.
    fireEvent.keyDown(handleOf(rowOf('schedules')), { key: 'ArrowUp' })
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])

    // The same at the other end: the last row cannot step down.
    fireEvent.keyDown(handleOf(rowOf('skills')), { key: 'ArrowDown' })
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])
  })

  it('keeps the arrow keys free for other modifiers, and for scrolling otherwise', () => {
    const harness = renderPage(profileWith(['plugins', 'schedules']))

    // Ctrl/Alt/Meta + arrow belongs to the host and to assistive tooling, so the
    // handle must not claim it.
    for (const key of ['ArrowDown', 'ArrowUp']) {
      fireEvent.keyDown(handleOf(rowOf('plugins')), { key, ctrlKey: true })
      fireEvent.keyDown(handleOf(rowOf('plugins')), { key, altKey: true })
      fireEvent.keyDown(handleOf(rowOf('plugins')), { key, metaKey: true })
    }
    expect(harness.profile()).toEqual(profileWith(['plugins', 'schedules']))

    // Any other key is left alone too.
    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'Tab' })
    expect(harness.profile()).toEqual(profileWith(['plugins', 'schedules']))
  })

  it('groups a row with the next row', () => {
    const harness = renderPage(profileWith(['plugins', 'schedules', 'skills']))

    fireEvent.click(within(rowOf('plugins')).getByRole('button', { name: 'Group with next' }))

    const next = harness.profile()
    expect(next.sequence).toHaveLength(2)
    const group = next.sequence[0]
    expect(group?.type).toBe('group')
    if (group?.type !== 'group') throw new Error('expected the first item to be a group')
    expect(group.members).toEqual(['plugins', 'schedules'])
    // No explicit name is written: README §2.6 makes the trigger's default
    // identity the first member's own name, resolved when it renders (so it also
    // follows a language switch instead of freezing the creation-time one).
    expect(group.label).toBeUndefined()
    // `skills` keeps the seat the plan resolved for it, so the seat survives the
    // group edit too — only `plugins` and `schedules` lose theirs by joining a
    // group, which renders in one seat as a unit.
    expect(next.sequence[1]).toEqual({ type: 'entry', id: 'skills', seat: 'top' })
  })

  it('dissolves a group back into bare rows', () => {
    const profile: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }, { type: 'entry', id: 'skills' }],
      entries: {},
    }
    const harness = renderPage(profile)

    fireEvent.click(within(rowOf('group:g1')).getByRole('button', { name: 'Ungroup' }))

    expect(harness.profile().sequence).toEqual([
      // A dissolved group leaves its members bare. Only `skills` was a bare row
      // already, so only it carries the seat the plan resolved for it; the two that
      // were folded inside the group had no seat of their own while suppressed, and
      // get one the next time the plan runs (which reads their contributor seat).
      { type: 'entry', id: 'plugins' },
      { type: 'entry', id: 'schedules' },
      { type: 'entry', id: 'skills', seat: 'top' },
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

    // The handle is the only drag origin: the row itself is not draggable, which
    // is what stops a slightly-moved click on Select/Hide from starting a drag.
    expect(source.getAttribute('draggable')).toBeNull()

    fireEvent.dragStart(handleOf(source))
    fireEvent.dragOver(target)
    fireEvent.drop(target)

    const next = harness.profile()
    expect(next.sequence).toHaveLength(1)
    const group = next.sequence[0]
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

    // A member's drag starts on its own handle; the group row above it must not
    // claim the same dragstart and turn it into a top-level row move.
    fireEvent.dragStart(handleOf(member as HTMLElement))
    fireEvent.drop(screen.getByTestId('dsh-panellist-settings-dropZone'))

    const next = harness.profile()
    expect(next.sequence.map(item => item.type)).toEqual(['group', 'entry', 'entry'])
    const group = next.sequence[0]
    if (group?.type !== 'group') throw new Error('expected the group to survive')
    expect(group.members).toEqual(['schedules'])
    // `plugins` left the group, so it carries the seat the plan resolved for it
    // again — the seat is a property of the row, not of the group. (`skills`, the
    // row that was already bare, is the one that proves the seat is written.)
    expect(next.sequence[1]).toEqual({ type: 'entry', id: 'plugins' })
    expect(next.sequence[2]).toEqual({ type: 'entry', id: 'skills', seat: 'top' })
  })

  it('opens a member’s own editor from the member list of its group', () => {
    // A member is a panel like any other: its name in the list is the way into
    // its own name / icon editor. Without that affordance the entries folded
    // into a group could not be edited at all — they have no top-level row.
    const harness = renderPage({
      sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }],
      entries: {},
    })

    const select = rowOf('group:g1').querySelector('[data-member-id="schedules"] [data-action="select"]')
    if (select === null) throw new Error('the member row has no select affordance')
    fireEvent.click(select)

    expect(document.querySelector('[data-editor="panel"][data-editor-id="schedules"]')).not.toBeNull()
    expect(rowOf('group:g1').querySelector('[data-member-id="schedules"]')?.getAttribute('data-selected')).toBe('true')
    // Selecting is navigation, not a configuration write.
    expect(harness.updates).toEqual([])
  })

  it('hides and shows a group member from its own row', () => {
    // A member's rail row is already suppressed, so "hidden" inside a group
    // means "leave it out of the group's menu" — but the entry point is the
    // same per-row Hide/Show button every other row has.
    const initial: ProfileConfig = {
      sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }],
      entries: {},
    }
    const harness = renderPage(initial)

    const member = rowOf('group:g1').querySelector('[data-member-id="schedules"]')
    if (member === null) throw new Error('no member row rendered')
    const toggle = member.querySelector('[data-action="memberToggleHidden"]')
    if (toggle === null) throw new Error('the member row has no hide/show affordance')

    // Hide/Show is the LAST control on the row, like every other row's: the
    // order is "move, then act, then visibility". Moving is the handle now, and
    // the handle is not a `data-action` button — the ↑/↓ pair is gone.
    const order = Array.from(member.querySelectorAll('[data-action]')).map(node => node.getAttribute('data-action'))
    expect(order).toEqual(['select', 'memberRemove', 'memberToggleHidden'])
    // The move affordance is still on the row, just not as a button pair.
    expect(handleOf(member as HTMLElement).getAttribute('data-drag-handle')).toBe('true')

    fireEvent.click(toggle)
    expect(harness.updates[0]).toEqual({
      sequence: initial.sequence,
      entries: { schedules: { hidden: true } },
    })

    // The store accepts it: the same button now offers the way back, and the
    // row carries the same "hidden" badge a top-level row does.
    const hidden = setPanelHidden(initial, 'schedules', true)
    harness.setProfile(hidden)
    const memberAfter = rowOf('group:g1').querySelector('[data-member-id="schedules"]')
    expect(memberAfter?.querySelector('[data-badge="hidden"]')).not.toBeNull()
    fireEvent.click(memberAfter?.querySelector('[data-action="memberToggleHidden"]') as HTMLElement)
    expect(harness.updates[1]).toEqual(setPanelHidden(hidden, 'schedules', false))
  })

  it('lists the whole rail from the start, with no gate to open first', () => {
    const harness = renderPage(emptyProfileConfig())

    // Nothing is configured yet, so the plan is in "the contributors' order
    // stands" mode and writes no `order` at all…
    expect(harness.plan().reordering).toBe(false)
    // …and the list is nevertheless complete from the first open: there is no
    // banner to read and no "use the current order as a starting point" step in
    // front of the rows the user came to edit.
    expect(document.querySelectorAll('[data-row-kind]')).toHaveLength(3)
    expect(document.querySelector('[data-row-id="schedules"]')).not.toBeNull()
    expect(document.querySelector('[data-action="materialize"]')).toBeNull()
    expect(screen.queryByText(/no order is written/)).toBeNull()

    // The first structural edit turns the live order into an explicit sequence
    // on its way in, so the gate stays invisible in both directions. Reordering
    // is reachable from the first frame: the handle carries it, with no button
    // pair and no "materialize first" step in front of it.
    fireEvent.keyDown(handleOf(rowOf('plugins')), { key: 'ArrowDown' })
    expect(harness.profile().sequence.map(item => item.id)).toEqual(['schedules', 'plugins', 'skills'])
  })

  it('hides and shows a row straight from the list', () => {
    const initial = profileWith(['plugins', 'schedules'])
    const harness = renderPage(initial)

    // A hide is a command, not a gesture: it commits the moment it is chosen, so
    // the assertion reads the write path.
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
    // The group row's own toggle (`toggleHidden`), not the member rows' —
    // those carry their own `memberToggleHidden` buttons.
    const toggle = rowOf('group:g1').querySelector('[data-action="toggleHidden"]')
    if (toggle === null) throw new Error('the group row has no hide/show affordance')
    fireEvent.click(toggle)
    expect(harness.updates[0]).toEqual(setGroupHidden(initial, 'group:g1', true))
  })

  it('says so when nothing is registered at all', () => {
    const harness = createHarness({ profile: emptyProfileConfig(), registered: [] })
    render(<Section deps={harness.deps} />)
    expect(screen.getByText('No panel is registered on this profile yet.')).toBeTruthy()
  })
})
