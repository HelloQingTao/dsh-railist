/**
 * The sequence editor's drag-and-drop stylesheet chunk (README §3.1).
 *
 * A chunk of its own, registered by `settings/index.tsx` right after
 * `settings.css.ts`, so the drag affordances (the grab handle, the drop
 * indicator, the keyboard "lifted" state) live in one reviewable place instead
 * of being appended to the page chunk.
 *
 * Every hook is a `data-` attribute the editor owns — no class is shared with
 * `settings.css.ts`, so the two chunks can be edited independently:
 *   `[data-drag-handle]`     the grab target (also the keyboard control)
 *   `[data-row-kind]`        the row / member the handle belongs to
 *   `[data-drop-target]`     where the next drop would land ('before'|'after'|'inside')
 *   `[data-drop-scope]`      the list being dragged in ('rows'|'members')
 *   `[data-drop-active]`     the list currently receiving a drag
 *   `[data-dragging='true']` the row being dragged (already used by settings.css)
 *
 * Colour comes from the same alias tokens and fallbacks the page chunk uses
 * (`var(--dsw-alias-*, <theme-neutral fallback>)`), so this chunk also reads
 * correctly on a shell that renamed or dropped the tokens.
 */

/** Chunk id inside the aggregated `<style>` element. */
export const DRAG_STYLE_ID = 'dsh-railist.settings.drag'

/** The chunk itself. */
export const DRAG_CSS = `
/* The handle is the row's only grab target: the row itself is no longer
   draggable, so a click on Select / Hide / Ungroup can never start a drag. */
.dsh-railist-settings-handle {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  min-height: 24px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--dsh-railist-muted);
  font: inherit;
  line-height: 1;
  cursor: grab;
  touch-action: none;
}

.dsh-railist-settings-handle:hover {
  border-color: var(--dsh-railist-line);
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-railist-fill-strong));
  color: inherit;
}

/* Keyboard focus is the visible contract for "arrow keys move this row". */
.dsh-railist-settings-handle:focus-visible,
.dsh-railist-settings-handle[data-lifted='true'] {
  border-color: var(--dsh-railist-accent);
  outline: 2px solid var(--dsh-railist-accent);
  outline-offset: 1px;
  color: inherit;
}

.dsh-railist-settings-handle[data-lifted='true'] {
  cursor: grabbing;
}

.dsh-railist-settings-handle:active {
  cursor: grabbing;
}

/* A member's handle is narrower: the member row is a single line of controls. */
.dsh-panellist-settings-member .dsh-railist-settings-handle {
  width: 18px;
  min-height: 22px;
}

.dsh-railist-settings-handleGlyph {
  display: block;
  font-size: 12px;
  letter-spacing: -1px;
  pointer-events: none;
}

/* ---------------------------------------------------------- drop feedback */

/* The active list gets a soft fill, so "you can drop anywhere here" reads
   before the pointer reaches a specific gap. */
[data-drop-active='true'] {
  background: var(--dsh-railist-fill);
  border-radius: 10px;
}

/* The insertion indicator. It is a pseudo-element rather than a real node: the
   candidate row is a drag target, and inserting a child into it would move the
   drop target out from under the pointer. */
[data-drop-target] {
  position: relative;
}

[data-drop-target='before']::after,
[data-drop-target='after']::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--dsh-railist-accent);
  pointer-events: none;
}

[data-drop-target='before']::after {
  top: -4px;
}

[data-drop-target='after']::after {
  bottom: -4px;
}

/* Dropping onto a group joins it, so the indicator hugs the whole row. */
[data-drop-target='inside']::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px dashed var(--dsh-railist-accent);
  border-radius: 10px;
  background: var(--dsh-railist-fill);
  pointer-events: none;
}

/* The row being dragged keeps a ghost outline where it came from. */
.dsh-railist-settings-row[data-dragging='true'],
.dsh-railist-settings-member[data-dragging='true'] {
  outline: 1px dashed var(--dsh-railist-line);
  outline-offset: -1px;
}

/* A member list is only a drop scope while something is being dragged. */
.dsh-railist-settings-members[data-drop-scope='members'] {
  border-radius: 8px;
}

.dsh-railist-settings-rows[data-drop-scope='rows'] {
  min-height: 8px;
}

/* The end-of-list gap: dropping here appends to the list. */
.dsh-railist-settings-listEnd {
  height: 14px;
  border-radius: 8px;
}

.dsh-railist-settings-listEnd[data-drop-target='after']::after {
  bottom: auto;
  top: 4px;
}
`.trim()
