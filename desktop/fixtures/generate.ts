// Writes what the TypeScript side says into desktop/fixtures/expected/*.json. Run from the repo root:
//   node desktop/fixtures/generate.ts
// Run it after changing src/core, ui/src/graph.ts, example/, docs/demo or a case under desktop/fixtures/cases, then run the desktop tests.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dumpBeats } from './beats.ts'
import { dumpFolder, expectedPath, fixtureDirs } from './dump.ts'
import { dumpDependents } from './dependents.ts'
import { dumpDetect, dumpHighlight } from './detect.ts'
import { dumpEditLabels } from './editlabel.ts'
import { dumpFailures, dumpFailuresView } from './failures.ts'
import { dumpUsedBy } from './usedby.ts'
import { dumpFormula } from './formula.ts'
import { dumpGeometry } from './geometry.ts'
import { buildTrail, dumpHistory } from './history.ts'
import { dumpLayout } from './layout.ts'
import { dumpLook } from './look.ts'
import { dumpMermaid } from './mermaid.ts'
import { dumpNumbers } from './numbers.ts'
import { dumpOutline } from './outline.ts'
import { dumpPerf, dumpPerfView } from './perf.ts'
import { dumpStates } from './states.ts'
import { dumpCaptions, dumpStops } from './structure.ts'
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
await write('appearance', await dumpLook())
await write('placement', await dumpLayout())
await write('scenes', await dumpScenes())
await write('navigation', await dumpNavigation())
await write('mermaid', await dumpMermaid())
await write('yaml-write', await dumpYamlWrite())
await write('ops', await dumpOps())
await write('dependents', await dumpDependents())
await write('usedby', await dumpUsedBy())
await write('beats', dumpBeats())
await write('outline', await dumpOutline())
await write('formula', dumpFormula())
await write('numbers', dumpNumbers())
await write('perf-runs', await dumpPerf())
await write('perf-view', await dumpPerfView())
await write('failures-core', await dumpFailures())
await write('failures-view', await dumpFailuresView())
await write('stops', await dumpStops())
await write('captions', await dumpCaptions())
await write('state-folds', await dumpStates())
await write('history', await dumpHistory())
await write('editlabel', dumpEditLabels())
await write('detect', dumpDetect())
await write('highlight', dumpHighlight())

// The sample trail: the step and blob files the TypeScript store writes, for the C# store to read.
const trailDir = join(dirname(expectedPath('history')), 'history-trail')
await rm(trailDir, { recursive: true, force: true })
for (const [rel, bytes] of Object.entries((await buildTrail()).files)) {
  await mkdir(dirname(join(trailDir, rel)), { recursive: true })
  await writeFile(join(trailDir, rel), bytes)
}
console.log('wrote history-trail')
