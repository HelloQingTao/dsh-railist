/**
 * The shell's "More" launcher is turned into an ordinary rail row.
 *
 * `dsh-client-ui-sidebar` appends its More button AFTER every `PanelRow` and
 * never registers it in `sidebar.panellist`, so the sequence editor cannot see
 * it. The more unit registers a proxy row in that slot, parks the real button
 * out of the rail (keeping it in the DOM so its `portal: true` menu keeps an
 * anchor rect), and forwards a click on the proxy to the real button.
 *
 * These specs pin the three things that make that safe: the proxy is a real,
 * page-less slot entry (so hide / order / group all stay ordinary machinery),
 * only proxy clicks are intercepted, and disposal restores everything. They
 * also pin the grouped (evoked) case: the row is hidden rather than turned into
 * `display: contents`, and the portal menu is anchored to the group row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { MORE_ROW_ID } from '../src/shared/config.ts'
import { RAIL_SLOT } from '../src/client/registry/rail.tsx'
import { ROW_ATTR } from '../src/client/rail/dom.ts'
import { MORE_HIDE_CSS, hostRowsEvokeCss } from '../src/client/rail/css.ts'
import { createMoreUnit, type MoreUnit } from '../src/client/more/index.ts'
import { createStyleRegistry, type StyleRegistry } from '../src/client/styles.ts'
import type { ClientContext } from '../src/client/ctx.ts'
import type { Translator } from '../src/client/i18n/index.ts'
import type { GlyphRequest } from '../src/client/contracts.ts'
import { FakeLedger, fakeContext } from './helpers/fake-ledger.ts'

const opened: MoreUnit[] = []
const registries: StyleRegistry[] = []

afterEach(() => {
  for (const unit of opened.splice(0)) unit.dispose()
  for (const styles of registries.splice(0)) styles.dispose()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

interface Deps {
  ledger: FakeLedger
  styles: StyleRegistry
  ctx: ClientContext
  translate: Translator
  glyph: (request: GlyphRequest) => ReactNode
}

function makeDeps(): Deps {
  const ledger = new FakeLedger()
  ledger.declare(RAIL_SLOT)
  const styles = createStyleRegistry()
  registries.push(styles)
  return {
    ledger,
    styles,
    ctx: fakeContext(ledger) as unknown as ClientContext,
    translate: { t: () => '更多' } as unknown as Translator,
    glyph: () => null,
  }
}

/** A stand-in for `nav._panelList` holding the proxy and the shell's button. */
function mount(decoys: HTMLElement[] = []): { proxy: HTMLButtonElement; host: HTMLButtonElement } {
  const nav = document.createElement('nav')
  nav.className = 'shell_panelList_abc'
  const proxy = document.createElement('button')
  proxy.className = 'shell_panelRow_abc'
  proxy.setAttribute(ROW_ATTR, MORE_ROW_ID)
  proxy.textContent = 'More'
  nav.appendChild(proxy)
  for (const decoy of decoys) nav.appendChild(decoy)
  const host = document.createElement('button')
  host.className = 'shell_panelRow_abc'
  host.setAttribute('aria-haspopup', 'menu')
  nav.appendChild(host)
  document.body.appendChild(nav)
  return { proxy, host }
}

/** A look-alike button that must never be mistaken for the host launcher. */
function decoyButton(kind: 'stamped' | 'group'): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'shell_panelRow_abc'
  button.setAttribute('aria-haspopup', 'menu')
  if (kind === 'stamped') button.setAttribute(ROW_ATTR, 'some-managed-row')
  else {
    const marker = document.createElement('span')
    marker.setAttribute('data-dsh-railist-group', 'group:g1')
    button.appendChild(marker)
  }
  return button
}

/** jsdom reports 0x0 for every rect; give one element a real measured box. */
function stubRect(element: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect)
}

describe('the More proxy row', () => {
  it('registers a real, page-less slot entry and the host-button hide rule', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))

    const entry = deps.ledger
      .entriesOfSlot(RAIL_SLOT)
      .find(candidate => (candidate.options as { id?: string }).id === MORE_ROW_ID)
    expect(entry).toBeDefined()
    const options = entry?.options as unknown as { id: string; order: number; label: () => string }
    expect(options.id).toBe(MORE_ROW_ID)
    expect(options.order).toBeGreaterThan(0)
    expect(options.label()).toBe('更多')

    // No `main` page: a grouped member click must go through activateRow.
    expect(deps.ledger.entries('main')).toHaveLength(0)

    const style = document.getElementById('dsh-railist-styles')
    expect(style?.textContent).toContain('position: fixed !important')
    expect(style?.textContent).toContain('pointer-events: none !important')
    expect(MORE_HIDE_CSS).toContain('opacity: 0 !important')
  })

  it('hides an evoked proxy row without touching the footer evoke rule', () => {
    const css = hostRowsEvokeCss([{ id: MORE_ROW_ID }])
    // Scoped by the evoke marker's VALUE = the adapter id, so only our proxy
    // row is hidden; EVOKE_CSS's plain `:has([...evoked])` (footer actions'
    // `display: contents`) keeps working.
    expect(css).toContain('display: none !important')
    expect(css).toContain(`data-dsh-railist-evoked="${MORE_ROW_ID}"`)
    expect(css).not.toContain('display: contents')

    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const style = document.getElementById('dsh-railist-styles')
    expect(style?.textContent).toContain(`data-dsh-railist-evoked="${MORE_ROW_ID}"`)
  })

  it('forwards a proxy click to the host button and stops the shell select', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const { proxy, host } = mount()
    const clickSpy = vi.spyOn(host, 'click')
    let reachedTarget = 0
    proxy.addEventListener('click', () => { reachedTarget += 1 })

    // A real pointer position is the last-resort anchor when no row has a rect.
    proxy.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 210, clientY: 140 }))
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    const notCancelled = proxy.dispatchEvent(event)

    expect(notCancelled).toBe(false)          // preventDefault()
    expect(event.defaultPrevented).toBe(true)
    expect(reachedTarget).toBe(0)             // stopPropagation(): shell never sees it
    expect(clickSpy).toHaveBeenCalledTimes(1) // host menu opens
    expect(host.style.left).toBe('210px')
    expect(host.style.top).toBe('140px')
  })

  it('anchors a visible proxy to its own rectangle', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const { proxy, host } = mount()
    stubRect(proxy, { left: 30, top: 60, right: 220, bottom: 96, width: 190, height: 36 })
    const clickSpy = vi.spyOn(host, 'click')

    proxy.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 999, clientY: 999 }))
    proxy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(host.style.left).toBe('30px')
    expect(host.style.top).toBe('60px')
  })

  it('anchors an evoked (grouped) proxy to its group row, not the cursor', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const group = decoyButton('group')
    const { proxy, host } = mount([group])
    // The proxy is `display: none` while evoked → 0x0 rect. The group trigger
    // row is the stable, measurable anchor: menu flies out to its RIGHT, top
    // aligned, instead of popping up at the raw mouse point over the content.
    stubRect(group, { left: 12, top: 100, right: 224, bottom: 136, width: 212, height: 36 })
    const clickSpy = vi.spyOn(host, 'click')

    proxy.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 210, clientY: 140 }))
    proxy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(host.style.left).toBe('232px') // group.right (224) + ANCHOR_GAP (8)
    expect(host.style.top).toBe('100px')  // group.top, top-aligned
  })

  it('leaves group-trigger buttons alone and still finds the real host', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const group = decoyButton('group')
    const { proxy, host } = mount([group])
    const clickSpy = vi.spyOn(host, 'click')

    // Group rows set aria-haspopup too; clicking one is not a proxy click.
    group.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).not.toHaveBeenCalled()

    // findHostButton skips the group row and forwards to the genuine launcher.
    proxy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('skips stamped rows when locating the host launcher', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const { proxy, host } = mount([decoyButton('stamped')])
    const clickSpy = vi.spyOn(host, 'click')

    proxy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('recognises an evoked (grouped) proxy by its evoke marker', () => {
    const deps = makeDeps()
    opened.push(createMoreUnit(deps))
    const { proxy, host } = mount()
    // While evoked the row is `display: none`: no ROW_ATTR, but the glyph
    // wrapper stamps the evoke marker inside the button.
    proxy.removeAttribute(ROW_ATTR)
    const evoked = document.createElement('span')
    evoked.setAttribute('data-dsh-railist-evoked', MORE_ROW_ID)
    proxy.appendChild(evoked)
    const clickSpy = vi.spyOn(host, 'click')

    proxy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('dispose removes the entry, the listeners and the parked position', () => {
    const deps = makeDeps()
    const unit = createMoreUnit(deps)
    const { proxy, host } = mount()
    host.style.left = '123px'
    host.style.top = '45px'

    unit.dispose()

    expect(host.style.left).toBe('')
    expect(host.style.top).toBe('')
    expect(
      deps.ledger.entriesOfSlot(RAIL_SLOT).some(candidate => (candidate.options as { id?: string }).id === MORE_ROW_ID),
    ).toBe(false)
    const clickSpy = vi.spyOn(host, 'click')
    proxy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
