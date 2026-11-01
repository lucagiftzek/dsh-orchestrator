/**
 * Build the browser half of dsh-orchestrator.
 *
 * Output shape is the web boot factory the client-module system materializes
 * at /plugins/<id>/client.js:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 *
 * Same pattern as the dsh-artifacts client build. The node half (lib/*.js) is
 * hand-written ESM and needs no build.
 *
 * esbuild: this plugin keeps no node_modules of its own, so the bundler is
 * taken from a sibling plugin that already has it. Offline and deterministic.
 * Override with ESBUILD_MAIN.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ID = 'dsh-orchestrator'

/** Platform seed words the shell shares into the module table. */
const CLIENT_EXTERNALS = ['react']

async function loadEsbuild() {
  const candidates = [
    process.env.ESBUILD_MAIN,
    // local devDependency first (self-sufficient checkout), then whatever
    // esbuild the module resolver finds
    new URL('../node_modules/esbuild/lib/main.js', import.meta.url).pathname,
    'esbuild',
  ].filter(Boolean)
  for (const c of candidates) {
    try { return await import(c) } catch { /* next */ }
  }
  throw new Error('esbuild not resolvable. Set ESBUILD_MAIN=/path/to/esbuild/lib/main.js')
}

const { build } = await loadEsbuild()

await build({
  entryPoints: [resolve(ROOT, 'src/client.jsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  outfile: resolve(ROOT, 'lib/client.js'),
  sourcemap: true,
  external: CLIENT_EXTERNALS,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  banner: { js: 'window.__ModuleLoader__.load({ id: ' + JSON.stringify(ID) + ', factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})

const bundle = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')

/* A @deepseek-ai/ value import would inline a second runtime instance. */
if (bundle.includes('@deepseek-ai/')) {
  throw new Error('client bundle purity: @deepseek-ai value imports must not reach the client bundle')
}
/* Every bare require must be a declared seed word. */
const requires = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
const bad = [...new Set(requires)].filter((r) => !CLIENT_EXTERNALS.includes(r))
if (bad.length) throw new Error('client bundle requires non-seed modules: ' + bad.join(', '))

console.log('built lib/client.js (' + bundle.length + ' bytes)')
console.log('  requires: ' + ([...new Set(requires)].join(', ') || '(none)'))
