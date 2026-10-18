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
import { EVOKE_CSS, PANEL_ROW_SELECTOR } from '../src/client/rail/css.ts'
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

/**
 * The evoked row must leave the rail's LAYOUT, not just lose its marker.
 *
 * Rendering the contributor is what makes the click work, but the shell puts the
 * row back in its own seat — the bottom-left corner for a footer action — so
 * dropping `suppressed` alone painted a second copy of a grouped capability
 * panel under the rail for as long as its popover stayed open. `EVOKE_CSS` takes
 * the row's box away while leaving the node in place: moving it in the DOM threw
 * `NotFoundError: The node to be removed is not a child of this node` on the next
 * unmount, because React still tracked the old parent.
 */
describe('EVOKE_CSS', () => {
  it('collapses the shell row that carries an evoked marker, and nothing else', () => {
    // The selector is built from the shell's class-hashed row selector, so it is
    // assembled here from the same constant the runtime uses rather than copied.
    expect(EVOKE_CSS).toContain(':has([data-dsh-railist-evoked])')
    // The top seat's row IS the flex item, so `contents` collapses it without
    // disturbing the row's own children.
    expect(EVOKE_CSS).toContain('display: contents')
    expect(EVOKE_CSS).toContain(PANEL_ROW_SELECTOR)
    // The footer seat is the opposite shape: the shell row is a plain `div`
    // whose only child is the `span` the contributor renders, so it has no
    // layout of its own and `contents` hides nothing (measured live: the row
    // kept its 42px). Only `display: none` collapses it.
    expect(EVOKE_CSS).toContain('display: none')
  })

  it('matches the row an evoked footer member renders in', () => {
    // jsdom's selector engine is enough for `:has` on these simple trees, so the
    // rule is exercised against the markup shape the shell produces.
    const shellRow = document.createElement('button')
    shellRow.className = '_panelRow_x1'
    const wrapper = document.createElement('span')
    wrapper.innerHTML = '<span data-dsh-railist-evoked="power"></span><span>Power</span>'
    shellRow.appendChild(wrapper)
    const nav = document.createElement('nav')
    nav.className = '_panelList_x1'
    nav.appendChild(shellRow)
    document.body.appendChild(nav)

    expect(document.querySelectorAll(`${PANEL_ROW_SELECTOR}:has([data-dsh-railist-evoked])`)).toHaveLength(1)
    // Once the evoke ends the marker becomes `suppressed`, which HIDE_CSS owns.
    wrapper.firstElementChild?.removeAttribute('data-dsh-railist-evoked')
    wrapper.firstElementChild?.setAttribute('data-dsh-railist-suppressed', '')
    expect(document.querySelectorAll(`${PANEL_ROW_SELECTOR}:has([data-dsh-railist-evoked])`)).toHaveLength(0)
    document.body.removeChild(nav)
  })

  it('collapses the footer slot that carries an evoked marker', () => {
    // The shape measured live on the very member this bug was reported for, and
    // the one the two rules above do NOT match: the member's registration stays
    // in `sidebar.footer.action`, so the slot is a plain `display: contents` div
    // holding the wrapper's marker span and the contributor's card as SIBLINGS.
    // Neither carries the ghost stamp, so without the slot rule the marker kept
    // its 42px and the contributor's card kept its own box: opening the popover
    // pushed a second copy of the row into the bottom of the rail.
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.footer.action')
    slot.style.display = 'contents'
    const marker = document.createElement('span')
    marker.setAttribute('data-dsh-railist-evoked', MEMBER)
    const card = document.createElement('div')
    card.className = 'skp-foot'
    slot.append(marker, card)
    const row = document.createElement('div')
    row.className = '_footerActions_x1'
    row.appendChild(slot)
    document.body.appendChild(row)

    // Hard-coded on purpose: building this from the same constant the runtime
    // interpolates made the assertion self-consistent, and a mutant that renamed
    // the attribute still passed (verified — the first version of this case did).
    const slotRule = '[data-slot="sidebar.footer.action"]:has([data-dsh-railist-evoked])'
    expect(EVOKE_CSS).toContain(slotRule)
    expect(EVOKE_CSS).toContain(`${slotRule} > span[data-dsh-railist-evoked]`)
    expect(document.querySelectorAll(slotRule)).toHaveLength(1)
    // The marker is the only thing removed; the contributor's card stays, because
    // it is what the evoke is for — its popover lives inside it.
    expect(document.querySelectorAll(`${slotRule} > span[data-dsh-railist-evoked]`)).toHaveLength(1)
    // A neighbouring footer action without a marker keeps its own box.
    const quietSlot = document.createElement('div')
    quietSlot.setAttribute('data-slot', 'sidebar.footer.action')
    const quietCard = document.createElement('div')
    quietSlot.appendChild(quietCard)
    row.appendChild(quietSlot)
    expect(document.querySelectorAll(`${slotRule}`)).toHaveLength(1)
    expect(quietSlot.matches(slotRule)).toBe(false)

    marker.removeAttribute('data-dsh-railist-evoked')
    marker.setAttribute('data-dsh-railist-suppressed', '')
    expect(document.querySelectorAll(slotRule)).toHaveLength(0)
    document.body.removeChild(row)
  })

  it('hides the evoked footer button but not the popover inside its card', () => {
    // The capability panel's card is
    //   <div class="skp-foot"><div class="skp-backdrop"/><div class="skp-popover"/>
    //   <button class="skp-foot-btn"/></div>
    // and only the button is in flow: `.skp-foot` is `position: relative` with no
    // size, the backdrop and the popover are both `position: fixed; inset: 0`.
    // Hiding the BUTTON is therefore what takes the bottom-left row away while
    // leaving the open panel alone — measured live, the foot area stayed at
    // y=700/h=94 before and after the evoke, and the popover was 947x672 at
    // (166, 64). Hiding or repositioning the CARD instead broke both: the popover
    // rendered inside it and went off screen, and the neighbouring power button
    // stretched from 264px to 1288px.
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.footer.action')
    slot.style.display = 'contents'
    const marker = document.createElement('span')
    marker.setAttribute('data-dsh-railist-evoked', MEMBER)
    const card = document.createElement('div')
    card.className = 'skp-foot'
    const backdrop = document.createElement('div')
    backdrop.className = 'skp-backdrop'
    const popover = document.createElement('div')
    popover.className = 'skp-popover'
    const button = document.createElement('button')
    button.className = 'skp-foot-btn'
    card.append(backdrop, popover, button)
    slot.append(marker, card)
    document.body.appendChild(slot)

    const buttonRule = '[data-slot="sidebar.footer.action"]:has([data-dsh-railist-evoked]) [class*="foot-btn"]'
    expect(EVOKE_CSS).toContain(buttonRule)
    expect(document.querySelectorAll(buttonRule)).toHaveLength(1)
    // The card and the popover are deliberately left alone.
    expect(card.matches(`${buttonRule.split(' [class')[0]} > :not([data-dsh-railist-evoked])`)).toBe(true)
    expect(popover.closest('[class*="foot-btn"]')).toBeNull()
    // No rule hides the card itself: that would take the popover with it.
    expect(EVOKE_CSS).not.toContain('> [class*="foot"]')
    expect(EVOKE_CSS).not.toMatch(/>\s*:not\(\[data-dsh-railist-evoked\]\)/)

    marker.removeAttribute('data-dsh-railist-evoked')
    expect(document.querySelectorAll(buttonRule)).toHaveLength(0)
    document.body.removeChild(slot)
  })
})
