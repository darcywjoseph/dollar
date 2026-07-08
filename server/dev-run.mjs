// Runs a server entry point through an esbuild bundle instead of tsx.
//
// Why bundle for dev: the reused db modules live under the repo root, so a
// plain runner (tsx) resolves `better-sqlite3` to the root node_modules, which
// is built for Electron's ABI and won't load under Node. Bundling with the
// native deps kept external, emitted under server/, makes `require(...)`
// resolve to server/node_modules (the Node-ABI build) at runtime.
//
// Usage: node dev-run.mjs [--watch] <entry.ts> [args...]
import esbuild from 'esbuild'
import { spawn } from 'child_process'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const watch = argv[0] === '--watch'
const [entry, ...scriptArgs] = watch ? argv.slice(1) : argv
if (!entry) {
  console.error('dev-run: missing entry point')
  process.exit(1)
}

// Emit under server/ so the bundle's require() resolves native deps from
// server/node_modules.
const outdir = join(here, '.dev')
mkdirSync(outdir, { recursive: true })
const outfile = join(outdir, 'bundle.cjs')

let child = null
function run() {
  if (child) child.kill()
  child = spawn(process.execPath, [outfile, ...scriptArgs], { stdio: 'inherit', env: process.env })
  if (!watch) child.on('exit', (code) => process.exit(code ?? 0))
}

const buildOptions = {
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile,
  tsconfig: join(here, 'tsconfig.json'),
  external: ['better-sqlite3', 'pdfjs-dist', 'pdfjs-dist/*'],
  sourcemap: 'inline'
}

if (watch) {
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [
      {
        name: 'rerun-on-build',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) run()
          })
        }
      }
    ]
  })
  await ctx.watch()
} else {
  await esbuild.build(buildOptions)
  run()
}
