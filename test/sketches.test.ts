import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { newSketch, sketchModelId, splitSketchModelId } from '../src/core/sketches.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import type { State } from '../src/core/state.ts'
import { hasSketch, listSketches, modelOfSketch, repoOf, sketchDir, sketchFolderIn } from '../src/node/sketches.ts'
import { createSketch, deleteSketch } from '../src/node/sketchwrites.ts'
import { loadDir, loadReport, loadState } from '../src/node/files.ts'
import { createMcpServer } from '../src/node/mcp.ts'
import { startServer } from '../src/node/server.ts'

type Loaded = Extract<State, { model: unknown }>

/** A home network: a house with a router and a laptop in it, a printer outside, and lines between them. */
const home = (): Model => ({
  ...emptyModel(),
  meta: { name: 'Home', lines: 'curved', icons: { plug: 'M4 4h16' } },
  objects: {
    house: { type: 'system', name: 'House' },
    router: { type: 'app', name: 'Router', in: 'house', icon: 'plug' },
    laptop: { type: 'app', name: 'Laptop', in: 'house' },
    printer: { type: 'system', name: 'Printer' },
  },
  connections: [{ from: 'laptop', to: 'router', label: 'sends packets' }, { from: 'router', to: 'printer' }],
})

/** A repo with flowy/ holding the home network, and nothing else. */
async function repo(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-sketches-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'name: Home\nobjects:\n  house:\n    type: system\n    name: House\n  router:\n    type: app\n    name: Router\n    in: house\n')
  return { root, dir }
}

test('a new sketch copies the shapes it names, what they sit in and the lines between them', () => {
  const sketch = newSketch(home(), { name: 'LAN', about: 'Packets on the LAN.', copy: ['router', 'laptop'] })
  assert.deepEqual(Object.keys(sketch.objects), ['house', 'router', 'laptop'])
  assert.deepEqual(sketch.connections, [{ from: 'laptop', to: 'router', label: 'sends packets' }])
  assert.deepEqual(sketch.meta, { name: 'LAN', about: 'Packets on the LAN.', pairs: 'separate', icons: { plug: 'M4 4h16' }, lines: 'curved' })
  assert.deepEqual(sketch.flows, {})
})

test('a copy is a copy: changing it leaves the model as it was', () => {
  const model = home()
  const sketch = newSketch(model, { name: 'LAN', copy: ['router'] })
  sketch.objects.router.name = 'Mesh'
  assert.equal(model.objects.router.name, 'Router')
})

test('a new sketch with nothing to copy is empty, and one naming a shape that is not there is refused', () => {
  assert.deepEqual(newSketch(home(), { name: 'Blank' }).objects, {})
  assert.throws(() => newSketch(home(), { name: 'X', copy: ['router', 'fridge'] }), /no shape "fridge"/)
})

test('a sketch id names its model and its sketch', () => {
  assert.equal(sketchModelId('', 'lan'), 'sketches/lan')
  assert.equal(sketchModelId('flowy', 'lan'), 'flowy/sketches/lan')
  assert.deepEqual(splitSketchModelId('flowy/sketches/lan'), { model: 'flowy', id: 'lan' })
  assert.deepEqual(splitSketchModelId('sketches/lan'), { model: '', id: 'lan' })
  assert.equal(splitSketchModelId('flowy'), undefined)
  assert.equal(splitSketchModelId('flowy/sketches/Bad Name'), undefined)
})

test('the model never reads its sketches, and its state lists them', async t => {
  const { root, dir } = await repo(t)
  await mkdir(join(dir, 'sketches', 'lan', 'flows'), { recursive: true })
  await writeFile(join(dir, 'sketches', 'lan', 'model.yaml'), 'name: LAN transfer\nobjects:\n  nas:\n    type: system\n    name: NAS\n')
  await writeFile(join(dir, 'sketches', 'lan', 'flows', 'copy.yaml'), 'name: Copy\nview: root\nsteps:\n  - from: nas\n    text: Stores\n')
  await mkdir(join(dir, 'sketches', 'empty-folder'))
  const { model } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.objects), ['house', 'router'])
  assert.deepEqual(model.flows, {})
  assert.deepEqual(await listSketches(dir), [{ id: 'lan', name: 'LAN transfer' }])
  const state = (await loadState(dir)) as Loaded
  assert.deepEqual(state.sketches, [{ id: 'lan', name: 'LAN transfer' }])
  assert.equal(state.sketch, undefined)
  const sketch = (await loadState(join(dir, 'sketches', 'lan'))) as Loaded
  assert.deepEqual(sketch.sketch, { of: 'Home' })
  assert.equal(sketch.sketches, undefined)
  assert.deepEqual(Object.keys(sketch.flows), ['copy'])
  assert.equal(modelOfSketch(join(dir, 'sketches', 'lan')), dir)
  assert.equal(modelOfSketch(dir), undefined)
  assert.equal(repoOf(join(dir, 'sketches', 'lan')), root) // a copied shape's code paths still start at the repo
})

test('a sketch\'s code paths are read from the repo, as the model\'s are', async t => {
  const { root, dir } = await repo(t)
  await mkdir(join(root, 'src'))
  await mkdir(join(dir, 'sketches', 'lan'), { recursive: true })
  await writeFile(join(dir, 'sketches', 'lan', 'model.yaml'), 'objects:\n  nas:\n    type: system\n    name: NAS\n    code: [src/]\n')
  const { problems } = await loadReport(join(dir, 'sketches', 'lan'))
  assert.deepEqual(problems.filter(p => /code|src/.test(p.message)), [])
})

test('the server opens a sketch by its id and makes a new one', async t => {
  const { root, dir } = await repo(t)
  const server = await startServer({ dir, ui: join(root, 'ui'), port: 0 })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  assert.equal((await fetch(`${base}/api/state?model=sketches%2Flan`)).status, 404) // not there yet
  const make = (body: unknown, headers: Record<string, string> = { 'X-Flowy': '1' }) => fetch(`${base}/api/sketches`, { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await make({ id: 'lan', name: 'LAN' }, {})).status, 403)
  assert.equal((await make({ id: 'Bad id', name: 'LAN' })).status, 400)
  assert.equal((await make({ id: 'lan', name: ' ' })).status, 400)
  const made = await make({ id: 'lan', name: 'LAN transfer' })
  assert.equal(made.status, 201)
  assert.deepEqual(await made.json(), { id: 'sketches/lan' })
  assert.equal((await make({ id: 'lan', name: 'Again' })).status, 409)
  const sketch = (await (await fetch(`${base}/api/state?model=sketches%2Flan`)).json()) as Loaded
  assert.equal(sketch.model.meta.name, 'LAN transfer')
  assert.deepEqual(sketch.sketch, { of: 'Home' })
  // A write to the sketch lands in its folder and leaves the model alone.
  const res = await fetch(`${base}/api/file/model.yaml?model=sketches%2Flan`, {
    method: 'PUT', headers: { 'X-Flowy': '1' },
    body: JSON.stringify({ version: sketch.versions['model.yaml'], data: { name: 'LAN transfer', objects: { nas: { type: 'system', name: 'NAS' } }, connections: [] } }),
  })
  assert.equal(res.status, 200)
  assert.match(await readFile(join(dir, 'sketches', 'lan', 'model.yaml'), 'utf8'), /NAS/)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /NAS/)
  const model = (await (await fetch(`${base}/api/state`)).json()) as Loaded
  assert.deepEqual(model.sketches, [{ id: 'lan', name: 'LAN transfer' }])
  // A sketch holds no sketches.
  const inner = await fetch(`${base}/api/sketches?model=sketches%2Flan`, { method: 'POST', headers: { 'X-Flowy': '1' }, body: JSON.stringify({ id: 'x', name: 'X' }) })
  assert.equal(inner.status, 400)
})

/** An MCP client on the home network's folder. */
async function mcp(t: TestContext) {
  const { dir } = await repo(t)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(() => client.close())
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    return { error: result.isError === true, text: (result.content as { text: string }[])[0].text }
  }
  return { dir, call }
}

test('mcp: an AI sketches a flow between real shapes without touching the model', async t => {
  const { dir, call } = await mcp(t)
  const made = await call('new_sketch', { id: 'wlan', name: 'WLAN transfer', copy: ['router'] })
  assert.equal(made.error, false, made.text)
  assert.match(made.text, /2 shapes and 0 lines/)
  assert.equal((await call('put_object', { sketch: 'wlan', id: 'phone', type: 'app', in: 'house', name: 'Phone' })).error, false)
  assert.equal((await call('connect', { sketch: 'wlan', from: 'phone', to: 'router', label: 'sends over Wi-Fi' })).error, false)
  const flow = await call('put_flow', { sketch: 'wlan', id: 'send', name: 'Send a photo', view: 'house', steps: [{ from: 'phone', to: 'router', text: 'Sends the photo' }] })
  assert.equal(flow.error, false, flow.text)
  const sketch = JSON.parse((await call('get_model', { sketch: 'wlan' })).text)
  assert.deepEqual(Object.keys(sketch.objects).sort(), ['house', 'phone', 'router'])
  const model = JSON.parse((await call('get_model')).text)
  assert.deepEqual(Object.keys(model.objects).sort(), ['house', 'router'])
  assert.deepEqual(Object.keys(model.flows), [])
  assert.ok(existsSync(join(dir, 'sketches', 'wlan', 'flows', 'send.yaml')))
  assert.deepEqual(JSON.parse((await call('get_sketches')).text), { sketches: [{ id: 'wlan', name: 'WLAN transfer' }] })
})

test('mcp: a sketch that is not there is refused, and delete_sketch removes one', async t => {
  const { dir, call } = await mcp(t)
  const missing = await call('get_model', { sketch: 'nope' })
  assert.equal(missing.error, true)
  assert.match(missing.text, /no sketch "nope"/)
  assert.equal((await call('new_sketch', { id: 'lan', name: 'LAN', copy: ['fridge'] })).error, true)
  assert.equal(existsSync(join(dir, 'sketches', 'lan')), false) // nothing half made
  assert.equal((await call('new_sketch', { id: 'lan', name: 'LAN' })).error, false)
  assert.equal((await call('new_sketch', { id: 'lan', name: 'LAN' })).error, true)
  assert.equal((await call('delete_sketch', { id: 'lan' })).error, false)
  assert.equal(existsSync(join(dir, 'sketches', 'lan')), false)
  assert.equal((await call('delete_sketch', { id: 'lan' })).error, true)
})

// Sketches used to be drafts in drafts/<id>/. That folder is still read, new sketches go to sketches/, and the old MCP names still work.

/** Writes a sketch called `name` straight into `folder` of the model folder `dir`, the way an older Flowy left it. */
async function writeSketch(dir: string, folder: 'sketches' | 'drafts', id: string, name: string) {
  await mkdir(join(dir, folder, id), { recursive: true })
  await writeFile(join(dir, folder, id, 'model.yaml'), `name: ${name}\nobjects:\n  nas:\n    type: system\n    name: NAS\n`)
}

test('the old drafts/ folder is read as sketches, and sketches/ wins when both hold an id', async t => {
  const { root, dir } = await repo(t)
  await writeSketch(dir, 'drafts', 'old', 'Old one')
  await writeSketch(dir, 'drafts', 'both', 'In drafts')
  await writeSketch(dir, 'sketches', 'both', 'In sketches')
  await writeSketch(dir, 'sketches', 'new', 'New one')
  assert.deepEqual(await listSketches(dir), [{ id: 'both', name: 'In sketches' }, { id: 'new', name: 'New one' }, { id: 'old', name: 'Old one' }])
  assert.equal(hasSketch(dir, 'old'), true)
  assert.equal(hasSketch(dir, 'nope'), false)
  assert.equal(sketchDir(dir, 'old'), join(dir, 'drafts', 'old'))
  assert.equal(sketchDir(dir, 'both'), join(dir, 'sketches', 'both'))
  assert.equal(sketchDir(dir, 'fresh'), join(dir, 'sketches', 'fresh')) // where a new one would go
  assert.equal(sketchFolderIn(dir, 'old'), 'drafts/old')
  assert.equal(sketchFolderIn(dir, 'new'), 'sketches/new')
  assert.equal(modelOfSketch(join(dir, 'drafts', 'old')), dir)
  assert.equal(repoOf(join(dir, 'drafts', 'old')), root)
  const state = (await loadState(dir)) as Loaded
  assert.deepEqual(state.sketches?.map(s => s.id), ['both', 'new', 'old'])
  const old = (await loadState(join(dir, 'drafts', 'old'))) as Loaded
  assert.deepEqual(old.sketch, { of: 'Home' })
  assert.equal(old.sketches, undefined)
})

test('a served model id names a sketch as sketches/<id> or as the old drafts/<id>', () => {
  assert.deepEqual(splitSketchModelId('drafts/lan'), { model: '', id: 'lan' })
  assert.deepEqual(splitSketchModelId('flowy/drafts/lan'), { model: 'flowy', id: 'lan' })
  assert.deepEqual(splitSketchModelId('a/b/drafts/lan'), { model: 'a/b', id: 'lan' })
  assert.equal(splitSketchModelId('flowy/drafts/Bad Name'), undefined)
  assert.equal(sketchModelId('flowy', 'lan'), 'flowy/sketches/lan') // the old form is read, never made
})

test('creating a sketch writes sketches/, refuses an id the old drafts/ holds, and deleting removes every copy', async t => {
  const { dir } = await repo(t)
  await writeSketch(dir, 'drafts', 'old', 'Old one')
  await assert.rejects(createSketch(dir, 'old', newSketch(emptyModel(), { name: 'Again' })), /sketch "old" already/)
  await createSketch(dir, 'fresh', newSketch(emptyModel(), { name: 'Fresh' }))
  assert.ok(existsSync(join(dir, 'sketches', 'fresh', 'model.yaml')))
  assert.equal(existsSync(join(dir, 'drafts', 'fresh')), false)
  await writeSketch(dir, 'sketches', 'old', 'Shadow') // the same id in both folders
  await deleteSketch(dir, 'old')
  assert.equal(existsSync(join(dir, 'sketches', 'old')), false)
  assert.equal(existsSync(join(dir, 'drafts', 'old')), false)
  assert.equal(hasSketch(dir, 'old'), false)
  await assert.rejects(deleteSketch(dir, 'old'), /no sketch "old"/)
})

test('the server opens a sketch kept in drafts/ by either id, and POST /api/drafts still makes a sketch in sketches/', async t => {
  const { root, dir } = await repo(t)
  await writeSketch(dir, 'drafts', 'old', 'Old one')
  const server = await startServer({ dir, ui: join(root, 'ui'), port: 0 })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  for (const served of ['drafts%2Fold', 'sketches%2Fold']) {
    const state = (await (await fetch(`${base}/api/state?model=${served}`)).json()) as Loaded
    assert.equal(state.model.meta.name, 'Old one', served)
    assert.deepEqual(state.sketch, { of: 'Home' })
  }
  const made = await fetch(`${base}/api/drafts`, { method: 'POST', headers: { 'X-Flowy': '1' }, body: JSON.stringify({ id: 'lan', name: 'LAN transfer' }) })
  assert.equal(made.status, 201)
  assert.deepEqual(await made.json(), { id: 'sketches/lan' })
  assert.ok(existsSync(join(dir, 'sketches', 'lan', 'model.yaml')))
  assert.equal(existsSync(join(dir, 'drafts', 'lan')), false)
  assert.equal((await fetch(`${base}/api/drafts`, { method: 'POST', headers: { 'X-Flowy': '1' }, body: JSON.stringify({ id: 'old', name: 'Again' }) })).status, 409)
  // A write to a sketch in drafts/ lands in that folder.
  const old = (await (await fetch(`${base}/api/state?model=sketches%2Fold`)).json()) as Loaded
  const res = await fetch(`${base}/api/file/model.yaml?model=sketches%2Fold`, {
    method: 'PUT', headers: { 'X-Flowy': '1' },
    body: JSON.stringify({ version: old.versions['model.yaml'], data: { name: 'Old one', objects: { nas: { type: 'system', name: 'NAS 2' } }, connections: [] } }),
  })
  assert.equal(res.status, 200)
  assert.match(await readFile(join(dir, 'drafts', 'old', 'model.yaml'), 'utf8'), /NAS 2/)
})

test('mcp: the draft tools and the draft argument still work beside the sketch ones', async t => {
  const { dir, call } = await mcp(t)
  assert.deepEqual(JSON.parse((await call('get_sketches')).text), { sketches: [] })
  const made = await call('new_draft', { id: 'wlan', name: 'WLAN transfer', copy: ['router'] })
  assert.equal(made.error, false, made.text)
  assert.match(made.text, /Made sketch wlan/)
  assert.ok(existsSync(join(dir, 'sketches', 'wlan', 'model.yaml')))
  assert.equal(existsSync(join(dir, 'drafts')), false)
  // Either argument works on it, and they have to agree when both come.
  assert.equal((await call('put_object', { draft: 'wlan', id: 'phone', type: 'app', in: 'house', name: 'Phone' })).error, false)
  assert.equal((await call('put_object', { sketch: 'wlan', id: 'tablet', type: 'app', in: 'house', name: 'Tablet' })).error, false)
  const both = await call('get_model', { sketch: 'wlan', draft: 'wlan' })
  assert.deepEqual(Object.keys(JSON.parse(both.text).objects).sort(), ['house', 'phone', 'router', 'tablet'])
  const clash = await call('get_model', { sketch: 'wlan', draft: 'other' })
  assert.equal(clash.error, true)
  assert.match(clash.text, /not both/)
  const missing = await call('get_model', { draft: 'nope' })
  assert.match(missing.text, /no sketch "nope"/)
  // The old list answers under its old key, the new one under the new.
  assert.deepEqual(JSON.parse((await call('get_drafts')).text), { drafts: [{ id: 'wlan', name: 'WLAN transfer' }] })
  assert.deepEqual(JSON.parse((await call('get_sketches')).text), { sketches: [{ id: 'wlan', name: 'WLAN transfer' }] })
  assert.equal((await call('delete_draft', { id: 'wlan' })).error, false)
  assert.equal(existsSync(join(dir, 'sketches', 'wlan')), false)
  assert.equal((await call('delete_draft', { id: 'wlan' })).error, true)
})

test('mcp: a sketch left in drafts/ is listed, worked on and deleted by the sketch tools', async t => {
  const { dir, call } = await mcp(t)
  await writeSketch(dir, 'drafts', 'old', 'Old one')
  assert.deepEqual(JSON.parse((await call('get_sketches')).text), { sketches: [{ id: 'old', name: 'Old one' }] })
  assert.equal((await call('put_object', { sketch: 'old', id: 'disk', type: 'store', in: 'nas', name: 'Disk' })).error, false)
  assert.match(await readFile(join(dir, 'drafts', 'old', 'model.yaml'), 'utf8'), /Disk/)
  assert.equal(existsSync(join(dir, 'sketches')), false) // nothing was made beside it
  assert.equal((await call('delete_sketch', { id: 'old' })).error, false)
  assert.equal(existsSync(join(dir, 'drafts', 'old')), false)
})

test('mcp: every sketch tool is listed with its deprecated draft name', async t => {
  const { dir } = await repo(t)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(() => client.close())
  const byName = new Map((await client.listTools()).tools.map(tool => [tool.name, tool]))
  for (const [now, old] of [['get_sketches', 'get_drafts'], ['new_sketch', 'new_draft'], ['delete_sketch', 'delete_draft']]) {
    assert.ok(byName.has(now), now)
    assert.match(byName.get(old)?.description ?? '', new RegExp(`^Deprecated, use ${now}`), old)
  }
  const arg = (name: string) => (byName.get('get_model')?.inputSchema.properties?.[name] ?? {}) as { description?: string }
  assert.match(arg('sketch').description ?? '', /get_sketches/)
  assert.match(arg('draft').description ?? '', /^Deprecated/)
})
