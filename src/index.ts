/**
 * Node-half entry (`package.json#main` → `lib/index.js`).
 *
 * The host loader mounts the module exports as a cordis plugin object, so the
 * bundle's root export surface IS the plugin: `name`, `inject`, `apply`.
 */
export * from './plugin/index.ts'
