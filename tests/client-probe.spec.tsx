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
    const check = createSelfCheck(contextWith(ledger), {
      sectionLabel: () => 'Panel list',
      entryCount: () => 0,
      // The probes wait for the declaration first; shorten that wait here.
      declarationTimeoutMs: 20,
    })
    await check.rerun()
    const result = check.getState().results.find(entry => entry.id === 'registry')
    expect(result?.ok).toBe(false)
    expect(result?.detail).toContain('undeclared slot')
  })

  it('waits for the rail slot to be declared instead of failing on a boot-order race', async () => {
    // The sidebar entry declares `sidebar.panellist` from its children table and
    // this plugin can mount first. A probe that registered straight away was
    // refused, and the refusal parked the WHOLE plugin in read-only — the
    // rewriting (order, name, icon) never ran at all.
    const ledger = new FakeLedger()
    const check = createSelfCheck(contextWith(ledger), {
      sectionLabel: () => 'Panel list',
      entryCount: () => 0,
      declarationTimeoutMs: 500,
    })
    const running = check.rerun()
    // The sidebar's entry lands a tick later, as it does during boot.
    setTimeout(() => { ledger.declare(RAIL) }, 10)
    await running

    const result = check.getState().results.find(entry => entry.id === 'registry')
    expect(result?.ok).toBe(true)
    expect(check.getState().readOnly).toBe(false)
  })
})

describe('probe: the rail selector', () => {
  it('fails without :has() support', async () => {
    disableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    expect(check.getState().results.find(entry => entry.id === 'rail')?.ok).toBe(false)
    expect(check.getState().results.find(entry => entry.id === 'rail')?.detail).toContain(':has()')
  })

  it('passes with :has() support while the rail is not mounted', async () => {
    enableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 0 })
    await check.rerun()
    expect(check.getState().results.find(entry => entry.id === 'rail')?.ok).toBe(true)
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

  it('names the surplus rows when the mismatch is real', async () => {
    enableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const nav = document.createElement('nav')
    nav.className = '_hash_panelList'
    for (const label of ['Plugins', 'Schedules', 'Skills']) {
      const row = document.createElement('button')
      row.className = '_hash_panelRow'
      row.setAttribute('aria-label', label)
      nav.appendChild(row)
    }
    document.body.appendChild(nav)
    try {
      const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 2 })
      await check.rerun()
      const result = check.getState().results.find(entry => entry.id === 'rail')
      expect(result?.ok).toBe(false)
      expect(result?.detail).toContain('3 row(s) for 2 rail entr')
      expect(result?.detail).toContain('Plugins | Schedules')
    } finally {
      nav.remove()
      disableHasSelectorSupport()
    }
  })

  it('re-measures while the DOM catches up, instead of reporting a stale row', async () => {
    // Regression for a REAL run on DSH 0.2.0-rc.2: the rail probe reported
    // "7 row(s) for 6 rail entr(ies)" because it counted a row that the previous
    // probe had just disposed — React commits that removal on the NEXT frame, so
    // a single synchronous measurement is not evidence.
    enableHasSelectorSupport()
    const ledger = new FakeLedger()
    ledger.declare(RAIL)
    const nav = document.createElement('nav')
    nav.className = '_hash_panelList'
    const rows: HTMLButtonElement[] = []
    for (let index = 0; index < 7; index += 1) {
      const row = document.createElement('button')
      row.className = '_hash_panelRow'
      row.setAttribute('aria-label', `Panel ${index}`)
      nav.appendChild(row)
      rows.push(row)
    }
    document.body.appendChild(nav)
    const extra = rows[6] as HTMLButtonElement
    // The shell committing the removal of a row that was disposed a moment ago.
    requestAnimationFrame(() => { extra.remove() })
    try {
      const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 6 })
      await check.rerun()
      const result = check.getState().results.find(entry => entry.id === 'rail')
      expect(result?.ok).toBe(true)
      expect(result?.detail).toContain('6 row(s) match')
      expect(check.getState().results.find(entry => entry.id === 'rail')?.ok).toBe(true)
    } finally {
      nav.remove()
      disableHasSelectorSupport()
    }
  })

  it('measures the rail before any probe row of its own exists', async () => {
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
      const check = createSelfCheck(contextWith(ledger), { sectionLabel: () => 'Panel list', entryCount: () => 1 })
      await check.rerun()
      expect(check.getState().results.find(entry => entry.id === 'rail')?.ok).toBe(true)
      // Probe 3 did park a row in the DOM during its two-frame wait, and it is
      // gone from the ledger again afterwards: the rail verdict must not depend
      // on the order the probes run in.
      expect(ledger.entries(RAIL).some(entry => entry.options.id === 'dsh-panellist:probe-active')).toBe(false)
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
    // The probe chain now starts with an `await` (the rail probe is async), so
    // the throwaway row appears a tick later: poll briefly instead of assuming
    // the registration happened before `rerun()` returned.
    let entry = ledger.entries(RAIL).find(candidate => candidate.options.id === 'dsh-panellist:probe-active')
    for (let tick = 0; entry === undefined && tick < 20; tick += 1) {
      await new Promise(resolve => { setTimeout(resolve, 1) })
      entry = ledger.entries(RAIL).find(candidate => candidate.options.id === 'dsh-panellist:probe-active')
    }
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
      expect(check.getState().results.find(entry => entry.id === 'settingsNav')?.ok).toBe(false)
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
      expect(check.getState().results.find(entry => entry.id === 'settingsNav')?.ok).toBe(true)
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
    expect(check.getState().version.length >= 0).toBe(true)
    // A second run while the first is in flight is the same promise.
    const first = check.rerun()
    const second = check.rerun()
    expect(first).toBe(second)
    await first
    unsubscribe()
  })
})
