/**
 * Smuggling regressions for the custom-icon allow-list.
 *
 * `Glyph` injects the sanitised string with `dangerouslySetInnerHTML` into an
 * HTML element, so the string is re-parsed a SECOND time by the HTML parser. Any
 * construct that means one thing to the XML parser and another to the HTML
 * parser is therefore a hole in the allow-list, even though the XML tree looked
 * innocent. A CDATA section is exactly that construct.
 *
 * These cases assert the security property (no live script/handler/external
 * resource in the rendered DOM), not a particular implementation of the fix.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Glyph, sanitizeSvg } from '../src/client/icons/index.tsx'

const PIECES = [
  'http://evil.example/beacon.png?a=1',
  '//evil.example/x.js',
  'data:text/html,<script>window.__pwned=1</script>',
  'javascript:alert(1)',
]

/** Every way an SVG can reach the network, with a well-formed URL in it. */
const EXTERNAL_REFERENCES = [
  (url: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="url(${url})"/></svg>`,
  (url: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path style="fill:url(${url})" d="M0 0h4v4H0z"/></svg>`,
  (url: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="${url}"/></svg>`,
  (url: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect onclick="${url}" width="4" height="4"/></svg>`,
  (url: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect fill="${url}" width="4" height="4"/></svg>`,
]

/** SVG sources that must never reach the DOM as markup. */
const HOSTILE: Array<{ name: string; svg: string }> = [
  {
    name: 'CDATA smuggling an img with an event handler',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><desc><![CDATA[</desc>'
      + `<img src="${PIECES[0]}" onerror="window.__pwned=1">]]></desc><path d="M0 0h4v4H0z"/></svg>`,
  },
  {
    name: 'CDATA smuggling an iframe',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title><![CDATA[]]></title>'
      + `<![CDATA[<iframe src="${PIECES[1]}"></iframe>]]></svg>`,
  },
  {
    name: 'CDATA smuggling a script element',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><desc><![CDATA[</desc>'
      + `<script>window.__pwned=1</script>]]></desc></svg>`,
  },
  {
    name: 'a plain script element',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>window.__pwned=1</script></svg>',
  },
  {
    name: 'an img with an event handler',
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><img src="x" onerror="window.__pwned=1"/></svg>',
  },
  {
    name: 'an external paint reference',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="url(${PIECES[0]})"/></svg>`,
  },
]

/** Render one sanitised icon exactly the way the rail does. */
function renderCustom(svg: string): HTMLElement {
  const { container } = render(<Glyph icon={{ kind: 'custom', svg }} native={null} size={20} />)
  return container
}

describe('custom icon smuggling', () => {
  for (const [index, url] of PIECES.entries()) {
    it(`refuses every external-reference shape (piece ${index})`, () => {
      for (const build of EXTERNAL_REFERENCES) {
        const source = build(url)
        const sanitized = sanitizeSvg(source)
        // Either it is refused, or the string that comes back cannot resolve to
        // that URL — never "accepted, and the URL survives into the DOM".
        if (sanitized.ok) {
          const container = renderCustom(sanitized.svg)
          expect(container.innerHTML.includes(url), source).toBe(false)
          expect(container.querySelector('image'), source).toBeNull()
        } else {
          expect(sanitized.reason.length, source).toBeGreaterThan(0)
        }
      }
    })
  }

  it('rejects or neutralises every hostile source', () => {
    for (const hostile of HOSTILE) {
      const sanitized = sanitizeSvg(hostile.svg)
      if (!sanitized.ok) {
        expect(sanitized.reason.length, hostile.name).toBeGreaterThan(0)
        continue
      }
      const container = renderCustom(sanitized.svg)
      expect(container.querySelector('script'), hostile.name).toBeNull()
      expect(container.querySelector('img'), hostile.name).toBeNull()
      expect(container.querySelector('iframe'), hostile.name).toBeNull()
      expect(container.querySelector('foreignObject'), hostile.name).toBeNull()
      for (const element of Array.from(container.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
          expect(attribute.name.toLowerCase().startsWith('on'), `${hostile.name}: ${attribute.name}`).toBe(false)
        }
      }
    }
  })

  it('never returns a serialisation that still contains a CDATA section', () => {
    for (const hostile of HOSTILE) {
      const sanitized = sanitizeSvg(hostile.svg)
      if (!sanitized.ok) continue
      expect(sanitized.svg.includes('<![CDATA['), hostile.name).toBe(false)
      expect(sanitized.svg.includes(']]>'), hostile.name).toBe(false)
    }
  })

  it('still accepts an ordinary icon, including one with escaped text', () => {
    const plain = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h4v4H0z"/></svg>')
    expect(plain.ok).toBe(true)
    const withTitle = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>a &amp; b</title><path d="M0 0h4v4H0z"/></svg>')
    expect(withTitle.ok).toBe(true)
    const withGradient = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g">'
      + '<stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="24" height="24" fill="url(#g)"/></svg>',
    )
    expect(withGradient.ok).toBe(true)
    if (withGradient.ok) {
      const container = renderCustom(withGradient.svg)
      expect(container.querySelector('rect')).not.toBeNull()
    }
  })
})
