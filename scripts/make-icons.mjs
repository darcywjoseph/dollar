// Rasterises build/icon.svg into the PNGs electron-builder and the runtime need.
// electron-builder derives .icns/.ico from build/icon.png; the renderer window
// uses resources/icon.png. Run with `npm run icons` (macOS/dev); commit the PNGs.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build/icon.svg'))

/** Render the SVG to a square PNG of the given pixel size. */
function render(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}

const targets = [
  ['build/icon.png', 1024], // electron-builder source (derives .icns/.ico)
  ['resources/icon.png', 512] // BrowserWindow icon (dev + Windows/Linux)
]

for (const [rel, size] of targets) {
  const out = join(root, rel)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, render(size))
  console.log(`wrote ${rel} (${size}x${size})`)
}
