/**
 * Polish for the settings list (README §3.1).
 *
 * A second chunk on top of `settings.css.ts`, registered after it so these
 * rules win where they overlap. It exists because the list's first pass put
 * every element on one line with no vertical rhythm, which read as cramped and
 * made the eye treat the row's name, its badges and its buttons as one block of
 * text. This chunk's job is spacing, alignment and state feedback only: it
 * introduces no colour of its own, no font that the shell does not already use,
 * and no shadow the page did not already have.
 *
 * Every value comes from a shell token (`--dsw-alias-*`, `--dsw-radius-*`),
 * each read through a `var(…, <theme-neutral fallback>)`. The fallbacks are
 * `currentColor` mixes and transparent fills, never a light-only or dark-only
 * literal, so the page reads correctly in either theme and in a shell that
 * renamed its tokens. That is also why this file contains no `@media
 * (prefers-color-scheme)` block: the tokens ARE the theme, and a second,
 * hand-rolled palette is exactly the thing that breaks when the shell changes.
 * @module
 */
export const SETTINGS_POLISH_CSS = `
/* ------------------------------------------------------------------ list */

/*
 * Rows were 6px apart with an 8px pad, so two adjacent rows' borders sat 6px
 * from each other and the list read as a solid block. The rail's own rows are
 * one 28px line; 10px of padding and 8px of gap gives each row a body without
 * making the list scroll for a five-row profile.
 */
.dsh-panellist-settings-rows {
  gap: 8px;
}

.dsh-panellist-settings-row {
  gap: 2px;
  padding: 4px 8px;
  border-radius: var(--dsw-radius-md, 8px);
  transition: border-color 120ms ease, background-color 120ms ease, opacity 120ms ease;
}

/*
 * Hover answers "this whole thing is one unit" with a flat, faint fill — the
 * same answer the shell gives its own list rows. It must not draw a border
 * here: the base row only carries a top hairline, and lighting all four sides
 * would box the row in.
 *
 * This is the ONE hover layer a settings row gets, so it must be clearly
 * visible on its own: the inner rowSelect and member hovers are gone precisely
 * because they stacked a second band inside this one. The fallback is a tint of
 * the theme accent, not a currentColor wash — that wash is grey on a light
 * theme and invisible on a dark one, which is how "hover is grey" got reported
 * in the first place.
 */
.dsh-panellist-settings-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, var(--dsw-alias-brand-primary, currentColor) 12%, transparent));
}

/*
 * Selection is a state, not a hover: it has to survive the pointer leaving. The
 * row is marked by the brand on its 1px border and on the name itself, never by
 * a filled box — a fill here read as a grey chip in light mode and dimmed the
 * row's own text in dark mode.
 */
.dsh-panellist-settings-row[data-selected='true'] {
  border-color: var(--dsw-alias-brand-primary, currentColor);
  background: transparent;
}

.dsh-panellist-settings-row[data-selected='true']:hover {
  border-color: var(--dsw-alias-brand-primary, currentColor);
}

/*
 * The dragged row stays visible but recedes. 0.5 was heavy enough that the row
 * looked disabled rather than in-flight; the dashed border carries the
 * "something is happening to this" signal that the opacity was doing.
 */
.dsh-panellist-settings-row[data-dragging='true'] {
  opacity: 0.72;
  border-style: dashed;
  border-color: var(--dsw-alias-brand-primary, currentColor);
}

@media (prefers-reduced-motion: reduce) {
  .dsh-panellist-settings-row,
  .dsh-panellist-settings-rowSelect,
  .dsh-panellist-settings-action,
  .dsh-panellist-settings-member {
    transition: none;
  }
}

/* -------------------------------------------------------------- row line */

/*
 * The row's single line is laid out to a baseline, not to a box: the name and
 * the badges sit on the text baseline so a 11px badge and a 13px name are
 * optically aligned, which align-items: center cannot do once the glyph box
 * is taller than the text box.
 *
 * The row is ONE line: nowrap is what stops the actions from falling under
 * the name, and a 24px min-height is what keeps it from growing to fit them
 * if they ever do. Both live in the page chunk (the namespaced panellist
 * side); this chunk only owns the rhythm — the gap and the alignment.
 */
.dsh-panellist-settings-rowMain {
  gap: 10px;
  min-height: 24px;
}

/*
 * The select button is the row's only growing child: it takes the space the
 * subtitle gives up. The name inside it then truncates rather than pushing the
 * badges and the actions out of the row.
 */
.dsh-panellist-settings-rowSelect {
  flex: 1 1 auto;
  gap: 10px;
  padding: 2px 6px 2px 2px;
  border-radius: var(--dsw-radius-md, 8px);
}

.dsh-panellist-settings-rowGlyph {
  width: 22px;
  height: 22px;
  flex: none;
}

/*
 * The name yields to the badges and the buttons. min-width: 0 is what lets
 * the ellipsis actually happen inside a flex child; without it a long panel
 * name pushes the buttons off the row instead of truncating.
 */
.dsh-panellist-settings-rowName {
  flex: 1 1 auto;
  min-width: 0;
  line-height: 22px;
}

/*
 * The handle is a fixed-width edge of the row, never a flexible one: at 22px
 * it is the same target size the rail's own rows use, so the drag affordance
 * does not change height when the name wraps or truncates. Its min-height is
 * set by the page chunk to the row's own line height (24px), not by this one.
 */
.dsh-railist-settings-handle {
  flex: none;
  width: 22px;
}

/* ------------------------------------------------------------- contributor */

/*
 * The plugin name and version, right of the name and above the badges. It is
 * secondary text: the tertiary label colour and 11px are both one step below
 * the row's own 13px, so it is legible when looked for and invisible when not.
 *
 * It is the first thing to yield. A zero basis is what keeps it OFF the name's
 * space at narrow widths: it collapses to nothing before the name is allowed to
 * truncate, because a name that reads "Capabili…" is worse than a missing
 * version number. The row stays one line.
 */
.dsh-panellist-settings-source {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 30%;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent));
  font-size: 11px;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: none;
}

/*
 * …and then it is not drawn at all until the row is hovered. A settings list
 * of seven panels reads as seven names when the contributor is shown on every
 * row; the question it answers — "which package is this row?" — is one the
 * user asks about ONE row at a time. Hovering answers it without a click, and
 * the name gets the full line the rest of the time.
 *
 * The keyboard path is covered by :focus-within: tabbing into a row's
 * actions reveals the same line, so this is not pointer-only.
 */
.dsh-panellist-settings-row:hover .dsh-panellist-settings-source,
.dsh-panellist-settings-row:focus-within .dsh-panellist-settings-source,
.dsh-panellist-settings-member:hover .dsh-panellist-settings-source {
  display: block;
}

/* ------------------------------------------------------------------ badges */

/*
 * Badges are one shape at one size, and their TYPE is carried by colour — the
 * previous pass had a 16px line box against an 11px font, which left the pill
 * visibly shorter than the row's text and made the missing/locked variants
 * look like a different component rather than a different state.
 */
.dsh-panellist-settings-badges {
  flex: none;
  gap: 6px;
  align-items: center;
}

.dsh-panellist-settings-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-width: 1px;
  border-style: solid;
  border-color: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
  border-radius: var(--dsw-radius-panel, 999px);
  color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 78%, transparent));
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
}

/*
 * The default pill is the *quiet* one: hidden and group are ordinary
 * states, so they must not shout. Only the two states the user has to act on
 * take a colour, which is what keeps the colour meaningful when it appears.
 *
 * The three attribute selectors below are guarded on the element still
 * carrying the badge class, so a future badge type that forgets data-badge
 * keeps the base look instead of dropping to unstyled.
 */
.dsh-panellist-settings-badge[data-badge='hidden'] {
  border-color: var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 24%, transparent));
  color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent));
}

.dsh-panellist-settings-badge[data-badge='group'] {
  color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent));
}

.dsh-panellist-settings-badge[data-badge='missing'] {
  border-color: var(--dsw-alias-state-error-primary, currentColor);
  color: var(--dsw-alias-state-error-primary, currentColor);
}

.dsh-panellist-settings-badge[data-badge='locked'] {
  border-color: var(--dsw-alias-state-warn-primary, currentColor);
  color: var(--dsw-alias-state-warn-primary, currentColor);
}

/*
 * A row that is registered but renders nothing on the rail is informational,
 * not broken: it uses the warn step, not the error one, so a profile where a
 * footer entry is simply switched off does not look like it has lost panels.
 */
.dsh-panellist-settings-badge[data-badge='unrendered'] {
  border-color: var(--dsw-alias-state-warn-primary, currentColor);
  color: var(--dsw-alias-state-warn-primary, currentColor);
}

/* ----------------------------------------------------------------- actions */

/*
 * The actions are the row's least important content and were competing with the
 * name for attention, because every one of them was a full-height bordered box.
 * They stay reachable and focusable; they just stop being drawn until the row is
 * hovered or one of them holds focus, which is the same progressive-disclosure
 * the shell's own list rows use. The border is kept in the box model at all
 * times (border-color transitions, border-width does not) so nothing moves
 * when the buttons appear.
 */
.dsh-panellist-settings-actions {
  gap: 4px;
  opacity: 0;
  transition: opacity 120ms ease;
}

/*
 * The disclosure itself. The rule above leaves the buttons in the box model and
 * withholds only their ink, so the row is one stable line whether or not the
 * pointer is over it — the name never reflows as the pointer crosses the list.
 *
 * Focus is the keyboard half of the same promise: tabbing into a row's actions
 * puts focus inside the row, which is what :focus-within matches, so a button
 * is revealed before it can be read. Nothing is ever focusable-but-invisible.
 */
.dsh-panellist-settings-row:hover .dsh-panellist-settings-actions,
.dsh-panellist-settings-row:focus-within .dsh-panellist-settings-actions,
.dsh-panellist-settings-member:hover .dsh-panellist-settings-actions,
.dsh-panellist-settings-member:focus-within .dsh-panellist-settings-actions {
  opacity: 1;
}

/* A touch screen has no hover to reveal them with, so there they are always on. */
@media (hover: none) {
  .dsh-panellist-settings-actions {
    opacity: 1;
  }
}

/*
 * The row's right-hand edge is a pinned one: it never wraps to a second line
 * and never lets its buttons shrink. This is the rule that keeps a row ONE
 * line tall when the settings column is narrow.
 */
.dsh-panellist-settings-actionRow {
  flex-wrap: nowrap;
  flex: none;
}

.dsh-panellist-settings-action {
  flex: none;
  white-space: nowrap;
  min-height: 24px;
  padding: 0 8px;
  border-radius: var(--dsw-radius-md, 8px);
  border-color: transparent;
  color: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 78%, transparent));
  font-size: 12px;
  line-height: 1;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease;
}

/*
 * A touch screen has no hover, and neither does the focus ring on a button the
 * user has not reached yet: on those the labels must be visible up front.
 */
@media (hover: none) {
  .dsh-panellist-settings-action {
    border-color: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
  }
}

.dsh-panellist-settings-row:hover .dsh-panellist-settings-action:not(:disabled),
.dsh-panellist-settings-member:hover .dsh-panellist-settings-action:not(:disabled),
.dsh-panellist-settings-action:focus-visible {
  border-color: var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 24%, transparent));
}

.dsh-panellist-settings-action:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 24%, transparent));
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 11%, transparent));
  color: var(--dsw-alias-label-primary, currentColor);
}

.dsh-panellist-settings-action:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 8%, transparent));
}

.dsh-panellist-settings-action:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: 1px;
}

/*
 * A disabled action is permanently invisible in a row that is not hovered:
 * "Move up" on the first row is the common case, and it should read as absent
 * rather than as a greyed box that the eye keeps re-checking.
 */
.dsh-panellist-settings-action:disabled {
  opacity: 0;
}

.dsh-panellist-settings-row:hover .dsh-panellist-settings-action:disabled,
.dsh-panellist-settings-member:hover .dsh-panellist-settings-action:disabled {
  opacity: 0.35;
}

@media (hover: none) {
  .dsh-panellist-settings-action:disabled {
    opacity: 0.35;
  }
}

/* ----------------------------------------------------------------- members */

/*
 * A group's members are a nested list, so they are indented by the group's own
 * content edge rather than by a fixed 24px that did not line up with the row's
 * padding. The rail's own nesting uses a hairline to mark the group, and the
 * same device is reused here so the two views agree.
 */
.dsh-panellist-settings-members {
  gap: 2px;
  margin: 2px 0 0;
  padding: 2px 0 0 14px;
  border-left: 1px solid var(--dsw-alias-border-l1, var(--dsh-railist-hairline, color-mix(in srgb, currentColor 10%, transparent)));
}

.dsh-panellist-settings-member {
  gap: 8px;
  min-height: 24px;
  padding: 2px 6px 2px 2px;
  border-radius: var(--dsw-radius-md, 8px);
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

/* Members carry no hover fill: they live inside a row that has one, and the two
   layers read as a double grey band. The selected state below is kept — it
   marks which icon the editor is editing. */

/* The selected member keeps the same inset ring the rail uses for a nested row. */
.dsh-panellist-settings-member[data-selected='true'] {
  background: var(--dsw-alias-interactive-bg-active, var(--dsh-railist-fill-strong, color-mix(in srgb, currentColor 11%, transparent)));
  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary, currentColor);
}

/* ---------------------------------------------------------------- drop zone */

/*
 * The drop target is the whole list wrapper, so it must stay invisible until a
 * drag is actually in flight: painting it on hover lit up the entire sequence
 * whenever the pointer crossed a gap between rows, which read as a second grey
 * layer above the row's own hover. The row's :hover is the only hover layer here
 * (user feedback, 2026-10-15); the end-of-list strip keeps its own affordance.
 */
.dsh-panellist-settings-dropZone {
  min-height: 12px;
  border-radius: var(--dsw-radius-md, 8px);
  background: none;
  box-shadow: none;
}

/* --------------------------------------------------------------- blocks */

/*
 * The list is the page's main card; the blocks below it are secondary. Giving
 * the outer card the page's own gap and keeping the inner blocks tighter makes
 * the hierarchy legible without changing any of the shell's surfaces.
 */
.dsh-panellist-settings-block {
  gap: 10px;
  border-radius: var(--dsw-radius-panel, 16px);
}

.dsh-panellist-settings-blockTitle {
  line-height: 20px;
}

.dsh-panellist-settings-hint {
  font-size: 12px;
  line-height: 18px;
}

/*
 * The pending-edit bar. It is rendered above the sequence list so the two ways
 * out of a previewed reorder are the first thing the eye lands on. It is framed
 * by its border and its brand-coloured Save, not by a grey surface — a layered
 * fill here made the bar look like a disabled region in light mode.
 */
.dsh-panellist-settings-commitBar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
  border-radius: var(--dsw-radius-lg, 12px);
  background: transparent;
}

.dsh-panellist-settings-commitBar[hidden] { display: none; }

.dsh-panellist-settings-commitHint {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsh-railist-secondary, var(--dsw-alias-label-secondary, currentColor));
}

.dsh-panellist-settings-commitActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.dsh-panellist-settings-commitAction {
  min-height: 28px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-md, 8px);
  border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
  background: transparent;
  color: var(--dsh-railist-secondary, var(--dsw-alias-label-secondary, currentColor));
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.dsh-panellist-settings-commitAction:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3, color-mix(in srgb, currentColor 24%, transparent));
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-railist-fill-strong, color-mix(in srgb, currentColor 11%, transparent)));
  color: var(--dsw-alias-label-primary, currentColor);
}

.dsh-panellist-settings-commitSave {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary, currentColor);
  color: var(--dsw-alias-on-accent, var(--dsw-alias-label-primary, currentColor));
}

.dsh-panellist-settings-commitSave:hover:not(:disabled) {
  border-color: transparent;
  background: var(--dsw-alias-interactive-bg-active, var(--dsh-railist-fill-strong, color-mix(in srgb, currentColor 11%, transparent)));
  color: var(--dsw-alias-on-accent, var(--dsw-alias-label-primary, currentColor));
}

.dsh-panellist-settings-commitAction:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, currentColor);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-panellist-settings-row,
  .dsh-panellist-settings-rowSelect,
  .dsh-panellist-settings-action,
  .dsh-panellist-settings-actions,
  .dsh-panellist-settings-member,
  .dsh-panellist-settings-commitAction {
    transition: none;
  }
}
`.trim()
