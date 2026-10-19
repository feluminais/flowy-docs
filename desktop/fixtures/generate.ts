// Writes what the TypeScript side says into desktop/fixtures/expected/*.json. Run from the repo root:
//   node desktop/fixtures/generate.ts
// Run it after changing src/core, ui/src/graph.ts, example/, docs/demo or a case under desktop/fixtures/cases, then run the desktop tests.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dumpFolder, expectedPath, fixtureDirs } from './dump.ts'
import { dumpGeometry } from './geometry.ts'
import { dumpLayout } from './layout.ts'
import { dumpMermaid } from './mermaid.ts'
import { dumpOps } from './ops.ts'
import { dumpYamlWrite } from './yaml-write.ts'
import { dumpNavigation, dumpScenes } from './scene.ts'

const write = async (name: string, data: unknown) => {
  await mkdir(dirname(expectedPath(name)), { recursive: true })
  await writeFile(expectedPath(name), `${JSON.stringify(data, null, 2)}\n`)
  console.log(`wrote ${name}`)
}

for (const [name, dir] of Object.entries(fixtureDirs())) await write(name, await dumpFolder(dir))
await write('geometry', dumpGeometry())
await write('placement', await dumpLayout())
await write('scenes', await dumpScenes())
await write('navigation', await dumpNavigation())
await write('mermaid', await dumpMermaid())
await write('yaml-write', await dumpYamlWrite())
await write('ops', await dumpOps())
