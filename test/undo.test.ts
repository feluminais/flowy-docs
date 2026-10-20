import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { putObject } from '../src/core/ops.ts'
import { openHistory } from '../src/node/history.ts'
import { startServer } from '../src/node/server.ts'
import { httpHistory } from '../ui/src/historyclient.ts'
import { REDO_STALE, restoreIsStale, restoreVersion, saveEdit, UNDO_STALE } from '../ui/src/save.ts'
import { httpTransport } from '../ui/src/transport.ts'
import { entryAfterRestore, replay } from '../ui/src/undo.ts'
import type { Entry } from '../ui/src/undo.ts'

/** A server with history over a folder that holds a shop, and what the page keeps for undo. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-undo-'))
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
  const read = () => readFile(join(dir, 'model.yaml'), 'utf8')
  const add = async (id: string) => {
    let entry: Entry | undefined
    const message = await saveEdit(m => putObject(m, { id, type: 'app', in: 'shop', name: id }), base, (undo, label) => { entry = { kind: 'edit', undo, label } })
    assert.equal(message, undefined)
    return entry!
  }
  /** Restores the first step ("First seen") and gives the entry the page would keep for it. */
  const restoreFirst = async () => {
    const first = (await client.list()).steps.at(-1)!
    const seen = (await client.yaml()).versions
    const done = await restoreVersion(first.id, 'Restored the version from 10:00', base, seen)
    return { done, seen, entry: entryAfterRestore(done, seen, 'Restored the version from 10:00') }
  }
  return { base, client, read, add, restoreFirst }
}

test('an edit goes back and forward, each time with the entry that reverses it', async t => {
  const { base, read, add } = await setup(t)
  const entry = await add('cart')
  const withCart = await read()
  const undone = await replay(entry, 'undo', base)
  assert.deepEqual([undone.message, undone.stale, undone.reverse?.kind], [undefined, false, 'edit'])
  assert.doesNotMatch(await read(), /cart:/) // what the file said, not how it was written: an edit is put back as data
  const redone = await replay(undone.reverse!, 'redo', base)
  assert.equal(redone.message, undefined)
  assert.equal(await read(), withCart)
})

test('a restore goes back and forward by restoring what it replaced, to the exact text', async t => {
  const { base, read, add, restoreFirst } = await setup(t)
  const original = await read()
  await add('cart')
  const withCart = await read()
  const { entry } = await restoreFirst()
  assert.equal(await read(), original)
  assert.equal(entry?.kind, 'restore')

  const undone = await replay(entry!, 'undo', base)
  assert.deepEqual([undone.message, undone.stale], [undefined, false])
  assert.equal(await read(), withCart)
  const redone = await replay(undone.reverse!, 'redo', base)
  assert.equal(redone.message, undefined)
  assert.equal(await read(), original)
})

test('Review Focus: a restore whose step is gone is stale, so the stack is cleared, not stuck on it', async t => {
  const { base, client, add, restoreFirst } = await setup(t)
  await add('cart')
  const { entry } = await restoreFirst()
  await client.clear()
  const undone = await replay(entry!, 'undo', base)
  assert.deepEqual([undone.stale, undone.message, undone.reverse], [true, UNDO_STALE, undefined])
  assert.equal((await replay(entry!, 'redo', base)).message, REDO_STALE)
})

test('a restore is not undone over a change made since, as an edit is not', async t => {
  const { base, read, add, restoreFirst } = await setup(t)
  await add('cart')
  const { entry } = await restoreFirst()
  await add('web') // a change after the restore
  const afterWeb = await read()
  const undone = await replay(entry!, 'undo', base)
  assert.deepEqual([undone.stale, undone.message], [true, UNDO_STALE])
  assert.equal(await read(), afterWeb)
})

test('a failure that may pass (no history here) is a message, not a reason to drop the entry', async t => {
  const { base } = await setup(t)
  const entry: Entry = { kind: 'restore', to: 'x', label: 'Restored', seen: {} }
  const bare = { ...httpTransport(base), history: undefined }
  const result = await replay(entry, 'undo', bare)
  assert.deepEqual([result.stale, result.message], [false, "History isn't available here."])
})

test('a restore that changed nothing leaves nothing to undo, and neither does one with no step before it', async t => {
  const same = { 'model.yaml': 'aaaaaaaaaaaaaaaa' }
  assert.equal(entryAfterRestore({ before: 'x', versions: same }, same, 'Restored'), undefined)
  assert.equal(entryAfterRestore({ versions: { 'model.yaml': 'bbbbbbbbbbbbbbbb' } }, same, 'Restored'), undefined)
  assert.equal(entryAfterRestore({ message: 'no', before: 'x', versions: { 'model.yaml': 'bbbbbbbbbbbbbbbb' } }, same, 'Restored'), undefined)
  assert.deepEqual(entryAfterRestore({ before: 'x', versions: { 'model.yaml': 'bbbbbbbbbbbbbbbb', 'flows/a.yaml': null } }, same, 'Restored'),
    { kind: 'restore', to: 'x', label: 'Restored', seen: { 'model.yaml': 'bbbbbbbbbbbbbbbb', 'flows/a.yaml': null } })
  // a file that was not there and still is not is no change
  assert.equal(entryAfterRestore({ before: 'x', versions: { 'model.yaml': 'aaaaaaaaaaaaaaaa', 'flows/a.yaml': null } }, same, 'Restored'), undefined)
})

test('only a step that is gone, or a file that changed, makes a restore stale', () => {
  assert.deepEqual([404, 409, 500, 503, undefined].map(restoreIsStale), [true, true, false, false, false])
})
