/**
 * The group unit's stylesheet chunk: the zero-size row marker, the
 * `data-dsh-railist-group-active` highlight, and the body-portal flyout.
 *
 * Registered once at unit construction (the lifecycle doc: chunks are ordered by
 * registration, so a unit registers while it is built, never lazily).
 *
 * Token names are the ones the shipped shell uses (README §2.6):
 * `--dsw-alias-interactive-bg-hover` is exactly the fill `_panelRow:hover` and
 * `_panelActive` paint, which is what makes a group trigger look like a
 * selected row without the shell ever selecting it.
 */

/** Chunk id inside the aggregated `<style>` element. */
export const GROUPS_STYLE_ID = 'dsh-railist.groups'

/** The chunk itself. Plain selectors: the flyout is portaled, so it is outside
 *  any CSS-module scope, and every hook is a `data-` attribute we own. */
export const GROUPS_CSS = `
/* The marker is a zero-size span: it gives the CSS layer a per-row identity
   without owning any layout (it may sit in the shell's inline-flex glyph box). */
[data-dsh-railist-group] {
  width: 0;
  height: 0;
  flex: none;
  overflow: hidden;
  pointer-events: none;
}

/* Direct rule, kept for shells whose glyph box has no row-shaped ancestor. */
[data-dsh-railist-group-active] {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* A group row is never the active panel, so the shell never paints it: while any
   member is active we forward the shell's own hover/active fill to the row. */
nav[class*="_panelList"] button[class*="_panelRow"]:has([data-dsh-railist-group-active]) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* The portal target. Fixed at the viewport origin so a "position: fixed" child
   resolves to the same coordinates the row rect was measured in. */
[data-dsh-railist-portal] {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 90;
}

/* The card is the shell's menu surface, layer for layer (MenuSurface.module.css):
   an outer box that owns geometry, radius and elevation; a "material" layer that
   paints the translucent fill + blur; and — on macOS only — a "backing" plate
   under it.

   The plate is a deliberate DEVIATION. The shell portals its plate to
   document.body at z-index -1, so there it only covers the window backdrop and
   the rows behind a native menu still read through it. Ours is a child of this
   card, which is its own stacking context ABOVE the page, so on macOS the card
   is solid — which is what a menu that covers a scrolling list should look
   like. Keep the plate or the see-through look comes straight back. */
[data-dsh-railist-flyout] {
  position: fixed;
  z-index: 90;
  box-sizing: border-box;
  /* The shell's list box: 144 / 360, clamped to the viewport so a narrow window
     cannot push the card past the edge. */
  min-width: 144px;
  max-width: min(360px, calc(100vw - 16px));
  /* Mirrors the shell surface. The card is already a stacking context (fixed +
     z-index), so this is not what keeps the two negative-z layers in place; it
     is kept because the shell's surface declares it the same way. */
  isolation: isolate;
  /* Radius + shadow live here (the layers inherit the radius); clipping is what
     keeps the scrolling list inside the rounded corners. Padding lives here too
     — on the scroller it would scroll away with the first row, exactly the
     thing the shell avoids by scrolling an inner viewport. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 4px;
  max-height: min(420px, calc(100vh - 16px));
  border-radius: var(--dsw-radius-lg, 16px);
  /* Menus use the prominent elevation, not the panel one. The hairline in that
     shadow follows --dsw-elevation-stroke-color, and the shell binds it in two
     steps: the light baseline is l1, the dark theme raises it to l3. Same two
     steps here, otherwise the 0.5px hairline is three times too strong in the
     light theme. */
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  /* The scrollable descendant inherits these; the shell declares them here for
     exactly that reason. */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  box-shadow: var(--dsw-elevation-prominent, 0 0 0 0.5px var(--dsw-elevation-stroke-color, rgba(255, 255, 255, 0.14)), 0 3px 8px rgba(0, 0, 0, 0.04), 0 0 20px rgba(0, 0, 0, 0.05));
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  /* The card is portaled onto document.body, so font: inherit resolves against
     BODY — the browser's 16px — and not against the rail row the menu flew out of.
     That is why every member label rendered larger than the panel list beside it.
     Align with the shell's own menu list type instead (the "More" menu's item:
     13px / 20px). */
  font-size: 13px;
  line-height: 20px;
}

/* The dark theme raises the hairline, same as it does for the shell's menus
   (body[data-ds-dark-theme] [data-menu-material]). */
body[data-ds-dark-theme] [data-dsh-railist-flyout] {
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
}

/* Both layers: same box as the card, painted behind its content. */
[data-dsh-railist-flyout-material],
[data-dsh-railist-flyout-backing] {
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  pointer-events: none;
}

/* The fill. Tokens live on body/body[data-ds-dark-theme]; the aliases only back
   up shells that predate them. */
[data-dsh-railist-flyout-material] {
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-2, Canvas));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
}

/* The macOS plate. Because this one lives INSIDE the card's stacking context it
   hides the rows behind the menu; removing it brings the see-through look back. */
html[data-platform='darwin'] [data-dsh-railist-flyout-backing] {
  background: var(--dsw-alias-bg-base);
}

/* The scrolling list. It carries no padding (the card has it) and no height cap
   (the card has it), so it only has to be allowed to shrink inside the flex
   column: min-height 0 is what lets it scroll instead of pushing the card past
   its cap. */
[data-dsh-railist-flyout-menu] {
  display: flex;
  flex-direction: column;
  /* The shell's list has no gap: rows sit flush, their own padding makes the
     rhythm. */
  gap: 0;
  min-height: 0;
  overflow: auto;
  outline: none;
}

[data-dsh-railist-flyout-item] {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dsw-radius-md, 12px);
  background: 0 0;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

[data-dsh-railist-flyout-item]:is(:hover, :focus-visible),
[data-dsh-railist-flyout-item][data-dsh-railist-flyout-highlighted] {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

[data-dsh-railist-flyout-item][data-dsh-railist-flyout-current] {
  background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-label-primary);
}

/* No disabled rule: a member that is hidden or uninstalled leaves the menu
   entirely (Flyout filters them), so nothing here ever carries the disabled
   attribute. If that changes, match the shell's opacity 0.4, not a new value. */

/* The empty state is a line of text where a row would be: same inset, quieter
   colour, and the shell's own label type (11px / 15px). */
[data-dsh-railist-flyout-empty] {
  margin: 0;
  padding: 6px 8px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 11px;
  line-height: 15px;
}

[data-dsh-railist-flyout-glyph] {
  display: inline-flex;
  flex: none;
  /* The shell's item icon is a 14x14 box in its own colour; without the fixed
     box a contributor that ignores the requested size would push the label out
     of alignment. */
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-menu-icon, inherit);
}

/* A contributor may draw its own SVG; the shell pins those to the icon box, so
   a glyph that comes in at its own size would not line up either. */
[data-dsh-railist-flyout-glyph] > svg {
  width: 14px;
  height: 14px;
}

[data-dsh-railist-flyout-label] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-dsh-railist-overview] {
  padding: 16px;
  color: var(--dsw-alias-label-primary, inherit);
}
`
