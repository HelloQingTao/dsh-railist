/**
 * The rail's entire DOM footprint: one stylesheet, no node moves.
 *
 * Hiding a row is the only thing the registry rewrite cannot express, and it is
 * expressed here as a single `:has()` rule: a row whose glyph rendered a marker
 * span disappears. Because the marker is rendered by React, the rule is
 * declarative — no observer, no re-parenting, no layout thrash.
 *
 * The settings navigation glyph is the ecosystem's proven technique (see
 * `dsh-better-sidebar/src/client/layout.css:58-75`): the shell has no icon field
 * in the `settings.section` contract, so the marker pass stamps our own row and
 * a pseudo-element paints a masked, `currentColor` glyph over the fallback gear.
 * The mask is a DEDICATED glyph — a panel list, drawn at the settings
 * navigation's own `Icon*OutlineMedium` weight (1.3), not at the rail's 1px —
 * because `dsh-client-ui-settings-general` renders every nav icon beside it as
 * `Icon*OutlineMedium` at `size: 16`, and a 1px glyph in that column read
 * visibly thinner than its neighbours (icons/builtin.tsx owns both artworks).
 */

/** Marker attribute for the settings navigation row (see {@link createSettingsNavMarker}). */
export const SETTINGS_NAV_ATTR = 'data-dsh-railist-settings-nav'

/** The footer seat's `data-slot` anchor, shared with `rail/dom.ts` (see {@link EVOKE_CSS}). */
const FOOTER_SLOT_ATTR = 'sidebar.footer.action'

/**
 * The selector for one rail row, in the ONE place.
 *
 * Both users of it matter equally: the hide rule below needs exactly this shape
 * (a direct child of the panel list), and the self-check has to measure the same
 * thing the rule matches. Two copies drifted apart the moment the shell re-rolled
 * its class hash, so there is one string, and `rail/probe.ts` imports it.
 */
export const PANEL_ROW_SELECTOR = 'nav[class*="_panelList"] > button[class*="_panelRow"]'

/** The ghost slot's stamp — the anchor for a row the plan moved out of its seat. */
const GHOST_ATTR = 'data-dsh-railist-ghost'

/**
 * Row hiding. `hidden` = "hide unless this panel is selected"; `suppressed` =
 * "always hide, it is shown inside a group instead". Both markers are rendered
 * by the glyph wrapper in `registry/rail.ts`.
 *
 * The panel list and the footer area are two SEPARATE seats and have to be
 * hidden separately: a footer action (the capability panel) that a group takes
 * over keeps its own row in `sidebar.footer.action`, not in `_panelList`, so a
 * rule anchored on the panel row alone left it standing at the bottom left
 * while it was "always hidden" — it disappeared only during an evoke, which is
 * the opposite of the intent.
 *
 * The group-active highlight is NOT here: it belongs to the group unit, whose
 * rule also carries the row's theme token (`groups/groups.css.ts`).
 */
export const HIDE_CSS = `
${PANEL_ROW_SELECTOR}:has([data-dsh-railist-hidden]),
${PANEL_ROW_SELECTOR}:has([data-dsh-railist-suppressed]) {
  display: none;
}
[data-slot="${FOOTER_SLOT_ATTR}"] > [data-dsh-railist-suppressed],
[data-slot="${FOOTER_SLOT_ATTR}"] > [data-dsh-railist-hidden] {
  display: none;
}
`

/**
 * An evoked row LEAVES the rail's layout without leaving the DOM.
 *
 * A group member whose contributor renders no `main` page (the capability panel)
 * is activated by rendering that contributor for one interaction and pressing
 * the button inside it — its popover is anchored to that button. The row cannot
 * simply be shown again, though: it would come back in the seat the shell rows
 * it in, which for a footer action is the bottom-left corner, so activating a
 * grouped member painted a SECOND copy of the row under the rail and left it
 * there until long after the popover closed.
 *
 * Moving the node is not an option — the shell's React tree owns it, and its
 * removal from the old position throws `NotFoundError: The node to be removed is
 * not a child of this node` on the next unmount. So the row stays exactly where
 * React put it and only its box is taken away: `display: contents` makes the row
 * contribute no area at all (nothing is painted in its seat, no gap is left
 * behind) while the contributor's subtree still renders and still takes the
 * click.
 *
 * It has to be the shell's ROW that gets `display: contents` and not just the
 * marker's parent: a footer row is the contributor's `<button>` inside it, which
 * carries its own background and padding, and a top-seat row is that row itself.
 *
 * A member the plan takes OUT of its seat is rendered by the ghost instead
 * (`registry/Ghost.tsx`), and its slot is not a shell row at all: the slot is a
 * `display: contents` div the contributor renders into, parked in the footnote
 * host next to every other footer action. The slot therefore needs a rule of its
 * own — measured live, `display: none` on the marker alone collapses the row to
 * nothing, which is what the evoke needs.
 *
 * A member the plan did NOT move stays in its original `sidebar.footer.action`
 * slot, and the glyph wrapper renders the marker span and the contributor's
 * component as SIBLING cards inside it (`registry/rail.tsx`, `wrapperFor`).
 *
 * Two things are removed there, and neither of them is the contributor's card.
 *
 * 1. The marker span. Measured live at 42px: the footer only looked right while
 *    the row was suppressed because the span was the slot's only tall child, and
 *    it stayed behind for as long as a popover was open.
 * 2. The contributor's BUTTON. The capability panel's card is
 *    `<div class="skp-foot"><div class="skp-backdrop"/><div class="skp-popover"/>
 *    <button class="skp-foot-btn"/></div>`, and only that last button sits in
 *    flow — `.skp-foot` is `position: relative` with no size of its own, the
 *    backdrop is `position: fixed; inset: 0`, and so is the popover. Hiding the
 *    button therefore takes the whole bottom-left row away while leaving the
 *    open popover untouched, which is exactly what an evoke wants: the popover
 *    is what the click was for, the row it was pressed in must not come back.
 *
 * The card itself must NOT be repositioned or hidden: taking it out of flow
 * stretched the neighbouring power button (264px -> 1288px), and hiding it hides
 * the popover with it, because the popover RENDERS INSIDE the card and only its
 * `position: fixed` takes it out of the layout.
 */
export const EVOKE_CSS = `
${PANEL_ROW_SELECTOR}:has([data-dsh-railist-evoked]) {
  display: contents;
}
[${GHOST_ATTR}]:has([data-dsh-railist-evoked]) {
  display: none;
  flex: 0 0 auto;
}
[data-slot="${FOOTER_SLOT_ATTR}"]:has([data-dsh-railist-evoked]) {
  display: contents;
}
[data-slot="${FOOTER_SLOT_ATTR}"]:has([data-dsh-railist-evoked]) > span[data-dsh-railist-evoked] {
  display: none;
}
[data-slot="${FOOTER_SLOT_ATTR}"]:has([data-dsh-railist-evoked]) [class*="foot-btn"] {
  display: none;
}
`

/**
 * Keep the shell's Settings seat at the very bottom of the sidebar's foot area.
 *
 * The foot area is a column holding two children: the footer action row first
 * (shell `client.js:399-408`) and the Settings seat after it. The rail's own
 * contract is the same — the settings row belongs after every action row — but
 * another plugin that ships its own sidebar rules (dsh-power-xc injects
 * `[class$="_settingsArea"]{order:1}` / `[class$="_footerActions"]{order:2}` to
 * keep its restart button reachable when the row wraps) can invert the pair.
 * Because both rules only set `order`, the LAST one in the document wins for
 * equal values, so this one has to outrank it: a higher value plus `!important`
 * (its `order` is not important) restores the intended arrangement regardless
 * of which plugin registered its stylesheet later.
 *
 * Attribute suffixes rather than the shell's class names: the class prefix is
 * re-hashed per build, and this plugin has to keep working across shells.
 */
export const SETTINGS_SEAT_ORDER_CSS = `
[class*="_footArea"] [class$="_settingsArea"] { order: 999 !important; }
[class*="_footArea"] [class$="_footerActions"] { order: 0 !important; }
`

/** The settings navigation row's own glyph, painted as a currentColor mask. */
export function settingsNavCss(dataUri: string): string {
  return `
[role="dialog"] nav button[${SETTINGS_NAV_ATTR}] > svg:first-child {
  display: none;
}

[role="dialog"] nav button[${SETTINGS_NAV_ATTR}]::before {
  content: '';
  flex: none;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: url("${dataUri}") center / contain no-repeat;
  mask: url("${dataUri}") center / contain no-repeat;
}
`
}

/**
 * Keep the marker on the settings navigation button whose visible text is our
 * own localized section label.
 *
 * Matching by text is the only option the shell leaves open: it projects only
 * `id`, `order` and `label` from a `settings.section` registration and picks the
 * glyph from a closed list of built-in ids. The pass only ever marks our own
 * row, removes the marker on disposal, and reports failure through the
 * self-check instead of throwing.
 *
 * @param label - the section's live, locale-aware label.
 * @returns a disposer that disconnects the observer and clears every marker.
 */
export function createSettingsNavMarker(label: () => string): () => void {
  if (typeof document === 'undefined') return () => {}
  let disposed = false

  const sync = (): void => {
    if (disposed) return
    const current = label().trim()
    for (const button of document.querySelectorAll<HTMLElement>(`[role="dialog"] nav button`)) {
      if (current.length > 0 && button.textContent?.trim() === current) button.setAttribute(SETTINGS_NAV_ATTR, '')
      else button.removeAttribute(SETTINGS_NAV_ATTR)
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    disposed = true
    observer.disconnect()
    for (const element of document.querySelectorAll(`[${SETTINGS_NAV_ATTR}]`)) {
      element.removeAttribute(SETTINGS_NAV_ATTR)
    }
  }
}
