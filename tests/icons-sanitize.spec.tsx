/**
 * Specs for the custom-icon allow-list (README §2.5, `src/client/icons/sanitize.ts`).
 *
 * The acceptance cases pin the happy path (a plain path, a gradient-filled
 * group) and the round trip; the rejection cases walk the hostile surface the
 * settings page can be handed: script, events, external links, foreignObject,
 * oversized and truncated documents, unresolved and external `url(…)`.
 */

import { describe, expect, it } from 'vitest'
import { MAX_SVG_LENGTH, MIN_SVG_LENGTH } from '../src/shared/config.ts'
import { sanitizeSvg } from '../src/client/icons/index.tsx'

const PLAIN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>'

const GRADIENT = [
  '<svg viewBox="0 0 24 24">',
  '<defs><linearGradient id="paint" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="24">',
  '<stop offset="0" stop-color="#ff0000"/>',
  '<stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>',
  '</linearGradient></defs>',
  '<g fill="url(#paint)"><rect x="2" y="2" width="20" height="20" rx="3"/></g>',
  '</svg>',
].join('')

/** The serialized glyph, or a failure that names the reason. */
function accepted(source: string): string {
  const result = sanitizeSvg(source)
  if (!result.ok) throw new Error(`expected a clean pass, got: ${result.reason}`)
  return result.svg
}

/** The rejection reason, or a failure that shows the accepted markup. */
function rejected(source: string): string {
  const result = sanitizeSvg(source)
  if (result.ok) throw new Error(`expected a rejection, got: ${result.svg}`)
  return result.reason
}

describe('sanitizeSvg / acceptance', () => {
  it('accepts a plain path and keeps its geometry', () => {
    const svg = accepted(PLAIN)
    expect(svg).toContain('<path')
    expect(svg).toContain('d="M4 4h16v16H4z"')
    expect(svg).toContain('viewBox="0 0 24 24"')
  })

  it('accepts a group painted by an internal gradient', () => {
    const svg = accepted(GRADIENT)
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('<stop')
    expect(svg).toContain('stop-color="#ff0000"')
    expect(svg).toContain('fill="url(#paint)"')
    expect(svg).toContain('<g')
  })

  it('injects a 24×24 viewBox when the root has none', () => {
    const svg = accepted('<svg><circle cx="12" cy="12" r="9"/></svg>')
    expect(svg).toContain('viewBox="0 0 24 24"')
    // A source pasted without a namespace still comes back as a standalone document.
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('lets the sized container own the box: root width/height become 100%', () => {
    const svg = accepted('<svg width="48" height="48" viewBox="0 0 24 24"><path d="M4 4h16"/></svg>')
    expect(svg).toContain('width="100%"')
    expect(svg).toContain('height="100%"')
  })

  it('strips comments and processing instructions', () => {
    const svg = accepted('<svg viewBox="0 0 24 24"><!-- payload --><?pi data?><path d="M4 4h16"/></svg>')
    expect(svg).not.toContain('<!--')
    expect(svg).not.toContain('<?')
    expect(svg).toContain('<path')
  })

  it('drops attributes outside the allow-list without failing the glyph', () => {
    const svg = accepted(
      '<svg viewBox="0 0 24 24" class="icon" version="1.1" data-x="1"><path d="M4 4h16" aria-label="x"/></svg>',
    )
    expect(svg).not.toContain('class=')
    expect(svg).not.toContain('version=')
    expect(svg).not.toContain('data-x')
    expect(svg).not.toContain('aria-label')
    expect(svg).toContain('d="M4 4h16"')
  })

  it('survives a round trip through itself, unchanged', () => {
    const once = accepted(PLAIN)
    const twice = sanitizeSvg(once)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    expect(twice.svg).toBe(once)
  })
})

describe('sanitizeSvg / rejection', () => {
  it.each(['script', 'style', 'image', 'a', 'use', 'iframe', 'object', 'embed', 'set'])(
    'rejects a <%s> element',
    tag => {
      expect(rejected(`<svg viewBox="0 0 24 24"><${tag}></${tag}></svg>`)).toMatch(new RegExp(tag, 'i'))
    },
  )

  it.each(['animate', 'animateTransform', 'animateMotion'])('rejects a <%s> element', tag => {
    expect(rejected(`<svg viewBox="0 0 24 24"><${tag}/></svg>`)).toMatch(new RegExp(tag, 'i'))
  })

  it('rejects an unknown element', () => {
    expect(rejected('<svg viewBox="0 0 24 24"><blink/></svg>')).toMatch(/allow-list/)
  })

  it('rejects an event attribute', () => {
    expect(rejected('<svg viewBox="0 0 24 24" onload="alert(1)"><path d="M4 4h16"/></svg>')).toMatch(/onload/)
  })

  it('rejects an href, external or not', () => {
    const source = [
      '<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">',
      '<path xlink:href="http://evil.example/x" d="M4 4h16"/>',
      '</svg>',
    ].join('')
    expect(rejected(source)).toMatch(/href/)
  })

  it('rejects foreignObject', () => {
    expect(rejected('<svg viewBox="0 0 24 24"><foreignObject width="10" height="10"/></svg>')).toMatch(
      /foreignObject/i,
    )
  })

  it('rejects a document longer than the cap', () => {
    const reason = rejected(`<svg viewBox="0 0 24 24">${'x'.repeat(MAX_SVG_LENGTH)}</svg>`)
    expect(reason).toMatch(/longer than/)
    expect(reason).toContain(String(MAX_SVG_LENGTH))
  })

  it('rejects a document shorter than the floor', () => {
    const reason = rejected('<svg/>')
    expect(reason).toMatch(/shorter than/)
    expect(reason).toContain(String(MIN_SVG_LENGTH))
  })

  it('rejects a truncated document', () => {
    expect(rejected('<svg viewBox="0 0 24 24"><path d="M4 4h16"')).toMatch(/well-formed/)
  })

  it('rejects a root that is not <svg>', () => {
    expect(rejected('<html><body><p>nope</p></body></html>')).toMatch(/root element/)
  })

  it('rejects an internal reference that does not resolve', () => {
    const source = '<svg viewBox="0 0 24 24"><rect width="20" height="20" fill="url(#missing)"/></svg>'
    expect(rejected(source)).toMatch(/does not resolve/)
  })

  it('rejects a reference pointing outside the document', () => {
    const source =
      '<svg viewBox="0 0 24 24"><rect width="20" height="20" fill="url(http://evil.example/x.svg)"/></svg>'
    expect(rejected(source)).toMatch(/external/)
  })

  it('rejects a style attribute smuggling a url()', () => {
    const source = '<svg viewBox="0 0 24 24"><path d="M4 4h16" style="fill:url(#x)"/></svg>'
    expect(rejected(source)).toMatch(/style/)
  })

  it('rejects a style attribute smuggling expression()', () => {
    const source = '<svg viewBox="0 0 24 24"><path d="M4 4h16" style="width:expression(alert(1))"/></svg>'
    expect(rejected(source)).toMatch(/style/)
  })

  it.each(['javascript:alert(1)', 'expression(alert(1))'])('rejects %s in any attribute', value => {
    const source = `<svg viewBox="0 0 24 24"><path d="M4 4h16" fill="${value}"/></svg>`
    expect(rejected(source)).toMatch(/executable or external/)
  })
})
