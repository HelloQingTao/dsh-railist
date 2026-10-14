/**
 * The sequence model, verified against the six examples confirmed in
 * README.zh-CN.md §2.2 plus the takeover rules of §2.3/§2.8/§2.10.
 */
import { describe, expect, it } from 'vitest'
import { emptyProfileConfig, groupRailId, type ProfileConfig } from '../src/shared/config.ts'
import { buildPlan, ORDER_STEP, type Plan, type RegisteredPanel } from '../src/shared/model.ts'

const PANELS: RegisteredPanel[] = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
  id,
  label: id.toUpperCase(),
  order: index,
  container: 'top',
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

/**
 * The order each row would be WRITTEN at, in row order — read from the fields
 * the rewrite pass reads (a group's own order, a panel's own order), not from a
 * display field. `null` means "leave the native order alone".
 */
function rowOrders(plan: Plan): (number | null)[] {
  return plan.rows.map(row => (row.kind === 'group'
    ? plan.groups.get(row.id)?.order ?? null
    : plan.panels.get(row.id)?.order ?? null))
}

describe('buildPlan: the six confirmed examples', () => {
  it('a c b d e → five bare rows in that order', () => {
    const plan = buildPlan(PANELS, shape(['a', 'c', 'b', 'd', 'e']))
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'c', 'b', 'd', 'e'])
    expect(rowOrders(plan)).toEqual([10, 20, 30, 40, 50])
    expect(plan.groups.size).toBe(0)
  })

  it('a b c → three bare rows (and the other two are appended, not lost)', () => {
    const plan = buildPlan(PANELS.slice(0, 3), shape(['a', 'b', 'c']))
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(plan.reordering).toBe(true)
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
    expect(group?.railId).toBe('dsh-railist:group:g1')
    expect(group?.iconFallbackPanelId).toBe('c')
  })
})

/**
 * Seat placement: the sequence is one list, but the shell renders it in three
 * separate containers, so every row also carries the seat it belongs in. The rule
 * under test is "a row joins the seat of the row above it" (see `resolveSeats`),
 * which is what makes a drag read the way it looks.
 */
describe('buildPlan: seat placement', () => {
  /** Three rows in the top seat and two in the footer, as a real sidebar has. */
  const seated: RegisteredPanel[] = [
    { id: 'plugins', label: 'Plugins', order: 0, container: 'top' },
    { id: 'usage', label: 'Usage', order: 10, container: 'top' },
    { id: 'power', label: 'Power', order: -20, container: 'footer' },
    { id: 'capability', label: 'Capability', order: 10, container: 'footer' },
  ]

  it('leaves every row in its contributor seat when nothing moved', () => {
    // With nothing configured the tail keeps the contributors' own order — which
    // for these fixtures puts `power` (order -20) first — and the seat rule only
    // kicks in once a row actually follows another.
    const plan = buildPlan(seated, shape([]))
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['power', 'footer'],
      ['plugins', 'top'],
      ['usage', 'top'],
      ['capability', 'footer'],
    ])
  })

  it('drags the capability panel up under Usage (the confirmed example)', () => {
    // The user drags the capability panel to sit right after Usage statistics: the
    // nearest seat-bearing row above it is a top row, so it joins the top seat. The
    // rows nobody placed keep their own seat and are listed after the configured
    // block (README §2.11).
    //
    // `capability` is passed as the dragged row: the model cannot infer it from the
    // sequence, because a row can be dragged to a position its contributor seat
    // already implied.
    const plan = buildPlan(seated, shape(['plugins', 'usage', 'capability']), undefined, 'capability')
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['plugins', 'top'],
      ['usage', 'top'],
      ['capability', 'top'],
      ['power', 'footer'],
    ])
    // Within-seat orders are what the registry is handed: the top seat numbers its
    // own rows consecutively, so the shell keeps them adjacent with no gaps.
    expect(plan.panels.get('plugins')?.order).toBe(ORDER_STEP)
    expect(plan.panels.get('usage')?.order).toBe(ORDER_STEP * 2)
    expect(plan.panels.get('capability')?.order).toBe(ORDER_STEP * 3)
  })

  it('leaves every other row where it was when one row is dragged up', () => {
    // THE regression the user hit. Dropping a FOOTER row at the top used to cascade:
    // the seat pass applied "take the seat of the row above" to EVERY row, so the
    // footer row moving to the top made the first top row below it a footer row too,
    // which made the next row a top row, and so on down the list. Rows whose seat
    // flipped like that were appended into the host the shell does not render, dropped
    // out of the rail, and the sidebar rendered empty.
    //
    // Under README §2.11 only the dragged row may change seat.
    const plan = buildPlan(seated, shape(['capability', 'plugins', 'usage', 'power']), undefined, 'capability')
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      // `capability` leads the list with nothing seat-bearing above it, so it keeps
      // its own footer seat. Every row under it is untouched.
      ['capability', 'footer'],
      ['plugins', 'top'],
      ['usage', 'top'],
      ['power', 'footer'],
    ])
  })

  it('keeps the untouched rows of both seats when a footer row leads the list', () => {
    // The same cascade from the other side: dragging `power` to the head of the list
    // must not pull a top row into the footer, nor a footer row into the top.
    const plan = buildPlan(seated, shape(['power', 'usage', 'plugins']), undefined, 'power')
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['power', 'footer'],
      ['usage', 'top'],
      ['plugins', 'top'],
      ['capability', 'footer'],
    ])
  })

  it('renders the exact sequence that used to blank the sidebar', () => {
    // The config the user was left with after the buggy build wrote its cascade to
    // disk: a footer row (`capability`) leading, then both top rows, then the
    // remaining footer rows. Replaying it must put each row back in its own seat
    // and leave every row on the rail — nothing appended into the host the shell
    // does not render. This is the end-to-end shape of the regression, pinned so a
    // future seat rule cannot silently reintroduce it.
    const rows = [
      { id: 'plugins', label: 'Plugins', order: 0, container: 'top' as const },
      { id: 'usage', label: 'Usage', order: 10, container: 'top' as const },
      { id: 'power', label: 'Power', order: 0, container: 'footer' as const },
      { id: 'capability', label: 'Capability', order: 10, container: 'footer' as const },
      { id: 'cordis', label: 'Cordis', order: 20, container: 'footer' as const },
      { id: 'commandcode', label: 'CommandCode', order: 30, container: 'footer' as const },
    ]
    const sequence = ['capability', 'plugins', 'usage', 'power', 'cordis', 'commandcode']
    const plan = buildPlan(rows, shape(sequence), undefined, 'capability')
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['capability', 'footer'],
      ['plugins', 'top'],
      ['usage', 'top'],
      ['power', 'footer'],
      ['cordis', 'footer'],
      ['commandcode', 'footer'],
    ])
    // Every configured row is placed: none became an orphan on the way.
    expect(plan.orphans).toEqual([])
  })

  it('moves nothing when no drag is in flight', () => {
    // Without an explicit dragged row there is no evidence anything moved, so the
    // sequence alone must never re-seat a row. This is what keeps a plain reorder
    // (and a load of an existing config) from disturbing the seats.
    const plan = buildPlan(seated, shape(['plugins', 'usage', 'capability']))
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['plugins', 'top'],
      ['usage', 'top'],
      ['capability', 'footer'],
      ['power', 'footer'],
    ])
  })

  it('drags power down below the capability panel', () => {
    const plan = buildPlan(seated, shape(['capability', 'power']))
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['capability', 'footer'],
      ['power', 'footer'],
      ['plugins', 'top'],
      ['usage', 'top'],
    ])
    // Both configured rows are footer rows, so the footer seat numbers them 10/20.
    expect(plan.panels.get('capability')?.order).toBe(ORDER_STEP)
    expect(plan.panels.get('power')?.order).toBe(ORDER_STEP * 2)
  })

  it('keeps a row that leads the sequence in its own seat', () => {
    const plan = buildPlan(seated, shape(['power']))
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['power', 'footer'],
      ['plugins', 'top'],
      ['usage', 'top'],
      ['capability', 'footer'],
    ])
  })

  it('places a group in the seat of the row above it', () => {
    const plan = buildPlan(seated, shape(['power', { group: 'group:g1', members: ['plugins', 'usage'] }]))
    expect(plan.rows.map(row => [row.kind, row.container])).toEqual([
      ['panel', 'footer'],
      ['group', 'footer'],
      // The members are shown inside the group, so only `capability` is left over.
      ['panel', 'footer'],
    ])
    // A group row has no seat of its own, so it takes the nearest one above.
    expect(plan.groups.get('group:g1')?.order).toBe(ORDER_STEP * 2)
  })

  it('carries the seat onto the settings row like any other', () => {
    // Settings is a single-entry seat the shell owns. Like a group row it has no
    // seat of its own, so it renders wherever the row above it does — which is
    // what lets it be dragged below a footer row.
    const withSettings: RegisteredPanel[] = [
      ...seated,
      { id: 'settings', label: 'Settings', order: 0, container: 'settings' },
    ]
    const plan = buildPlan(withSettings, shape(['power', 'settings']))
    expect(plan.rows.map(row => [row.id, row.container])).toEqual([
      ['power', 'footer'],
      ['settings', 'footer'],
      ['plugins', 'top'],
      ['usage', 'top'],
      ['capability', 'footer'],
    ])
    // …but the DOM layer never places it: `placeRows` skips the seat, so the shell
    // keeps rendering its own settings row where it always was. Its panel entry
    // carries the same resolved seat, which is only where it sits in our own list.
    expect(plan.rows[1]?.container).toBe('footer')
    expect(plan.panels.get('settings')?.container).toBe('footer')
  })

})

describe('buildPlan: takeover scope', () => {
  it('keeps the ledger order when panels declare the same order', () => {
    // The shell sorts the same slot with a stable sort, so equal `order` values
    // stay in registration order. Ties must therefore NOT be broken
    // alphabetically here: that would show the rail and the "not configured"
    // list in two different orders (found on a real DSH window).
    const registered: RegisteredPanel[] = [
      { id: 'zulu', label: 'Zulu', order: 0 , container: 'top'},
      { id: 'mike', label: 'Mike', order: 0 , container: 'top'},
      { id: 'alfa', label: 'Alfa', order: 0 , container: 'top'},
    ]
    const plan = buildPlan(registered, shape(['zulu']))
    expect(plan.rows.map(row => row.id)).toEqual(['zulu', 'mike', 'alfa'])
    // The two it did not place were appended after the configured block.
    expect(rowOrders(plan)).toEqual([10, 20, 30])
  })

  it('still lets a declared order win over the ledger order', () => {
    const registered: RegisteredPanel[] = [
      { id: 'second', label: 'Second', order: 20 , container: 'top'},
      { id: 'first', label: 'First', order: 10 , container: 'top'},
    ]
    const plan = buildPlan(registered, shape(['second']))
    expect(plan.rows.map(row => row.id)).toEqual(['second', 'first'])
    expect(rowOrders(plan)).toEqual([10, 20])
  })

  it('lists the whole rail from the start and writes no order until something is configured', () => {
    // The editor has no "not configured yet" pool: every registered panel is a
    // row from the first open, in the contributors' own order. What a fresh
    // install does NOT do is take over the order — every row's order is null, so
    // the rewrite pass writes nothing.
    const plan = buildPlan(PANELS, profile())
    expect(plan.reordering).toBe(false)
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(rowOrders(plan).every(order => order === null)).toBe(true)
    for (const panel of plan.panels.values()) {
      expect(panel.order).toBeNull()
    }
  })

  it('still keys off the declared order when nothing is configured', () => {
    const registered: RegisteredPanel[] = [
      { id: 'late', label: 'Late', order: 30 , container: 'top'},
      { id: 'early', label: 'Early', order: 10 , container: 'top'},
      { id: 'middle', label: 'Middle', order: 20 , container: 'top'},
    ]
    const plan = buildPlan(registered, profile())
    expect(plan.rows.map(row => row.id)).toEqual(['early', 'middle', 'late'])
    expect(rowOrders(plan).every(order => order === null)).toBe(true)
  })

  it('an override alone is applied without reordering', () => {
    const plan = buildPlan(PANELS, profile({ entries: { b: { label: 'Bee' } } }))
    expect(plan.reordering).toBe(false)
    expect(plan.panels.get('b')?.label).toBe('Bee')
    expect(plan.panels.get('b')?.order).toBeNull()
    expect(plan.reordering).toBe(false)
    // The row is still listed, at its own place in the rail order.
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('unconfigured panels keep the tail of the rail, in native order', () => {
    const plan = buildPlan(PANELS, shape(['d']))
    expect(plan.rows.map(row => row.id)).toEqual(['d', 'a', 'b', 'c', 'e'])
    expect(rowOrders(plan)).toEqual([10, 20, 30, 40, 50])
    expect(rowOrders(plan)).toEqual([10, 20, 30, 40, 50])
  })

  it('a sequence of only-missing ids never reorders anything', () => {
    const plan = buildPlan(PANELS, shape(['ghost']))
    expect(plan.reordering).toBe(false)
    expect(plan.orphans).toEqual(['ghost'])
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(rowOrders(plan).every(order => order === null)).toBe(true)
  })

  it('hidden is a hide-unless-active flag, never a suppression', () => {
    const plan = buildPlan(PANELS, profile({ entries: { b: { hidden: true } } }))
    expect(plan.panels.get('b')?.hidden).toBe(true)
    expect(plan.panels.get('b')?.suppressed).toBe(false)
  })

  it('a configured row with no live registration does not disturb the rail', () => {
    // The sequence is partial: listing an id nothing answers changes nothing —
    // every real row keeps its own order and the id is reported as an orphan.
    const plan = buildPlan(PANELS, profile({ sequence: [{ type: 'entry', id: 'ghost' }] }))
    expect(plan.reordering).toBe(false)
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(rowOrders(plan).every(order => order === null)).toBe(true)
    expect(plan.orphans).toEqual(['ghost'])
  })
})

describe('buildPlan: orphans and warnings', () => {
  it('keeps configured ids that no registration answers', () => {
    const plan = buildPlan(PANELS.slice(0, 2), profile({
      sequence: [{ type: 'entry', id: 'ghost' }, { type: 'group', id: 'group:g1', members: ['a', 'phantom'] }],
      entries: { vanished: { label: 'Gone' } },
    }))
    expect(plan.orphans).toEqual(['ghost', 'phantom', 'vanished'])
    expect(plan.missingMembers).toEqual(['phantom'])
    expect(plan.groups.get('group:g1')?.members.find(member => member.id === 'phantom')?.missing).toBe(true)
  })

  it('a group whose members all vanished renders no row but keeps its config', () => {
    const plan = buildPlan(PANELS, profile({ sequence: [{ type: 'group', id: 'group:g1', members: ['ghost'] }] }))
    // No group row, and (nothing left configured) the panels keep their own order.
    expect(plan.rows.map(row => row.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(rowOrders(plan).every(order => order === null)).toBe(true)
    expect(plan.groups.get('group:g1')?.order).toBeNull()
    // Its config survives the uninstall, but it has no live member to render.
    expect(plan.groups.get('group:g1')?.liveMembers).toEqual([])
  })

  it('rejects a group whose RAIL id is already registered by someone else', () => {
    // The bare id and the rail id are different strings, and it is the rail id
    // that gets registered and used as the `main` key (README §4.3).
    const plan = buildPlan([{ id: 'dsh-railist:group:g1', label: 'Squatter', order: 0 , container: 'top'}], profile({
      sequence: [{ type: 'group', id: 'group:g1', members: ['a'] }],
    }))
    expect(plan.warnings).toContainEqual({ code: 'group-id-collision', groupId: 'group:g1' })
    expect(plan.groups.has('group:g1')).toBe(false)
    // The squatter is just an ordinary registered panel from the model's point
    // of view, so it keeps its own row (the rail adapter filters our namespace
    // out before buildPlan ever sees it).
    expect(plan.rows.map(row => [row.kind, row.id])).toEqual([['panel', 'dsh-railist:group:g1']])
    expect(rowOrders(plan)).toEqual([null])
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
