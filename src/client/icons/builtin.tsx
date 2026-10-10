/**
 * The built-in glyph set: 24 hand-written outline glyphs on the shell's own
 * icon canvas, plus the catalogue the settings picker walks and the CSS-mask
 * data URIs.
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
 * House style — the shell's own, taken from
 * `@deepseek-ai/dsh-client-ui-primitives` (its 94 product icons), so a glyph we
 * ship sits next to a shipped one without looking foreign:
 *
 * - `viewBox="0 0 16 16"`, `width`/`height` = the requested edge;
 * - `fill="none"`, `stroke="currentColor"`; colour rides the row, never a hex;
 * - stroke **1.3** — the `Icon*OutlineMedium` weight the rail rows and the
 *   settings navigation already use (`dsh-client-ui-settings-general` renders
 *   its nav glyphs at `size: 16` with exactly this weight);
 * - geometry on the 16 grid at half-step coordinates, one unit of clearance
 *   from the edge (1.5…14.5) for an outer contour, concave curves for sparkles,
 *   `fill="currentColor"` only for dots;
 * - round caps and joins, no ids, no external references, no `<title>`/text
 *   (the row's accessible name comes from the shell's `aria-label`, so glyphs
 *   are `aria-hidden`).
 */

import type { ReactElement, ReactNode } from 'react'
import { BUILTIN_ICON_NAMES } from '../../shared/config.ts'
import type { BuiltinIconName } from '../../shared/config.ts'

/** The glyph a row falls back to when neither an override nor a native glyph exists. */
export const FALLBACK_GLYPH: BuiltinIconName = 'box'

/** The shell's icon canvas. */
const VIEW_BOX = '0 0 16 16'
/** `Icon*OutlineMedium`'s weight, and the edge every mask is drawn at. */
const STROKE_WIDTH = 1.3
const RENDER_SIZE = 16
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

/** One cog tooth: a stroke from the ring outwards, at `degrees` on the 16×16 grid. */
function gearTooth(degrees: number): GlyphShape {
  const angle = (degrees * Math.PI) / 180
  const inner = 4.2
  const outer = 5.8
  const x1 = round(8 + inner * Math.cos(angle))
  const y1 = round(8 + inner * Math.sin(angle))
  const x2 = round(8 + outer * Math.cos(angle))
  const y2 = round(8 + outer * Math.sin(angle))
  return { tag: 'path', d: `M${x1} ${y1}L${x2} ${y2}` }
}

const GEAR_TEETH: readonly GlyphShape[] = Array.from(
  { length: 8 },
  (_unused, index): GlyphShape => gearTooth(index * 45),
)

/**
 * A four-point sparkle: the shell draws these as cubic curves whose control
 * points sit one third of an arm from the centre, which is what makes the
 * sides concave instead of a straight diamond.
 * @param cx - centre x.
 * @param cy - centre y.
 * @param arm - distance from the centre to a tip.
 */
function sparkle(cx: number, cy: number, arm: number): GlyphShape {
  const bend = round(arm / 3)
  const tipX = round(cx + arm)
  const tipY = round(cy + arm)
  const lowX = round(cx - arm)
  const lowY = round(cy - arm)
  const up = round(cy - bend)
  const down = round(cy + bend)
  const left = round(cx - bend)
  const right = round(cx + bend)
  return {
    tag: 'path',
    d: `M${cx} ${lowY}C${cx} ${up} ${right} ${cy} ${tipX} ${cy}`
      + `C${right} ${cy} ${cx} ${down} ${cx} ${tipY}`
      + `C${cx} ${down} ${left} ${cy} ${lowX} ${cy}`
      + `C${left} ${cy} ${cx} ${up} ${cx} ${lowY}Z`,
  }
}

/** Geometry of every glyph, on the shared 16×16 grid. */
const GLYPH_SHAPES: Record<BuiltinIconName, readonly GlyphShape[]> = {
  grid: [
    { tag: 'rect', x: 1.5, y: 1.5, width: 5.7, height: 5.7, rx: 1 },
    { tag: 'rect', x: 8.8, y: 1.5, width: 5.7, height: 5.7, rx: 1 },
    { tag: 'rect', x: 1.5, y: 8.8, width: 5.7, height: 5.7, rx: 1 },
    { tag: 'rect', x: 8.8, y: 8.8, width: 5.7, height: 5.7, rx: 1 },
  ],
  puzzle: [
    {
      // A jigsaw piece in one contour: a knob on the top edge and a matching
      // dent in the right edge, with the other two sides left straight — the
      // only reading that survives at 16px (four knobs turn into a blob).
      // Flags follow from the bell's dome below: left→right with sweep 1 bulges
      // up, so the top knob uses sweep 1; rotated a quarter turn, top→bottom with
      // sweep 1 bulges LEFT, which is the inward dent the right edge needs.
      tag: 'path',
      d: 'M2.5 1.5H6.2A1.8 1.8 0 0 1 9.8 1.5H13.5A1 1 0 0 1 14.5 2.5V6.1'
        + 'A1.6 1.6 0 0 1 14.5 9.3V13.5A1 1 0 0 1 13.5 14.5H2.5A1 1 0 0 1 1.5 13.5V2.5A1 1 0 0 1 2.5 1.5Z',
    },
  ],
  sparkles: [sparkle(6, 5.75, 4.25), sparkle(11.6, 11.2, 2.6)],
  clock: [
    { tag: 'circle', cx: 8, cy: 8, r: 6.5 },
    { tag: 'path', d: 'M8 4.5V8l2.6 1.6' },
  ],
  memory: [
    { tag: 'rect', x: 3.5, y: 3.5, width: 9, height: 9, rx: 1 },
    { tag: 'rect', x: 6.5, y: 6.5, width: 3, height: 3, rx: 0.6 },
    { tag: 'path', d: 'M5.5 1.5v2M10.5 1.5v2M5.5 12.5v2M10.5 12.5v2M1.5 5.5h2M1.5 10.5h2M12.5 5.5h2M12.5 10.5h2' },
  ],
  terminal: [
    { tag: 'rect', x: 1.5, y: 2.5, width: 13, height: 11, rx: 1 },
    { tag: 'path', d: 'M5 6.5l2.2 2.2-2.2 2.2' },
    { tag: 'path', d: 'M9.5 11h3' },
  ],
  plug: [
    { tag: 'path', d: 'M5.5 1.5v4M10.5 1.5v4M3.5 5.5h9v2.4a4.5 4.5 0 0 1-9 0zM8 12.4v2.1' },
  ],
  star: [
    {
      tag: 'path',
      d: 'M8 1.9L9.53 6.1 13.99 6.25 10.47 9 11.7 13.3 8 10.8 4.3 13.3 5.53 9 2.01 6.25 6.47 6.1Z',
    },
  ],
  folder: [
    {
      tag: 'path',
      d: 'M1.5 12.5v-8.5a1 1 0 0 1 1-1h3.2l1.4 1.9h6.4a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z',
    },
  ],
  book: [
    {
      tag: 'path',
      d: 'M8 4.2C6.9 3.3 5.6 2.8 3 2.8v9.4c2.6 0 3.9.5 5 1.4 1.1-.9 2.4-1.4 5-1.4V2.8c-2.6 0-3.9.5-5 1.4zM8 4.2v9.4',
    },
  ],
  code: [
    { tag: 'path', d: 'M6.2 4.5L2.5 8l3.7 3.5M9.8 4.5L13.5 8l-3.7 3.5M9.1 3l-2.2 10' },
  ],
  gear: [
    ...GEAR_TEETH,
    { tag: 'circle', cx: 8, cy: 8, r: 4.2 },
    { tag: 'circle', cx: 8, cy: 8, r: 2 },
  ],
  chart: [{ tag: 'path', d: 'M2.5 13.5h11M5 13.5V9M8 13.5V5.5M11 13.5V10.5' }],
  list: [
    // The shell's own list rhythm (`IconFlatListOutline`): the dots are round
    // capped zero-length strokes, i.e. a 1.3px dot, on the same three baselines
    // as the rules. This one also paints the settings navigation row's mask.
    { tag: 'circle', cx: 2.6, cy: 3.5, r: 0.65, filled: true },
    { tag: 'circle', cx: 2.6, cy: 8, r: 0.65, filled: true },
    { tag: 'circle', cx: 2.6, cy: 12.5, r: 0.65, filled: true },
    { tag: 'path', d: 'M6 3.5h7.5M6 8h7.5M6 12.5h7.5' },
  ],
  bell: [
    { tag: 'path', d: 'M4.5 12.5V8.5a3.5 3.5 0 0 1 7 0v4z' },
    { tag: 'path', d: 'M6.8 14.3a1.3 1.3 0 0 0 2.4 0' },
    { tag: 'path', d: 'M8 5V3.4' },
  ],
  bolt: [{ tag: 'path', d: 'M8.9 1.6L4 8.9h3.4L7.1 14.4 12.5 7.1H9.1z' }],
  shield: [
    { tag: 'path', d: 'M8 1.7l6.2 2.3v4.5c0 3.2-2.6 5.6-6.2 6.8-3.6-1.2-6.2-3.6-6.2-6.8V4z' },
    { tag: 'path', d: 'M5.9 7.9l1.5 1.5 2.8-3' },
  ],
  globe: [
    { tag: 'circle', cx: 8, cy: 8, r: 6.5 },
    { tag: 'ellipse', cx: 8, cy: 8, rx: 2.9, ry: 6.5 },
    { tag: 'path', d: 'M1.6 8h12.8' },
  ],
  database: [
    { tag: 'ellipse', cx: 8, cy: 4.6, rx: 5.5, ry: 2.1 },
    {
      tag: 'path',
      d: 'M2.5 4.6v6.8c0 1.2 2.5 2.1 5.5 2.1 3 0 5.5-.9 5.5-2.1V4.6M2.5 8c0 1.2 2.5 2.1 5.5 2.1 3 0 5.5-.9 5.5-2.1',
    },
  ],
  box: [
    { tag: 'path', d: 'M8 1.6l6 3.1v6.6L8 14.4l-6-3.1V4.7z' },
    { tag: 'path', d: 'M2 4.7l6 3.1 6-3.1M8 7.8v6.6' },
  ],
  wrench: [
    {
      tag: 'path',
      d: 'M9.8 4.2a0.67 0.67 0 0 0 0 0.93l1.07 1.07a0.67 0.67 0 0 0 0.93 0l2.51-2.51a4 4 0 0 1-5.29 5.29l-4.61 4.61'
        + 'a1.41 1.41 0 0 1-2-2l4.61-4.61a4 4 0 0 1 5.29-5.29l-2.51 2.51z',
    },
  ],
  layers: [
    { tag: 'path', d: 'M8 1.6l6 3.2-6 3.2-6-3.2z' },
    { tag: 'path', d: 'M2 8.2l6 3.2 6-3.2' },
    { tag: 'path', d: 'M2 11.4l6 3.2 6-3.2' },
  ],
  compass: [
    { tag: 'circle', cx: 8, cy: 8, r: 6.5 },
    { tag: 'path', d: 'M10.6 5.4l-1.7 3.5-3.5 1.7 1.7-3.5z' },
  ],
  more: [
    // Dots at the shell's own ellipsis spacing and radius (`IconEllipsisOutline`).
    { tag: 'circle', cx: 3, cy: 8, r: 1, filled: true },
    { tag: 'circle', cx: 8, cy: 8, r: 1, filled: true },
    { tag: 'circle', cx: 13, cy: 8, r: 1, filled: true },
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
  return `<svg xmlns="${SVG_NAMESPACE}" width="${RENDER_SIZE}" height="${RENDER_SIZE}" viewBox="${VIEW_BOX}" fill="none" stroke="${paint}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`
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
/**
 * Compile-time witness, intentionally exported: the VALUE is meaningless, the
 * TYPE is the assertion. A non-exported unused const would be an error under
 * `noUnusedLocals`, and the failure mode it guards (a name added to the frozen
 * catalogue with no glyph behind it) is exactly what a reader would otherwise
 * only discover as a blank icon at runtime.
 */
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
