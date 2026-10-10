/**
 * The built-in glyph set: 24 hand-written outline glyphs on the shell's own
 * icon canvas, plus the catalogue the settings picker walks and the CSS-mask
 * data URIs.
 *
 * Every glyph is described once, as geometry, in {@link GLYPH_SHAPES}. Two
 * renderers consume that one description:
 *
 * - {@link BUILTIN_GLYPHS} draws React elements (what the rail renders);
 * - {@link glyphDataUri} writes the same markup as a `data:` URI.
 *
 * Keeping one source of truth means the picker preview, the rail glyph and the
 * mask can never drift apart. The settings navigation row's own mask glyph is a
 * SEPARATE artwork ({@link settingsNavDataUri}) because that column is drawn at
 * a heavier weight than the rail.
 *
 * House style — the rail's own, taken from the three panel icons every user has
 * next to these (`插件` = `IconPluginPinwheelOutlineRegular`,
 * `自动化任务` = `IconClockOutlineRegular`, `记忆系统` = dsh-mnemon's
 * `MemoryIcon`), so a glyph we ship sits beside a shipped one without looking
 * foreign:
 *
 * - `viewBox="0 0 16 16"`, `width`/`height` = the requested edge;
 * - `fill="none"`, `stroke="currentColor"`; colour rides the row, never a hex;
 * - stroke **1.0** — the `Icon*OutlineRegular` weight those three all use. A
 *   1.3 stroke (the `Medium` weight the settings navigation uses) read 30%
 *   heavier than every icon beside it in the rail, which is exactly what an
 *   on-device review called out;
 * - geometry on the 16 grid at half-step coordinates, an outer contour that
 *   stays inside roughly 2…14 (a 6-unit radius plus the stroke — the shipped
 *   clock measures 13 units of ink), and generous interior whitespace;
 * - **round caps and joins**, as dsh-mnemon's `MemoryIcon` draws its brain;
 * - concave cubic curves for sparkles, `fill="currentColor"` only for dots,
 *   no ids, no external references, no `<title>`/text (the row's accessible name
 *   comes from the shell's `aria-label`, so glyphs are `aria-hidden`).
 */

import type { ReactElement, ReactNode } from 'react'
import { BUILTIN_ICON_NAMES } from '../../shared/config.ts'
import type { BuiltinIconName } from '../../shared/config.ts'

/** The glyph a row falls back to when neither an override nor a native glyph exists. */
export const FALLBACK_GLYPH: BuiltinIconName = 'box'

/** The shell's icon canvas. */
const VIEW_BOX = '0 0 16 16'
/**
 * `Icon*OutlineRegular`'s weight — the one every rail row beside these uses
 * (`IconPluginPinwheelOutlineRegular`, `IconClockOutlineRegular`,
 * dsh-mnemon's `MemoryIcon`). The settings navigation draws its own glyphs at
 * `Icon*OutlineMedium` (1.3), but that column is not what these sit in.
 */
const STROKE_WIDTH = 1
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

/**
 * A cog as ONE closed contour: `teeth` trapezoids on a rim, joined by valley
 * chords.
 *
 * Teeth drawn as separate strokes off a circle read as a sun, not a gear — and
 * a gear is the one glyph here whose shipped counterpart everyone has seen
 * (`IconSettingsOutline`), so it has to look like one at 16px.
 * @param teeth - number of teeth.
 * @param outer - tip radius.
 * @param inner - valley radius.
 */
function cogPath(teeth: number, outer: number, inner: number): string {
  const step = (Math.PI * 2) / teeth
  const point = (angle: number, radius: number): string =>
    `${round(8 + radius * Math.cos(angle))} ${round(8 + radius * Math.sin(angle))}`
  const parts: string[] = []
  for (let index = 0; index < teeth; index += 1) {
    // Start at twelve o'clock so the tips land symmetrically.
    const centre = index * step - Math.PI / 2
    const contour = [
      point(centre - 0.4 * step, inner),
      point(centre - 0.1 * step, outer),
      point(centre + 0.1 * step, outer),
      point(centre + 0.4 * step, inner),
    ]
    parts.push(`${index === 0 ? 'M' : 'L'}${contour[0]}`, `L${contour[1]}`, `L${contour[2]}`, `L${contour[3]}`)
  }
  return `${parts.join('')}Z`
}

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
    // Two-unit gutter between the cells, so the four of them read as a layout
    // rather than as a filled block.
    { tag: 'rect', x: 2.4, y: 2.4, width: 4.6, height: 4.6, rx: 1 },
    { tag: 'rect', x: 9, y: 2.4, width: 4.6, height: 4.6, rx: 1 },
    { tag: 'rect', x: 2.4, y: 9, width: 4.6, height: 4.6, rx: 1 },
    { tag: 'rect', x: 9, y: 9, width: 4.6, height: 4.6, rx: 1 },
  ],
  puzzle: [
    // The plugin pinwheel the shell itself draws (`IconPluginPinwheelOutline`):
    // four curved petals on the 16 grid. This is the shape `插件` renders in the
    // rail, so a panel given this glyph looks like a shipped one — the earlier
    // jigsaw silhouette read as "a box with a tab" at 16px.
    {
      tag: 'path',
      d: 'M7.84 5.06C11.66 4.94 14.8 6.15 14.85 7.76C14.89 8.97 13.18 10.07 10.72 10.59',
    },
    {
      tag: 'path',
      d: 'M5.13 8.08C5 4.26 6.21 1.13 7.83 1.07C9.04 1.03 10.14 2.74 10.66 5.2',
    },
    {
      tag: 'path',
      d: 'M8.02 10.68C4.21 10.8 1.07 9.59 1.02 7.98C0.98 6.77 2.69 5.67 5.15 5.15',
    },
    {
      tag: 'path',
      d: 'M10.75 7.9C10.87 11.71 9.66 14.85 8.05 14.9C6.83 14.94 5.74 13.23 5.22 10.77',
    },
  ],
  sparkles: [sparkle(6, 5.75, 4.25), sparkle(11.6, 11.2, 2.6)],
  clock: [
    // Geometry taken from the shipped `IconClockOutlineArtwork` — the icon
    // `自动化任务` renders — so the two read as the same drawing at 16px.
    { tag: 'circle', cx: 8, cy: 8, r: 6 },
    { tag: 'path', d: 'M8 4.31V8.46L11 10.08' },
  ],
  memory: [
    { tag: 'rect', x: 3.5, y: 3.5, width: 9, height: 9, rx: 1 },
    { tag: 'rect', x: 6.4, y: 6.4, width: 3.2, height: 3.2, rx: 0.6 },
    { tag: 'path', d: 'M5.6 2v1.5M10.4 2v1.5M5.6 12.5v1.5M10.4 12.5v1.5M2 5.6h1.5M2 10.4h1.5M12.5 5.6h1.5M12.5 10.4h1.5' },
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
      d: 'M8 2.45L9.38 6.25 13.42 6.39 10.23 8.88 11.35 12.76 8 10.5 4.65 12.76 5.77 8.88 2.58 6.39 6.62 6.25Z',
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
    { tag: 'path', d: cogPath(8, 5.9, 4.5) },
    { tag: 'circle', cx: 8, cy: 8, r: 2.1 },
  ],
  chart: [{ tag: 'path', d: 'M2.5 13.5h11M5 13.5V9M8 13.5V5.5M11 13.5V10.5' }],
  list: [
    // The shell's own list rhythm (`IconFlatListOutline`): dots of a 1.3px
    // stroke's width on the same three baselines as the rules, and rules long
    // enough to reach the same right edge the shipped round caps give them.
    { tag: 'circle', cx: 2.6, cy: 3.5, r: 0.65, filled: true },
    { tag: 'circle', cx: 2.6, cy: 8, r: 0.65, filled: true },
    { tag: 'circle', cx: 2.6, cy: 12.5, r: 0.65, filled: true },
    { tag: 'path', d: 'M5.5 3.5h8.6M5.5 8h8.6M5.5 12.5h8.6' },
  ],
  bell: [
    { tag: 'path', d: 'M4.5 12.5V8.5a3.5 3.5 0 0 1 7 0v4z' },
    { tag: 'path', d: 'M6.8 14.3a1.3 1.3 0 0 0 2.4 0' },
    { tag: 'path', d: 'M8 5V3.4' },
  ],
  bolt: [{ tag: 'path', d: 'M8.9 1.6L4 8.9h3.4L7.1 14.4 12.5 7.1H9.1z' }],
  shield: [
    { tag: 'path', d: 'M8 2.2l5.7 2.1v4.1c0 2.9-2.4 5.2-5.7 6.2-3.3-1-5.7-3.3-5.7-6.2V4.3z' },
    { tag: 'path', d: 'M6 8.1l1.4 1.4 2.6-2.8' },
  ],
  globe: [
    { tag: 'circle', cx: 8, cy: 8, r: 6 },
    { tag: 'ellipse', cx: 8, cy: 8, rx: 2.7, ry: 6 },
    { tag: 'path', d: 'M2 8h12' },
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
    { tag: 'circle', cx: 8, cy: 8, r: 6 },
    { tag: 'path', d: 'M10.4 5.6l-1.6 3.2-3.2 1.6 1.6-3.2z' },
  ],
  more: [
    // The shell's own ellipsis geometry (`IconEllipsisOutlineArtwork`): three
    // filled r=1 dots on the 3/8/13 rhythm. A bigger radius read as three fat
    // blobs instead of a quiet "more".
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
  return shapesMarkup(GLYPH_SHAPES[name], paint, STROKE_WIDTH)
}

/** A shape list as standalone markup at one stroke weight. */
function shapesMarkup(shapes: readonly GlyphShape[], paint: string, strokeWidth: number): string {
  const body = shapes.map(shape => shapeMarkup(shape, paint)).join('')
  return `<svg xmlns="${SVG_NAMESPACE}" width="${RENDER_SIZE}" height="${RENDER_SIZE}" viewBox="${VIEW_BOX}" fill="none" stroke="${paint}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
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

/**
 * The settings navigation glyph — a **panel list**: three rows, each a small
 * rounded panel beside its label rule.
 *
 * It is deliberately NOT one of the 24 built-ins: that set is drawn at the
 * rail's `Icon*OutlineRegular` weight (1px, beside `插件`/`自动化任务`/
 * `记忆系统`), while the settings navigation column is drawn at the shell's
 * `Icon*OutlineMedium` weight — `dsh-client-ui-settings-general` renders every
 * nav glyph as `Icon*OutlineMedium` at `size: 16`. A 1px glyph in that column
 * read visibly thinner than the ten icons beside it, so this one gets its own
 * artwork and its own weight.
 */
const SETTINGS_NAV_SHAPES: readonly GlyphShape[] = [
  { tag: 'rect', x: 2.1, y: 2.2, width: 2.6, height: 2.6, rx: 0.6 },
  { tag: 'rect', x: 2.1, y: 6.7, width: 2.6, height: 2.6, rx: 0.6 },
  { tag: 'rect', x: 2.1, y: 11.2, width: 2.6, height: 2.6, rx: 0.6 },
  { tag: 'path', d: 'M6.2 3.5h7.6M6.2 8h7.6M6.2 12.5h7.6' },
]

/** The settings navigation glyph's weight — `Icon*OutlineMedium`. */
export const SETTINGS_NAV_STROKE = 1.3

/**
 * The settings navigation glyph as a `data:image/svg+xml,` URI stroked in
 * `black` (CSS `mask-image` only reads alpha).
 */
export function settingsNavDataUri(): string {
  return `data:image/svg+xml,${encodeURIComponent(shapesMarkup(SETTINGS_NAV_SHAPES, 'black', SETTINGS_NAV_STROKE))}`
}
