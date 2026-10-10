/**
 * The icons unit's public surface, typed against the frozen `IconModule`
 * contract so a signature drift breaks the build here rather than at the rail.
 *
 * `Glyph` is the single decision point of README §2.5:
 *
 * - no override (`icon === null`) or an explicit "keep the original"
 *   (`{kind:'original'}`) renders the contributor's own glyph, or the `box`
 *   fallback when the panel has none;
 * - `{kind:'builtin', name}` renders that glyph from the hand-written set;
 * - `{kind:'custom', svg}` renders the pasted SVG inline. It already passed
 *   the allow-list on the way into the config, but the config file is
 *   hand-editable, so {@link sanitizeSvg} runs again on every render; a source
 *   that no longer passes degrades to the native glyph (or the fallback)
 *   instead of throwing inside the rail.
 *
 * A custom glyph renders through a `<span>` because the rail row is a shell
 * owned `<button>`: a glyph must never nest an interactive element.
 */

import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { GlyphComponent, IconModule } from '../contracts.ts'
import {
  BuiltinGlyph as BuiltinGlyphImpl,
  FALLBACK_GLYPH,
  glyphDataUri as glyphDataUriImpl,
  normaliseGlyphSize,
} from './builtin.tsx'
import { sanitizeSvg as sanitizeSvgImpl } from './sanitize.ts'

/** The contributor's own glyph when there is one, the `box` fallback otherwise. */
function nativeOrFallback(
  native: GlyphComponent | null | undefined,
  size: number,
  active: boolean | undefined,
): ReactNode {
  if (native !== undefined && native !== null) return createElement(native, { size, active })
  return BuiltinGlyphImpl({ name: FALLBACK_GLYPH, size })
}

/** Render one effective glyph. */
export const Glyph: IconModule['Glyph'] = ({ icon, native, size, active }) => {
  if (icon === null || icon.kind === 'original') return nativeOrFallback(native, size, active)
  if (icon.kind === 'builtin') return BuiltinGlyphImpl({ name: icon.name, size })

  const sanitized = sanitizeSvgImpl(icon.svg)
  if (!sanitized.ok) return nativeOrFallback(native, size, active)

  const edge = normaliseGlyphSize(size)
  return (
    <span
      data-panellist-glyph="custom"
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        width: edge,
        height: edge,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: sanitized.svg }}
    />
  )
}

/** One hand-written built-in glyph by name. */
export const BuiltinGlyph: IconModule['BuiltinGlyph'] = BuiltinGlyphImpl

/** The SVG allow-list pass (README §2.5). */
export const sanitizeSvg: IconModule['sanitizeSvg'] = sanitizeSvgImpl

/** A black `data:image/svg+xml,` URI of one built-in glyph, for CSS masks. */
export const glyphDataUri: IconModule['glyphDataUri'] = glyphDataUriImpl
