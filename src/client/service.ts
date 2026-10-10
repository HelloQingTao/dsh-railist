/**
 * Cordis service access that tolerates absence.
 *
 * `ctx.get` throws for an undeclared service on some cords versions and returns
 * `undefined` on others; every optional collaborator this plugin uses (the
 * locale service, the layout service) goes through here so a shell that ships
 * neither still loads and degrades instead of parking the fiber forever.
 */
import type { ClientContext } from './ctx.ts'

/** Read an optional service, or `undefined` when it is absent. */
export function optionalService<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    return ctx.get(name) as T | undefined
  } catch {
    return undefined
  }
}
