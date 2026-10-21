import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dumpBeats } from '../desktop/fixtures/beats.ts'
import { dumpDetect, dumpHighlight } from '../desktop/fixtures/detect.ts'
import { dumpFolder, expectedPath, fixtureDirs } from '../desktop/fixtures/dump.ts'
import { dumpGeometry } from '../desktop/fixtures/geometry.ts'
import { dumpEditLabels } from '../desktop/fixtures/editlabel.ts'
import { dumpFormula } from '../desktop/fixtures/formula.ts'
import { buildTrail, dumpHistory } from '../desktop/fixtures/history.ts'
import { dumpLayout } from '../desktop/fixtures/layout.ts'
import { dumpMermaid } from '../desktop/fixtures/mermaid.ts'
import { dumpOutline } from '../desktop/fixtures/outline.ts'
import { dumpPerf, dumpPerfView } from '../desktop/fixtures/perf.ts'
import { dumpCaptions, dumpStops } from '../desktop/fixtures/structure.ts'
import { dumpOps } from '../desktop/fixtures/ops.ts'
import { dumpYamlWrite } from '../desktop/fixtures/yaml-write.ts'
import { dumpNavigation, dumpScenes } from '../desktop/fixtures/scene.ts'

// The desktop app's tests compare the C# reader with desktop/fixtures/expected. These tests keep that folder honest:
// if the TypeScript core changes what it says about a fixture, they fail until the JSON is regenerated.
test('desktop geometry still matches the browser canvas\'s own functions', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('geometry'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpGeometry())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop placement still matches the canvas\'s arrange and untangle', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('placement'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpLayout())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop scenes still match what the canvas decides', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('scenes'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpScenes())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop navigation still matches the panels and the search', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('navigation'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpNavigation())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop mermaid still matches the text the browser copies', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('mermaid'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpMermaid())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop yaml writer still matches what the yaml package writes', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('yaml-write'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpYamlWrite())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop edits still write what the TypeScript ops write', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('ops'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpOps())), expected, 'run: node desktop/fixtures/generate.ts')
})

for (const [name, dir] of Object.entries(fixtureDirs())) {
  test(`desktop fixture "${name}" still matches what the TypeScript core says`, async () => {
    const expected: unknown = JSON.parse(await readFile(expectedPath(name), 'utf8'))
    assert.deepEqual(JSON.parse(JSON.stringify(await dumpFolder(dir))), expected, 'run: node desktop/fixtures/generate.ts')
  })
}

test('desktop language detection still names what the TypeScript cues name', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('detect'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpDetect())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop code colours still match the HTML and runs the canvas gets from highlight.js', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('highlight'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpHighlight())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop animation beats still match what the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('beats'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpBeats())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop navigator rows, flow groups and keys still match what the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('outline'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpOutline())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop load-test runs still read, roll up, struggle and draw as the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('perf-runs'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpPerf())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop traffic formulas still read, print and evaluate as the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('formula'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpFormula())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop panel maths and words still match ui/src/perfview.ts', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('perf-view'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpPerfView())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop runs and stops of a flow\'s groups still match what the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('stops'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpStops())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop captions and progress bars still match what the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('captions'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpCaptions())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop history rules still match the TypeScript ones: diff, list, retention, labels, keys', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('history'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(await dumpHistory())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('desktop edit labels still match the TypeScript ones', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('editlabel'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpEditLabels())), expected, 'run: node desktop/fixtures/generate.ts')
})

test('the sample history trail is what openHistory writes, byte for byte', async () => {
  const folder = join(dirname(expectedPath('history')), 'history-trail')
  const onDisk: Record<string, Uint8Array> = {}
  for (const sub of ['steps', 'blobs']) {
    for (const name of await readdir(join(folder, sub))) onDisk[`${sub}/${name}`] = new Uint8Array(await readFile(join(folder, sub, name)))
  }
  assert.deepEqual(onDisk, (await buildTrail()).files, 'run: node desktop/fixtures/generate.ts')
})
