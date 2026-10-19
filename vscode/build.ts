// Builds the extension: the host code into dist/extension.cjs (with the notices of what it bundles), and the built canvas
// (../dist/ui) into media/. The canvas comes first from the repo root: npm run build:ui.
// `--release`, which vsce's prepublish step passes, leaves out the source map.
import { access, cp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { licencesOf } from './licences.ts'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const release = process.argv.includes('--release')

await access(here('../dist/ui/index.html')).catch(() => {
  throw new Error('The canvas is not built yet. Run: npm run build:ui (from the repo root)')
})

const { metafile } = await build({
  entryPoints: [here('src/extension.ts')],
  outfile: here('dist/extension.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'], // VS Code provides it
  sourcemap: !release,
  metafile: true,
  logLevel: 'info',
})
await writeFile(here('dist/THIRD-PARTY-LICENSES.md'), await licencesOf(Object.keys(metafile.inputs), process.cwd()))

await rm(here('media'), { recursive: true, force: true })
await cp(here('../dist/ui'), here('media'), { recursive: true })
