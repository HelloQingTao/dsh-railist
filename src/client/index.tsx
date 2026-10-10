/**
 * dsh-panellist, browser half.
 *
 * Boot order matters exactly once: the stylesheet and the first plan
 * computation must exist before the self-check registers its throwaway probe
 * rows, otherwise the probe row (which the stylesheet hides) would be visible
 * for a frame and probe 2 would count a row the plan does not know about.
 *
 * @module dsh-panellist/client
 */
import { BUILTIN_ICON_NAMES } from '../shared/config.ts'
import type { ClientContext } from './ctx.ts'
import { createPanellistStore } from './config/store.ts'
import { createController, type PanellistController } from './controller.ts'
import { createTranslator, type LocaleLike, type Translator } from './i18n/index.ts'
import { BuiltinGlyph, Glyph, glyphDataUri, sanitizeSvg } from './icons/index.tsx'
import { beginExclusiveMount } from './mount.ts'
import { optionalService } from './service.ts'
import { createStyleRegistry } from './styles.ts'

/** Services this half cannot work without: the rail IS the feature. */
export const inject = ['slots']

/** Structural logger: the client context always ships one, but tests may not. */
interface Logger {
  info(message: string): void
  warn(message: string): void
}

function loggerOf(ctx: ClientContext): Logger {
  const candidate = optionalService<Partial<Logger>>(ctx, 'logger')
  return {
    info: (message) => candidate?.info?.(message) ?? console.info(message),
    warn: (message) => candidate?.warn?.(message) ?? console.warn(message),
  }
}

/**
 * Mount the plugin.
 * @param ctx - the browser-half root context.
 * @returns the disposer that restores every shell entry this plugin touched.
 */
export function apply(ctx: ClientContext): () => void {
  // The shell may apply this bundle twice on one page (a re-evaluated bundle, an
  // HMR pass). Retire the previous mount BEFORE building this one: two
  // controllers over one ledger fight over the same entries, and the second one
  // cannot tell this plugin's own glyph wrappers from the contributors'
  // components (see registry/rail.tsx and mount.ts).
  const registerMount = beginExclusiveMount()
  const log = loggerOf(ctx)
  const translate: Translator = createTranslator(optionalService<LocaleLike>(ctx, 'locale'))
  const styles = createStyleRegistry()
  const store = createPanellistStore()
  const controller: PanellistController = createController({
    ctx,
    store,
    translate,
    styles,
    glyph: Glyph,
    builtinNames: BUILTIN_ICON_NAMES,
    sanitizeSvg,
  })
  styles.refresh()
  controller.refresh()
  log.info('[dsh-panellist] client active')

  // The locale service may be provided by a bundle that mounts after this one.
  // Declaring it in `inject` would park this fiber until it exists (a shell
  // without it would never load the plugin at all), so it is bound when it
  // arrives instead — the page follows a late language bundle without a reload.
  ctx.inject(['locale'], (scope) => {
    const service = scope.get('locale') as LocaleLike | undefined
    if (service !== undefined) translate.attach(service)
  })

  void store.load().then(() => {
    controller.refresh()
    const snapshot = store.getSnapshot()
    if (snapshot.status === 'error') {
      log.warn(`[dsh-panellist] configuration is unavailable: ${snapshot.error ?? 'unknown reason'}`)
    }
  })

  // The probes measure the shell asynchronously (probe 3 needs two frames), so
  // the plan is refreshed once their verdict changes the degradation state.
  void controller.selfCheck.rerun().then(() => {
    controller.refresh()
    const state = controller.selfCheck.getState()
    if (state.degraded) {
      const failed = state.results.filter(result => !result.ok).map(result => result.id).join(', ')
      log.warn(`[dsh-panellist] degraded (failed checks: ${failed}); DSH ${state.version || 'unknown'}`)
    }
  })

  return registerMount(() => {
    controller.dispose()
    store.dispose()
    translate.dispose()
  })
}

export { BuiltinGlyph, Glyph, glyphDataUri, sanitizeSvg }
