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
 * The mask is the built-in `list` glyph at the glyph set's own 16px edge and
 * 1.3px weight — the weight and size the shell's nav icons use
 * (`dsh-client-ui-settings-general` renders `Icon*OutlineMedium` at `size: 16`),
 * so ours sits in that column like a shipped one.
 */

/** Marker attribute for the settings navigation row (see {@link createSettingsNavMarker}). */
export const SETTINGS_NAV_ATTR = 'data-dsh-panellist-settings-nav'

/**
 * The selector for one rail row, in the ONE place.
 *
 * Both users of it matter equally: the hide rule below needs exactly this shape
 * (a direct child of the panel list), and the self-check has to measure the same
 * thing the rule matches. Two copies drifted apart the moment the shell re-rolled
 * its class hash, so there is one string, and `rail/probe.ts` imports it.
 */
export const PANEL_ROW_SELECTOR = 'nav[class*="_panelList"] > button[class*="_panelRow"]'

/**
 * Row hiding. `hidden` = "hide unless this panel is selected"; `suppressed` =
 * "always hide, it is shown inside a group instead". Both markers are rendered
 * by the glyph wrapper in `registry/rail.ts`.
 *
 * The group-active highlight is NOT here: it belongs to the group unit, whose
 * rule also carries the row's theme token (`groups/groups.css.ts`).
 */
export const HIDE_CSS = `
${PANEL_ROW_SELECTOR}:has([data-dsh-panellist-hidden]),
${PANEL_ROW_SELECTOR}:has([data-dsh-panellist-suppressed]) {
  display: none;
}
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
