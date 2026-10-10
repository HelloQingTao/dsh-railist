/**
 * Appearance editor behaviour (task-4, item 3): name, glyph (all three sources),
 * hidden, locked, and the group trigger + member list.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createHarness } from './helpers/settings-harness.tsx'
import { Section } from '../src/client/settings/Section.tsx'
import { MAX_SVG_LENGTH, type ProfileConfig } from '../src/shared/config.ts'
import { setGroupIcon, setGroupLabel, setPanelIcon, setPanelLabel } from '../src/shared/edit.ts'
import { createTranslator } from '../src/client/i18n/index.ts'

function profileWith(ids: readonly string[]): ProfileConfig {
  return { sequence: ids.map(id => ({ type: 'entry' as const, id })), entries: {} }
}

// vitest runs without globals, so testing-library cannot auto-register cleanup.
afterEach(cleanup)

const GROUPED: ProfileConfig = {
  sequence: [{ type: 'group', id: 'group:g1', members: ['plugins', 'schedules'] }, { type: 'entry', id: 'skills' }],
  entries: {},
}

function selectRow(id: string): void {
  const row = document.querySelector(`[data-row-id="${id}"]`)
  const button = row === null ? null : row.querySelector('[data-action="select"]')
  if (button === null) throw new Error(`no row to select for "${id}"`)
  fireEvent.click(button)
}

function renderPage(profile: ProfileConfig, sanitizeSvg?: (source: string) => { ok: true; svg: string } | { ok: false; reason: string }): ReturnType<typeof createHarness> {
  const harness = createHarness({ profile, ...(sanitizeSvg === undefined ? {} : { sanitizeSvg }) })
  render(<Section deps={harness.deps} close={() => {}} />)
  return harness
}

function memberOf(id: string): HTMLElement {
  const member = document.querySelector(`[data-editor] [data-member-id="${id}"]`)
  if (member === null) throw new Error(`no member row for "${id}"`)
  return member as HTMLElement
}

describe('AppearanceEditor (panel row)', () => {
  it('commits a display name on blur', () => {
    const initial = profileWith(['plugins', 'schedules'])
    const harness = renderPage(initial)
    selectRow('plugins')

    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'Plugins market' } })
    fireEvent.focusOut(input)

    expect(harness.updates).toHaveLength(1)
    expect(harness.updates[0]).toEqual(setPanelLabel(initial, 'plugins', 'Plugins market'))
  })

  it('picks a built-in glyph from the grid', () => {
    const initial = profileWith(['plugins', 'schedules'])
    const harness = renderPage(initial)
    selectRow('plugins')

    fireEvent.click(screen.getByRole('radio', { name: 'Built-in set' }))
    expect(harness.updates[0]).toEqual(setPanelIcon(initial, 'plugins', { kind: 'builtin', name: 'grid' }))

    fireEvent.click(screen.getByRole('button', { name: 'puzzle' }))
    expect(harness.updates[1]).toEqual(setPanelIcon(initial, 'plugins', { kind: 'builtin', name: 'puzzle' }))
    // The grid cell and the preview both render the picked glyph.
    expect(document.querySelectorAll('[data-glyph="builtin:puzzle"]').length).toBeGreaterThanOrEqual(2)
  })

  it('shows the sanitizer reason when a pasted SVG is rejected', () => {
    const harness = renderPage(profileWith(['plugins']), source => (source.includes('<script')
      ? { ok: false, reason: 'script element' }
      : { ok: true, svg: source }))
    selectRow('plugins')

    fireEvent.click(screen.getByRole('radio', { name: 'Paste SVG' }))
    const box = screen.getByRole('textbox', { name: 'Paste SVG' })
    fireEvent.change(box, { target: { value: '<svg><script>alert(1)</script></svg>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert').textContent).toBe('That SVG was rejected: script element')
    expect(harness.updates).toHaveLength(0)
  })

  it('rejects an oversized SVG with the size copy', () => {
    const harness = renderPage(profileWith(['plugins']))
    selectRow('plugins')

    fireEvent.click(screen.getByRole('radio', { name: 'Paste SVG' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste SVG' }), { target: { value: 'x'.repeat(MAX_SVG_LENGTH + 1) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert').textContent).toBe('SVG is larger than 64 KB.')
    expect(harness.updates).toHaveLength(0)
  })

  it('accepts a sanitized SVG', () => {
    const initial = profileWith(['plugins'])
    const harness = renderPage(initial)
    selectRow('plugins')

    fireEvent.click(screen.getByRole('radio', { name: 'Paste SVG' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste SVG' }), { target: { value: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(harness.updates[0]).toEqual(setPanelIcon(initial, 'plugins', {
      kind: 'custom',
      svg: '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
    }))
  })

  it('leaves visibility to the sequence list instead of repeating it here', () => {
    // The appearance editor used to carry its own Hidden (and Locked) checkbox.
    // Visibility now has exactly one entry point — the per-row Hide/Show button —
    // so this editor offers no checkbox for it at all.
    renderPage(profileWith(['plugins']))
    selectRow('plugins')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('previews the rail icon itself while nothing is overridden', () => {
    renderPage(profileWith(['plugins']))
    selectRow('plugins')
    const preview = document.querySelector('.dsh-panellist-settings-preview')
    expect(preview?.querySelector('[data-native-panel="plugins"]')).not.toBeNull()
  })

  it('previews a group trigger with its first member\'s glyph', () => {
    renderPage(GROUPED)
    selectRow('group:g1')
    const preview = document.querySelector('.dsh-panellist-settings-preview')
    // README §2.6: an icon-less trigger borrows the first live member's glyph,
    // exactly as the rail row does.
    expect(preview?.querySelector('[data-native-panel="plugins"]')).not.toBeNull()
  })

  it('shows a localized sentence for a coded refusal, not the raw English reason', () => {
    const harness = createHarness({
      profile: profileWith(['plugins']),
      translate: createTranslator({ getLocale: () => ({ active: 'zh-CN' }), subscribe: () => () => {} }),
      sanitizeSvg: () => ({ ok: false, reason: 'raw english detail', code: 'forbidden' }),
    })
    render(<Section deps={harness.deps} close={() => {}} />)
    selectRow('plugins')

    fireEvent.click(screen.getByRole('radio', { name: '粘贴 SVG' }))
    fireEvent.change(screen.getByRole('textbox', { name: '粘贴 SVG' }), { target: { value: '<svg viewBox="0 0 24 24"><path d="M0 0h4v4H0z"/></svg>' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(screen.getByRole('alert').textContent).toBe('图标源码里含有不允许的元素或属性。')
    expect(document.body.textContent ?? '').not.toContain('raw english detail')
    expect(harness.updates).toHaveLength(0)
  })

  it('falls back to the raw reason when a refusal carries no code', () => {
    const harness = createHarness({
      profile: profileWith(['plugins']),
      sanitizeSvg: () => ({ ok: false, reason: 'raw english detail' }),
    })
    render(<Section deps={harness.deps} close={() => {}} />)
    selectRow('plugins')

    fireEvent.click(screen.getByRole('radio', { name: 'Paste SVG' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste SVG' }), { target: { value: '<svg viewBox="0 0 24 24"><path d="M0 0h4v4H0z"/></svg>' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('alert').textContent).toBe('That SVG was rejected: raw english detail')
    expect(harness.updates).toHaveLength(0)
  })
})

describe('AppearanceEditor (group row)', () => {
  it('renames the group trigger', () => {
    const harness = renderPage(GROUPED)
    selectRow('group:g1')

    const input = screen.getByRole('textbox', { name: 'Group name' })
    fireEvent.change(input, { target: { value: 'More' } })
    fireEvent.focusOut(input)

    expect(harness.updates[0]).toEqual(setGroupLabel(GROUPED, 'group:g1', 'More'))
  })

  it('sets the group trigger glyph', () => {
    const harness = renderPage(GROUPED)
    selectRow('group:g1')

    fireEvent.click(screen.getByRole('radio', { name: 'Built-in set' }))
    expect(harness.updates[0]).toEqual(setGroupIcon(GROUPED, 'group:g1', { kind: 'builtin', name: 'grid' }))
  })

  it('reorders and removes members through materializeSequence', () => {
    const harness = renderPage(GROUPED)
    selectRow('group:g1')

    fireEvent.click(memberOf('plugins').querySelector('[data-action="memberMoveDown"]') as HTMLElement)
    const reordered = harness.updates[0]
    const firstGroup = reordered?.sequence[0]
    if (firstGroup?.type !== 'group') throw new Error('expected a group')
    expect(firstGroup.members).toEqual(['schedules', 'plugins'])

    fireEvent.click(memberOf('plugins').querySelector('[data-action="memberRemove"]') as HTMLElement)
    const removed = harness.updates[1]
    expect(removed?.sequence.map(item => item.type)).toEqual(['group', 'entry', 'entry'])
    const group = removed?.sequence[0]
    if (group?.type !== 'group') throw new Error('expected the group to survive')
    expect(group.members).toEqual(['schedules'])
  })

  it('leaves the group trigger visibility to the sequence list too', () => {
    // Same rule as the panel branch: the per-row Hide/Show button is the single
    // entry point for visibility, so neither editor renders a checkbox for it.
    renderPage(GROUPED)
    selectRow('group:g1')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
