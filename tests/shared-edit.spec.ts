/**
 * The pure editing API the settings page is built on. The one invariant every
 * case checks: a panel id appears **at most once** anywhere in the sequence.
 */
import { describe, expect, it } from 'vitest'
import { emptyProfileConfig, type ProfileConfig, type SequenceItem } from '../src/shared/config.ts'
import {
  addToGroup,
  cleanOrphans,
  createGroup,
  dissolveGroup,
  materializeSequence,
  moveMember,
  moveRow,
  moveRowTo,
  removeFromGroup,
  setGroupLabel,
  setPanelHidden,
  setPanelLabel,
} from '../src/shared/edit.ts'

function profile(sequence: SequenceItem[] = [], extra: Partial<ProfileConfig> = {}): ProfileConfig {
  return { ...emptyProfileConfig(), sequence, ...extra }
}

function ids(profile: ProfileConfig): string[] {
  return profile.sequence.map(item => item.id)
}

/** Every panel id mentioned anywhere in the sequence, in order. */
function panelIds(profile: ProfileConfig): string[] {
  const result: string[] = []
  for (const item of profile.sequence) {
    if (item.type === 'entry') result.push(item.id)
    else result.push(...item.members)
  }
  return result
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

describe('overrides', () => {
  it('sets, trims and clears a name', () => {
    const named = setPanelLabel(profile(), 'a', '  Alpha  ')
    expect(named.entries['a']?.label).toBe('Alpha')
    const cleared = setPanelLabel(named, 'a', null)
    expect(cleared.entries['a']).toBeUndefined()
    // The input is never mutated.
    expect(named.entries['a']?.label).toBe('Alpha')
  })

  it('treats hidden:false and original icons as "no opinion"', () => {
    const hidden = setPanelHidden(profile(), 'a', true)
    expect(hidden.entries['a']?.hidden).toBe(true)
    const shown = setPanelHidden(hidden, 'a', false)
    expect(shown.entries['a']).toBeUndefined()
  })
})

describe('materializeSequence', () => {
  it('turns the live rail order into an explicit, complete sequence', () => {
    const live = [
      { kind: 'panel' as const, id: 'a' },
      { kind: 'group' as const, id: 'group:g1' },
      { kind: 'panel' as const, id: 'd' },
    ]
    const partial = profile([
      { type: 'group', id: 'group:g1', members: ['b', 'c'] },
      { type: 'entry', id: 'ghost' },
    ])
    const materialized = materializeSequence(partial, live)
    expect(ids(materialized)).toEqual(['a', 'group:g1', 'd', 'ghost'])
    expect(panelIds(materialized)).toEqual(['a', 'b', 'c', 'd', 'ghost'])
    expect(hasDuplicates(panelIds(materialized))).toBe(false)
  })
})

describe('row moves', () => {
  const base = profile([
    { type: 'entry', id: 'a' },
    { type: 'entry', id: 'b' },
    { type: 'entry', id: 'c' },
  ])

  it('moves by delta and clamps at the edges', () => {
    expect(ids(moveRow(base, 'b', -1))).toEqual(['b', 'a', 'c'])
    expect(ids(moveRow(base, 'a', -1))).toEqual(['a', 'b', 'c'])
    expect(ids(moveRow(base, 'c', 5))).toEqual(['a', 'b', 'c'])
  })

  it('moves to an absolute index and is a no-op for an unknown row', () => {
    expect(ids(moveRowTo(base, 'c', 0))).toEqual(['c', 'a', 'b'])
    expect(ids(moveRowTo(base, 'nope', 0))).toEqual(['a', 'b', 'c'])
  })
})

describe('groups', () => {
  const base = profile([
    { type: 'entry', id: 'a' },
    { type: 'entry', id: 'b' },
    { type: 'entry', id: 'c' },
    { type: 'entry', id: 'd' },
  ])

  it('creates a group where its topmost member stood', () => {
    const created = createGroup(base, 'group:g1', ['b', 'd'])
    expect(ids(created)).toEqual(['a', 'group:g1', 'c'])
    expect(panelIds(created)).toEqual(['a', 'b', 'd', 'c'])
    expect(hasDuplicates(panelIds(created))).toBe(false)
  })

  it('collects a member out of another group without leaving a duplicate', () => {
    const first = createGroup(base, 'group:g1', ['a', 'b'])
    const second = createGroup(first, 'group:g2', ['c', 'd'])
    const stolen = addToGroup(second, 'group:g2', 'a')
    expect(panelIds(stolen)).toEqual(['b', 'c', 'd', 'a'])
    expect(hasDuplicates(panelIds(stolen))).toBe(false)
  })

  it('adds at an explicit index inside the group', () => {
    const grouped = createGroup(base, 'group:g1', ['c', 'd'])
    const inserted = addToGroup(grouped, 'group:g1', 'a', 1)
    const group = inserted.sequence.find(item => item.type === 'group')
    expect(group?.type === 'group' ? group.members : []).toEqual(['c', 'a', 'd'])
  })

  it('dissolves a group in place', () => {
    const grouped = createGroup(base, 'group:g1', ['b', 'c'])
    expect(ids(dissolveGroup(grouped, 'group:g1'))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes a member out right after its group, and dissolves an emptied one', () => {
    const grouped = createGroup(base, 'group:g1', ['b', 'c'])
    expect(ids(removeFromGroup(grouped, 'group:g1', 'b'))).toEqual(['a', 'group:g1', 'b', 'd'])
    expect(ids(removeFromGroup(grouped, 'group:g1', 'c'))).toEqual(['a', 'group:g1', 'c', 'd'])
    const single = removeFromGroup(grouped, 'group:g1', 'b')
    // The group loses its last member: it dissolves and the member takes its slot.
    expect(ids(removeFromGroup(single, 'group:g1', 'c'))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('reorders members inside their group', () => {
    const grouped = createGroup(base, 'group:g1', ['a', 'b', 'c'])
    const group = (p: ProfileConfig): readonly string[] => {
      const item = p.sequence.find(candidate => candidate.type === 'group')
      return item?.type === 'group' ? item.members : []
    }
    expect(group(moveMember(grouped, 'group:g1', 'c', -1))).toEqual(['a', 'c', 'b'])
    expect(group(moveMember(grouped, 'group:g1', 'a', -1))).toEqual(['a', 'b', 'c'])
  })

  it('names the group trigger and clears the name again', () => {
    const grouped = createGroup(base, 'group:g1', ['a'])
    const named = setGroupLabel(grouped, 'group:g1', 'More')
    const item = named.sequence[0]
    expect(item?.type === 'group' ? item.label : undefined).toBe('More')
    const cleared = setGroupLabel(named, 'group:g1', '  ')
    const clearedItem = cleared.sequence[0]
    expect(clearedItem?.type === 'group' ? clearedItem.label : undefined).toBeUndefined()
  })

  it('lands where the topmost member stood even when that member dissolves its own group', () => {
    // Regression: the insert index used to be taken before the removals, so a
    // group dissolving to the left of it shifted the new group one row down.
    const first = profile([{ type: 'group', id: 'group:g1', members: ['a'] }, { type: 'entry', id: 'b' }, { type: 'entry', id: 'c' }])
    const created = createGroup(first, 'group:g2', ['a', 'b'])
    expect(ids(created)).toEqual(['group:g2', 'c'])
    const group = created.sequence[0]
    expect(group?.type === 'group' ? group.members : []).toEqual(['a', 'b'])
    expect(hasDuplicates(panelIds(created))).toBe(false)
  })

  it('finds a member that currently lives inside another group', () => {
    const nested = profile([{ type: 'entry', id: 'x' }, { type: 'group', id: 'group:g1', members: ['a', 'b'] }])
    const created = createGroup(nested, 'group:g2', ['a'])
    // The topmost member sat inside group:g1, so the new group takes that slot.
    expect(ids(created)).toEqual(['x', 'group:g2', 'group:g1'])
    expect(panelIds(created)).toEqual(['x', 'a', 'b'])
    expect(hasDuplicates(panelIds(created))).toBe(false)
  })

  it('splits a lone group into the new group above what is left of it', () => {
    const solo = profile([{ type: 'group', id: 'group:g1', members: ['a', 'b'] }])
    const created = createGroup(solo, 'group:g2', ['a'])
    expect(ids(created)).toEqual(['group:g2', 'group:g1'])
    expect(panelIds(created)).toEqual(['a', 'b'])
  })
})

describe('group member seats (see GroupItem.seats)', () => {
  const seated = (id: string, seat: 'top' | 'footer'): SequenceItem => ({ type: 'entry', id, seat })

  it('records each member seat when the group is built', () => {
    const base = profile([seated('a', 'top'), { type: 'entry', id: 'b' }, seated('c', 'footer')])
    const grouped = createGroup(base, 'group:g1', ['a', 'b', 'c'])
    const group = grouped.sequence[0]
    expect(group).toMatchObject({ type: 'group', members: ['a', 'b', 'c'], seats: { a: 'top', c: 'footer' } })
    // A member with no stored seat records nothing: it has nothing to restore.
  })

  it('carries a member seat over from a previous group', () => {
    const first = createGroup(profile([seated('a', 'footer'), seated('b', 'top')]), 'group:g1', ['a', 'b'])
    const regrouped = createGroup(first, 'group:g2', ['a'])
    const group = regrouped.sequence.find(item => item.type === 'group' && item.id === 'group:g2')
    expect(group).toMatchObject({ members: ['a'], seats: { a: 'footer' } })
  })

  it('puts seats back when a group dissolves', () => {
    const base = profile([seated('a', 'top'), seated('b', 'footer')])
    const grouped = createGroup(base, 'group:g1', ['a', 'b'])
    const dissolved = dissolveGroup(grouped, 'group:g1')
    expect(ids(dissolved)).toEqual(['a', 'b'])
    expect(dissolved.sequence[0]).toEqual({ type: 'entry', id: 'a', seat: 'top' })
    expect(dissolved.sequence[1]).toEqual({ type: 'entry', id: 'b', seat: 'footer' })
  })

  it('records a seat when a member joins, and restores it when it leaves', () => {
    const base = profile([{ type: 'group', id: 'group:g1', members: ['b'] }, seated('a', 'footer')])
    const joined = addToGroup(base, 'group:g1', 'a')
    const group = joined.sequence[0]
    expect(group).toMatchObject({ members: ['b', 'a'], seats: { a: 'footer' } })

    const left = removeFromGroup(joined, 'group:g1', 'a')
    expect(ids(left)).toEqual(['group:g1', 'a'])
    expect(left.sequence[1]).toEqual({ type: 'entry', id: 'a', seat: 'footer' })
    // The record leaves with the member: an empty `seats` map is not kept.
    const remaining = left.sequence[0]
    expect(remaining).toMatchObject({ members: ['b'] })
    expect(remaining).not.toHaveProperty('seats')
  })

  it('leaves seat-less members untouched by the record', () => {
    const base = profile([{ type: 'group', id: 'group:g1', members: ['b'] }, { type: 'entry', id: 'a' }])
    const joined = addToGroup(base, 'group:g1', 'a')
    expect(joined.sequence[0]).not.toHaveProperty('seats')
    const left = removeFromGroup(joined, 'group:g1', 'a')
    expect(left.sequence[1]).toEqual({ type: 'entry', id: 'a' })
  })
})

describe('cleanOrphans', () => {
  it('drops everything whose panel is gone and keeps the rest intact', () => {
    const dirty = profile(
      [
        { type: 'entry', id: 'a' },
        { type: 'entry', id: 'ghost' },
        { type: 'group', id: 'group:g1', members: ['b', 'phantom'] },
      ],
      { entries: { b: { label: 'Bee' }, phantom: { label: 'P' } } },
    )
    const cleaned = cleanOrphans(dirty, ['a', 'b'])
    expect(ids(cleaned)).toEqual(['a', 'group:g1'])
    expect(panelIds(cleaned)).toEqual(['a', 'b'])
    expect(Object.keys(cleaned.entries)).toEqual(['b'])
  })
})
