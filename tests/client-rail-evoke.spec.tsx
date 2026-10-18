/**
 * An evoked group member must render its contributor again.
 *
 * A member with no `main` page — a footer action such as the capability panel —
 * is activated by EVOKING its row: the flyout asks the row to come back for one
 * interaction and then clicks the real button inside it, because the member's
 * own popover renders inside that row.
 *
 * The wrapper used to paint the configured icon and nothing else in the evoked
 * state, so the row that came back held no button at all: the menu closed, the
 * icon stayed on the rail, and the member's popover never opened. Reported live
 * as "clicking the capability panel shows no popup, and an extra icon appears in
 * the bottom-left corner".
 *
 * The second spec binds the other half: an evoke whose member renders no button
 * must never walk into a NEIGHBOURING row and press that row's action.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { emptyProfileConfig, type ProfileConfig } from '../src/shared/config.ts'
import { buildPlan, type Plan } from '../src/shared/model.ts'
import type { GlyphRequest } from '../src/client/contracts.ts'
import { ROW_ATTR } from '../src/client/rail/dom.ts'
import { createRailAdapter } from '../src/client/registry/rail.tsx'
import type { ClientContext } from '../src/client/ctx.ts'
import { FakeLedger, fakeContext } from './helpers/fake-ledger.ts'

const FOOTER_SLOT = 'sidebar.footer.action'
const MEMBER = 'power'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The member's own row: the button an evoke has to press. */
function MemberRow({ onPress }: { onPress?: () => void }): ReactNode {
  return (
    <button type="button" data-testid="member-button" onClick={onPress}>
      <span data-testid="member-icon" />
      <span data-testid="member-label">{'Power'}</span>
    </button>
  )
}

/** The icons unit's renderer, reduced to something assertable. */
function glyph(request: GlyphRequest): ReactNode {
  const icon = request.icon
  const name = icon === null ? 'none' : icon.kind === 'builtin' ? icon.name : icon.kind
  return <span data-testid="override-glyph">{name}</span>
}

function seedFooter(ledger: FakeLedger, component: unknown): void {
  ledger.declare('sidebar.panellist')
  ledger.declare(FOOTER_SLOT)
  ledger.register({ name: FOOTER_SLOT, id: MEMBER, order: 0, label: 'Power' }, component)
}

/**
 * The reported shape: a footer row collected into a group and carrying a
 * configured icon. It stays in the footer seat, so the wrapper (not the ghost)
 * owns the row — the ghost only takes over a footer row the plan moves out.
 */
function planWithGroupIcon(): Plan {
  const profile: ProfileConfig = {
    ...emptyProfileConfig(),
    sequence: [{ type: 'group', id: 'group:g1', label: 'Capabilities', members: [MEMBER] }],
    entries: { [MEMBER]: { icon: { kind: 'builtin', name: 'star' } } },
  }
  return buildPlan([{ id: MEMBER, label: 'Power', order: 0, container: 'footer' as const }], profile)
}

/** The wrapper the adapter installed on the footer entry. */
function wrapperOf(ledger: FakeLedger): (props: Record<string, unknown>) => ReactNode {
  const found = ledger.entries(FOOTER_SLOT).find(entry => entry.options.id === MEMBER)
  if (found === undefined) throw new Error(`no footer entry ${MEMBER}`)
  return found.component as (props: Record<string, unknown>) => ReactNode
}

/** One animation frame (a timer when the environment has no rAF). */
function waitForFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { resolve() })
    else setTimeout(resolve, 32)
  })
}

describe('createRailAdapter: evoked group member', () => {
  it('renders the contributor again, so its own button takes the click', async () => {
    const pressed: string[] = []
    const ledger = new FakeLedger()
    seedFooter(ledger, () => <MemberRow onPress={() => { pressed.push(MEMBER) }} />)
    const plan = planWithGroupIcon()
    // Fixture guard: the icon override is the thing that used to swallow the
    // evoke, so a plan without one would make this spec pass for free.
    expect(plan.panels.get(MEMBER)?.icon).not.toBeNull()
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    adapter.applyOverrides()
    const Wrapper = wrapperOf(ledger)

    const view = render(<Wrapper wide />)
    // Suppressed: the group owns the row, so it renders nothing but the marker
    // the seat CSS hides — no glyph, and nothing to click.
    expect(view.container.querySelector('[data-dsh-railist-suppressed]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="override-glyph"]')).toBeNull()
    expect(view.container.querySelector('[data-testid="member-button"]')).toBeNull()

    // The evoke asks for the member's own row back — WITH its button.
    act(() => { adapter.activateRow(MEMBER) })
    view.rerender(<Wrapper wide />)
    expect(view.container.querySelector(`[data-dsh-railist-evoked="${MEMBER}"]`)).not.toBeNull()
    expect(view.container.querySelector('[data-testid="member-button"]')).not.toBeNull()

    // And that button is what the evoke presses.
    await waitForFrame()
    await waitForFrame()
    expect(pressed).toEqual([MEMBER])

    adapter.dispose()
  })

  it('refuses a neighbouring row and hides the evoke again when nothing was pressed', async () => {
    const neighbourPressed: string[] = []
    const ledger = new FakeLedger()
    // A contributor that renders no button at all.
    seedFooter(ledger, () => <div className="member-without-button">{'plain'}</div>)
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, planWithGroupIcon, glyph)
    adapter.applyOverrides()
    const Wrapper = wrapperOf(ledger)

    const view = render(
      <div>
        <Wrapper wide />
        {/* The next row in the same seat, stamped as its own: this is the button
            the old scan would have pressed ("the first button after the marker"). */}
        <div {...{ [ROW_ATTR]: 'other' }}>
          <button type="button" data-testid="other-button" onClick={() => { neighbourPressed.push('other') }} />
        </div>
      </div>,
    )

    act(() => { adapter.activateRow(MEMBER) })
    view.rerender(
      <div>
        <Wrapper wide />
        <div {...{ [ROW_ATTR]: 'other' }}>
          <button type="button" data-testid="other-button" onClick={() => { neighbourPressed.push('other') }} />
        </div>
      </div>,
    )
    expect(view.container.querySelector(`[data-dsh-railist-evoked="${MEMBER}"]`)).not.toBeNull()

    await waitForFrame()
    await waitForFrame()
    expect(neighbourPressed).toEqual([])

    // Nothing was pressed, so the deadline ends the evoke and the row hides back
    // into its group instead of leaving a stray icon on the rail.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5_000)
    await waitForFrame()
    await waitForFrame()
    view.rerender(
      <div>
        <Wrapper wide />
        <div {...{ [ROW_ATTR]: 'other' }}>
          <button type="button" data-testid="other-button" onClick={() => { neighbourPressed.push('other') }} />
        </div>
      </div>,
    )
    expect(view.container.querySelector(`[data-dsh-railist-evoked="${MEMBER}"]`)).toBeNull()
    expect(view.container.querySelector('[data-dsh-railist-suppressed]')).not.toBeNull()
    expect(neighbourPressed).toEqual([])

    adapter.dispose()
  })
})
