/**
 * The declarative adapter table for shell-drawn sidebar buttons.
 *
 * Most rail rows arrive through `sidebar.panellist` / `sidebar.footer.action`
 * and are picked up automatically — adding one of those needs no code at all.
 * A few buttons, however, are appended straight into `nav.panelList` by the
 * shell and never register a slot entry, so the sequence editor cannot see
 * them. Each is described here by ONE declaration: a stable id, a label, an
 * icon and a `:has()`-free selector that locates the real button.
 *
 * `more/index.ts` walks this table and does the rest (inject a proxy slot row,
 * hide the shell button, forward clicks). To adopt a future wild button, add
 * one line here and rebuild — no new unit, no new CSS, no config shape change.
 *
 * The label is either a plugin i18n key (`labelKey`, bilingual) or a plain
 * `label` string. Generated "adopt" snippets use `label` so they compile and
 * display correctly the moment they are pasted, without adding a dictionary
 * entry first; switch to `labelKey` later if bilingual copy is wanted.
 */
import { MORE_ROW_ID, type BuiltinIconName } from '../../shared/config.ts'
import type { I18nKey, Translator } from '../i18n/index.ts'
import { MORE_HOST_BUTTON_SELECTOR } from '../rail/css.ts'

// Single source of truth lives in `rail/css.ts`; re-exported so the generic
// unit and the discovery unit share exactly the same selector definitions.
export {
  GROUP_MARKER_SELECTOR,
  HOST_ROW_HIDE_SUFFIX,
  MORE_HOST_BUTTON_SELECTOR,
} from '../rail/css.ts'

/** One shell-drawn button turned into an ordinary rail row. */
export interface HostRowAdapter {
  /** Stable rail id. Must NOT start with `dsh-railist:` (see `isOwnRailId`). */
  id: string
  /** Bilingual label via the plugin dictionary. */
  labelKey?: I18nKey
  /** Literal label (takes precedence over `labelKey`); used by pasted snippets. */
  label?: string
  /** Built-in glyph drawn on the proxy row. */
  icon: BuiltinIconName
  /** Native order. The shell appends these last, so a large value starts last. */
  order: number
  /** `:has()`-free selector locating the real button (JS scan + CSS hide base). */
  hostSelector: string
}

/**
 * The built-in declarations. Currently just the shell's "More" launcher.
 *
 * Adding a line here is the whole "adopt a new wild button" workflow. Keep the
 * `hostSelector` unique per row and free of `:has()`; `hostRowsHideCss()` in
 * `rail/css.ts` adds the group-row exclusion automatically.
 */
export const HOST_ROW_ADAPTERS: readonly HostRowAdapter[] = [
  {
    id: MORE_ROW_ID,
    labelKey: 'rail.more.label',
    icon: 'grid',
    order: 100000,
    hostSelector: MORE_HOST_BUTTON_SELECTOR,
  },
]

/** Resolve what the proxy row's accessible label should read. */
export function resolveLabel(adapter: HostRowAdapter, translate: Translator): string {
  if (adapter.label !== undefined && adapter.label !== '') return adapter.label
  if (adapter.labelKey !== undefined) return translate.t(adapter.labelKey)
  return adapter.id
}
