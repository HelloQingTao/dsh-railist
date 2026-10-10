/**
 * One mount per document: the guard that keeps a second `apply` (a re-evaluated
 * bundle, an HMR pass) from leaving two controllers on one ledger.
 *
 * The state is page-global on purpose, so these tests read and write the same
 * `globalThis` slot the plugin does — every mount they open is released again.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { beginExclusiveMount } from '../src/client/mount.ts'

/** Disposers opened by a test, released after it whatever the assertions did. */
const opened: Array<() => void> = []

afterEach(() => {
  for (const dispose of opened.splice(0)) dispose()
})

describe('beginExclusiveMount', () => {
  it('retires the previous mount as soon as the next one is registered', () => {
    const order: string[] = []
    const first = beginExclusiveMount()(() => { order.push('first') })
    opened.push(first)
    expect(order).toEqual([])

    const second = beginExclusiveMount()(() => { order.push('second') })
    opened.push(second)
    // The replacement tears the old mount down during its own registration.
    expect(order).toEqual(['first'])

    second()
    expect(order).toEqual(['first', 'second'])
  })

  it('never runs a teardown twice, however late the shell calls the disposer', () => {
    const order: string[] = []
    const first = beginExclusiveMount()(() => { order.push('first') })
    const second = beginExclusiveMount()(() => { order.push('second') })
    opened.push(second)

    first()
    first()
    expect(order).toEqual(['first'])
    second()
    second()
    expect(order).toEqual(['first', 'second'])
  })

  it('a retired mount’s disposer does not release its successor', () => {
    const order: string[] = []
    const first = beginExclusiveMount()(() => { order.push('first') })
    const second = beginExclusiveMount()(() => { order.push('second') })
    opened.push(second)

    // The shell calls the retired mount's disposer after the replacement is up.
    first()
    const third = beginExclusiveMount()(() => { order.push('third') })
    opened.push(third)
    // The stale call released nothing: `second` was still the live mount, so the
    // third registration is what retired it — exactly once.
    expect(order).toEqual(['first', 'second'])
    second()
    expect(order).toEqual(['first', 'second'])
    third()
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('contains a teardown that throws, so the replacement still mounts', () => {
    const order: string[] = []
    // The throwing mount is retired by the next registration, not by its own
    // disposer: that is the path the guard has to survive.
    beginExclusiveMount()(() => { throw new Error('boom') })
    const second = beginExclusiveMount()(() => { order.push('second') })
    opened.push(second)
    second()
    expect(order).toEqual(['second'])
  })
})
