/**
 * One injected stylesheet for the whole plugin.
 *
 * Every unit contributes its own CSS chunk under a stable id; the registry
 * concatenates them into a single `<style data-plugin-css="dsh-panellist">`
 * element and re-renders it whenever a chunk changes. Adopting the element by a
 * document id (rather than a module-scope flag) keeps a re-evaluated bundle
 * under HMR from producing a second copy — a lesson recorded by `dsh-dream-skin`.
 *
 * The element carries no `media`/`layer` so order is the registration order,
 * which the units fix by registering at construction time.
 */

/** Aggregated style registry (see the module doc). */
export interface StyleRegistry {
  /** Add or replace one chunk. Idempotent by id. */
  register(id: string, css: string): void
  /** Re-render the `<style>` element (called after registration and on mount). */
  refresh(): void
  /** Remove the element and forget every chunk (plugin unload). */
  dispose(): void
}

const STYLE_ID = 'dsh-panellist'
const ELEMENT_ID = 'dsh-panellist-styles'

/** Create the registry. Safe to call before `document` exists (tests, SSR probe). */
export function createStyleRegistry(): StyleRegistry {
  const chunks = new Map<string, string>()
  const ensureElement = (): HTMLStyleElement | null => {
    if (typeof document === 'undefined') return null
    const existing = document.getElementById(ELEMENT_ID)
    if (existing instanceof HTMLStyleElement) return existing
    const element = document.createElement('style')
    element.id = ELEMENT_ID
    element.dataset['pluginCss'] = STYLE_ID
    document.head.appendChild(element)
    return element
  }
  return {
    register: (id, css) => {
      chunks.set(id, css)
      const element = ensureElement()
      if (element !== null) element.textContent = [...chunks.values()].join('\n')
    },
    refresh: () => {
      const element = ensureElement()
      if (element !== null) element.textContent = [...chunks.values()].join('\n')
    },
    dispose: () => {
      chunks.clear()
      if (typeof document === 'undefined') return
      document.getElementById(ELEMENT_ID)?.remove()
    },
  }
}
