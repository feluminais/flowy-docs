import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteFlow, placeBoxes, putFlow, putObject } from '../src/core/ops.ts'
import { startServer } from '../src/node/server.ts'
import { CHANGED_OUTSIDE, saveEdit } from '../ui/src/save.ts'

/** A server over a flowy/ folder that starts with a shop and a title, the way the canvas talks to it. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-save-'))
  const dir = join(root, 'flowy')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'title: Demo\nobjects:\n  shop: { type: system, name: Shop }\n')
  const server = await startServer({ dir, ui: root, port: 0 })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const read = (rel: string) => readFile(join(dir, rel), 'utf8')
  return { dir, read, save: (op: Parameters<typeof saveEdit>[0]) => saveEdit(op, `http://127.0.0.1:${server.port}`) }
}

test('an edit reads fresh, writes the file, and keeps extra top-level keys where they were', async t => {
  const { read, save } = await setup(t)
  assert.equal(await save(m => putObject(m, { id: 'web', type: 'app', in: 'shop', name: 'Web app' })), undefined)
  assert.equal(await save(m => putObject(m, { id: 'web', tech: 'React' })), undefined)
  assert.equal(await read('model.yaml'),
    'title: Demo\nobjects:\n  shop:\n    type: system\n    name: Shop\n  web:\n    type: app\n    name: Web app\n    in: shop\n    tech: React\nconnections: []\n')
})

test('an edit that adds a problem is refused and writes nothing', async t => {
  const { read, save } = await setup(t)
  const before = await read('model.yaml')
  assert.equal(await save(m => putObject(m, { id: 'web', type: 'app', name: 'Web app' })),
    'Refused, nothing saved. This would add:\n- model.yaml: web: app must be inside system')
  assert.equal(await read('model.yaml'), before)
})

test('a file that changes between reading and writing gets the 409 notice, and the outside change stays', async t => {
  const { dir, read, save } = await setup(t)
  const outside = 'objects:\n  mail: { type: system, name: Mail }\n'
  const message = await save(m => {
    writeFileSync(join(dir, 'model.yaml'), outside) // someone else saves while the canvas works
    return putObject(m, { id: 'shop', name: 'Store' })
  })
  assert.equal(message, CHANGED_OUTSIDE)
  assert.equal(await read('model.yaml'), outside)
})

test('layout and flow edits write their own files, and deleting a flow removes it', async t => {
  const { read, save } = await setup(t)
  assert.equal(await save(m => placeBoxes(m, 'root', { shop: [10, 20] })), undefined)
  assert.equal(await read('layout.yaml'), 'root:\n  shop: [10, 20]\n')
  const flow = { id: 'tour', name: 'Tour', view: 'root', steps: [{ from: 'shop', to: 'shop', text: 'Loops' }] }
  assert.match((await save(m => putFlow(m, flow))) ?? '', /step 1: goes from an object to itself/)
  assert.equal(await save(m => putFlow(putObject(m, { id: 'mail', type: 'system', name: 'Mail' }), { ...flow, steps: [{ from: 'shop', to: 'mail', text: 'Sends' }] })), undefined)
  assert.match(await read('flows/tour.yaml'), /text: Sends/)
  assert.equal(await save(m => deleteFlow(m, 'tour')), undefined)
  await assert.rejects(read('flows/tour.yaml'), { code: 'ENOENT' })
})
