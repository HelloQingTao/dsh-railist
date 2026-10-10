/**
 * Type-only imports that make the browser half's `ctx` surface visible:
 * `ctx.slots` (ui-renderer), `ctx.layout` (ui-layout), the `sidebar.panellist`
 * / `settings.section` slot declarations, and the optional locale service.
 *
 * Importing this module (even for a type) is what merges those declarations, so
 * every client module that touches `ctx` starts with
 * `import type { ClientContext } from './ctx.ts'`.
 *
 * No value import of a `@deepseek-ai/*` package appears here: the client bundle
 * may only take react / cordis / ui-primitives from the loader's module table
 * (enforced by `purityGate` in `tsdown.config.ts`).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** The browser-half root context, with every declaration above merged in. */
export type ClientContext = Context

export type { Context }
