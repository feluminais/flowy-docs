import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { placeBoxes, putFlow, putObject } from '../src/core/ops.ts'
import type { Model } from '../src/core/model.ts'
import { startServer } from '../src/node/server.ts'
import { saveEdit, undoEdit } from '../ui/src/save.ts'
import type { Undo } from '../ui/src/save.ts'
import { httpTransport } from '../ui/src/transport.ts'
import type { Transport } from '../ui/src/transport.ts'

/** An edit that changes three files: model.yaml, a new flow and layout.yaml. */
const threeFiles = (m: Model): Model =>
  placeBoxes(putFlow(putObject(m, { id: 'web', type: 'app', in: 'shop', name: 'Web app' }), { id: 'visit', name: 'Visit', view: 'shop', steps: [{ from: 'web', text: 'Opens' }] }), 'root', { shop: [10, 20] })

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-batch-'))
  const dir = join(root, 'flowy')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop:\n    type: system\n    name: Shop\nconnections: []\n')
  const server = await startServer({ dir, ui: root, port: 0 })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const real = httpTransport(`http://127.0.0.1:${server.port}`)
  const log: string[] = []
  /** The server, except that write number `failAt` onward (1-based, counting every write) answers 500, as a disk that fills up does. */
  const flaky = (failAt: number | undefined, until = Infinity): Transport => {
    let n = 0
    return {
      state: real.state,
      async write(method, file, body) {
        n++
        log.push(`${method} ${file}`)
        if (failAt !== undefined && n >= failAt && n < until) return { status: 500, body: { error: 'disk full' } }
        return real.write(method, file, body)
      },
    }
  }
  return { dir, flaky, log, real, read: (rel: string) => readFile(join(dir, rel), 'utf8') }
}

test('an edit that changes three files saves them all and one undo takes them all back', async t => {
  const { dir, read, real } = await setup(t)
  const before = await read('model.yaml')
  let undo: Undo | undefined
  assert.equal(await saveEdit(threeFiles, real, u => { undo = u }), undefined)
  assert.equal(undo?.length, 3)
  assert.ok(existsSync(join(dir, 'flows/visit.yaml')))
  assert.notEqual(await read('model.yaml'), before)
  let redo: Undo | undefined
  assert.equal(await undoEdit(undo!, real, back => { redo = back }), undefined)
  assert.equal(await read('model.yaml'), before)
  assert.equal(existsSync(join(dir, 'flows/visit.yaml')), false)
  assert.equal(await undoEdit(redo!, real), undefined) // and redo puts them all back
  assert.ok(existsSync(join(dir, 'flows/visit.yaml')))
})

test('a write that fails halfway puts back what was written, and nothing is recorded', async t => {
  const { dir, flaky, read } = await setup(t)
  const before = await read('model.yaml')
  let recorded = 0
  const message = await saveEdit(threeFiles, flaky(2, 3), () => { recorded++ })
  assert.equal(message, "Couldn't save flows/visit.yaml: disk full")
  assert.equal(await read('model.yaml'), before)
  assert.equal(existsSync(join(dir, 'flows/visit.yaml')), false)
  assert.equal(existsSync(join(dir, 'layout.yaml')), false)
  assert.equal(recorded, 0)
})

test('a file that changed outside after it was read is the notice for that, and the earlier file goes back', async t => {
  const { dir, read, real } = await setup(t)
  const before = await read('model.yaml')
  const message = await saveEdit(m => {
    mkdirSync(join(dir, 'flows'), { recursive: true })
    writeFileSync(join(dir, 'flows/visit.yaml'), 'name: Someone else\nview: root\nsteps: []\n') // someone else saves while the canvas works
    return threeFiles(m)
  }, real)
  assert.equal(message, 'This file changed outside Flowy. Reloaded.')
  assert.equal(await read('model.yaml'), before)
  assert.equal(await read('flows/visit.yaml'), 'name: Someone else\nview: root\nsteps: []\n')
  assert.equal(existsSync(join(dir, 'layout.yaml')), false)
})

test('when the first file cannot be put back either, it says which, and the edit can still be undone', async t => {
  const { flaky, read, real } = await setup(t)
  const before = await read('model.yaml')
  let undo: Undo | undefined
  const message = await saveEdit(threeFiles, flaky(2, 4), u => { undo = u }) // writes 2 and 3 fail: the second file, then putting the first back
  assert.equal(message, "Couldn't save flows/visit.yaml: disk full. model.yaml was saved first and could not be put back.")
  assert.notEqual(await read('model.yaml'), before)
  assert.equal(undo?.length, 1)
  assert.equal(await undoEdit(undo!, real), undefined)
  assert.equal(await read('model.yaml'), before)
})

test('an undo that fails halfway leaves every file as it was', async t => {
  const { dir, flaky, read, real } = await setup(t)
  let undo: Undo | undefined
  assert.equal(await saveEdit(threeFiles, real, u => { undo = u }), undefined)
  const after = { model: await read('model.yaml'), layout: await read('layout.yaml'), flow: await read('flows/visit.yaml') }
  assert.equal(await undoEdit(undo!, flaky(2, 3)), "Couldn't undo flows/visit.yaml: disk full")
  assert.equal(await read('model.yaml'), after.model)
  assert.equal(await read('layout.yaml'), after.layout)
  assert.equal(await read('flows/visit.yaml'), after.flow)
  assert.ok(existsSync(join(dir, 'flows/visit.yaml')))
})
