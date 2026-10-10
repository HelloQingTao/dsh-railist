/**
 * Specs for the built-in glyph set and the `Glyph` dispatch
 * (`src/client/icons/builtin.tsx`, `src/client/icons/index.tsx`, README §2.5).
 *
 * The catalogue is walked rather than spot-checked: every frozen name must have
 * a glyph, every glyph must be a theme-coloured, self-contained outline on the
 * shell's own 16×16 canvas at its Medium (1.3px) weight — the spec
 * `@deepseek-ai/dsh-client-ui-primitives` draws its product icons to, so ours
 * sit next to a shipped one without looking foreign — and it must be
 * recognisable at rail size and can never nest an interactive element inside
 * the shell's row `<button>`.
 */

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BUILTIN_ICON_NAMES } from '../src/shared/config.ts'
import type { BuiltinIconName } from '../src/shared/config.ts'
import {
  assertBuiltinGlyphCatalogue,
  BUILTIN_GLYPHS,
  FALLBACK_GLYPH,
} from '../src/client/icons/builtin.tsx'
import { BuiltinGlyph, glyphDataUri, Glyph } from '../src/client/icons/index.tsx'

const NAMES: readonly BuiltinIconName[] = BUILTIN_ICON_NAMES
const DATA_PREFIX = 'data:image/svg+xml,'
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]'

/** A contributor glyph, to prove the native path is taken verbatim. */
function nativeGlyph({ size }: { size: number }): ReactNode {
  return <svg data-native="true" width={size} height={size} viewBox="0 0 24 24" />
}

describe('built-in catalogue', () => {
  it('covers every frozen name exactly once', () => {
    expect(() => assertBuiltinGlyphCatalogue()).not.toThrow()
    expect(NAMES).toHaveLength(24)
    expect(Object.keys(BUILTIN_GLYPHS).sort()).toEqual([...NAMES].sort())
  })

  it('draws a distinct glyph for every name', () => {
    const seen = new Map<string, BuiltinIconName>()
    for (const name of NAMES) {
      const { container, unmount } = render(<BuiltinGlyph name={name} size={16} />)
      const markup = container.innerHTML
      expect(markup, name).not.toBe('')
      expect(seen.has(markup), `${name} duplicates ${String(seen.get(markup))}`).toBe(false)
      seen.set(markup, name)
      unmount()
    }
    expect(seen.size).toBe(NAMES.length)
  })

  it('draws a 16×16 outline in currentColor at the requested edge', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<BuiltinGlyph name={name} size={15} />)
      const svg = container.querySelector('svg')
      expect(svg, name).not.toBeNull()
      expect(svg?.getAttribute('viewBox'), name).toBe('0 0 16 16')
      expect(svg?.getAttribute('width'), name).toBe('15')
      expect(svg?.getAttribute('height'), name).toBe('15')
      expect(svg?.getAttribute('fill'), name).toBe('none')
      expect(svg?.getAttribute('stroke'), name).toBe('currentColor')
      // The shell's own icon weight (`Icon*OutlineMedium`), which is what the
      // rail rows and the settings navigation are drawn at.
      expect(svg?.getAttribute('stroke-width'), name).toBe('1.3')
      expect(svg?.getAttribute('stroke-linecap'), name).toBe('round')
      expect(svg?.getAttribute('stroke-linejoin'), name).toBe('round')
      expect(svg?.getAttribute('aria-hidden'), name).toBe('true')
      expect(svg?.getAttribute('data-panellist-glyph'), name).toBe(name)
      unmount()
    }
  })

  it('stays self-contained, colour-neutral and non-interactive', () => {
    for (const name of NAMES) {
      const { container, unmount } = render(<BuiltinGlyph name={name} size={16} />)
      const html = container.innerHTML
      expect(html, name).not.toMatch(/<script|<image|<use|<foreignObject|\shref=|url\(/i)
      expect(html, name).not.toMatch(/\sid="/)
      expect(html, name).not.toMatch(/#[0-9a-f]{3}|rgb\(/i)
      expect(container.querySelector(INTERACTIVE), name).toBeNull()
      for (const element of Array.from(container.querySelectorAll('*'))) {
        for (const paint of ['fill', 'stroke']) {
          const value = element.getAttribute(paint)
          if (value !== null) expect(['currentColor', 'none'], `${name} ${paint}`).toContain(value)
        }
      }
      unmount()
    }
  })

  it('uses only well-formed path data with absolute-starting subpaths', () => {
    const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]+$/
    for (const name of NAMES) {
      const { container, unmount } = render(<BuiltinGlyph name={name} size={16} />)
      for (const path of Array.from(container.querySelectorAll('path'))) {
        const d = path.getAttribute('d') ?? ''
        expect(d, name).toMatch(/^M/)
        expect(d, name).toMatch(PATH_DATA)
        expect(d, name).not.toMatch(/\.\./)
      }
      unmount()
    }
  })

  it('falls back to a 16px edge for a degenerate size', () => {
    const { container } = render(<BuiltinGlyph name="star" size={0} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16')
  })

  it('keeps the fallback glyph inside the catalogue', () => {
    expect(NAMES).toContain(FALLBACK_GLYPH)
  })
})

describe('glyphDataUri', () => {
  it('produces a black, distinct mask URI per glyph', () => {
    const uris = new Set<string>()
    for (const name of NAMES) {
      const uri = glyphDataUri(name)
      expect(uri.startsWith(DATA_PREFIX), name).toBe(true)

      // Unquoted inside a CSS url(): the payload must not need escaping.
      const encoded = uri.slice(DATA_PREFIX.length)
      expect(encoded, name).not.toMatch(/[<>"()]/)

      const markup = decodeURIComponent(encoded)
      expect(markup, name).toContain('viewBox="0 0 16 16"')
      // The mask is painted at the glyph's own 16px edge, the same box the
      // shell's settings navigation draws its icons in.
      expect(markup, name).toContain('width="16"')
      expect(markup, name).toContain('height="16"')
      expect(markup, name).toContain('stroke-width="1.3"')
      expect(markup, name).toContain('stroke="black"')
      expect(markup, name).toMatch(/<(path|rect|circle|ellipse)\b/)
      expect(markup, name).not.toMatch(/currentColor/)
      uris.add(uri)
    }
    expect(uris.size).toBe(NAMES.length)
  })
})

describe('Glyph', () => {
  it('renders the native glyph when there is no override', () => {
    for (const icon of [null, { kind: 'original' } as const]) {
      const { container, unmount } = render(<Glyph icon={icon} native={nativeGlyph} size={18} />)
      const native = container.querySelector('[data-native]')
      expect(native).not.toBeNull()
      expect(native?.getAttribute('width')).toBe('18')
      expect(container.querySelector('[data-panellist-glyph]')).toBeNull()
      unmount()
    }
  })

  it('forwards size and active to the contributor glyph', () => {
    const seen: Array<{ size: number; active: boolean | undefined }> = []
    function probe(props: { size: number; active?: boolean }): ReactNode {
      seen.push({ size: props.size, active: props.active })
      return <svg data-native="true" />
    }
    render(<Glyph icon={null} native={probe} size={20} active />)
    expect(seen).toEqual([{ size: 20, active: true }])
  })

  it('renders the box fallback when neither override nor native glyph exists', () => {
    const { container } = render(<Glyph icon={null} size={16} />)
    expect(FALLBACK_GLYPH).toBe('box')
    expect(container.querySelector('svg')?.getAttribute('data-panellist-glyph')).toBe('box')
  })

  it('renders the requested built-in glyph', () => {
    const { container } = render(<Glyph icon={{ kind: 'builtin', name: 'star' }} size={16} />)
    expect(container.querySelector('svg')?.getAttribute('data-panellist-glyph')).toBe('star')
  })

  it('inlines a sanitised custom glyph in a sized, non-interactive wrapper', () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="currentColor"/></svg>'
    const { container } = render(<Glyph icon={{ kind: 'custom', svg }} size={17} />)
    const wrapper = container.querySelector('[data-panellist-glyph="custom"]')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.querySelector('path')?.getAttribute('d')).toBe('M4 4h16v16H4z')
    expect(wrapper?.getAttribute('style')).toContain('width: 17px')
    expect(container.querySelector(INTERACTIVE)).toBeNull()
  })

  it('re-sanitises on render and degrades instead of throwing', () => {
    const svg = '<svg viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script></svg>'
    const { container } = render(<Glyph icon={{ kind: 'custom', svg }} native={nativeGlyph} size={16} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[data-panellist-glyph="custom"]')).toBeNull()
    expect(container.querySelector('[data-native]')).not.toBeNull()
  })

  it('falls back to the box when a corrupt custom glyph has no native alternative', () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M4 4"'
    const { container } = render(<Glyph icon={{ kind: 'custom', svg }} size={16} />)
    expect(container.querySelector('svg')?.getAttribute('data-panellist-glyph')).toBe('box')
  })
})
