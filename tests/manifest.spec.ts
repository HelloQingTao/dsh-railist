/**
 * The packaging contract, checked instead of trusted.
 *
 * Three separate files have to agree for the loader to mount this plugin, and
 * two of them are read at RUNTIME from the published tarball (the schema the
 * host validates with, the patch layer that mounts the row). A rename that
 * updates one of them and not the others fails only in a real DSH window, which
 * is exactly the failure this spec exists to prevent.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { describe, expect, it } from 'vitest'
import { name as pluginName } from '../src/plugin/index.ts'
import { SCHEMA_VERSION } from '../src/shared/config.ts'
import { API_PREFIX } from '../src/shared/protocol.ts'
import { ROUTE_REGISTRATION } from '../src/plugin/routes.ts'

const root = process.cwd()
const manifest: {
  name: string
  type: string
  main: string
  types: string
  exports: Record<string, { types?: string; default?: string }>
  files: string[]
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  scripts: Record<string, string>
  dsh: {
    bundle: { patch: string }
    client: { inject: string[]; platform: string }
  }
  engines: Record<string, string>
} = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

/** One mounted row of the patch layer. */
interface PatchRow {
  id?: unknown
  name?: unknown
  disabled?: unknown
}

/** One patch list entry: a single `insert:` key holding the rows to add. */
interface PatchLayer {
  insert?: PatchRow[]
}

const patchLayers: PatchLayer[] = parseYaml(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')) as PatchLayer[]
const patchRows: PatchRow[] = patchLayers.flatMap(layer => layer.insert ?? [])

describe('package manifest', () => {
  it('names the plugin exactly as the host half exports it', () => {
    // The loader resolves this plugin by the name in the patch layer, and the
    // module's `name` export is what the loader records on the entry.
    expect(pluginName).toBe(manifest.name)
  })

  it('is an ESM package whose declared entry points are where the build writes', () => {
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.types).toBe('lib/types/plugin/index.d.ts')
    expect(manifest.exports['.']?.default).toBe('./lib/index.js')
    expect(manifest.exports['./client']?.default).toBe('./lib/client.js')
    expect(manifest.exports['.']?.types).toBe('./lib/types/plugin/index.d.ts')
    expect(manifest.exports['./client']?.types).toBe('./lib/types/client/index.d.ts')
  })

  it('ships every file the two halves read from the tarball at runtime', () => {
    // The host reads the schema next to its own module; the loader reads the
    // patch layer; the README pair is the documented behaviour contract.
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    for (const required of ['lib/types', 'cordis.patch.yml', 'docs/config.schema.json', 'README.md', 'README.zh-CN.md']) {
      expect(manifest.files, `files must include ${required}`).toContain(required)
    }
    expect(existsSync(resolve(root, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(resolve(root, 'docs/config.schema.json'))).toBe(true)
  })

  it('mounts exactly one enabled row, under a reserved entry id', () => {
    // The shipped patch format: a top-level list of layers, each layer an
    // `insert:` list of composition rows (see dsh-genui / dsh-better-sidebar).
    expect(patchLayers).toHaveLength(1)
    expect(patchRows).toHaveLength(1)
    const row = patchRows[0]
    expect(row?.name).toBe(manifest.name)
    // `panellist` is the composition-level row id (the docs and the health
    // report both refer to it); the plugin's own name stays the package name.
    expect(row?.id).toBe('panellist')
    expect(row?.disabled).toBeUndefined()
  })

  it('keeps the browser half loadable: a web platform plus the bundles it needs first', () => {
    expect(manifest.dsh.client.platform).toBe('web')
    // Ordering matters for the locale service: this plugin binds it when it
    // arrives, but declaring it keeps the settings page in the user's language
    // from the first paint.
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-locale')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-client-ui-slots')
  })

  it('declares the node half runtime dependencies and nothing else', () => {
    // Only the schema validator is a runtime dependency; everything else the
    // two halves touch is provided by the host (peer) or bundled.
    expect(Object.keys(manifest.dependencies).sort()).toEqual(['ajv', 'ajv-formats'])
  })

  it('pins the DSH engine family it was verified against', () => {
    expect(manifest.engines['dsh']).toBe('>=0.2.0-rc.2 <0.3.0-0')
    expect(manifest.engines['node']).toContain('>=24.0.0')
  })

  it('exposes the quality gate the README documents', () => {
    for (const script of ['build', 'typecheck', 'test', 'check']) {
      expect(typeof manifest.scripts[script], script).toBe('string')
    }
    expect(manifest.scripts['check']).toContain('tsc')
    expect(manifest.scripts['check']).toContain('vitest')
    expect(manifest.scripts['check']).toContain('tsdown')
  })
})

describe('runtime file contracts', () => {
  it('keeps the schema version and the route prefix single-sourced', () => {
    const schema: { properties: { schemaVersion: { const: number } } } =
      JSON.parse(readFileSync(resolve(root, 'docs/config.schema.json'), 'utf8'))
    expect(schema.properties.schemaVersion.const).toBe(SCHEMA_VERSION)
    expect(API_PREFIX).toBe('/panellist/api')
    // The prefix the browser half calls, the registration the host half makes and
    // the description `plugin/index.ts` gives the loader are one value.
    expect(ROUTE_REGISTRATION.path).toBe(API_PREFIX)
    expect(ROUTE_REGISTRATION.kind).toBe('prefix')
    expect(readFileSync(resolve(root, 'src/plugin/index.ts'), 'utf8')).toContain('ROUTE_REGISTRATION')
  })
})
