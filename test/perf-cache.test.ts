import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { childCount, computeView, hasChildren, isView, memberIds } from '../src/core/views.ts'
import { loadDir, loadState } from '../src/node/files.ts'
import { startServer } from '../src/node/server.ts'
import { spotsOf, viewSpots } from '../src/core/layout.ts'
import type { State } from '../src/core/state.ts'

/** A state that read: the folder had nothing the files could not be read for. */
function read(state: State) {
  assert.ok(!('parseError' in state), 'the folder reads')
  return state
}

const MODEL = `objects:
  shop: { type: system, name: Shop }
  api: { type: app, name: API, in: shop }
  db: { type: store, name: DB, in: shop }
connections:
  - { from: api, to: db }
`
const FLOW = `name: Order
view: root
steps:
  - { from: api, to: db, text: Save }
`

async function folder(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  await mkdir(join(dir, 'flows'), { recursive: true })
  await writeFile(join(dir, 'model.yaml'), MODEL)
  await writeFile(join(dir, 'flows', 'order.yaml'), FLOW)
  return dir
}

const model = (): Model => ({
  ...emptyModel(),
  objects: { shop: { type: 'system', name: 'Shop' }, api: { type: 'app', name: 'API', in: 'shop' }, db: { type: 'store', name: 'DB', in: 'shop' } },
  connections: [{ from: 'api', to: 'db' }],
})

test('children are found by parent, and a model with other shapes is asked afresh', () => {
  const m = model()
  assert.deepEqual(memberIds(m, 'shop'), ['api', 'db'])
  assert.equal(childCount(m, 'shop'), 2)
  assert.equal(hasChildren(m, 'api'), false)
  assert.equal(isView(m, 'shop'), true)
  assert.equal(isView(m, 'api'), false)
  const next: Model = { ...m, objects: { ...m.objects, cache: { type: 'store', name: 'Cache', in: 'api' } } }
  assert.equal(hasChildren(next, 'api'), true)
  assert.deepEqual(memberIds(next, 'api'), ['cache'])
  assert.equal(hasChildren(m, 'api'), false, 'the first model is as it was')
})

test('what memberIds gives can be changed without changing the model', () => {
  const m = model()
  memberIds(m, 'shop').push('x')
  assert.deepEqual(memberIds(m, 'shop'), ['api', 'db'])
})

test('a view with every box saved is drawn where the layout says, without a layout of its own', () => {
  const m = model()
  m.layout = { shop: { api: [10, 20], db: [300, 20] } }
  const v = computeView(m, 'shop')
  const spots = spotsOf(m, 'shop', v, ['api', 'db'])
  assert.deepEqual([...spots], [['api', { x: 10, y: 20 }], ['db', { x: 300, y: 20 }]])
  assert.equal(viewSpots(m, 'shop').size, 2)
})

test('a box without a saved place is put clear of the saved ones', () => {
  const m = model()
  m.layout = { shop: { api: [0, 0] } }
  const spots = viewSpots(m, 'shop')
  const [a, d] = [spots.get('api')!, spots.get('db')!]
  assert.deepEqual(a, { x: 0, y: 0 })
  assert.ok(Math.abs(a.x - d.x) >= 200 || Math.abs(a.y - d.y) >= 70, 'the boxes do not cover each other')
})

test('a folder read again with nothing changed gives the same state, and a save gives a new one', async t => {
  const dir = await folder(t)
  const first = await loadState(dir)
  assert.equal(await loadState(dir), first)
  await writeFile(join(dir, 'flows', 'order.yaml'), FLOW.replace('Save', 'Store'))
  const second = await loadState(dir)
  assert.notEqual(second, first)
  assert.equal(read(second).flows.order.steps[0].text, 'Store')
  assert.equal(read(first).flows.order.steps[0].text, 'Save', 'the state read before is not changed')
})

test('a file that gets worse is a problem again, not the last good read', async t => {
  const dir = await folder(t)
  await loadState(dir)
  await writeFile(join(dir, 'flows', 'order.yaml'), 'name: [\n')
  const state = await loadState(dir)
  assert.ok('parseError' in state, 'the flow no longer reads')
  await writeFile(join(dir, 'flows', 'order.yaml'), FLOW)
  assert.ok(!('parseError' in (await loadState(dir))))
})

test('the files of a loaded folder cannot be changed by whoever is handed them', async t => {
  const dir = await folder(t)
  const { model: loaded } = await loadDir(dir)
  assert.throws(() => { loaded.connections.push({ from: 'a', to: 'b' }) }, TypeError)
  const again = (await loadDir(dir)).model
  assert.equal(again.connections.length, 1)
})

test('askers who come while a read runs share the read that starts after it, and see a change made meanwhile', async t => {
  const dir = await folder(t)
  const first = loadState(dir)
  await writeFile(join(dir, 'flows', 'order.yaml'), FLOW.replace('Save', 'Later'))
  const [a, b, c] = [loadState(dir), loadState(dir), loadState(dir)]
  assert.equal(await a, await b)
  assert.equal(await b, await c)
  assert.equal(read(await c).flows.order.steps[0].text, 'Later')
  await first
})

test('state is sent with a tag, and answered 304 while the page already holds it', async t => {
  const dir = await folder(t)
  const server = await startServer({ dir, ui: join(dir, 'ui'), port: 0 })
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.port}/api/state`
  const first = await fetch(url)
  assert.equal(first.status, 200)
  const tag = first.headers.get('etag')
  assert.ok(tag)
  assert.equal(first.headers.get('cache-control'), 'no-cache')
  const same = await fetch(url, { headers: { 'If-None-Match': tag } })
  assert.equal(same.status, 304)
  await writeFile(join(dir, 'flows', 'order.yaml'), FLOW.replace('Save', 'Changed'))
  const changed = await fetch(url, { headers: { 'If-None-Match': tag } })
  assert.equal(changed.status, 200)
  assert.notEqual(changed.headers.get('etag'), tag)
})
