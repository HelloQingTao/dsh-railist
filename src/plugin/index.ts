/**
 * dsh-railist, host half.
 *
 * `package.json#main` points at `lib/index.js`, which re-exports this module:
 * the host loader mounts the module's export surface as a cordis plugin, so
 * `name` / `inject` / `apply` *are* the plugin (README §4.3).
 *
 * The half owns three things and nothing else: the configuration file, the
 * loopback route that reads and writes it, and the health report the settings
 * page shows. The rail itself belongs to the browser half.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApiHandler, ROUTE_REGISTRATION, type ApiHandlerOptions } from './routes.ts'
import { RailistStore } from './store.ts'

/** Plugin id the composition mounts this module as (`cordis.patch.yml`). */
export const name = 'dsh-railist'

/**
 * No hard service requirements.
 *
 * The store is useful without a webserver, so `webServer` is deliberately not
 * an `inject` entry: a hard requirement would keep this plugin unloaded (and
 * its configuration unreachable) on a host that has none. The route instead
 * lives in a dependency fiber that starts, stops and restarts with the
 * service (see {@link apply}).
 */
export const inject: string[] = []

/** Configuration the host may pass to {@link apply}. */
export interface RailistPluginConfig {
  /** Override the harness home (defaults to `$DSH_HOME`, else `~/.dsh`). */
  home?: string
  /** Override the profile section this half reads and writes (defaults to `$DSH_PROFILE`, else `default`). */
  profileId?: string
  /** Side-effect overrides; production hosts pass nothing. */
  routes?: ApiHandlerOptions
}

/**
 * The slice of the webserver service this plugin registers through.
 */
interface WebServerLike {
  register(route: {
    kind: 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Wire the store and the route.
 *
 * `webServer` is optional at apply time, so the registration runs inside
 * `ctx.inject(['webServer'], …)` and is wrapped in `ctx.effect` — the service
 * may be provided later, replaced, or withdrawn on a reload, and the route
 * follows it either way.
 * @param ctx - cordis context of this plugin.
 * @param config - optional home/profile/route overrides.
 */
export function apply(ctx: Context, config?: RailistPluginConfig): void {
  // The launcher publishes the running profile here (see
  // `@deepseek-ai/dsh-app-boot`'s `ProfileContext`). Reading it is what keeps a
  // host booted as `--profile web` from addressing a `default` section that was
  // never its own — the failure that made every reload undo the user's drags.
  const profileContext = (ctx as Context & { profileContext?: { name?: unknown } }).profileContext
  const store = new RailistStore({
    home: config?.home,
    profileId: config?.profileId,
    profileContext,
  })
  const handler = createApiHandler(store, config?.routes)

  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.reflect.get('webServer') as WebServerLike
    webCtx.effect(
      () => webServer.register({ ...ROUTE_REGISTRATION, handler }),
      'dsh-railist: loopback api route',
    )
  })
}
