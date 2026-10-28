import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { draftModelId, newDraft, splitDraftModelId } from '../src/core/drafts.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import type { State } from '../src/core/state.ts'
import { listDrafts, modelOfDraft, repoOf } from '../src/node/drafts.ts'
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
  const root = await mkdtemp(join(tmpdir(), 'flowy-drafts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'name: Home\nobjects:\n  house:\n    type: system\n    name: House\n  router:\n    type: app\n    name: Router\n    in: house\n')
  return { root, dir }
}

test('a new draft copies the shapes it names, what they sit in and the lines between them', () => {
  const draft = newDraft(home(), { name: 'LAN', about: 'Packets on the LAN.', copy: ['router', 'laptop'] })
  assert.deepEqual(Object.keys(draft.objects), ['house', 'router', 'laptop'])
  assert.deepEqual(draft.connections, [{ from: 'laptop', to: 'router', label: 'sends packets' }])
  assert.deepEqual(draft.meta, { name: 'LAN', about: 'Packets on the LAN.', icons: { plug: 'M4 4h16' }, lines: 'curved' })
  assert.deepEqual(draft.flows, {})
})

test('a copy is a copy: changing it leaves the model as it was', () => {
  const model = home()
  const draft = newDraft(model, { name: 'LAN', copy: ['router'] })
  draft.objects.router.name = 'Mesh'
  assert.equal(model.objects.router.name, 'Router')
})

test('a new draft with nothing to copy is empty, and one naming a shape that is not there is refused', () => {
  assert.deepEqual(newDraft(home(), { name: 'Blank' }).objects, {})
  assert.throws(() => newDraft(home(), { name: 'X', copy: ['router', 'fridge'] }), /no shape "fridge"/)
})

test('a draft id names its model and its draft', () => {
  assert.equal(draftModelId('', 'lan'), 'drafts/lan')
  assert.equal(draftModelId('flowy', 'lan'), 'flowy/drafts/lan')
  assert.deepEqual(splitDraftModelId('flowy/drafts/lan'), { model: 'flowy', id: 'lan' })
  assert.deepEqual(splitDraftModelId('drafts/lan'), { model: '', id: 'lan' })
  assert.equal(splitDraftModelId('flowy'), undefined)
  assert.equal(splitDraftModelId('flowy/drafts/Bad Name'), undefined)
})

test('the model never reads its drafts, and its state lists them', async t => {
  const { root, dir } = await repo(t)
  await mkdir(join(dir, 'drafts', 'lan', 'flows'), { recursive: true })
  await writeFile(join(dir, 'drafts', 'lan', 'model.yaml'), 'name: LAN transfer\nobjects:\n  nas:\n    type: system\n    name: NAS\n')
  await writeFile(join(dir, 'drafts', 'lan', 'flows', 'copy.yaml'), 'name: Copy\nview: root\nsteps:\n  - from: nas\n    text: Stores\n')
  await mkdir(join(dir, 'drafts', 'empty-folder'))
  const { model } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.objects), ['house', 'router'])
  assert.deepEqual(model.flows, {})
  assert.deepEqual(await listDrafts(dir), [{ id: 'lan', name: 'LAN transfer' }])
  const state = (await loadState(dir)) as Loaded
  assert.deepEqual(state.drafts, [{ id: 'lan', name: 'LAN transfer' }])
  assert.equal(state.draft, undefined)
  const draft = (await loadState(join(dir, 'drafts', 'lan'))) as Loaded
  assert.deepEqual(draft.draft, { of: 'Home' })
  assert.equal(draft.drafts, undefined)
  assert.deepEqual(Object.keys(draft.flows), ['copy'])
  assert.equal(modelOfDraft(join(dir, 'drafts', 'lan')), dir)
  assert.equal(modelOfDraft(dir), undefined)
  assert.equal(repoOf(join(dir, 'drafts', 'lan')), root) // a copied shape's code paths still start at the repo
})

test('a draft\'s code paths are read from the repo, as the model\'s are', async t => {
  const { root, dir } = await repo(t)
  await mkdir(join(root, 'src'))
  await mkdir(join(dir, 'drafts', 'lan'), { recursive: true })
  await writeFile(join(dir, 'drafts', 'lan', 'model.yaml'), 'objects:\n  nas:\n    type: system\n    name: NAS\n    code: [src/]\n')
  const { problems } = await loadReport(join(dir, 'drafts', 'lan'))
  assert.deepEqual(problems.filter(p => /code|src/.test(p.message)), [])
})

test('the server opens a draft by its id and makes a new one', async t => {
  const { root, dir } = await repo(t)
  const server = await startServer({ dir, ui: join(root, 'ui'), port: 0 })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  assert.equal((await fetch(`${base}/api/state?model=drafts%2Flan`)).status, 404) // not there yet
  const make = (body: unknown, headers: Record<string, string> = { 'X-Flowy': '1' }) => fetch(`${base}/api/drafts`, { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await make({ id: 'lan', name: 'LAN' }, {})).status, 403)
  assert.equal((await make({ id: 'Bad id', name: 'LAN' })).status, 400)
  assert.equal((await make({ id: 'lan', name: ' ' })).status, 400)
  const made = await make({ id: 'lan', name: 'LAN transfer' })
  assert.equal(made.status, 201)
  assert.deepEqual(await made.json(), { id: 'drafts/lan' })
  assert.equal((await make({ id: 'lan', name: 'Again' })).status, 409)
  const draft = (await (await fetch(`${base}/api/state?model=drafts%2Flan`)).json()) as Loaded
  assert.equal(draft.model.meta.name, 'LAN transfer')
  assert.deepEqual(draft.draft, { of: 'Home' })
  // A write to the draft lands in its folder and leaves the model alone.
  const res = await fetch(`${base}/api/file/model.yaml?model=drafts%2Flan`, {
    method: 'PUT', headers: { 'X-Flowy': '1' },
    body: JSON.stringify({ version: draft.versions['model.yaml'], data: { name: 'LAN transfer', objects: { nas: { type: 'system', name: 'NAS' } }, connections: [] } }),
  })
  assert.equal(res.status, 200)
  assert.match(await readFile(join(dir, 'drafts', 'lan', 'model.yaml'), 'utf8'), /NAS/)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /NAS/)
  const model = (await (await fetch(`${base}/api/state`)).json()) as Loaded
  assert.deepEqual(model.drafts, [{ id: 'lan', name: 'LAN transfer' }])
  // A draft holds no drafts.
  const inner = await fetch(`${base}/api/drafts?model=drafts%2Flan`, { method: 'POST', headers: { 'X-Flowy': '1' }, body: JSON.stringify({ id: 'x', name: 'X' }) })
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

test('mcp: an AI drafts a flow between real shapes without touching the model', async t => {
  const { dir, call } = await mcp(t)
  const made = await call('new_draft', { id: 'wlan', name: 'WLAN transfer', copy: ['router'] })
  assert.equal(made.error, false, made.text)
  assert.match(made.text, /2 shapes and 0 lines/)
  assert.equal((await call('put_object', { draft: 'wlan', id: 'phone', type: 'app', in: 'house', name: 'Phone' })).error, false)
  assert.equal((await call('connect', { draft: 'wlan', from: 'phone', to: 'router', label: 'sends over Wi-Fi' })).error, false)
  const flow = await call('put_flow', { draft: 'wlan', id: 'send', name: 'Send a photo', view: 'house', steps: [{ from: 'phone', to: 'router', text: 'Sends the photo' }] })
  assert.equal(flow.error, false, flow.text)
  const draft = JSON.parse((await call('get_model', { draft: 'wlan' })).text)
  assert.deepEqual(Object.keys(draft.objects).sort(), ['house', 'phone', 'router'])
  const model = JSON.parse((await call('get_model')).text)
  assert.deepEqual(Object.keys(model.objects).sort(), ['house', 'router'])
  assert.deepEqual(Object.keys(model.flows), [])
  assert.ok(existsSync(join(dir, 'drafts', 'wlan', 'flows', 'send.yaml')))
  assert.deepEqual(JSON.parse((await call('list_drafts')).text), { drafts: [{ id: 'wlan', name: 'WLAN transfer' }] })
})

test('mcp: a draft that is not there is refused, and delete_draft removes one', async t => {
  const { dir, call } = await mcp(t)
  const missing = await call('get_model', { draft: 'nope' })
  assert.equal(missing.error, true)
  assert.match(missing.text, /no draft "nope"/)
  assert.equal((await call('new_draft', { id: 'lan', name: 'LAN', copy: ['fridge'] })).error, true)
  assert.equal(existsSync(join(dir, 'drafts', 'lan')), false) // nothing half made
  assert.equal((await call('new_draft', { id: 'lan', name: 'LAN' })).error, false)
  assert.equal((await call('new_draft', { id: 'lan', name: 'LAN' })).error, true)
  assert.equal((await call('delete_draft', { id: 'lan' })).error, false)
  assert.equal(existsSync(join(dir, 'drafts', 'lan')), false)
  assert.equal((await call('delete_draft', { id: 'lan' })).error, true)
})
