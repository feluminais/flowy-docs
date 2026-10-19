// Builds the extension: the host code into dist/extension.cjs, and the built canvas (../dist/ui) into media/.
// The canvas comes first from the repo root: npm run build:ui.
import { access, cp, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

await access(here('../dist/ui/index.html')).catch(() => {
  throw new Error('The canvas is not built yet. Run: npm run build:ui (from the repo root)')
})

await build({
  entryPoints: [here('src/extension.ts')],
  outfile: here('dist/extension.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'], // VS Code provides it
  sourcemap: true,
  logLevel: 'info',
})

await rm(here('media'), { recursive: true, force: true })
await cp(here('../dist/ui'), here('media'), { recursive: true })
