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
  padding: 10px 10px 10px 8px;
  border-radius: var(--dsw-radius-lg, 12px);
  transition: border-color 120ms ease, background-color 120ms ease, opacity 120ms ease;
}

/*
 * The shell paints its own hover as a flat fill on the element under the
 * pointer. A row is a container, not a control, so hovering it should answer
 * "this whole thing is one unit" — a hairline that firms up — rather than light
 * the entire row up as if it were a button.
 */
.dsh-panellist-settings-row:hover {
  border-color: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
}

/*
 * Selection is a state, not a hover: it has to survive the pointer leaving. A
 * 1px border in the brand colour is enough to read as "this is the row you are
 * editing", and it keeps the row's size stable where a heavier outline would
 * shift the text by a pixel.
 */
.dsh-panellist-settings-row[data-selected='true'] {
  border-color: var(--dsw-alias-brand-primary, currentColor);
  background: var(--dsw-alias-interactive-bg-active, color-mix(in srgb, currentColor 8%, transparent));
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
 */
.dsh-panellist-settings-rowMain {
  gap: 10px;
  min-height: 24px;
}

.dsh-panellist-settings-rowSelect {
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

/* ------------------------------------------------------------- contributor */

/*
 * The plugin name and version, right of the name and above the badges. It is
 * secondary text: the tertiary label colour and 11px are both one step below
 * the row's own 13px, so it is legible when looked for and invisible when not.
 * It never takes space from the name (it truncates first).
 */
.dsh-panellist-settings-source {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, color-mix(in srgb, currentColor 62%, transparent));
  font-size: 11px;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
}

.dsh-panellist-settings-action {
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

.dsh-panellist-settings-member:hover {
  background: var(--dsw-alias-interactive-bg-hover, var(--dsh-railist-fill-strong, color-mix(in srgb, currentColor 11%, transparent)));
}

/* The selected member keeps the same inset ring the rail uses for a nested row. */
.dsh-panellist-settings-member[data-selected='true'] {
  background: var(--dsw-alias-interactive-bg-active, var(--dsh-railist-fill-strong, color-mix(in srgb, currentColor 11%, transparent)));
  box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary, currentColor);
}

/* ---------------------------------------------------------------- drop zone */

/*
 * The drop target at the end of the list: an empty 8px strip that the pointer
 * could not find and that gave no answer while dragging. It now grows into a
 * visible line on hover, so "drop here to send it to the end" is discoverable
 * and confirmed before the drop rather than after it.
 */
.dsh-panellist-settings-dropZone {
  min-height: 12px;
  border-radius: var(--dsw-radius-md, 8px);
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

.dsh-panellist-settings-dropZone:hover {
  background: color-mix(in srgb, currentColor 5%, transparent);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 16%, transparent));
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
`.trim()
