/**
 * The profile a store addresses when nothing says otherwise.
 *
 * `$DSH_PROFILE` used to be the only source, and it is not set by the launcher
 * (`dsh web --profile web` passes the profile to the boot layer, not to the
 * environment). A host that boots the `web` profile therefore resolved to
 * `default`, and — because the read path never checked that the section exists —
 * silently served whatever a stale `default` section held. The rail then
 * rearranged itself to that answer on every reload, which reads to a user as
 * "my drag was undone".
 *
 * The launcher publishes the running profile on the context as `profileContext`
 * (see `@deepseek-ai/dsh-app-boot`'s `ProfileContext`), so that is the primary
 * source; `$DSH_PROFILE` remains an override for hosts that do set it, and
 * `default` is only the last resort.
 *
 * @param profileContext - `ctx.profileContext`, when the launcher provided it.
 * @param env - environment mapping used to read `DSH_PROFILE`.
 * @returns the profile id to read and write.
 */
export function resolveProfileId(profileContext: { name?: unknown } | undefined, env: Record<string, string | undefined>): string {
  const fromContext = profileContext?.name
  if (typeof fromContext === 'string' && fromContext.trim().length > 0) return fromContext
  const fromEnv = env['DSH_PROFILE']
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return fromEnv
  return 'default'
}
