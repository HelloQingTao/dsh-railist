/**
 * The settings-page "automatic discovery" card.
 *
 * It must read as a calm, honest status: when every rail button is managed it
 * shows a one-line "nothing to do", and when a shell button is not adopted it
 * shows the count plus a paste-ready declaration. It must never add a text field
 * (the page's contract forbids free-text controls) or resurrect removed buttons.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createTranslator } from '../src/client/i18n/index.ts'
import { DiscoveryBlock } from '../src/client/more/DiscoveryBlock.tsx'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const t = createTranslator(undefined).t

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

describe('DiscoveryBlock', () => {
  it('says there is nothing to adopt when every button is managed', () => {
    mount([wildButton('More')])
    render(<DiscoveryBlock t={t} />)
    expect(screen.getByText('No unmanaged entry — every rail button is managed.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('reports the count and shows a paste-ready declaration when one is missing', () => {
    mount([wildButton('More'), wildButton('Extra')])
    render(<DiscoveryBlock t={t} />)
    expect(screen.getByText('Found 1 unmanaged entry.')).toBeTruthy()
    expect(screen.getAllByText('Extra').length).toBeGreaterThan(0)
    expect(screen.getByText(/hostSelector:/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
