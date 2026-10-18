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

/* Material copied from the shell's own menu surface (MenuSurface.module.css):
   translucent fill + heavy backdrop blur + the shell elevation stroke/shadow,
   so the flyout reads as the same surface as every native menu. The leading
   tokens exist on body/body[data-ds-dark-theme]; the aliases only back up
   shells that predate them. */
[data-dsh-railist-flyout] {
  position: fixed;
  z-index: 90;
  box-sizing: border-box;
  min-width: 176px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 16px));
  overflow: auto;
  padding: 4px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-menu-surface-fill, var(--dsw-alias-bg-layer-2, Canvas));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%));
  box-shadow: var(--dsw-elevation-panel, 0 8px 24px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
  /* The card is portaled onto document.body, so font: inherit resolves against
     BODY — the browser's 16px — and not against the rail row the menu flew out of.
     That is why every member label rendered larger than the panel list beside it.
     Pin the shell's own panel-row type instead (_panelRow: 14px / 22px). */
  font-size: 14px;
  line-height: 22px;
}

[data-dsh-railist-flyout-header] {
  display: flex;
  align-items: center;
  /* The title starts over the glyph column, so the header and the member icons
     share one left edge (card padding 4px + 10px). */
  padding: 4px 10px 6px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 12px;
}

[data-dsh-railist-flyout-title] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-dsh-railist-flyout-menu] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  outline: none;
}

[data-dsh-railist-flyout-item] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 5px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: 0 0;
  color: inherit;
  font: inherit;
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

[data-dsh-railist-flyout-item]:disabled {
  background: 0 0;
  opacity: 0.55;
  cursor: default;
}

[data-dsh-railist-flyout-glyph] {
  display: inline-flex;
  flex: none;
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
