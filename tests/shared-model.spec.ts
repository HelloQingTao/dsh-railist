/**
 * The sequence model, verified against the six examples confirmed in
 * README.zh-CN.md §2.2 plus the takeover rules of §2.3/§2.8/§2.9/§2.11.
 */
import { describe, expect, it } from 'vitest'
import { emptyProfileConfig, groupRailId, type ProfileConfig } from '../src/shared/config.ts'
import { buildPlan, ORDER_STEP, type RegisteredPanel } from '../src/shared/model.ts'

const PANELS: RegisteredPanel[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
  id,
  label: id.toUpperCase(),
  order: index,
}))

function profile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return { ...emptyProfileConfig(), ...overrides }
}

/** `[a][b]...` / `[G{a,b}]` shorthand, so a test reads like the README table. */
function shape(items: readonly (string | { group: string; members: string[] })[]): ProfileConfig {
  return profile({
    sequence: items.map(item => (typeof item === 'string'
      ? { type: 'entry' as const, id: item }
      : { type: 'group' as const, id: item.group, members: item.members })),
  })
}

describe('buildPlan: the six confirmed examples', () => {
  it('a c b d e → five bare rows in that order', () => {
    const plan = buildPlan(PANELS, shape(['a', 'c', 'b', 'd', 'e']))
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(plan.rows.map(row => row.order)).toEqual([10, 20, 30, 40, 50])
    expect(plan.groups.size).toBe(0)
  })

  it('a b c → three bare rows (and the other two are appended, not lost)', () => {
    const plan = buildPlan(PANELS.slice(0, 3), shape(['a', 'b', 'c']))
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(plan.unmanaged).toEqual([])
  })

  it('a 下拉(b c d e) → a then one group holding the rest', () => {
    const plan = buildPlan(PANELS, shape(['a', { group: 'group:g1', members: ['b', 'c', 'd', 'e'] }]))
    expect(plan.rows.map(row => [row.kind, row.id])).toEqual([['panel', 'a'], ['group', 'group:g1']])
    const group = plan.groups.get('group:g1')
    expect(group?.members.map(member => member.id)).toEqual(['b', 'c', 'd', 'e'])
    expect(group?.order).toBe(ORDER_STEP * 2)
    // Members are shown inside the group instead of on the rail.
    for (const id of ['b', 'c', 'd', 'e']) {
      expect(plan.panels.get(id)?.suppressed).toBe(true)
      expect(plan.panels.get(id)?.hidden).toBe(false)
    }
    expect(plan.panels.get('a')?.suppressed).toBe(false)
  })

  it('a 下拉(b d e c) → member order is the configured order', () => {
    const plan = buildPlan(PANELS, shape(['a', { group: 'group:g1', members: ['b', 'd', 'e', 'c'] }]))
    expect(plan.groups.get('group:g1')?.members.map(member => member.id)).toEqual(['b', 'd', 'e', 'c'])
  })

  it('a 下拉(b e c) d → group between two bare rows', () => {
    const plan = buildPlan(PANELS, shape(['a', { group: 'group:g1', members: ['b', 'e', 'c'] }, 'd']))
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'group:g1', 'd'])
    expect(plan.groups.get('group:g1')?.members.map(member => member.id)).toEqual(['b', 'e', 'c'])
  })

  it('下拉(a b c) d e → group first', () => {
    const plan = buildPlan(PANELS, shape([{ group: 'group:g1', members: ['a', 'b', 'c'] }, 'd', 'e']))
    expect(plan.rows.map(row => row.id)).toEqual(['group:g1', 'd', 'e'])
    expect(plan.groups.get('group:g1')?.order).toBe(ORDER_STEP)
  })

  it('names the group after its first live member, and the rail id in the plugin namespace', () => {
    const plan = buildPlan(PANELS, shape(['a', { group: 'group:g1', members: ['c', 'b'] }]))
    const group = plan.groups.get('group:g1')
    expect(group?.label).toBe('C')
    expect(group?.labelExplicit).toBe(false)
    expect(group?.railId).toBe(groupRailId('group:g1'))
    expect(group?.railId).toBe('dsh-panellist:group:g1')
    expect(group?.iconFallbackPanelId).toBe('c')
  })
})

describe('buildPlan: takeover scope', () => {
  it('keeps the ledger order when panels declare the same order', () => {
    // The shell sorts the same slot with a stable sort, so equal `order` values
    // stay in registration order. Ties must therefore NOT be broken
    // alphabetically here: that would show the rail and the "not configured"
    // list in two different orders (found on a real DSH window).
    const registered: RegisteredPanel[] = [
      { id: 'zulu', label: 'Zulu', order: 0 },
      { id: 'mike', label: 'Mike', order: 0 },
      { id: 'alfa', label: 'Alfa', order: 0 },
    ]
    const plan = buildPlan(registered, shape(['zulu']))
    expect(plan.rows.map(row => row.id)).toEqual(['zulu', 'mike', 'alfa'])
    expect(plan.unmanaged).toEqual(['mike', 'alfa'])
  })

  it('still lets a declared order win over the ledger order', () => {
    const registered: RegisteredPanel[] = [
      { id: 'second', label: 'Second', order: 20 },
      { id: 'first', label: 'First', order: 10 },
    ]
    const plan = buildPlan(registered, shape(['second']))
    expect(plan.rows.map(row => row.id)).toEqual(['second', 'first'])
    expect(plan.unmanaged).toEqual(['first'])
  })

  it('lists the whole rail from the start and writes no order until something is configured', () => {
    // The editor has no "not configured yet" pool: every registered panel is a
    // row from the first open, in the contributors' own order. What a fresh
    // install does NOT do is take over the order — every row's order is null, so
    // the rewrite pass writes nothing.
    const plan = buildPlan(PANELS, profile())
    expect(plan.reordering).toBe(false)
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(plan.rows.every(row => row.order === null)).toBe(true)
    for (const panel of plan.panels.values()) {
      expect(panel.order).toBeNull()
      expect(panel.managed).toBe(false)
    }
    expect(plan.unmanaged).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('still keys off the declared order when nothing is configured', () => {
    const registered: RegisteredPanel[] = [
      { id: 'late', label: 'Late', order: 30 },
      { id: 'early', label: 'Early', order: 10 },
      { id: 'middle', label: 'Middle', order: 20 },
    ]
    const plan = buildPlan(registered, profile())
    expect(plan.rows.map(row => row.id)).toEqual(['early', 'middle', 'late'])
    expect(plan.rows.every(row => row.order === null)).toBe(true)
  })

  it('an override alone is applied without reordering', () => {
    const plan = buildPlan(PANELS, profile({ entries: { b: { label: 'Bee' } } }))
    expect(plan.reordering).toBe(false)
    expect(plan.panels.get('b')?.label).toBe('Bee')
    expect(plan.panels.get('b')?.order).toBeNull()
    expect(plan.panels.get('b')?.managed).toBe(true)
    expect(plan.unmanaged).not.toContain('b')
    // The row is still listed, at its own place in the rail order.
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('unconfigured panels keep the tail of the rail, in native order', () => {
    const plan = buildPlan(PANELS, shape(['d']))
    expect(plan.rows.map(row => row.id)).toEqual(['d', 'a', 'b', 'c', 'e'])
    expect(plan.rows.map(row => row.order)).toEqual([10, 20, 30, 40, 50])
    expect(plan.unmanaged).toEqual(['a', 'b', 'c', 'e'])
  })

  it('a sequence of only-missing ids never reorders anything', () => {
    const plan = buildPlan(PANELS, shape(['ghost']))
    expect(plan.reordering).toBe(false)
    expect(plan.orphans).toEqual(['ghost'])
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(plan.rows.every(row => row.order === null)).toBe(true)
  })

  it('hidden is a hide-unless-active flag, never a suppression', () => {
    const plan = buildPlan(PANELS, profile({ entries: { b: { hidden: true } } }))
    expect(plan.panels.get('b')?.hidden).toBe(true)
    expect(plan.panels.get('b')?.suppressed).toBe(false)
  })

  it('a locked panel is left exactly as registered, even when listed', () => {
    const plan = buildPlan(PANELS, profile({ sequence: [{ type: 'entry', id: 'b' }], locked: ['b'] }))
    const panel = plan.panels.get('b')
    expect(panel?.locked).toBe(true)
    expect(panel?.order).toBeNull()
    expect(panel?.label).toBe('B')
    expect(panel?.managed).toBe(false)
    // Nothing live is left in the configured block, so the rail keeps its native
    // order; the locked panel itself is not a row (it has its own list).
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'c', 'd', 'e'])
    expect(plan.unmanaged).toEqual(['a', 'c', 'd', 'e'])
    expect(plan.warnings).toContainEqual({ code: 'locked-in-sequence', panelId: 'b' })
  })

  it('locking a panel takes it out of its group', () => {
    const plan = buildPlan(PANELS, profile({
      sequence: [{ type: 'group', id: 'group:g1', members: ['b', 'c'] }],
      locked: ['c'],
    }))
    expect(plan.groups.get('group:g1')?.members.map(member => member.id)).toEqual(['b'])
    expect(plan.panels.get('c')?.locked).toBe(true)
    expect(plan.warnings).toContainEqual({ code: 'locked-member', groupId: 'group:g1', panelId: 'c' })
  })
})

describe('buildPlan: orphans and warnings', () => {
  it('keeps configured ids that no registration answers', () => {
    const plan = buildPlan(PANELS.slice(0, 2), profile({
      sequence: [{ type: 'entry', id: 'ghost' }, { type: 'group', id: 'group:g1', members: ['a', 'phantom'] }],
      entries: { vanished: { label: 'Gone' } },
      locked: ['also-gone'],
    }))
    expect(plan.orphans).toEqual(['ghost', 'phantom', 'vanished', 'also-gone'])
    expect(plan.missingMembers).toEqual(['phantom'])
    expect(plan.groups.get('group:g1')?.members.find(member => member.id === 'phantom')?.missing).toBe(true)
  })

  it('a group whose members all vanished renders no row but keeps its config', () => {
    const plan = buildPlan(PANELS, profile({ sequence: [{ type: 'group', id: 'group:g1', members: ['ghost'] }] }))
    // No group row, and (nothing left configured) the panels keep their own order.
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(plan.rows.every(row => row.order === null)).toBe(true)
    expect(plan.groups.get('group:g1')?.order).toBeNull()
    expect(plan.dormantGroups).toEqual(['group:g1'])
  })

  it('rejects a group whose RAIL id is already registered by someone else', () => {
    // The bare id and the rail id are different strings, and it is the rail id
    // that gets registered and used as the `main` key (README §4.3).
    const plan = buildPlan([{ id: 'dsh-panellist:group:g1', label: 'Squatter', order: 0 }], profile({
      sequence: [{ type: 'group', id: 'group:g1', members: ['a'] }],
    }))
    expect(plan.warnings).toContainEqual({ code: 'group-id-collision', groupId: 'group:g1' })
    expect(plan.groups.has('group:g1')).toBe(false)
    // The squatter is just an ordinary registered panel from the model's point
    // of view, so it keeps its own row (the rail adapter filters our namespace
    // out before buildPlan ever sees it).
    expect(plan.rows.map(row => [row.kind, row.id, row.order])).toEqual([
      ['panel', 'dsh-panellist:group:g1', null],
    ])
  })

  it('reports the single-member group and a group id that collides with a panel', () => {
    const plan = buildPlan(PANELS, profile({
      sequence: [
        { type: 'group', id: 'group:g1', members: ['a'] },
        { type: 'group', id: 'b', members: ['c'] },
      ],
    }))
    expect(plan.warnings).toContainEqual({ code: 'single-member-group', groupId: 'group:g1' })
    expect(plan.warnings).toContainEqual({ code: 'group-id-collision', groupId: 'b' })
    expect(plan.groups.has('b')).toBe(false)
    expect(plan.panels.get('c')?.suppressed).toBe(false)
  })

  it('a duplicated panel keeps its first placement', () => {
    const plan = buildPlan(PANELS, profile({
      sequence: [{ type: 'entry', id: 'a' }, { type: 'group', id: 'group:g1', members: ['a', 'b'] }],
    }))
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'group:g1', 'c', 'd', 'e'])
    expect(plan.panels.get('a')?.suppressed).toBe(false)
    expect(plan.groups.get('group:g1')?.members.map(member => member.id)).toEqual(['b'])
    expect(plan.warnings).toContainEqual({ code: 'duplicate-in-sequence', panelId: 'a' })
  })

  it('an explicit group name and icon win over the first member', () => {
    const plan = buildPlan(PANELS, profile({
      sequence: [{ type: 'group', id: 'group:g1', members: ['c'], label: 'More', icon: { kind: 'builtin', name: 'star' } }],
    }))
    const group = plan.groups.get('group:g1')
    expect(group?.label).toBe('More')
    expect(group?.labelExplicit).toBe(true)
    expect(group?.icon).toEqual({ kind: 'builtin', name: 'star' })
  })
})
