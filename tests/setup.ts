/**
 * jsdom setup shared by every spec.
 *
 * jsdom ships no `CSS.supports`, no `matchMedia` and no `ResizeObserver`, all of
 * which the rail probe and the flyout touch. The shims are deliberately
 * *neutral* (they report "no support") so a spec that needs the positive path
 * must opt in explicitly with the helper below — a probe that silently passes
 * because of a fixture would defeat the point of the probe.
 */

if (typeof CSS === 'undefined') {
  Object.defineProperty(globalThis, 'CSS', {
    value: { supports: () => false },
    writable: true,
    configurable: true,
  })
} else if (typeof CSS.supports !== 'function') {
  Object.defineProperty(CSS, 'supports', { value: () => false, writable: true, configurable: true })
}

/**
 * jsdom ships no `CSS.escape` either, and the evoke path uses it to build the
 * `[data-dsh-railist-evoked="<id>"]` selector. Rail ids are registration ids
 * (`power`, `capability-panel`), so escaping everything outside the ident
 * charset is enough for the specs.
 */
if (typeof CSS.escape !== 'function') {
  Object.defineProperty(CSS, 'escape', {
    value: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`),
    writable: true,
    configurable: true,
  })
}

if (typeof window !== 'undefined' && !('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, writable: true })
}

/** Make `CSS.supports` answer `true` for selector support (rail probe). */
export function enableHasSelectorSupport(): void {
  Object.defineProperty(CSS, 'supports', { value: () => true, writable: true, configurable: true })
}

/** Make `CSS.supports` answer `false` again. */
export function disableHasSelectorSupport(): void {
  Object.defineProperty(CSS, 'supports', { value: () => false, writable: true, configurable: true })
}
