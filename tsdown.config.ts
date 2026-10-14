/**
 * dsh-railist build.
 *
 * Two artefacts:
 * - `lib/index.js`   — the node half (config store, migration, loopback route),
 *                      built from `src/index.ts`.
 * - `lib/client.js`  — the browser half, wrapped in the dsh module-loader
 *                      protocol (`window.__ModuleLoader__.load`), built from
 *                      `src/client/index.tsx`.
 *
 * Mirrors the shape proven by `dsh-genui` / the dsh repo's client preset: the
 * browser bundle may only leave the loader-supplied seed rows external
 * (react family, cordis, ui-primitives) because cross-plugin value imports are
 * forbidden on the client side — the purity gate below enforces that at build
 * time instead of at runtime.
 */
import type { UserConfig } from 'tsdown'

const ID = 'dsh-railist'

/** Module-table entries this bundle may leave external: platform seed rows
 *  (react family, cordis, ui-primitives) answered by the loader's require. */
const EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** Client-side purity gate: only the seed rows are importable as values. */
function purityGate(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the module table (EXTERNALS) — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services '
        + '(use `import type` for types)',
      )
    },
  }
}

const nodeConfig: UserConfig = {
  name: ID,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: '[name].js' },
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  minify: true,
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...EXTERNALS],
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [purityGate()],
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [nodeConfig, clientConfig]
