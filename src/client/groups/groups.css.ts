/**
 * The group unit's stylesheet chunk: the zero-size row marker, the
 * `data-dsh-panellist-group-active` highlight, and the body-portal flyout.
 *
 * Registered once at unit construction (the lifecycle doc: chunks are ordered by
 * registration, so a unit registers while it is built, never lazily).
 *
 * Token names are the ones the shipped shell uses (README §5 / ARCHITECTURE §5):
 * `--dsw-alias-interactive-bg-hover` is exactly the fill `_panelRow:hover` and
 * `_panelActive` paint, which is what makes a group trigger look like a
 * selected row without the shell ever selecting it.
 */

/** Chunk id inside the aggregated `<style>` element. */
export const GROUPS_STYLE_ID = 'dsh-panellist.groups'

/** The chunk itself. Plain selectors: the flyout is portaled, so it is outside
 *  any CSS-module scope, and every hook is a `data-` attribute we own. */
export const GROUPS_CSS = `
/* The marker is a zero-size span: it gives the CSS layer a per-row identity
   without owning any layout (it may sit in the shell's inline-flex glyph box). */
[data-dsh-panellist-group] {
  width: 0;
  height: 0;
  flex: none;
  overflow: hidden;
  pointer-events: none;
}

/* Direct rule, kept for shells whose glyph box has no row-shaped ancestor. */
[data-dsh-panellist-group-active] {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* A group row is never the active panel, so the shell never paints it: while any
   member is active we forward the shell's own hover/active fill to the row. */
nav[class*="_panelList"] button[class*="_panelRow"]:has([data-dsh-panellist-group-active]) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* The portal target. Fixed at the viewport origin so a "position: fixed" child
   resolves to the same coordinates the row rect was measured in. */
[data-dsh-panellist-portal] {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 90;
}

[data-dsh-panellist-flyout] {
  position: fixed;
  z-index: 90;
  box-sizing: border-box;
  min-width: 176px;
  max-width: min(280px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 16px));
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.25));
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, Canvas);
  box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0, 0, 0, 0.18));
  color: var(--dsw-alias-label-primary, CanvasText);
  font: inherit;
}

[data-dsh-panellist-flyout-header] {
  display: flex;
  align-items: center;
  padding: 4px 6px 6px;
  color: var(--dsw-alias-label-tertiary, inherit);
  font-size: 12px;
}

[data-dsh-panellist-flyout-title] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-dsh-panellist-flyout-menu] {
  display: flex;
  flex-direction: column;
  gap: 2px;
  outline: none;
}

[data-dsh-panellist-flyout-item] {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 30px;
  padding: 5px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: 0 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

[data-dsh-panellist-flyout-item]:is(:hover, :focus-visible),
[data-dsh-panellist-flyout-item][data-dsh-panellist-flyout-highlighted] {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}

[data-dsh-panellist-flyout-item][data-dsh-panellist-flyout-current] {
  background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover));
  color: var(--dsw-alias-label-primary);
}

[data-dsh-panellist-flyout-item]:disabled {
  background: 0 0;
  opacity: 0.55;
  cursor: default;
}

[data-dsh-panellist-flyout-glyph] {
  display: inline-flex;
  flex: none;
}

[data-dsh-panellist-flyout-label] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-dsh-panellist-overview] {
  padding: 16px;
  color: var(--dsw-alias-label-primary, inherit);
}
`
