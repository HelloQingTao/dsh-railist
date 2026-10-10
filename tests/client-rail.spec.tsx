/**
 * The rewrite pass, exercised against a fake ledger that reproduces the shell's
 * documented mutation semantics.
 *
 * This is the test that would catch the failure modes docs/ARCHITECTURE.md §10
 * lists: a frozen entry, a snapshot that hides the write, and a wrapper that
 * loses the contributor's component on restore.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { emptyProfileConfig, type IconRef, type ProfileConfig } from '../src/shared/config.ts'
import { buildPlan, type Plan } from '../src/shared/model.ts'
import type { GlyphRequest } from '../src/client/contracts.ts'
import { createRailAdapter } from '../src/client/registry/rail.tsx'
import type { ClientContext } from '../src/client/ctx.ts'
import { FakeLedger, fakeContext } from './helpers/fake-ledger.ts'

const Native = ({ label }: { label?: string }): React.ReactElement => <svg data-testid="native" aria-label={label ?? 'native'} />

/** The icons unit's renderer, reduced to something assertable. */
function glyph(request: GlyphRequest): React.ReactElement {
  if (request.icon === null) return <svg data-testid="glyph-native" />
  const name = request.icon.kind === 'builtin' ? request.icon.name : 'custom'
  return <svg data-testid={`glyph-${name}`} />
}

function seed(ledger: FakeLedger): void {
  ledger.declare('sidebar.panellist')
  ledger.declare('main')
  ledger.register({ name: 'sidebar.panellist', id: 'a', order: 0, label: 'Alpha' }, Native)
  ledger.register({ name: 'sidebar.panellist', id: 'b', order: 1, label: () => 'Beta' }, Native)
  ledger.register({ name: 'sidebar.panellist', id: 'c', order: 2, label: 'Gamma' }, Native)
  for (const id of ['a', 'b', 'c']) ledger.register({ name: 'main', key: id }, () => null)
}

function entryOf(ledger: FakeLedger, id: string): { component: unknown; options: { order?: number; label?: unknown } } {
  const found = ledger.entries('sidebar.panellist').find(candidate => candidate.options.id === id)
  if (found === undefined) throw new Error(`no entry ${id}`)
  return found as { component: unknown; options: { order?: number; label?: unknown } }
}

function profileWith(overrides: Partial<ProfileConfig>): ProfileConfig {
  return { ...emptyProfileConfig(), ...overrides }
}

describe('createRailAdapter: discovery', () => {
  it('projects native facts and ignores this plugin’s own rows', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    ledger.register({ name: 'sidebar.panellist', id: 'dsh-panellist:group:g1', order: 5, label: 'More' }, Native)
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => buildPlan([], emptyProfileConfig()), glyph)
    expect(adapter.panels().map(panel => [panel.id, panel.label, panel.order])).toEqual([
      ['a', 'Alpha', 0],
      ['b', 'Beta', 1],
      ['c', 'Gamma', 2],
    ])
    expect(adapter.hasPage('a')).toBe(true)
    expect(adapter.hasPage('dsh-panellist:group:g1')).toBe(false)
  })

  it('resolves a label thunk at read time', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => buildPlan([], emptyProfileConfig()), glyph)
    expect(adapter.panels().find(panel => panel.id === 'b')?.label).toBe('Beta')
  })
})

describe('createRailAdapter: rewriting', () => {
  it('writes order, installs a label thunk and wraps only what needs a marker', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const profile = profileWith({
      sequence: [{ type: 'entry', id: 'c' }, { type: 'entry', id: 'a' }],
      entries: { a: { label: 'Aye', icon: { kind: 'builtin', name: 'star' } }, b: { hidden: true } },
    })
    const plan: Plan = buildPlan([
      { id: 'a', label: 'Alpha', order: 0 },
      { id: 'b', label: 'Beta', order: 1 },
      { id: 'c', label: 'Gamma', order: 2 },
    ], profile)
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    const before = entryOf(ledger, 'c').component
    adapter.applyOverrides()

    expect(entryOf(ledger, 'c').options.order).toBe(10)
    expect(entryOf(ledger, 'a').options.order).toBe(20)
    // Unconfigured panels are appended after the configured block.
    expect(entryOf(ledger, 'b').options.order).toBe(30)
    // c needs nothing, so its component is untouched — object identity proves it.
    expect(entryOf(ledger, 'c').component).toBe(before)
    // a has an icon override and b is hidden, so both are wrapped.
    expect(entryOf(ledger, 'a').component).not.toBe(before)
    expect(entryOf(ledger, 'b').component).not.toBe(before)
    // The label thunk resolves through the live plan.
    const label = entryOf(ledger, 'a').options.label
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('Aye')
    adapter.dispose()
  })

  it('renders the hide marker only while the panel is not the active one', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const plan = buildPlan([
      { id: 'a', label: 'Alpha', order: 0 },
      { id: 'b', label: 'Beta', order: 1 },
    ], profileWith({ entries: { b: { hidden: true } } }))
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    adapter.applyOverrides()
    const Wrapper = entryOf(ledger, 'b').component as (props: { size: number; active?: boolean }) => React.ReactElement

    const hidden = render(<Wrapper size={20} active={false} />)
    expect(hidden.container.querySelector('[data-dsh-panellist-hidden]')).not.toBeNull()
    expect(screen.queryByTestId('native')).toBeNull()
    hidden.unmount()

    // README §2.3: a hidden panel that is active keeps its row.
    const shown = render(<Wrapper size={20} active />)
    expect(shown.container.querySelector('[data-dsh-panellist-hidden]')).toBeNull()
    expect(screen.getByTestId('native')).toBeTruthy()
    shown.unmount()
    adapter.dispose()
  })

  it('suppresses a group member unconditionally and paints no visual for it', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const plan = buildPlan([
      { id: 'a', label: 'Alpha', order: 0 },
      { id: 'b', label: 'Beta', order: 1 },
      { id: 'c', label: 'Gamma', order: 2 },
    ], profileWith({
      sequence: [{ type: 'group', id: 'group:g1', members: ['b', 'c'] }],
      entries: { b: { icon: { kind: 'builtin', name: 'star' } } },
    }))
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    adapter.applyOverrides()
    const Wrapper = entryOf(ledger, 'b').component as (props: { size: number; active?: boolean }) => React.ReactElement
    // The marker is unconditional, even for the active panel: the member is
    // shown inside its group, and its icon reaches the flyout through the plan.
    const rendered = render(<Wrapper size={20} active />)
    expect(rendered.container.querySelector('[data-dsh-panellist-suppressed]')).not.toBeNull()
    expect(rendered.container.querySelector('[data-dsh-panellist-hidden]')).toBeNull()
    expect(rendered.container.querySelector('svg')).toBeNull()
    rendered.unmount()
    adapter.dispose()
  })

  it('nudges the ledger so the shell re-reads the rewritten fields', async () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const plan = buildPlan([{ id: 'a', label: 'Alpha', order: 0 }], profileWith({ sequence: [{ type: 'entry', id: 'a' }] }))
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    const versionBefore = ledger.currentVersion
    adapter.applyOverrides()
    await Promise.resolve()
    expect(ledger.currentVersion).toBeGreaterThan(versionBefore + 0)
    // The throwaway row is disposed again: the ledger is back to four entries
    // (three panels plus nothing else) on the rail slot only.
    expect(ledger.count('sidebar.panellist')).toBe(3)
    adapter.dispose()
  })

  it('is a strict no-op on a fresh install, even for a registration without a label', async () => {
    // README §2.10 / model.ts: an empty configuration means this plugin is
    // read-only on the rail. The shell renders `label ?? id`, so the pass must
    // compare against that effective value rather than against `undefined` —
    // otherwise every label-less contributor gets a thunk written and the ledger
    // is nudged for a string that was already on screen.
    const ledger = new FakeLedger()
    seed(ledger)
    ledger.register({ name: 'sidebar.panellist', id: 'bare' }, Native)
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => buildPlan([
      { id: 'a', label: 'Alpha', order: 0 },
      { id: 'b', label: 'Beta', order: 1 },
      { id: 'c', label: 'Gamma', order: 2 },
      { id: 'bare', label: 'bare', order: 3 },
    ], emptyProfileConfig()), glyph)
    const before = ledger.currentVersion
    const bare = entryOf(ledger, 'bare')
    const labelBefore = bare.options.label
    const componentBefore = bare.component
    adapter.applyOverrides()
    expect(bare.options.label).toBe(labelBefore)
    expect(bare.options.order).toBeUndefined()
    expect(bare.component).toBe(componentBefore)
    // Any nudge would have landed by now: the throwaway registration is a
    // microtask and this await drains it.
    await Promise.resolve()
    expect(ledger.currentVersion).toBe(before)
    adapter.dispose()
  })

  it('restores every captured field when an override goes away or the plugin unloads', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const originalLabel = entryOf(ledger, 'a').options.label
    const originalComponent = entryOf(ledger, 'a').component
    let profile = profileWith({ entries: { a: { label: 'Aye', hidden: true } } })
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => buildPlan([
      { id: 'a', label: 'Alpha', order: 0 },
    ], profile), glyph)
    adapter.applyOverrides()
    expect(entryOf(ledger, 'a').component).not.toBe(originalComponent)

    profile = emptyProfileConfig()
    adapter.applyOverrides()
    expect(entryOf(ledger, 'a').options.label).toBe(originalLabel)
    expect(entryOf(ledger, 'a').component).toBe(originalComponent)

    // Re-wrap, then unload: disposal restores the originals again.
    profile = profileWith({ entries: { a: { hidden: true } } })
    adapter.applyOverrides()
    expect(entryOf(ledger, 'a').component).not.toBe(originalComponent)
    adapter.dispose()
    expect(entryOf(ledger, 'a').component).toBe(originalComponent)
  })
})

describe('createRailAdapter: our own rows', () => {
  it('registers a group row and its main page, and disposes both', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => buildPlan([], emptyProfileConfig()), glyph)
    const dispose = adapter.registerRow({
      railId: 'dsh-panellist:group:g1',
      order: 10,
      label: () => 'More',
      glyph: Native as never,
    }, () => null)
    expect(ledger.entries('sidebar.panellist').some(entry => entry.options.id === 'dsh-panellist:group:g1')).toBe(true)
    expect(adapter.hasPage('dsh-panellist:group:g1')).toBe(true)
    dispose()
    expect(ledger.entries('sidebar.panellist').some(entry => entry.options.id === 'dsh-panellist:group:g1')).toBe(false)
    expect(adapter.hasPage('dsh-panellist:group:g1')).toBe(false)
    adapter.dispose()
  })

  it('never selects a panel whose page is missing (a stale config must not throw)', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const selected: string[] = []
    const adapter = createRailAdapter(
      fakeContext(ledger, { selectPanel: (id) => { selected.push(String(id)) } }) as ClientContext,
      () => buildPlan([], emptyProfileConfig()),
      glyph,
    )
    adapter.selectPanel('ghost')
    adapter.selectPanel('a')
    expect(selected).toEqual(['a'])
    adapter.dispose()
  })

  it('reports the active panel without a layout service', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const adapter = createRailAdapter({ slots: ledger, get: () => undefined } as unknown as ClientContext, () => buildPlan([], emptyProfileConfig()), glyph)
    expect(adapter.activePanelId()).toBe('')
    adapter.selectPanel('a')
    adapter.dispose()
  })
})

describe('createRailAdapter: glyph fallback', () => {
  it('keeps the contributor component for an "original" icon', () => {
    const ledger = new FakeLedger()
    seed(ledger)
    const icons: IconRef[] = [{ kind: 'original' }]
    const plan = buildPlan([{ id: 'a', label: 'Alpha', order: 0 }], profileWith({
      entries: { a: { icon: icons[0], label: 'Aye' } },
    }))
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    adapter.applyOverrides()
    const Wrapper = entryOf(ledger, 'a').component as (props: { size: number; active?: boolean }) => React.ReactElement
    const rendered = render(<Wrapper size={20} />)
    // 'original' means "no icon override", so the contributor's own component
    // renders — through JSX, with the whole prop bag forwarded.
    expect(screen.getByTestId('native')).toBeTruthy()
    rendered.unmount()
    adapter.dispose()
  })
})
