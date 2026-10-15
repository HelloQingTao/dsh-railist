/**
 * The settings page's CSS chunk (README §3).
 *
 * Every class is namespaced `dsh-railist-settings-`. Colour comes from the
 * shell's own alias tokens (`--dsw-alias-*`, the names the shipped settings
 * sections use), each read through a `var(…, <theme-neutral fallback>)` so the
 * page still reads correctly when the tokens are absent (tests, a shell that
 * renamed them): the fallbacks are `currentColor` mixes and transparent fills,
 * never a light-only or dark-only literal.
 *
 * Registered once by `settings/index.tsx` through `deps.styles.register`.
 *
 * The one exception to the namespace is at the bottom of this file: the sequence
 * editor's rows render in `dsh-panellist-settings-*` (a name it has carried since
 * before this plugin was forked, and one its tests assert on), so the two class
 * names the editor uses but neither the page nor the polish chunk covers are
 * defined here rather than renamed in thirty files.
 */
export const SETTINGS_CSS = `
.dsh-railist-settings {
  --dsh-railist-line: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
  --dsh-railist-hairline: var(--dsw-alias-hairline, color-mix(in srgb, currentColor 10%, transparent));
  --dsh-railist-fill: color-mix(in srgb, currentColor 5%, transparent);
  --dsh-railist-fill-strong: color-mix(in srgb, currentColor 11%, transparent);
  --dsh-railist-muted: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent));
  --dsh-railist-secondary: var(--dsw-alias-label-secondary, currentColor);
  --dsh-railist-accent: var(--dsw-alias-accent, currentColor);
  --dsh-railist-danger: var(--dsw-alias-state-error-primary, currentColor);
  --dsh-railist-warn: var(--dsw-alias-state-warn-primary, currentColor);

  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 760px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 1.5;
}

.dsh-railist-settings *,
.dsh-railist-settings *::before,
.dsh-railist-settings *::after {
  box-sizing: border-box;
}

.dsh-railist-settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.dsh-railist-settings-headerText {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dsh-railist-settings-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.dsh-railist-settings-subtitle {
  margin: 0;
  color: var(--dsh-railist-muted);
}

.dsh-railist-settings-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--dsh-railist-line);
  border-radius: 16px;
  /* The card is the shell's own surface, not a grey of our making: painting it
     with a layer colour made the whole section read as a dimmed panel next to
     the shell's settings rows. Transparent keeps it on the dialog's background
     and lets the border do the framing. */
  background: transparent;
}

.dsh-railist-settings-blockTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.dsh-railist-settings-hint {
  margin: 0;
  color: var(--dsh-railist-muted);
}

.dsh-railist-settings-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--dsh-railist-line);
  border-left-width: 3px;
  border-radius: 10px;
  background: var(--dsh-railist-fill);
}

.dsh-railist-settings-banner-warn {
  border-left-color: var(--dsh-railist-warn);
}

.dsh-railist-settings-action {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--dsh-railist-line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.dsh-railist-settings-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-railist-fill-strong));
}

.dsh-railist-settings-action:disabled {
  color: var(--dsh-railist-muted);
  cursor: default;
  opacity: 0.6;
}

.dsh-railist-settings-actionRow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.dsh-railist-settings-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* A seat heading inside the sequence list. It is a list item so the list keeps
   one flat DOM order (drag positions are read from that order), but it is not a
   row: no border, no handle, and it must never be a drop target. */
.dsh-railist-settings-seat {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0 2px;
  border: none;
  background: none;
  list-style: none;
  pointer-events: none;
}

.dsh-railist-settings-seat:first-child {
  margin-top: 0;
}

.dsh-railist-settings-seatTitle {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--dsh-railist-secondary);
  text-transform: none;
}

.dsh-railist-settings-seatHint {
  font-size: 11px;
  color: var(--dsh-railist-muted);
}

/* The rule that makes the heading read as a divider between seats rather than a
   label on the first row of one. */
.dsh-railist-settings-seat::after {
  content: '';
  flex: 1 1 100%;
  height: 1px;
  background: var(--dsh-railist-hairline);
}

/* The pinned seat (the shell's own settings row) reads as the end of the list:
   no divider below it, because nothing follows. */
.dsh-railist-settings-seat[data-seat='pinned']::after {
  display: none;
}

/* A pinned row carries no controls, so it must not look like an empty one. */
.dsh-railist-settings-row[data-pinned='true'] {
  border-style: dashed;
  background: none;
}

/* A selected row is marked by the accent on its name, not by a filled box —
   the list stays a list while it says which row the editor below is on. */
.dsh-railist-settings-row[data-selected='true'] {
  background: transparent;
}

.dsh-railist-settings-row[data-selected='true'] .dsh-panellist-settings-rowName,
.dsh-railist-settings-row[data-selected='true'] .dsh-panellist-settings-memberName {
  color: var(--dsh-railist-accent);
}

/* The visibility switch: an icon, not a worded button. It sits at the end of
   the row, takes the label colour, and only reveals itself as a control on
   hover or when it is actually reporting "hidden" — so the list reads as
   "glyph + name" until the pointer is on the row. */
.dsh-railist-settings-eye {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  /* The name block stays flush left and the switch is pushed to the far right,
     so every row's icon and text start at the same x whatever its name length. */
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsh-railist-muted);
  cursor: pointer;
  opacity: 0.55;
}

.dsh-railist-settings-row:hover .dsh-railist-settings-eye,
.dsh-railist-settings-member:hover .dsh-railist-settings-eye,
.dsh-railist-settings-eye:focus-visible {
  opacity: 1;
}

.dsh-railist-settings-eye[data-state='hidden'] {
  color: var(--dsh-railist-warn);
  opacity: 1;
}

.dsh-railist-settings-eye:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-railist-fill-strong));
}

.dsh-railist-settings-eyeGlyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* The strip under the list: one verb, on the row you selected. */
.dsh-railist-settings-rowActions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
}

.dsh-railist-settings-stripAction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 12px;
  border: 1px solid var(--dsh-railist-line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.dsh-railist-settings-stripAction:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-railist-fill-strong));
}

.dsh-railist-settings-stripAction:disabled {
  color: var(--dsh-railist-muted);
  cursor: default;
  opacity: 0.6;
}

.dsh-railist-settings-dropZone {
  min-height: 8px;
}

.dsh-railist-settings-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  /* No fill of our own: a row is a line of the list, not a card. The wash read
     as a grey box per row and made the list look like a table of chips. */
  background: transparent;
}

/* The row's own line, so the list keeps its structure without painting a
   surface: the hairline under each row is the separator (the last one and the
   pinned row drop it). */
.dsh-railist-settings-row + .dsh-railist-settings-row {
  border-top: 1px solid var(--dsh-railist-hairline);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.dsh-railist-settings-row:hover {
  /* The ONE hover layer a row gets, in the shell's own hover colour. The
     fallback is a tint of the accent rather than a grey wash: a currentColor
     wash at 5% reads as dirt on a light theme and as nothing at all on a dark
     one, so an environment that publishes no hover alias got a colour that was
     not the theme's. */
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsh-railist-accent) 12%, transparent));
}

.dsh-railist-settings-row[data-dragging='true'] {
  opacity: 0.5;
}

.dsh-railist-settings-row[data-selected='true'] {
  border-color: var(--dsh-railist-accent);
}

.dsh-railist-settings-rowMain {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dsh-railist-settings-rowSelect,
.dsh-panellist-settings-rowSelect {
  flex: 0 1 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* No hover fill of its own: the select covers all but the row's padding, so a
   second layer here painted a visibly darker band INSIDE the hovered row —
   two greys at once. The row's own :hover is the one hover layer. */

.dsh-railist-settings-rowGlyph,
.dsh-panellist-settings-rowGlyph {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.dsh-railist-settings-rowName,
.dsh-panellist-settings-rowName {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-railist-settings-badges {
  flex: none;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dsh-railist-settings-badge {
  padding: 0 6px;
  border: 1px solid var(--dsh-railist-hairline);
  border-radius: 999px;
  background: transparent;
  color: var(--dsh-railist-muted);
  font-size: 11px;
  line-height: 16px;
}

.dsh-railist-settings-badge[data-badge='missing'] {
  border-color: var(--dsh-railist-danger);
  color: var(--dsh-railist-danger);
}

.dsh-railist-settings-badge[data-badge='locked'] {
  border-color: var(--dsh-railist-warn);
  color: var(--dsh-railist-warn);
}

.dsh-railist-settings-actions {
  flex: none;
}

.dsh-railist-settings-members {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0 0 0 24px;
  list-style: none;
}

.dsh-railist-settings-member {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 8px;
}

/* Members of a group sit INSIDE their row: hovering one used to paint a grey
   band under the row's own hover grey. The row-level layer is the one hover
   layer, so nothing is painted here. The selected fill below stays — that is a
   state, not a hover, and it says which icon the editor is editing. */

.dsh-railist-settings-member[data-selected='true'] {
  background: var(--dsh-railist-fill-strong);
  box-shadow: inset 0 0 0 1px var(--dsh-railist-accent);
}

.dsh-railist-settings-memberName {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-railist-settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dsh-railist-settings-fieldLabel {
  color: var(--dsh-railist-secondary);
  font-weight: 600;
}

.dsh-railist-settings-input,
.dsh-railist-settings-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--dsh-railist-line);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.dsh-railist-settings-textarea {
  min-height: 64px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.dsh-railist-settings-radioRow {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.dsh-railist-settings-radio {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.dsh-railist-settings-iconGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(32px, 1fr));
  gap: 4px;
}

.dsh-railist-settings-iconCell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--dsh-railist-hairline);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.dsh-railist-settings-iconCell[aria-pressed='true'] {
  border-color: var(--dsh-railist-accent);
  background: var(--dsh-railist-fill-strong);
}

.dsh-railist-settings-preview {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dsh-railist-settings-error {
  margin: 0;
  color: var(--dsh-railist-danger);
}

.dsh-railist-settings-warnings {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--dsh-railist-muted);
}

/*
 * The sequence editor renders in its own namespace: the class names it has
 * carried since before this plugin was forked, and the ones its tests assert
 * on. The page chunk therefore keeps the two of them that neither the page nor
 * the polish chunk covers. They duplicate rules above in intent, but they must
 * live here: a rule in the polish chunk would lose the cascade race against the
 * same-name rules in this file, because the polish chunk is registered third.
 *
 * The same two namespaces are also where the row's layout lives, and the reason
 * the rows used to be twice as tall as they needed to be: the row's main line
 * is a flex row whose children — handle, select button, contributor subtitle,
 * badges, actions — all asked to be flex: 1 1 auto, so in the narrow settings
 * column the subtitle pushed the buttons onto a second line and the row grew to
 * fit it. That is the reported "one entry takes two rows, the list is too tall".
 *
 * The fix is the contract the rail itself uses: a row is ONE line, and whatever
 * does not fit truncates. The select button owns the free space, the subtitle
 * yields first, and the handle, the badges and the actions are pinned edges.
 */

.dsh-panellist-settings-memberName {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-panellist-settings-actionRow {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  flex: none;
}

/*
 * nowrap is the whole point: without it the actions fall under the name the
 * moment the column gets narrow, which is what made every row two lines tall.
 * min-height is 24px — one line of text plus the row's own padding — not the
 * 28px of the drag handle, so a row is one line in every seat.
 */
.dsh-panellist-settings-rowMain {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 24px;
}

.dsh-panellist-settings-rowMain > * {
  min-width: 0;
}

/* The row's fixed edges: the handle, the badges and the actions. */
.dsh-railist-settings-handle,
.dsh-panellist-settings-badges,
.dsh-panellist-settings-actions,
.dsh-panellist-settings-action {
  flex: none;
}

/*
 * The handle is the row's left edge and keeps its own 22px width at any row
 * height: a 28px-tall handle next to a 24px row is what made the row taller
 * than its own content. It stays 22x24 — the rail's own row height.
 */
.dsh-railist-settings-handle {
  width: 22px;
  min-height: 24px;
}

/* The same for a group member's handle, one step narrower. */
.dsh-panellist-settings-member .dsh-railist-settings-handle {
  width: 18px;
  min-height: 22px;
}
`.trim()
