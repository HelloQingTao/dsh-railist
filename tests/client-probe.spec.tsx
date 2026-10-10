/**
 * The four self-checks, including their failure paths — the degradation
 * contract of README §5 is only worth anything if a probe can actually fail.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { createSelfCheck } from '../src/client/rail/probe.ts'
import type { ClientContext } from '../src/client/ctx.ts'
import { FakeLedger } from './helpers/fake-ledger.ts'
import { disableHasSelectorSupport, enableHasSelectorSupport } from './setup.ts'

const RAIL = 'sidebar.panellist'

function contextWith(ledger: FakeLedger): ClientContext {
  return { slots: ledger, get: () => undefined } as unknown as ClientContext
}

/** A ledger whose entries are projections, so post-hoc writes cannot be seen. */
class OpaqueLedger extends FakeLedger {
  override entriesOfSlot(name: string): ReturnType<FakeLedger['entriesOfSlot']> {
    return super.entriesOfSlot(name).map(entry => ({
      component: entry.component,
      options: { ...entry.options },
    }))
  }
}

describe('probe: registration rewriting', () => {
  it('passes when a stored entry accepts a post-hoc write', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    const result = check.getState().results.find(entry => entry.id === 'registry')
    expect(result?.ok).toBe(true)
    expect(result?.detail).toContain('read back')
    expect(check.getState().readOnly).toBe(false)
  })

  it('fails, and degrades to read-only, when the write is not visible', async () => {
    const ledger = new OpaqueLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    expect(check.getState().results.find(entry => entry.id === 'registry')?.ok).toBe(false)
    expect(check.getState().readOnly).toBe(true)
    expect(check.getState().degraded).toBe(true)
  })

  it('fails when the slot is not declared at all', async () => {
    const ledger = new FakeLedger()
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    const result = check.getState().results.find(entry => entry.id === 'registry')
    expect(result?.ok).toBe(false)
    expect(result?.detail).toContain('undeclared slot')
  })
})

describe('probe: the rail selector', () => {
  it('fails without :has() support', async () => {
    disableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    expect(check.getState().hidingDisabled).toBe(true)
    expect(check.getState().results.find(entry => entry.id === 'rail')?.detail).toContain(':has()')
  })

  it('passes with :has() support while the rail is not mounted', async () => {
    enableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    expect(check.getState().hidingDisabled).toBe(false)
    expect(check.getState().results.find(entry => entry.id === 'rail')?.detail).toContain('not mounted')
  })

  it('fails when the row count disagrees with the ledger', async () => {
    enableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const nav = document.createElement('nav')
    nav.className = '_hash_panelList'
    const row = document.createElement('button')
    row.className = '_hash_panelRow'
    nav.appendChild(row)
    document.body.appendChild(nav)
    try {
      const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 3 })
      await check.rerun()
      const result = check.getState().results.find(entry => entry.id === 'rail')
      expect(result?.ok).toBe(false)
      expect(result?.detail).toContain('1 row(s) for 3 rail entr')
    } finally {
      nav.remove()
      disableHasSelectorSupport()
    }
  })
})

describe('probe: the active prop', () => {
  it('passes when the shell renders the probe glyph with a boolean active prop', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    const running = check.rerun()
    // `rerun()` runs probe 1 synchronously and parks inside probe 3's frame
    // wait, so the throwaway row is already registered here.
    const entry = ledger.entries(RAIL).find(candidate => candidate.options.id === 'dsh-panellist:probe-active')
    expect(entry).toBeDefined()
    const Probe = entry?.component as (props: { size: number; active: boolean }) => null
    const rendered = render(<Probe size={18} active={false} />)
    rendered.unmount()
    await running
    const result = check.getState().results.find(candidate => candidate.id === 'active')
    expect(result?.ok).toBe(true)
    expect(result?.detail).toContain('active=false')
    expect(check.getState().activeRuleDisabled).toBe(false)
    // The throwaway row is gone again.
    expect(ledger.entries(RAIL).some(candidate => candidate.options.id === 'dsh-panellist:probe-active')).toBe(false)
  })

  it('fails, and drops the hidden-but-active rule, when the glyph is never rendered', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    const result = check.getState().results.find(entry => entry.id === 'active')
    expect(result?.ok).toBe(false)
    expect(result?.detail).toContain('never rendered')
    expect(check.getState().activeRuleDisabled).toBe(true)
  })
})

describe('probe: the settings navigation row', () => {
  it('passes with the dialog closed', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    const result = check.getState().results.find(entry => entry.id === 'settingsNav')
    expect(result?.ok).toBe(true)
    expect(result?.detail).toContain('closed')
  })

  it('fails when the open dialog has no row carrying our label', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const nav = document.createElement('nav')
    const button = document.createElement('button')
    button.textContent = 'General'
    nav.appendChild(button)
    dialog.appendChild(nav)
    document.body.appendChild(dialog)
    try {
      const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
      await check.rerun()
      expect(check.getState().settingsIconDisabled).toBe(true)
    } finally {
      dialog.remove()
    }
  })

  it('passes when the open dialog carries our own row', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const nav = document.createElement('nav')
    const button = document.createElement('button')
    button.textContent = '  面板列表  '
    nav.appendChild(button)
    dialog.appendChild(nav)
    document.body.appendChild(dialog)
    try {
      const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => '面板列表', entryCount: () => 0 })
      await check.rerun()
      const result = check.getState().results.find(entry => entry.id === 'settingsNav')
      expect(result?.ok).toBe(true)
      expect(result?.detail).toContain('面板列表')
      expect(check.getState().settingsIconDisabled).toBe(false)
    } finally {
      dialog.remove()
    }
  })
})

describe('self-check aggregation', () => {
  it('notifies subscribers and re-runs idempotently', async () => {
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    let notifications = 0
    const unsubscribe = check.subscribe(() => { notifications += 1 })
    await check.rerun()
    expect(notifications).toBe(1)
    expect(check.getState().results).toHaveLength(4)
    expect(check.getState().checkedAt).not.toBe('')
    // A second run while the first is in flight is the same promise.
    const first = check.rerun()
    const second = check.rerun()
    expect(first).toBe(second)
    await first
    unsubscribe()
  })
})
