import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { placeBoxes, putObject } from '../src/core/ops.ts'
import { openHistory } from '../src/node/history.ts'
import { startServer } from '../src/node/server.ts'
import { httpHistory } from '../ui/src/historyclient.ts'
import { restoreVersion, saveEdit, undoEdit } from '../ui/src/save.ts'
import type { Undo } from '../ui/src/save.ts'
import { httpTransport } from '../ui/src/transport.ts'

/** A server with history over a folder that holds a shop, the way the canvas talks to it, and a client to read what the history says. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-save-history-'))
  const dir = join(root, 'flowy')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop: { type: system, name: Shop }\n')
  const history = openHistory(dir, { app: 'browser', stateDir: join(root, 'state'), log: () => undefined })
  const server = await startServer({ dir, ui: root, port: 0, history })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.port}`
  const client = httpHistory(base)
  const labels = async () => (await client.list()).steps.map(s => s.label)
  const read = () => readFile(join(dir, 'model.yaml'), 'utf8')
  return { base, client, labels, read }
}

const addCart = (m: Parameters<typeof putObject>[0]) => putObject(m, { id: 'cart', type: 'app', in: 'shop', name: 'Cart' })

test('an edit leaves a step named for what it did', async t => {
  const { base, client, labels } = await setup(t)
  assert.equal(await saveEdit(addCart, base), undefined)
  assert.deepEqual(await labels(), ['Added the Cart app', 'First seen'])
  const [top] = (await client.list()).steps
  assert.deepEqual([top.source, top.app, top.changed], ['you', 'browser', ['model.yaml']])
})

test('a drag is named for the move, and the first one in a view for the arranging of the view', async t => {
  const { base, labels } = await setup(t)
  assert.equal(await saveEdit(m => placeBoxes(m, 'root', { shop: [10, 20] }), base), undefined)
  assert.equal((await labels())[0], 'Arranged the top level') // the page saves every box of a view the first time one is dragged
  assert.equal(await saveEdit(m => placeBoxes(m, 'root', { shop: [15, 20] }), base), undefined)
  assert.equal((await labels())[0], 'Moved Shop')
})

test('onSaved is given the label along with how to undo', async t => {
  const { base } = await setup(t)
  let got: { undo: Undo; label: string } | undefined
  await saveEdit(addCart, base, (undo, label) => { got = { undo, label } })
  assert.equal(got?.label, 'Added the Cart app')
  assert.ok(got && got.undo.length > 0)
})

test('an edit that is refused, or loses a race, leaves no step', async t => {
  const { base, labels } = await setup(t)
  const refused = await saveEdit(m => putObject(m, { id: 'web', type: 'app', name: 'Web app' }), base) // an app must be inside a system
  assert.match(String(refused), /Refused/)
  assert.deepEqual(await labels(), ['First seen'])
})

test('undo and redo say what they took back and put back', async t => {
  const { base, labels } = await setup(t)
  let undo: Undo = []
  await saveEdit(addCart, base, u => { undo = u })
  let redo: Undo = []
  assert.equal(await undoEdit(undo, base, back => { redo = back }, 'undo', 'Added the Cart app'), undefined)
  assert.equal(await undoEdit(redo, base, undefined, 'redo', 'Added the Cart app'), undefined)
  assert.deepEqual((await labels()).slice(0, 3), ['Redid: Added the Cart app', 'Undid: Added the Cart app', 'Added the Cart app'])
})

test('an edit still saves where there is no history client', async t => {
  const { base, read } = await setup(t)
  const bare = { ...httpTransport(base), history: undefined }
  assert.equal(await saveEdit(addCart, bare), undefined)
  assert.match(await read(), /cart:/)
})

test('restoring an earlier version, and then restoring what was there before, brings back the exact text', async t => {
  const { base, client, read } = await setup(t)
  const original = await read()
  await saveEdit(addCart, base)
  const withCart = await read()
  const firstSeen = (await client.list()).steps.at(-1)!

  const restored = await restoreVersion(firstSeen.id, 'Restored the version from 10:00', base)
  assert.equal(restored.message, undefined)
  assert.ok(restored.before)
  assert.equal(await read(), original)

  const undone = await restoreVersion(restored.before, 'Undid: Restored the version from 10:00', base)
  assert.equal(undone.message, undefined)
  assert.equal(await read(), withCart)
  assert.ok(undone.before)
})

test('a restore that finds a file changed says so, and one with no history says that', async t => {
  const { base, client, read } = await setup(t)
  const original = await read()
  await saveEdit(addCart, base)
  const firstSeen = (await client.list()).steps.at(-1)!
  const stale = await restoreVersion(firstSeen.id, 'x', base, { 'model.yaml': 'badbadbadbadbadb' })
  assert.deepEqual(stale, { message: 'This file changed outside Flowy. Reloaded.', status: 409 })
  assert.notEqual(await read(), original)
  assert.deepEqual(await restoreVersion(firstSeen.id, 'x', { ...httpTransport(base), history: undefined }), { message: "History isn't available here." })
})
