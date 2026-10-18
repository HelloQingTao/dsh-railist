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

/* The list currently receiving a drag gets a soft fill, so "you can drop
   anywhere here" reads before the pointer reaches a specific gap.

   Only the top-level list gets it. The group whose member is being dragged
   used to paint the same fill - and it painted it on the element that wraps
   the entire row, so dragging one member turned the whole group grey. The
   member list is identified by its own attribute instead, which outlines just
   the list the pointer is actually in (below). */
[data-drop-active='true']:not([data-member-drop]) {
  background: var(--dsh-railist-fill);
  border-radius: 10px;
}

/* A group's member list accepts a member of its OWN group: the reorder runs
   inside it. It gets an inset outline, not a fill — the fill covered the group
   row's own name and badges, i.e. an ancestor of the thing being sorted. */
[data-member-drop='active'] {
  /* A hairline in the theme accent: enough to say "you can reorder inside
     here" without the box shouting over the rows it wraps. */
  outline: 1px solid color-mix(in srgb, var(--dsh-railist-accent) 40%, transparent);
  outline-offset: 2px;
  border-radius: 8px;
}

/* A member dragged out of its group and over the top-level list: that list is
   a real destination (the member leaves the group), so it gets the full fill. */
[data-drop-active='true'][data-member-drop='escape'] {
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
  height: 1px;
  border-radius: 1px;
  /* The insertion line is a hairline hint, not a bar: the theme's accent at
     low opacity says "it goes here" without out-shouting the rows on either
     side of it. */
  background: color-mix(in srgb, var(--dsh-railist-accent) 35%, transparent);
  pointer-events: none;
}

/* A group's member list draws its gaps between the members, inset from the
   indent so the line reads as "between these two members". The gap above the
   first member uses the ::before pseudo-element and the one below the last
   uses ::after, so the two cases never fight over one pseudo-element.

   Declared AFTER the generic row rule on purpose: same specificity, so the
   display/inset resets below would otherwise be undone by it. */
.dsh-panellist-settings-members[data-drop-target] {
  position: relative;
}

.dsh-panellist-settings-members[data-drop-target='before']::after,
.dsh-panellist-settings-members[data-drop-target='after']::after,
.dsh-panellist-settings-members[data-drop-target='before']::before,
.dsh-panellist-settings-members[data-drop-target='after']::before {
  content: '';
  position: absolute;
  left: 24px;
  right: 0;
  height: 1px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--dsh-railist-accent) 35%, transparent);
  pointer-events: none;
  transform: none;
}

/* One line per case: the "above the first member" case hides the row rule's
   top line, the "below the last member" case hides the bottom one. */
.dsh-panellist-settings-members[data-drop-target='before']::after,
.dsh-panellist-settings-members[data-drop-target='after']::before {
  display: none;
}

.dsh-panellist-settings-members[data-drop-target='before']::before {
  top: -2px;
}

.dsh-panellist-settings-members[data-drop-target='after']::after {
  top: auto;
  bottom: -2px;
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
