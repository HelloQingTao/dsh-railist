/**
 * The translator's notification contract.
 *
 * This is a regression test for a live runaway loop. The shell's locale service
 * publishes on every `register`, not only when the language moves — measured on
 * a real page as a `LocaleRuntime.publish` firing continuously. A translator
 * that forwarded each of those publishes made the plugin's own recompute loop
 * never settle: the recompute writes rows, the shell registers another locale
 * contribution, which publishes again, which schedules another recompute. The
 * page logged `recomputation did not settle after 60 passes` ten thousand times.
 *
 * `translate.subscribe` therefore has to mean "the language moved", which is the
 * only thing a listener can act on. These cases pin that meaning down.
 */
import { describe, expect, it } from 'vitest'
import { createTranslator, type LocaleLike } from '../src/client/i18n/index.ts'

/** A locale service whose active language can be moved, and which publishes on demand. */
function localeService(active: string): { service: LocaleLike; publish: () => void; set: (next: string) => void } {
  const listeners = new Set<() => void>()
  let current = active
  return {
    service: {
      getLocale: () => ({ active: current }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    publish: () => { for (const listener of [...listeners]) listener() },
    set: (next: string) => { current = next },
  }
}

describe('translator notifications', () => {
  it('does not notify when the service publishes the same language again', () => {
    const { service, publish } = localeService('zh-CN')
    const translate = createTranslator(service)
    let notified = 0
    translate.subscribe(() => { notified += 1 })

    // The live failure mode: a publish that carries no language change.
    for (let round = 0; round < 50; round += 1) publish()

    expect(notified).toBe(0)
  })

  it('notifies once when the language actually moves', () => {
    const { service, publish, set } = localeService('zh-CN')
    const translate = createTranslator(service)
    let notified = 0
    translate.subscribe(() => { notified += 1 })

    publish()
    expect(notified).toBe(0)

    set('en-US')
    publish()
    expect(notified).toBe(1)

    // A second publish at the new language is not news either.
    publish()
    expect(notified).toBe(1)
  })

  it('notifies when a late-bound service reports a different language', () => {
    const translate = createTranslator(undefined)
    let notified = 0
    translate.subscribe(() => { notified += 1 })

    const { service } = localeService('zh-CN')
    // `attach` announces the language the service brings; the browser default
    // resolved to `en`, so a Chinese service is a real change.
    translate.attach(service)

    expect(notified).toBe(1)
    expect(translate.lang()).toBe('zh')
  })

  it('treats two locale ids of the same language as unchanged', () => {
    const { service, publish, set } = localeService('zh-CN')
    const translate = createTranslator(service)
    let notified = 0
    translate.subscribe(() => { notified += 1 })

    // `zh-CN` → `zh-TW` is the same dictionary: a listener would redraw identical
    // copy, which is exactly the kind of write that must not schedule work.
    set('zh-TW')
    publish()

    expect(notified).toBe(0)
    expect(translate.lang()).toBe('zh')
  })
})
