import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StepInfo } from '../src/core/history.ts'
import { putObject } from '../src/core/ops.ts'
import { openHistory } from '../src/node/history.ts'
import { startServer } from '../src/node/server.ts'
import { httpHistory } from '../ui/src/historyclient.ts'
import type { HistoryClient, HistoryList } from '../ui/src/historyclient.ts'
import { createHistoryStore } from '../ui/src/historystore.ts'
import { saveEdit } from '../ui/src/save.ts'

/** A server with history over a folder that holds a shop (so its first step is "First seen"), a client for it, and edits that add a shape. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-store-ui-'))
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
  const add = (id: string) => saveEdit(m => putObject(m, { id, type: 'app', in: 'shop', name: id.toUpperCase() }), base)
  return { client: httpHistory(base), add }
}

const info = (id: string): StepInfo => ({ id, time: '2026-10-20T10:00:00.000Z', label: id, source: 'you', app: 'browser', changed: ['model.yaml'] })

/** A client that answers from a script: each call of `list` takes the next entry (the last one repeats). */
function stub(lists: (() => Promise<HistoryList>)[]): HistoryClient {
  let n = 0
  return {
    list: () => lists[Math.min(n++, lists.length - 1)](),
    step: async id => ({ step: info(id), files: { 'model.yaml': { text: id } } }),
    yaml: async () => ({ files: {}, versions: {} }),
    record: async () => false,
    restore: async () => ({ ok: false, status: 500, message: 'no' }),
    clear: async () => undefined,
  }
}
const listOf = (...ids: string[]) => async (): Promise<HistoryList> => ({ saving: true, steps: ids.map(info) })
const pause = (ms: number) => new Promise(done => setTimeout(done, ms))

test('it starts not ready, then has the list, the newest step and the files as they are', async t => {
  const { client } = await setup(t)
  const store = createHistoryStore(client)
  assert.equal(store.get().ready, false)
  await store.refresh()
  const view = store.get()
  assert.equal(view.ready, true)
  assert.deepEqual(view.steps.map(s => s.label), ['First seen'])
  assert.equal(view.shownId, view.steps[0].id)
  assert.equal(view.shown?.step.label, 'First seen')
  assert.ok(view.now && 'text' in view.now.files['model.yaml'])
})

test('it follows the newest step as new ones arrive', async t => {
  const { client, add } = await setup(t)
  const store = createHistoryStore(client)
  await store.refresh()
  await add('cart')
  await store.refresh()
  const view = store.get()
  assert.equal(view.shown?.step.label, 'Added the CART app')
  assert.equal(view.picked, undefined)
})

test('it stays on a step the reader picked while newer ones arrive, and follows again when told to', async t => {
  const { client, add } = await setup(t)
  const store = createHistoryStore(client)
  await add('cart')
  await store.refresh()
  const older = store.get().steps[1]
  await store.pick(older.id)
  assert.equal(store.get().shown?.step.label, 'First seen')
  assert.equal(store.get().shown?.previous, undefined) // the oldest step has no step before it

  await add('web')
  await store.refresh()
  assert.equal(store.get().steps.length, 3)
  assert.equal(store.get().shownId, older.id)

  await store.pick(store.get().steps[1].id)
  assert.equal(store.get().shown?.previous?.id, older.id) // marks are against the step before

  await store.pick(undefined)
  assert.equal(store.get().shown?.step.label, 'Added the WEB app')
})

test('Review Focus: when the picked step disappears, it falls back to the newest', async t => {
  const { client, add } = await setup(t)
  const store = createHistoryStore(client)
  await add('cart')
  await store.refresh()
  await store.pick(store.get().steps[1].id)
  await client.clear()
  await store.refresh()
  const view = store.get()
  assert.deepEqual([view.steps, view.picked, view.shownId, view.shown], [[], undefined, undefined, undefined])
})

test('Review Focus: a picked step that is gone between the list and the read falls back too', async t => {
  const client = stub([listOf('b', 'a')])
  const store = createHistoryStore({ ...client, step: async id => (id === 'a' ? undefined : { step: info(id), files: {} }) })
  await store.pick('a')
  assert.deepEqual([store.get().picked, store.get().shownId], [undefined, 'b'])
})

test('of two reads that overlap, the later one is kept', async t => {
  const slowOld: () => Promise<HistoryList> = async () => {
    await pause(80)
    return { saving: true, steps: [info('old')] }
  }
  const store = createHistoryStore(stub([slowOld, listOf('new')]))
  await Promise.all([store.refresh(), store.refresh()])
  assert.deepEqual(store.get().steps.map(s => s.id), ['new'])
  await pause(120)
  assert.deepEqual(store.get().steps.map(s => s.id), ['new'])
})

test('a read that fails says why and keeps what it had', async t => {
  let fail = false
  const store = createHistoryStore(stub([async () => {
    if (fail) throw new Error('the server answered 500')
    return { saving: true, steps: [info('a')] }
  }]))
  await store.refresh()
  fail = true
  await store.refresh()
  assert.equal(store.get().error, 'the server answered 500')
  assert.deepEqual(store.get().steps.map(s => s.id), ['a'])
  fail = false
  await store.refresh()
  assert.equal(store.get().error, undefined)
})

test('it says when the history is not being saved, and why', async t => {
  const store = createHistoryStore(stub([async () => ({ saving: false, reason: 'the disk is full', steps: [] })]))
  await store.refresh()
  assert.deepEqual([store.get().saving, store.get().reason], [false, 'the disk is full'])
})

test('comparing with now is a switch, and it tells subscribers once', async t => {
  const store = createHistoryStore(stub([listOf('a')]))
  await store.refresh()
  let heard = 0
  const stop = store.subscribe(() => { heard++ })
  store.setCompare(true)
  store.setCompare(true)
  assert.equal(store.get().compare, true)
  assert.equal(heard, 1)
  stop()
  store.setCompare(false)
  assert.equal(heard, 1)
})

test('following the newest again turns comparing off, or the marks of the latest change would be gone', async t => {
  const store = createHistoryStore(stub([listOf('b', 'a')]))
  await store.pick('a')
  store.setCompare(true)
  await store.pick(undefined)
  assert.equal(store.get().compare, false)
  store.setCompare(true)
  await store.pick('a') // choosing another step keeps the switch
  assert.equal(store.get().compare, true)
})

test('when the picked step goes away, comparing turns off with it, or the latest change would show no marks', async t => {
  const client = stub([listOf('b', 'a'), listOf('c', 'b')])
  const store = createHistoryStore(client)
  await store.pick('a')
  store.setCompare(true)
  await store.refresh() // 'a' is gone from the list now
  assert.deepEqual([store.get().picked, store.get().compare, store.get().shownId], [undefined, false, 'c'])
})

test('a pick is not shown as picked until its files are read, so Restore never acts on another step', async t => {
  const client = { ...stub([listOf('b', 'a')]), step: async (id: string) => { await pause(60); return { step: info(id), files: {} } } }
  const store = createHistoryStore(client)
  await store.refresh()
  const picking = store.pick('a')
  assert.equal(store.get().picked, undefined)
  await picking
  assert.deepEqual([store.get().picked, store.get().shownId, store.get().shown?.step.id], ['a', 'a', 'a'])
})

test('Review Focus: a server that answers 404 has no history for the tab to show', async t => {
  const missing = Object.assign(new Error('the server answered 404'), { status: 404 })
  const store = createHistoryStore({ ...stub([listOf('a')]), list: async () => { throw missing } })
  await store.refresh()
  assert.equal(store.get().unavailable, true)
  const broken = createHistoryStore({ ...stub([listOf('a')]), list: async () => { throw Object.assign(new Error('the server answered 500'), { status: 500 }) } })
  await broken.refresh()
  assert.deepEqual([broken.get().unavailable, broken.get().error], [undefined, 'the server answered 500'])
})

test('what get() returns stays the same until something changes', async t => {
  const store = createHistoryStore(stub([listOf('a')]))
  await store.refresh()
  const first = store.get()
  assert.equal(store.get(), first)
  store.setCompare(true)
  assert.notEqual(store.get(), first)
})
