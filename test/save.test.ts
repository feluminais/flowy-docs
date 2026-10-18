import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deleteFlow, placeBoxes, putFlow, putObject } from '../src/core/ops.ts'
import { startServer } from '../src/node/server.ts'
import { CHANGED_OUTSIDE, REDO_STALE, saveEdit, UNDO_STALE, undoEdit } from '../ui/src/save.ts'
import type { Undo } from '../ui/src/save.ts'

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
  const base = `http://127.0.0.1:${server.port}`
  return { dir, read, base, save: (op: Parameters<typeof saveEdit>[0]) => saveEdit(op, base) }
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

test('undo takes saved edits back, newest first, a new flow and a first layout included', async t => {
  const { dir, read, base } = await setup(t)
  const undos: Undo[] = []
  const save = (op: Parameters<typeof saveEdit>[0]) => saveEdit(op, base, undo => undos.push(undo))
  assert.equal(await save(m => putObject(m, { id: 'shop', name: 'Store' })), undefined)
  assert.equal(await save(m => placeBoxes(m, 'root', { shop: [10, 20] })), undefined)
  assert.equal(await save(m => putFlow(m, { id: 'tour', name: 'Tour', view: 'root', steps: [{ from: 'shop', text: 'Waits' }] })), undefined)
  assert.equal(undos.length, 3)
  assert.equal(await undoEdit(undos.pop()!, base), undefined)
  assert.equal(existsSync(join(dir, 'flows', 'tour.yaml')), false)
  assert.equal(await undoEdit(undos.pop()!, base), undefined)
  assert.equal(await read('layout.yaml'), '{}\n')
  assert.equal(await undoEdit(undos.pop()!, base), undefined)
  assert.match(await read('model.yaml'), /^title: Demo\nobjects:\n {2}shop:\n {4}type: system\n {4}name: Shop\n/)
})

test('while a file can\'t be read, undo says so instead of calling the edit stale, and works once it\'s fixed', async t => {
  const { dir, read, base } = await setup(t)
  const undos: Undo[] = []
  assert.equal(await saveEdit(m => putObject(m, { id: 'shop', name: 'Store' }), base, undo => undos.push(undo)), undefined)
  await mkdir(join(dir, 'flows'))
  await writeFile(join(dir, 'flows', 'bad.yaml'), 'steps: [\n')
  assert.match((await undoEdit(undos[0], base)) ?? '', /^Can't undo while a file can't be read: flows\/bad\.yaml/)
  await rm(join(dir, 'flows', 'bad.yaml'))
  assert.equal(await undoEdit(undos[0], base), undefined)
  assert.match(await read('model.yaml'), /name: Shop/)
})

test('undo refuses once the file changed since, and leaves the change alone', async t => {
  const { dir, read, base } = await setup(t)
  const undos: Undo[] = []
  assert.equal(await saveEdit(m => putObject(m, { id: 'shop', name: 'Store' }), base, undo => undos.push(undo)), undefined)
  const outside = 'objects:\n  mail: { type: system, name: Mail }\n'
  writeFileSync(join(dir, 'model.yaml'), outside)
  assert.equal(await undoEdit(undos[0], base), UNDO_STALE)
  assert.equal(await read('model.yaml'), outside)
})

test('redo puts an undone edit back, a deleted flow included, and undo can take it away again', async t => {
  const { dir, read, base } = await setup(t)
  const undos: Undo[] = []
  const redos: Undo[] = []
  assert.equal(await saveEdit(m => putObject(m, { id: 'shop', name: 'Store' }), base, undo => undos.push(undo)), undefined)
  assert.equal(await saveEdit(m => putFlow(m, { id: 'tour', name: 'Tour', view: 'root', steps: [{ from: 'shop', text: 'Waits' }] }), base, undo => undos.push(undo)), undefined)
  // Undo both, newest first; each hands over its redo.
  assert.equal(await undoEdit(undos.pop()!, base, back => redos.push(back)), undefined)
  assert.equal(await undoEdit(undos.pop()!, base, back => redos.push(back)), undefined)
  assert.match(await read('model.yaml'), /name: Shop/)
  assert.equal(existsSync(join(dir, 'flows', 'tour.yaml')), false)
  // Redo in reverse order: the rename, then the flow file comes back.
  assert.equal(await undoEdit(redos.pop()!, base, back => undos.push(back), 'redo'), undefined)
  assert.match(await read('model.yaml'), /name: Store/)
  assert.equal(await undoEdit(redos.pop()!, base, back => undos.push(back), 'redo'), undefined)
  assert.match(await read('flows/tour.yaml'), /text: Waits/)
  // And the redone flow can be undone again.
  assert.equal(await undoEdit(undos.pop()!, base), undefined)
  assert.equal(existsSync(join(dir, 'flows', 'tour.yaml')), false)
})

test('redo refuses once the file changed since, in its own words', async t => {
  const { dir, read, base } = await setup(t)
  const undos: Undo[] = []
  const redos: Undo[] = []
  assert.equal(await saveEdit(m => putObject(m, { id: 'shop', name: 'Store' }), base, undo => undos.push(undo)), undefined)
  assert.equal(await undoEdit(undos[0], base, back => redos.push(back)), undefined)
  const outside = 'objects:\n  mail: { type: system, name: Mail }\n'
  writeFileSync(join(dir, 'model.yaml'), outside)
  assert.equal(await undoEdit(redos[0], base, undefined, 'redo'), REDO_STALE)
  assert.equal(await read('model.yaml'), outside)
})
