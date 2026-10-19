import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dumpBeats } from '../desktop/fixtures/beats.ts'
import { dumpFolder, expectedPath, fixtureDirs } from '../desktop/fixtures/dump.ts'
import { dumpGeometry } from '../desktop/fixtures/geometry.ts'
import { dumpLayout } from '../desktop/fixtures/layout.ts'
import { dumpMermaid } from '../desktop/fixtures/mermaid.ts'
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

test('desktop animation beats still match what the TypeScript core says', async () => {
  const expected: unknown = JSON.parse(await readFile(expectedPath('beats'), 'utf8'))
  assert.deepEqual(JSON.parse(JSON.stringify(dumpBeats())), expected, 'run: node desktop/fixtures/generate.ts')
})
