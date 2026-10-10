/**
 * The built-in glyph set: 24 hand-written 24×24 outline glyphs, plus the
 * catalogue the settings picker walks and the CSS-mask data URIs.
 *
 * Every glyph is described once, as geometry, in {@link GLYPH_SHAPES}. Two
 * renderers consume that one description:
 *
 * - {@link BUILTIN_GLYPHS} draws React elements (what the rail renders);
 * - {@link glyphDataUri} writes the same markup as a `data:` URI (what the
 *   settings navigation masks with).
 *
 * Keeping one source of truth means the picker preview, the rail glyph and the
 * mask can never drift apart.
 *
 * House style, applied by both renderers: `viewBox="0 0 24 24"`, `fill="none"`,
 * `stroke="currentColor"` at 1.6px with round caps and joins, no ids, no
 * external references, and no `<title>`/text (the row's accessible name comes
 * from the shell's `aria-label`, so glyphs are `aria-hidden`).
 */

import type { ReactElement, ReactNode } from 'react'
import { BUILTIN_ICON_NAMES } from '../../shared/config.ts'
import type { BuiltinIconName } from '../../shared/config.ts'

/** The glyph a row falls back to when neither an override nor a native glyph exists. */
export const FALLBACK_GLYPH: BuiltinIconName = 'box'

const VIEW_BOX = '0 0 24 24'
const STROKE_WIDTH = 1.6
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const DEFAULT_SIZE = 16

/** One drawing primitive. `filled` is the only exception to the outline house style. */
type GlyphShape =
  | { readonly tag: 'path'; readonly d: string; readonly filled?: boolean }
  | {
      readonly tag: 'circle'
      readonly cx: number
      readonly cy: number
      readonly r: number
      readonly filled?: boolean
    }
  | {
      readonly tag: 'ellipse'
      readonly cx: number
      readonly cy: number
      readonly rx: number
      readonly ry: number
      readonly filled?: boolean
    }
  | {
      readonly tag: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
      readonly rx?: number
      readonly filled?: boolean
    }

/** The renderer shape `BUILTIN_GLYPHS` exposes. */
export type BuiltinGlyphRenderer = (props: { size: number }) => ReactNode

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** One cog tooth: a stroke from the ring outwards, at `degrees` on the 24×24 grid. */
function gearTooth(degrees: number): GlyphShape {
  const angle = (degrees * Math.PI) / 180
  const inner = 6.3
  const outer = 8.7
  const x1 = round(12 + inner * Math.cos(angle))
  const y1 = round(12 + inner * Math.sin(angle))
  const x2 = round(12 + outer * Math.cos(angle))
  const y2 = round(12 + outer * Math.sin(angle))
  return { tag: 'path', d: `M${x1} ${y1}L${x2} ${y2}` }
}

const GEAR_TEETH: readonly GlyphShape[] = Array.from(
  { length: 8 },
  (_unused, index): GlyphShape => gearTooth(index * 45),
)

/** Geometry of every glyph, on the shared 24×24 grid. */
const GLYPH_SHAPES: Record<BuiltinIconName, readonly GlyphShape[]> = {
  grid: [
    { tag: 'rect', x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.6 },
    { tag: 'rect', x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.6 },
    { tag: 'rect', x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.6 },
    { tag: 'rect', x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.6 },
  ],
  puzzle: [
    { tag: 'path', d: 'M5 5h4.8a2.2 2.2 0 0 1 4.4 0H19v4.8a2.2 2.2 0 0 1 0 4.4V19H5z' },
  ],
  sparkles: [
    { tag: 'path', d: 'M10.5 3.5l1.8 4.7 4.7 1.8-4.7 1.8-1.8 4.7-1.8-4.7-4.7-1.8 4.7-1.8z' },
    { tag: 'path', d: 'M18 13.2l1.05 2.75 2.75 1.05-2.75 1.05-1.05 2.75-1.05-2.75-2.75-1.05 2.75-1.05z' },
  ],
  clock: [
    { tag: 'circle', cx: 12, cy: 12, r: 8.6 },
    { tag: 'path', d: 'M12 7.2V12l3.2 2' },
  ],
  memory: [
    { tag: 'rect', x: 6, y: 6, width: 12, height: 12, rx: 2.2 },
    { tag: 'rect', x: 9.5, y: 9.5, width: 5, height: 5, rx: 1.2 },
    { tag: 'path', d: 'M9.2 3v3M14.8 3v3M9.2 18v3M14.8 18v3M3 9.2h3M3 14.8h3M18 9.2h3M18 14.8h3' },
  ],
  terminal: [
    { tag: 'rect', x: 3, y: 4.5, width: 18, height: 15, rx: 2.4 },
    { tag: 'path', d: 'M7.5 9.7l2.6 2.6-2.6 2.6' },
    { tag: 'path', d: 'M12.8 15.1h3.8' },
  ],
  plug: [
    { tag: 'path', d: 'M9 8.2V3.2M15 8.2V3.2M6.6 8.2h10.8v3.1a5.4 5.4 0 0 1-10.8 0zM12 16.7v3.6' },
  ],
  star: [
    { tag: 'path', d: 'M12 3.4l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.8l6-.9z' },
  ],
  folder: [
    {
      tag: 'path',
      d: 'M3.5 7.2a2.2 2.2 0 0 1 2.2-2.2h3.1l2.1 2.5h7.4a2.2 2.2 0 0 1 2.2 2.2v7.9a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2z',
    },
  ],
  book: [
    {
      tag: 'path',
      d: 'M12 6.4C10.4 5 8.4 4.4 5 4.4v13.2c3.4 0 5.4.6 7 2 1.6-1.4 3.6-2 7-2V4.4c-3.4 0-5.4.6-7 2zM12 6.4v13.2',
    },
  ],
  code: [
    { tag: 'path', d: 'M9.4 7.4L4.6 12l4.8 4.6M14.6 7.4L19.4 12l-4.8 4.6M12.9 5.2l-1.8 13.6' },
  ],
  gear: [
    ...GEAR_TEETH,
    { tag: 'circle', cx: 12, cy: 12, r: 6.3 },
    { tag: 'circle', cx: 12, cy: 12, r: 3.1 },
  ],
  chart: [{ tag: 'path', d: 'M4.6 20h14.8M8.2 20v-6.2M12 20V8.4M15.8 20v-9.6' }],
  list: [
    { tag: 'circle', cx: 4.6, cy: 7, r: 1.05, filled: true },
    { tag: 'circle', cx: 4.6, cy: 12, r: 1.05, filled: true },
    { tag: 'circle', cx: 4.6, cy: 17, r: 1.05, filled: true },
    { tag: 'path', d: 'M8.6 7h11M8.6 12h11M8.6 17h11' },
  ],
  bell: [
    { tag: 'path', d: 'M6.6 17.4V11a5.4 5.4 0 0 1 10.8 0v6.4z' },
    { tag: 'path', d: 'M10.1 20.2a2.1 2.1 0 0 0 3.8 0' },
    { tag: 'path', d: 'M12 5.6V3.2' },
  ],
  bolt: [{ tag: 'path', d: 'M13.2 2.6L5 13.4h5.6L10.8 21.4 19 10.6h-5.6z' }],
  shield: [
    { tag: 'path', d: 'M12 3.1l7.6 2.7v6.1c0 4.5-3.1 7.7-7.6 9.4-4.5-1.7-7.6-4.9-7.6-9.4V5.8z' },
    { tag: 'path', d: 'M8.9 12.1l2.2 2.2 4.1-4.3' },
  ],
  globe: [
    { tag: 'circle', cx: 12, cy: 12, r: 8.6 },
    { tag: 'ellipse', cx: 12, cy: 12, rx: 3.9, ry: 8.6 },
    { tag: 'path', d: 'M3.4 12h17.2' },
  ],
  database: [
    { tag: 'ellipse', cx: 12, cy: 6.6, rx: 7.6, ry: 3.1 },
    {
      tag: 'path',
      d: 'M4.4 6.6v10.8c0 1.7 3.4 3.1 7.6 3.1 3.9 0 7.6-1.4 7.6-3.1V6.6M4.4 12c0 1.7 3.4 3.1 7.6 3.1 3.9 0 7.6-1.4 7.6-3.1',
    },
  ],
  box: [
    { tag: 'path', d: 'M12 2.9l8.2 4.3v9.6L12 21.1l-8.2-4.3V7.2z' },
    { tag: 'path', d: 'M3.8 7.2L12 11.6l8.2-4.4M12 11.6v9.5' },
  ],
  wrench: [
    {
      tag: 'path',
      d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    },
  ],
  layers: [
    { tag: 'path', d: 'M12 3.4l8.6 4.4-8.6 4.4L3.4 7.8z' },
    { tag: 'path', d: 'M3.4 12.2L12 16.6l8.6-4.4' },
    { tag: 'path', d: 'M3.4 16.4L12 20.8l8.6-4.4' },
  ],
  compass: [
    { tag: 'circle', cx: 12, cy: 12, r: 8.6 },
    { tag: 'path', d: 'M15.6 8.4l-2.2 5-5 2.2 2.2-5z' },
  ],
  more: [
    { tag: 'circle', cx: 5.4, cy: 12, r: 1.35, filled: true },
    { tag: 'circle', cx: 12, cy: 12, r: 1.35, filled: true },
    { tag: 'circle', cx: 18.6, cy: 12, r: 1.35, filled: true },
  ],
}

/** A non-finite or non-positive size would produce a broken box; 16px is the rail's own edge. */
export function normaliseGlyphSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_SIZE
}

/** One shape as a React element. */
function shapeElement(shape: GlyphShape, key: string): ReactElement {
  const paint = shape.filled === true ? { fill: 'currentColor', stroke: 'none' } : {}
  switch (shape.tag) {
    case 'path':
      return <path key={key} d={shape.d} {...paint} />
    case 'circle':
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} {...paint} />
    case 'ellipse':
      return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...paint} />
    case 'rect':
      return (
        <rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          {...(shape.rx === undefined ? {} : { rx: shape.rx })}
          {...paint}
        />
      )
  }
}

/** One shape as markup, painted in `paint` (`currentColor` or `black`). */
function shapeMarkup(shape: GlyphShape, paint: string): string {
  const filled = shape.filled === true ? ` fill="${paint}" stroke="none"` : ''
  switch (shape.tag) {
    case 'path':
      return `<path d="${shape.d}"${filled}/>`
    case 'circle':
      return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}"${filled}/>`
    case 'ellipse':
      return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}"${filled}/>`
    case 'rect':
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"${shape.rx === undefined ? '' : ` rx="${shape.rx}"`}${filled}/>`
  }
}

/** One glyph as a React element. */
function glyphElement(name: BuiltinIconName, size: number): ReactElement {
  const edge = normaliseGlyphSize(size)
  return (
    <svg
      xmlns={SVG_NAMESPACE}
      width={edge}
      height={edge}
      viewBox={VIEW_BOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE_WIDTH}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-panellist-glyph={name}
    >
      {GLYPH_SHAPES[name].map((shape, index) => shapeElement(shape, `${name}-${index}`))}
    </svg>
  )
}

/** One glyph as standalone markup, painted in `paint`. */
function glyphMarkup(name: BuiltinIconName, paint: string): string {
  const shapes = GLYPH_SHAPES[name].map(shape => shapeMarkup(shape, paint)).join('')
  return `<svg xmlns="${SVG_NAMESPACE}" viewBox="${VIEW_BOX}" fill="none" stroke="${paint}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`
}

function renderer(name: BuiltinIconName): BuiltinGlyphRenderer {
  return ({ size }) => glyphElement(name, size)
}

/** The hand-written catalogue, keyed by name (deliberately un-annotated: see the gate below). */
const GLYPH_CATALOGUE = {
  grid: renderer('grid'),
  puzzle: renderer('puzzle'),
  sparkles: renderer('sparkles'),
  clock: renderer('clock'),
  memory: renderer('memory'),
  terminal: renderer('terminal'),
  plug: renderer('plug'),
  star: renderer('star'),
  folder: renderer('folder'),
  book: renderer('book'),
  code: renderer('code'),
  gear: renderer('gear'),
  chart: renderer('chart'),
  list: renderer('list'),
  bell: renderer('bell'),
  bolt: renderer('bolt'),
  shield: renderer('shield'),
  globe: renderer('globe'),
  database: renderer('database'),
  box: renderer('box'),
  wrench: renderer('wrench'),
  layers: renderer('layers'),
  compass: renderer('compass'),
  more: renderer('more'),
}

/** Every built-in glyph, one renderer per name in `BUILTIN_ICON_NAMES`. */
export const BUILTIN_GLYPHS: Record<BuiltinIconName, BuiltinGlyphRenderer> = GLYPH_CATALOGUE

/* ------------------------------------------------------------------------ exit */

/**
 * Exhaustiveness gate.
 *
 * `BUILTIN_GLYPHS` is annotated `Record<BuiltinIconName, …>`, so adding a name
 * to the frozen `BUILTIN_ICON_NAMES` array breaks compilation here until a
 * glyph exists; the type below repeats the check against the literal catalogue
 * and names the missing glyph in the error when that happens.
 */
type MissingBuiltinGlyph = Exclude<BuiltinIconName, keyof typeof GLYPH_CATALOGUE>
export const BUILTIN_GLYPHS_ARE_EXHAUSTIVE: MissingBuiltinGlyph extends never
  ? true
  : `missing builtin glyph: ${MissingBuiltinGlyph}` = true

/**
 * Runtime mirror of the gate above, for the case where the module was bundled
 * from a catalogue that no longer matches its type. Returns nothing; a gap
 * throws with the glyph name.
 */
export function assertBuiltinGlyphCatalogue(): void {
  for (const name of BUILTIN_ICON_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(BUILTIN_GLYPHS, name)) {
      throw new Error(`builtin glyph "${name}" is missing from the catalogue`)
    }
  }
}

/** One built-in glyph by name. */
export function BuiltinGlyph({ name, size }: { name: BuiltinIconName; size: number }): ReactNode {
  return BUILTIN_GLYPHS[name]({ size })
}

/**
 * One glyph as a `data:image/svg+xml,` URI stroked in `black`.
 *
 * The settings navigation uses it as a CSS `mask-image`, where only alpha
 * matters, so the colour is fixed rather than themed.
 */
export function glyphDataUri(name: BuiltinIconName): string {
  return `data:image/svg+xml,${encodeURIComponent(glyphMarkup(name, 'black'))}`
}
