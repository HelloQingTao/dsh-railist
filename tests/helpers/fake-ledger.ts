/**
 * A faithful-enough fake of the shell's slot ledger.
 *
 * It reproduces the three properties the rewrite pass depends on and that
 * docs/ARCHITECTURE.md recorded as verified facts:
 *   - `register()` copies the options into a FRESH object and stores it plainly
 *     (never frozen), and `entries`/`entriesOfSlot` hand that stored object back;
 *   - a raw field write on a stored entry bumps no version and notifies nobody;
 *   - `register`/dispose mutate the ledger, which bumps the version and notifies
 *     subscribers — that is exactly what the nudge relies on.
 */
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

/** One registration as the fake ledger stores it. */
export interface FakeRegistration {
  entry: StoredEntry
  /** Options object identity check: the ledger must copy, never alias. */
  optionsSnapshot: Record<string, unknown>
}

export class FakeLedger {
  private readonly slots = new Map<string, StoredEntry[]>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private version = 0
  /** Every register/dispose pair the nudge produced, for assertions. */
  readonly mutations: string[] = []

  /** Declare a slot (the shell's `register` throws for an undeclared one). */
  declare(name: string): void {
    if (!this.slots.has(name)) this.slots.set(name, [])
  }

  /** Whether a slot is declared. */
  declared(name: string): boolean {
    return this.slots.has(name)
  }

  register(options: Record<string, unknown>, component: unknown): () => void {
    const name = options['name']
    if (typeof name !== 'string' || !this.slots.has(name)) {
      throw new Error(`registering into an undeclared slot: ${String(name)}`)
    }
    const copied = { ...options }
    const entry: StoredEntry = { component, options: copied as StoredEntry['options'] }
    const list = this.slots.get(name) as StoredEntry[]
    if (list.some(existing => existing.options.id !== undefined && existing.options.id === copied['id'])) {
      throw new Error(`same id + same priority: ${String(copied['id'])}`)
    }
    list.push(entry)
    this.bump(name)
    let live = true
    return () => {
      if (!live) return
      live = false
      const current = this.slots.get(name) as StoredEntry[]
      const index = current.indexOf(entry)
      if (index >= 0) current.splice(index, 1)
      this.bump(name)
    }
  }

  entries(name: string): readonly StoredEntry[] {
    return this.slots.get(name) ?? []
  }

  /** Shadowing winners: for a `list` slot, the first entry per id. */
  entriesOfSlot(name: string): readonly StoredEntry[] {
    const seen = new Set<unknown>()
    const winners: StoredEntry[] = []
    for (const entry of this.slots.get(name) ?? []) {
      const id = entry.options.id ?? entry.options.key
      if (seen.has(id)) continue
      seen.add(id)
      winners.push(entry)
    }
    return winners
  }

  subscribe(name: string, listener: () => void): () => void {
    const set = this.listeners.get(name) ?? new Set<() => void>()
    set.add(listener)
    this.listeners.set(name, set)
    return () => { set.delete(listener) }
  }

  getVersion(): number {
    return this.version
  }

  subscribeDeclaration(name: string, listener: () => void): () => void {
    return this.subscribe(name, listener)
  }

  /** `inject` on an already-declared slot runs the effect immediately. */
  inject(name: string, callback: () => (() => void) | Iterable<() => void>): () => void {
    if (!this.slots.has(name)) return () => {}
    const produced = callback()
    if (typeof produced === 'function') return produced
    return () => {
      for (const dispose of produced) dispose()
    }
  }

  /** The current ledger version (the nudge must have moved it). */
  get currentVersion(): number {
    return this.version
  }

  /** Count the entries of a slot, own rows included. */
  count(name: string): number {
    return (this.slots.get(name) ?? []).length
  }

  private bump(name: string): void {
    this.version += 1
    this.mutations.push(name)
    for (const listener of this.listeners.get(name) ?? []) listener()
  }
}

/** A `ctx`-shaped object carrying only what the rail adapter touches. */
export function fakeContext(ledger: FakeLedger, layout?: {
  activePanelId?: string | null
  selectPanel?: (id: unknown) => void
}): unknown {
  const panelInfo = {
    getSnapshot: () => ({ activePanelId: layout?.activePanelId ?? null }),
    subscribe: () => () => {},
  }
  return {
    slots: ledger,
    get: (name: string) => {
      if (name === 'layout') {
        return {
          panelInfo,
          selectPanel: (id: unknown) => { layout?.selectPanel?.(id) },
        }
      }
      return undefined
    },
  }
}
