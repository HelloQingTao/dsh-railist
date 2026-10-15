/**
 * The footer ghost, exercised against a fake ledger that reproduces the shell's
 * documented mutation semantics.
 *
 * These are the failure modes the ghost exists to avoid, each one verified live
 * on a real instance before the fix:
 *
 *  - a footer row the plan moves into the panel list must NOT keep its own
 *    component in the footer slot: that node is React's, and taking it away with
 *    `appendChild` leaves the slot's bookkeeping holding a stale reference, which
 *    freezes the page the next time the footer re-renders;
 *  - the ghost must render nothing in place, so React's footer bookkeeping ends
 *    up holding an entry that produces no host node at all;
 *  - the contributor's component must still be rendered, through the ghost's
 *    portal, and must receive the footer seat's own props;
 *  - the slot element the ghost owns must be a DOM node no renderer holds a
 *    reference to, and must carry the row stamp the rest of the plugin reads.
 */
import { describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { emptyProfileConfig, type BuiltinIconName, type ProfileConfig } from '../src/shared/config.ts'
import { buildPlan, type Plan } from '../src/shared/model.ts'
import type { GlyphRequest } from '../src/client/contracts.ts'
import { createRailAdapter } from '../src/client/registry/rail.tsx'
import { GHOST_ATTR, ROW_ATTR } from '../src/client/rail/dom.ts'
import type { ClientContext } from '../src/client/ctx.ts'
import { FakeLedger, fakeContext } from './helpers/fake-ledger.ts'

const FOOTER_SLOT = 'sidebar.footer.action'

/** The icons unit's renderer, reduced to something assertable. */
function glyph(_request: GlyphRequest): ReactNode {
  return null
}

/** A footer contributor: a whole button, as the footer seat's contract expects. */
const FooterButton = ({ label }: { label?: string }): ReactNode => (
  <button type="button" data-testid="footer-button">
    <span className="skp-foot-icon" data-testid="footer-icon" />
    <span data-testid="footer-label">{label ?? 'footer'}</span>
  </button>
)

function seedFooter(ledger: FakeLedger, ids: string[]): void {
  ledger.declare('sidebar.panellist')
  ledger.declare('main')
  ledger.declare(FOOTER_SLOT)
  for (const id of ids) {
    ledger.register({ name: FOOTER_SLOT, id, order: 0, label: id }, FooterButton)
    ledger.register({ name: 'main', key: id }, () => null)
  }
}

function footerEntry(ledger: FakeLedger, id: string): { component: unknown } {
  const found = ledger.entries(FOOTER_SLOT).find(candidate => candidate.options.id === id)
  if (found === undefined) throw new Error(`no footer entry ${id}`)
  return found as { component: unknown }
}

/** A plan where the given panels sit in the top seat, in the given order. */
function planTop(panels: Array<{ id: string; label: string }>, profile: ProfileConfig): Plan {
  return buildPlan(
    panels.map((panel, index) => ({ id: panel.id, label: panel.label, order: index * 10, container: 'top' as const })),
    profile,
  )
}

/** A plan where the given panels stay in the footer seat. */
function planFooter(panels: Array<{ id: string; label: string }>, profile: ProfileConfig): Plan {
  return buildPlan(
    panels.map((panel, index) => ({ id: panel.id, label: panel.label, order: index * 10, container: 'footer' as const })),
    profile,
  )
}

/**
 * A stand-in for the sidebar's panel list.
 *
 * The ghost appends its slot element into the top seat on mount, and the DOM half
 * only ever recognises the seat by its class suffix plus its `data-slot` anchor,
 * so this reproduces exactly as much of the shell as the ghost depends on.
 */
function withPanelList(): HTMLElement {
  const nav = document.createElement('nav')
  // The seat is matched by its class SUFFIX (the shell re-hashes the prefix per
  // build), so the fixture has to carry the suffix rather than a literal name.
  nav.className = 'shell_panelList'
  const anchor = document.createElement('div')
  anchor.setAttribute('data-slot', 'sidebar.panellist')
  nav.append(anchor)
  document.body.append(nav)
  return nav
}

describe('createRailAdapter: footer ghost', () => {
  it('replaces a footer row moved into the panel list with a ghost that renders nothing in place', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planTop([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    const original = footerEntry(ledger, 'power').component

    adapter.applyOverrides()

    const entry = footerEntry(ledger, 'power')
    expect(entry.component).not.toBe(original)
    expect(typeof entry.component).toBe('function')
    // The ghost renders no host node of its own: React's footer bookkeeping is
    // left holding an entry that produces nothing, which is the whole point.
    const view = render(<GhostComponent component={entry.component} />)
    expect(view.container.querySelector('[data-dsh-railist-ghost]')).toBeNull()
    view.unmount()
    adapter.dispose()
  })

  it('renders the contributor through a portal into a slot element no renderer owns', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planTop([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    adapter.applyOverrides()
    const Ghost = footerEntry(ledger, 'power').component as (props: { wide?: boolean }) => ReactNode
    const nav = withPanelList()

    const view = render(<div data-testid="footer-host"><Ghost wide /></div>)

    // The contributor itself is rendered, and it is rendered in the SLOT element,
    // not in the footer host React rendered the ghost into.
    const slot = nav.querySelector(`[${GHOST_ATTR}]`)
    expect(slot).not.toBeNull()
    expect(slot?.getAttribute(ROW_ATTR)).toBe('power')
    expect(slot?.querySelector('[data-testid="footer-button"]')).not.toBeNull()
    expect(view.container.querySelector('[data-testid="footer-button"]')).toBeNull()
    // The footer seat's own prop bag is forwarded verbatim.
    expect(slot?.querySelector('[data-testid="footer-button"]')?.textContent).toBe('footer')
    view.unmount()
    nav.remove()
    adapter.dispose()
  })

  it('places the slot in the panel list and removes it on unmount', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planTop([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    adapter.applyOverrides()
    const Ghost = footerEntry(ledger, 'power').component as (props: { wide?: boolean }) => ReactNode
    const nav = withPanelList()

    const view = render(<div data-testid="footer-host"><Ghost wide /></div>)
    expect(nav.querySelector(`[${GHOST_ATTR}]`)).not.toBeNull()

    // Unmounting the ghost removes the slot element: the contributor's whole
    // subtree lives inside it, so leaving it behind would strand a dead row in
    // the panel list.
    view.unmount()
    expect(nav.querySelector(`[${GHOST_ATTR}]`)).toBeNull()
    nav.remove()
    adapter.dispose()
  })

  it('keeps a footer row that stays in the footer on its own component', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planFooter([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    const original = footerEntry(ledger, 'power').component

    adapter.applyOverrides()

    expect(footerEntry(ledger, 'power').component).toBe(original)
    adapter.dispose()
  })

  it('restores the contributor when the row goes back to the footer', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    let plan = planTop([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    const original = footerEntry(ledger, 'power').component
    adapter.applyOverrides()
    expect(footerEntry(ledger, 'power').component).not.toBe(original)

    plan = planFooter([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    adapter.applyOverrides()

    expect(footerEntry(ledger, 'power').component).toBe(original)
    adapter.dispose()
  })

  it('puts the ghost back after a dispose that took it away', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planTop([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, glyph)
    const original = footerEntry(ledger, 'power').component

    adapter.applyOverrides()
    adapter.dispose()

    expect(footerEntry(ledger, 'power').component).toBe(original)
  })
})

/**
 * A footer row must honour a configured icon.
 *
 * The top seat reaches its icons through the glyph WRAPPER (`rail.tsx`'s
 * `wrapperFor`), but a footer row is REPLACED by this ghost — which used to
 * forward props straight into its portal and never consult the plan's `icon`.
 * The picker wrote `entries[id].icon` to `railist.json` and the rail kept the
 * contributor's own glyph: reported as "picking a built-in icon and saving has
 * no effect", and it only ever affected footer rows, which is why the top half
 * of the list looked correct.
 */
describe('createRailAdapter: footer ghost icon override', () => {
  /**
   * A glyph renderer that marks itself, so the test can see WHICH path ran.
   *
   * `request.icon` is nullable on the real contract (a row may have no override),
   * so the narrowing is explicit rather than an assertion the stub would not
   * survive a contract change.
   */
  const markedGlyph = (request: GlyphRequest): ReactNode => {
    const icon = request.icon
    const name = icon === null ? 'none' : icon.kind === 'builtin' ? icon.name : icon.kind
    return <span data-testid="override-glyph">{name}</span>
  }

  /** A plan whose `power` panel carries a built-in icon override. */
  function planWithIcon(name: BuiltinIconName, profile: ProfileConfig): Plan {
    const config: ProfileConfig = {
      ...profile,
      entries: { power: { icon: { kind: 'builtin', name } } },
    }
    return buildPlan(
      [{ id: 'power', label: 'Power', order: 0, container: 'top' as const }],
      config,
    )
  }

  it('keeps the contributor row and swaps only its icon element', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planWithIcon('star', emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, markedGlyph)
    adapter.applyOverrides()
    const Ghost = footerEntry(ledger, 'power').component as (props: { wide?: boolean }) => ReactNode
    const nav = withPanelList()

    const view = render(<div data-testid="footer-host"><Ghost wide /></div>)

    const slot = nav.querySelector(`[${GHOST_ATTR}]`)
    expect(slot).not.toBeNull()
    // The contributor's button and label SURVIVE: a footer row is the whole
    // row, so replacing it with a bare glyph is what made the label disappear
    // and the icon sit unaligned.
    expect(slot?.querySelector('[data-testid="footer-button"]')).not.toBeNull()
    expect(slot?.querySelector('[data-testid="footer-icon"]')).not.toBeNull()
    view.unmount()
    nav.remove()
    adapter.dispose()
  })

  it('leaves a contributor without a recognisable icon element alone', () => {
    const ledger = new FakeLedger()
    // A contributor whose markup carries no icon element at all: the override
    // cannot apply, and painting over some arbitrary node would corrupt it.
    ledger.declare('sidebar.panellist')
    ledger.declare('main')
    ledger.declare(FOOTER_SLOT)
    ledger.register({ name: FOOTER_SLOT, id: 'power', order: 0, label: 'power' }, () => (
      <div className="no-icon-here"><span>{'plain'}</span></div>
    ))
    ledger.register({ name: 'main', key: 'power' }, () => null)
    const plan = planWithIcon('star', emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, markedGlyph)
    adapter.applyOverrides()
    const Ghost = footerEntry(ledger, 'power').component as (props: { wide?: boolean }) => ReactNode
    const nav = withPanelList()

    const view = render(<div data-testid="footer-host"><Ghost wide /></div>)

    const slot = nav.querySelector(`[${GHOST_ATTR}]`)
    expect(slot?.querySelector('.no-icon-here')).not.toBeNull()
    expect(slot?.querySelector('[data-testid="override-glyph"]')).toBeNull()
    view.unmount()
    nav.remove()
    adapter.dispose()
  })

  it('falls back to the contributor row when the panel carries no icon', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    const plan = planTop([{ id: 'power', label: 'Power' }], emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, markedGlyph)
    adapter.applyOverrides()
    const Ghost = footerEntry(ledger, 'power').component as (props: { wide?: boolean }) => ReactNode
    const nav = withPanelList()

    const view = render(<div data-testid="footer-host"><Ghost wide /></div>)

    const slot = nav.querySelector(`[${GHOST_ATTR}]`)
    expect(slot?.querySelector('[data-testid="override-glyph"]')).toBeNull()
    expect(slot?.querySelector('[data-testid="footer-button"]')).not.toBeNull()
    view.unmount()
    nav.remove()
    adapter.dispose()
  })

  it('repaints the icon when the choice changes to another built-in', () => {
    const ledger = new FakeLedger()
    seedFooter(ledger, ['power'])
    let plan = planWithIcon('star', emptyProfileConfig())
    const adapter = createRailAdapter(fakeContext(ledger) as ClientContext, () => plan, markedGlyph)
    adapter.applyOverrides()
    const Ghost = footerEntry(ledger, 'power').component as (props: { wide?: boolean }) => ReactNode
    const nav = withPanelList()

    const view = render(<div data-testid="footer-host"><Ghost wide /></div>)
    const icon = (): Element | null | undefined => nav.querySelector('[data-testid="footer-icon"] [data-testid="override-glyph"]')
    expect(icon()?.textContent).toBe('star')

    // Picking a SECOND built-in icon on a panel already carrying one writes no
    // ledger field at all, so the shell has no reason to re-render the row: the
    // rewrite pass compares a rendering digest and nudges the ghosts itself.
    plan = planWithIcon('puzzle', emptyProfileConfig())
    act(() => { adapter.applyOverrides() })

    expect(icon()?.textContent).toBe('puzzle')
    // The row is NOT re-mounted by the repaint — its own chrome is still there.
    expect(nav.querySelector('[data-testid="footer-button"]')).not.toBeNull()
    view.unmount()
    nav.remove()
    adapter.dispose()
  })
})

/** Renders a component identity the ledger holds, in a fresh container. */
function GhostComponent({ component }: { component: unknown }): ReactNode {
  const Comp = component as ((props: Record<string, unknown>) => ReactNode) | null
  return Comp === null ? null : <Comp />
}
