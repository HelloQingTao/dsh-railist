/**
 * Discovery aid for shell-drawn rail buttons.
 *
 * Ordinary entries register a `sidebar.panellist` / `sidebar.footer.action`
 * slot and are managed automatically. The few the shell draws straight into
 * `nav.panelList` (its "More" launcher today) are described one-by-one in
 * `adapters.ts`. If a shell upgrade adds another such button, it appears in the
 * rail but has no adapter, so it cannot be ordered / hidden / grouped — and the
 * hide rule even parks it out of sight. This module surfaces those leftovers so
 * the fix is "add one line", not "notice something is missing".
 *
 * It only READS the DOM and returns plain data; it never adopts anything at
 * runtime (adoption is a one-line source edit, by design — see README).
 */
import { MORE_HOST_BUTTON_SELECTOR, GROUP_MARKER_SELECTOR } from '../rail/css.ts'
import { ROW_ATTR } from '../rail/dom.ts'
import { HOST_ROW_ADAPTERS } from './adapters.ts'

/** One shell-drawn button that no adapter covers yet. */
export interface DiscoveredHostRow {
  /** Visible button text, trimmed (display only). */
  label: string
  /** Suggested rail id for the new declaration. */
  suggestedId: string
  /** A ready-to-paste one-line declaration for `adapters.ts`. */
  snippet: string
}

/**
 * Every shell-drawn rail button matching the generic wild shape, minus
 * railist's own rows (proxy rows carry `ROW_ATTR`; group triggers wrap a group
 * marker) — those are already managed.
 */
function wildButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(MORE_HOST_BUTTON_SELECTOR))
    .filter(button => !button.hasAttribute(ROW_ATTR))
    .filter(button => button.querySelector(GROUP_MARKER_SELECTOR) === null)
}

/**
 * The buttons the declared adapters already forward to. Each adapter claims the
 * first still-unclaimed wild button its selector matches — the same "first
 * match wins" rule `findHostButton()` uses, so the two never disagree.
 */
function claimedButtons(): Set<HTMLButtonElement> {
  const claimed = new Set<HTMLButtonElement>()
  for (const adapter of HOST_ROW_ADAPTERS) {
    const button = wildButtons().find(
      candidate => !claimed.has(candidate) && candidate.matches(adapter.hostSelector),
    )
    if (button !== undefined) claimed.add(button)
  }
  return claimed
}

/** One compact declaration line, ready to paste into HOST_ROW_ADAPTERS. */
function makeSnippet(id: string, label: string): string {
  const literal = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return (
    `{ id: '${id}', label: '${literal}', icon: 'grid', order: 100000, ` +
    `hostSelector: '${MORE_HOST_BUTTON_SELECTOR}' },`
  )
}

/**
 * Describe every shell-drawn rail button that no adapter covers yet. Returns an
 * empty array when the rail is not mounted or everything is already managed.
 */
export function discoverHostRows(): DiscoveredHostRow[] {
  const claimed = claimedButtons()
  return wildButtons()
    .filter(button => !claimed.has(button))
    .map((button, index) => {
      const label = (button.textContent ?? '').trim() || `#${index + 1}`
      const suggestedId = `dsh-railist-host-${index + 1}`
      return { label, suggestedId, snippet: makeSnippet(suggestedId, label) }
    })
}
