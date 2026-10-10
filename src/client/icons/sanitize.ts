/**
 * The SVG allow-list behind a pasted custom icon (README §2.5).
 *
 * A custom icon is untrusted input: the settings page hands us whatever the
 * user pasted, and the file on disk is hand-editable, so the same pass runs
 * again on every render (see `client/icons/index.tsx`).
 *
 * The pass is deliberately a *strict* allow-list with a hostile-input bias:
 *
 * - element names are matched case-insensitively against a small allowed set,
 *   so `<foreignObject>`, `<script>`, `<style>`, `<image>`, `<a>`, `<use>`,
 *   `<set>`, `animate*`, `<iframe>`, `<object>` and every unknown element are
 *   rejected outright (a rejection is louder than a silent removal);
 * - `on*` event attributes and anything whose local name is `href`
 *   (`href`, `xlink:href`, …) are rejected;
 * - a `style` attribute is kept only when it contains no `url(`, `expression(`
 *   or `javascript:` — a style *element* never survives;
 * - every `url(…)` reference must be an internal `url(#id)` whose id exists in
 *   the same document; external references are rejected;
 * - attributes outside the allow-list are *stripped* (a pasted icon from a
 *   design tool carries harmless extras such as `class`, `version`, `data-*`
 *   and stray namespace declarations, and dropping those is friendlier than
 *   failing the whole paste);
 * - comments and processing instructions are removed.
 *
 * The result is serialized back with `XMLSerializer` and normalised so a
 * glyph behaves inside its sized container: the root keeps (or gains) a
 * `viewBox` — `0 0 24 24` when absent — and its `width`/`height` become `100%`.
 */

import { MAX_SVG_LENGTH, MIN_SVG_LENGTH } from '../../shared/config.ts'
import type { SanitizeFailure, SanitizeResult } from '../contracts.ts'

/** Namespace of the glyph we hand back, used when the source relies on HTML parsing. */
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Square default for a custom icon that arrived without a `viewBox`. */
const DEFAULT_VIEW_BOX = '0 0 24 24'

/** The root is always scaled by its container, never by its own attributes. */
const ROOT_SIZE = '100%'

/** Elements that are rejected by name for a precise reason (all also absent from the allow-list). */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'style',
  'image',
  'a',
  'use',
  'set',
  'iframe',
  'object',
  'embed',
])

/** The ordinary shape set. Anything else is rejected. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'title',
  'desc',
])

/**
 * Geometry, paint, transform and the handful of structural attributes the
 * allowed elements can carry. Matched on the qualified attribute name, so
 * `xlink:fill` is not mistaken for `fill`.
 */
const ALLOWED_ATTRIBUTES = new Set([
  // geometry
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'transform',
  'transform-origin',
  'vector-effect',
  // paint
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'color',
  'opacity',
  'paint-order',
  'marker-start',
  'marker-mid',
  'marker-end',
  'clip-path',
  'clip-rule',
  'display',
  'visibility',
  // structure / gradients
  'id',
  'viewBox',
  'preserveAspectRatio',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'clipPathUnits',
  'xmlns',
  // a style attribute is allowed, but only after the check below
  'style',
])

/** Constructs that turn a style *attribute* into code or an external fetch. */
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:/i

/** The same constructs when they appear in any other attribute value. */
const UNSAFE_VALUE = /expression\s*\(|@import|javascript:|behavior\s*:/i

/** `url(…)`, with or without quotes. */
const URL_REFERENCE = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi

/**
 * Attributes whose value is a paint or a reference. A URL is only meaningful
 * here inside `url(#id)`, so a bare URL-ish value is refused rather than
 * accepted-and-ignored: an invalid paint paints nothing today, but the string
 * would still ship to the DOM, and a future consumer could read it as a URL.
 */
const REFERENCE_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'color',
  'stop-color',
  'marker-start',
  'marker-mid',
  'marker-end',
  'clip-path',
])

/** A URI scheme, or a protocol-relative URL. */
const URL_LIKE = /\/\/|^[a-z][a-z0-9+.-]*:/i

/**
 * Markers whose meaning flips between the XML parser and the HTML parser.
 *
 * The consumer injects the sanitised string with `dangerouslySetInnerHTML`, so
 * the string is parsed a SECOND time — this time as HTML. A CDATA section is
 * text to an XML parser and a markup boundary to a careless HTML one, so a
 * source containing it can smuggle a live `<img onerror>` past an XML-only
 * allow-list (verified: `tests/icons-hardening.spec.tsx`). No icon needs it.
 */
const CDATA_MARKERS = ['<![CDATA[', ']]>'] as const

/**
 * Reject with a closed-set code (what the page translates) plus a
 * human-readable reason (what a developer reads in the tooltip and the log).
 * @param reason - precise, English, never shown to a user when a code exists.
 * @param code - which localized sentence the refusal maps to.
 */
function reject(reason: string, code: SanitizeFailure = 'forbidden'): SanitizeResult {
  return { ok: false, reason, code }
}

/**
 * Replace every CDATA section with a plain text node.
 *
 * The marker check above already refuses such sources; this is the second line
 * of defence for a document that acquired one through an entity or a parser
 * quirk. Escaping happens at serialisation time, so the text can never become
 * markup again.
 */
function flattenCdata(node: Element): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 4) {
      const text = node.ownerDocument.createTextNode(child.nodeValue ?? '')
      node.replaceChild(text, child)
      continue
    }
    if (child.nodeType === 1) flattenCdata(child as Element)
  }
}

/** Every element in the document, root first, in document order. */
function collectElements(root: Element): Element[] {
  const elements: Element[] = [root]
  const descendants = root.getElementsByTagName('*')
  for (let index = 0; index < descendants.length; index += 1) {
    const element = descendants.item(index)
    if (element !== null) elements.push(element)
  }
  return elements
}

/** A snapshot of an element's attributes, safe to mutate the element while walking it. */
function attributeList(element: Element): Attr[] {
  const attributes: Attr[] = []
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index)
    if (attribute !== null) attributes.push(attribute)
  }
  return attributes
}

/** Every `url(…)` target written in one attribute value. */
function urlReferences(value: string): string[] {
  const references: string[] = []
  for (const match of value.matchAll(URL_REFERENCE)) {
    references.push((match[2] ?? '').trim())
  }
  return references
}

/**
 * Drop comments (nodeType 8) and processing instructions (nodeType 7).
 * jsdom and every browser give them no behaviour, but they can carry payloads
 * a naive consumer might later copy out of the string.
 */
function stripMetadata(node: Element): void {
  const children = Array.from(node.childNodes)
  for (const child of children) {
    if (child.nodeType === 8 || child.nodeType === 7) {
      node.removeChild(child)
      continue
    }
    if (child.nodeType === 1) stripMetadata(child as Element)
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run one custom SVG through the allow-list.
 *
 * Accepts only a well-formed XML document whose root is `<svg>`, between
 * {@link MIN_SVG_LENGTH} and {@link MAX_SVG_LENGTH} code units.
 */
export function sanitizeSvg(source: string): SanitizeResult {
  if (typeof source !== 'string') return reject('icon source is not a string', 'malformed')
  if (source.length < MIN_SVG_LENGTH) {
    return reject(`icon source is shorter than ${MIN_SVG_LENGTH} characters`, 'size')
  }
  if (source.length > MAX_SVG_LENGTH) {
    return reject(`icon source is longer than ${MAX_SVG_LENGTH} characters`, 'size')
  }
  for (const marker of CDATA_MARKERS) {
    if (source.includes(marker)) {
      return reject(`icon source contains "${marker}", which is not allowed in an icon`, 'forbidden')
    }
  }

  let document: Document
  try {
    document = new DOMParser().parseFromString(source, 'image/svg+xml')
  } catch (error) {
    return reject(`icon source could not be parsed: ${describe(error)}`, 'malformed')
  }

  const root = document.documentElement
  if (root === null) return reject('icon source has no root element', 'malformed')
  if (root.localName === 'parsererror' || document.querySelector('parsererror') !== null) {
    return reject('icon source is not well-formed XML', 'malformed')
  }
  if (root.localName !== 'svg') {
    return reject(`root element is <${root.localName}>, expected <svg>`, 'malformed')
  }

  const elements = collectElements(root)
  const ids = new Set<string>()
  const references: Array<{ id: string; attribute: string }> = []

  for (const element of elements) {
    const tag = element.localName
    const lower = tag.toLowerCase()

    if (FORBIDDEN_ELEMENTS.has(lower) || lower.startsWith('animate')) {
      return reject(`<${tag}> is not allowed`)
    }
    if (!ALLOWED_ELEMENTS.has(lower)) {
      return reject(`<${tag}> is not in the icon allow-list`)
    }

    for (const attribute of attributeList(element)) {
      const name = attribute.name
      const local = (attribute.localName ?? name).toLowerCase()
      const value = attribute.value

      if (name.toLowerCase().startsWith('on')) {
        return reject(`event attribute "${name}" is not allowed`)
      }
      if (local === 'href') {
        return reject(`link attribute "${name}" is not allowed`)
      }
      if (name === 'id') {
        if (value !== '') ids.add(value)
        continue
      }
      if (name === 'style') {
        if (UNSAFE_STYLE.test(value)) {
          return reject('style attribute contains an executable or external reference')
        }
        continue
      }
      if (UNSAFE_VALUE.test(value)) {
        return reject(`attribute "${name}" contains an executable or external reference`)
      }
      for (const reference of urlReferences(value)) {
        if (!reference.startsWith('#')) {
          return reject(`external reference "${reference}" is not allowed`, 'reference')
        }
        references.push({ id: reference.slice(1), attribute: name })
      }
      if (REFERENCE_ATTRIBUTES.has(name) && URL_LIKE.test(value)) {
        return reject(`attribute "${name}" carries a URL-like value ("${value.slice(0, 40)}")`, 'forbidden')
      }
    }
  }

  for (const reference of references) {
    if (!ids.has(reference.id)) {
      return reject(`url(#${reference.id}) in "${reference.attribute}" does not resolve inside this icon`, 'reference')
    }
  }

  // Second pass: drop everything the allow-list does not name.
  for (const element of elements) {
    for (const attribute of attributeList(element)) {
      if (!ALLOWED_ATTRIBUTES.has(attribute.name)) {
        element.removeAttributeNode(attribute)
      }
    }
  }

  stripMetadata(root)
  flattenCdata(root)

  // Normalise the root: a sized container owns the layout, the glyph owns its box.
  if (root.hasAttribute('width')) root.setAttribute('width', ROOT_SIZE)
  if (root.hasAttribute('height')) root.setAttribute('height', ROOT_SIZE)
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', DEFAULT_VIEW_BOX)
  // Always pinned, never merely defaulted: a source that rebinds the namespace
  // must not be able to describe itself as something other than an SVG.
  root.setAttribute('xmlns', SVG_NAMESPACE)

  const serialized = new XMLSerializer().serializeToString(root)
  // The string is re-parsed as HTML by the consumer, so the security property is
  // about the STRING, not the tree: refuse to hand back anything that could mean
  // two things to two parsers.
  for (const marker of CDATA_MARKERS) {
    if (serialized.includes(marker)) {
      return reject('icon source could not be serialised without an ambiguous construct', 'malformed')
    }
  }
  return { ok: true, svg: serialized }
}
