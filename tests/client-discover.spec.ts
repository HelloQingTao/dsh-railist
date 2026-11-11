/**
 * Discovery of shell-drawn rail buttons that no adapter covers.
 *
 * The point: a shell upgrade may append a new button into `nav.panelList`. It is
 * then managed by nobody (cannot be ordered / hidden / grouped) and is even
 * parked out of sight by the hide rule. `discoverHostRows()` must report exactly
 * those leftovers so the fix is one adapter line, and must never report railist's
 * own proxy rows or group triggers as leftovers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MORE_ROW_ID } from '../src/shared/config.ts'
import { ROW_ATTR } from '../src/client/rail/dom.ts'
import { discoverHostRows } from '../src/client/more/discover.ts'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function wildButton(text: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'shell_panelRow_abc'
  button.setAttribute('aria-haspopup', 'menu')
  button.textContent = text
  return button
}

function mount(children: HTMLElement[]): void {
  const nav = document.createElement('nav')
  nav.className = 'shell_panelList_abc'
  for (const child of children) nav.appendChild(child)
  document.body.appendChild(nav)
}

describe('discoverHostRows', () => {
  it('returns nothing when the only wild button is already adopted', () => {
    mount([wildButton('More')])
    expect(discoverHostRows()).toEqual([])
  })

  it('reports a second wild button as unmanaged', () => {
    mount([wildButton('More'), wildButton('Extra')])
    const found = discoverHostRows()
    expect(found).toHaveLength(1)
    expect(found[0]?.label).toBe('Extra')
    expect(found[0]?.suggestedId).toBe('dsh-railist-host-1')
  })

  it("ignores railist's own proxy rows and group triggers", () => {
    const proxy = document.createElement('button')
    proxy.className = 'shell_panelRow_abc'
    proxy.setAttribute('aria-haspopup', 'menu')
    proxy.setAttribute(ROW_ATTR, MORE_ROW_ID)

    const group = document.createElement('button')
    group.className = 'shell_panelRow_abc'
    group.setAttribute('aria-haspopup', 'menu')
    const marker = document.createElement('span')
    marker.setAttribute('data-dsh-railist-group', 'group:g1')
    group.appendChild(marker)

    // Only the genuine shell button counts as wild; the proxy and group rows are ours.
    mount([wildButton('More'), proxy, group])
    expect(discoverHostRows()).toEqual([])
  })

  it('emits a paste-ready declaration carrying the button label', () => {
    mount([wildButton('More'), wildButton("O'Brien")])
    const found = discoverHostRows()
    expect(found).toHaveLength(1)
    const snippet = found[0]?.snippet ?? ''
    expect(snippet).toContain("id: 'dsh-railist-host-1'")
    // The label is escaped for a single-quoted JS literal.
    expect(snippet).toContain("label: 'O\\'Brien'")
    expect(snippet).toContain('hostSelector:')
  })

  it('returns nothing when the rail is not mounted', () => {
    expect(discoverHostRows()).toEqual([])
  })
})
