/**
 * One live mount per document.
 *
 * The shell is allowed to apply a client plugin more than once on the same
 * page: it re-evaluates a bundle whose file changed on disk, an HMR pass
 * re-applies it, and a shell that treats every load as a fresh fibre will run
 * `apply` again without disposing the first one. Two controllers over one
 * ledger do not merely waste work — they fight over the same entries: the
 * second one captures the first one's glyph wrappers as if the contributors
 * had installed them (that is what blanked every group-member icon in the
 * settings page), and both write `order`/`label`/`component` on every pass.
 *
 * The bookkeeping therefore lives on `globalThis`, not in module scope: a
 * re-evaluated bundle gets fresh module state, and the only witness of the
 * mount it is about to replace is the page itself.
 */

/** Page-global slot holding the live mount. */
const ACTIVE_MOUNT_KEY = '__dshPanellistActiveMount'

interface Mount {
  /** The owner's teardown, called at most once. */
  dispose: () => void
  /** False once this mount was retired or released. */
  live: boolean
}

function scope(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>
}

/** Release one mount, exactly once, containing a teardown that throws. */
function release(mount: Mount): void {
  if (!mount.live) return
  mount.live = false
  const store = scope()
  if (store[ACTIVE_MOUNT_KEY] === mount) delete store[ACTIVE_MOUNT_KEY]
  try {
    mount.dispose()
  } catch {
    // A teardown that throws must not stop the replacement from mounting.
  }
}

/** Release the live mount, if any. */
function retireActiveMount(): void {
  const previous = scope()[ACTIVE_MOUNT_KEY] as Mount | undefined
  if (previous !== undefined) release(previous)
}

/**
 * Retire the previous mount and return the registrar for this one.
 *
 * Call the returned function once the new mount is built; the disposer it
 * returns is what `apply` hands back to the shell. Every disposer here is
 * idempotent, and a late one from a retired mount releases nothing: it is a
 * no-op rather than a second teardown.
 *
 * @returns `register(dispose)` for the mount being built.
 */
export function beginExclusiveMount(): (dispose: () => void) => () => void {
  retireActiveMount()
  return (dispose) => {
    const mount: Mount = { dispose, live: true }
    scope()[ACTIVE_MOUNT_KEY] = mount
    return () => { release(mount) }
  }
}
