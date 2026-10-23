import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { State } from '../src/core/state.ts'
import { parse } from 'node:path'
import { folderTree } from '../src/core/modellist.ts'
import type { FolderNode } from '../src/core/modellist.ts'
import { broadOf, Catalog, entryOf, findModels, QUICK, scanModels } from '../src/node/models.ts'
import { startServer } from '../src/node/server.ts'
import { addressOf, modelOfPage } from '../ui/src/models.ts'
import { apiUrl } from '../ui/src/apiurl.ts'

/** A repo with a flowy/ folder at the top, two in services, and look-alikes that must not count. */
async function repo(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const model = async (rel: string, name: string) => {
    await mkdir(join(root, rel), { recursive: true })
    await writeFile(join(root, rel, 'model.yaml'), `objects:\n  thing:\n    type: system\n    name: ${name}\n`)
  }
  await model('flowy', 'Top')
  await model('services/billing/flowy', 'Billing')
  await model('services/dispatch/flowy', 'Dispatch')
  await model('node_modules/dep/flowy', 'Not mine') // dependencies are not searched
  await model('desktop/publish/app/flowy', 'A build copy') // nor are build copies or test inputs
  await model('desktop/fixtures/case/flowy', 'A test input')
  await model('.hidden/flowy', 'Hidden')
  await mkdir(join(root, 'services/empty/flowy'), { recursive: true }) // no model.yaml
  return root
}

test('findModels lists every flowy folder with a model.yaml, the nearest the top first', async t => {
  const root = await repo(t)
  const found = await findModels(root)
  assert.deepEqual(found.map(m => m.id), ['flowy', 'services/billing/flowy', 'services/dispatch/flowy'])
  assert.deepEqual(found.map(m => m.name), [basename(root), 'billing', 'dispatch'])
  assert.equal(found[1].where, 'services/billing/flowy')
})

test('findModels finds nothing in a repo without one', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(await findModels(root), [])
})

test('entryOf names a folder for the place it sits in', () => {
  assert.equal(entryOf('/r', '/r/api/flowy').name, 'api')
  assert.equal(entryOf('/r', '/r/docs/arch').name, 'arch')
  assert.equal(entryOf('/r', '/r/docs/arch').id, 'docs/arch')
})

test('one server shows several models, each with its own files', async t => {
  const root = await repo(t)
  const models = (await findModels(root)).map(m => ({ ...m }))
  const server = await startServer({ dir: models[0].dir, ui: join(root, 'ui'), port: 0, models })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  const listed = (await (await fetch(`${base}/api/models`)).json()) as { models: unknown[]; scope?: unknown; state: string }
  assert.deepEqual(listed.models, models.map(({ id, name, where }) => ({ id, name, where })))
  assert.equal(listed.scope, undefined) // named, not searched for
  assert.equal(listed.state, 'done')
  const nameIn = async (query: string) => {
    const state = (await (await fetch(`${base}/api/state${query}`)).json()) as Extract<State, { model: unknown }>
    return state.model.objects.thing.name
  }
  assert.equal(await nameIn(''), 'Top') // the first is the default
  assert.equal(await nameIn('?model=services%2Fbilling%2Fflowy'), 'Billing')
  assert.equal(await nameIn('?model=services/dispatch/flowy'), 'Dispatch')
  assert.equal((await fetch(`${base}/api/state?model=nope`)).status, 404)
})

test('a write goes to the model it names', async t => {
  const root = await repo(t)
  const models = await findModels(root)
  const server = await startServer({ dir: models[0].dir, ui: join(root, 'ui'), port: 0, models })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  const stateOf = async (id: string) => (await (await fetch(`${base}/api/state?model=${encodeURIComponent(id)}`)).json()) as Extract<State, { model: unknown }>
  const before = await stateOf('services/billing/flowy')
  const res = await fetch(`${base}/api/file/model.yaml?model=${encodeURIComponent('services/billing/flowy')}`, {
    method: 'PUT',
    headers: { 'X-Flowy': '1' },
    body: JSON.stringify({ version: before.versions['model.yaml'], data: { objects: { thing: { type: 'system', name: 'Billing 2' } }, connections: [] } }),
  })
  assert.equal(res.status, 200)
  assert.equal((await stateOf('services/billing/flowy')).model.objects.thing.name, 'Billing 2')
  assert.equal((await stateOf('flowy')).model.objects.thing.name, 'Top')
})

test('the page asks for its model by ?model=', () => {
  assert.equal(modelOfPage(''), undefined)
  assert.equal(modelOfPage('?model=a%2Fb'), 'a/b')
  assert.equal(apiUrl('', '/api/state'), '/api/state')
  assert.equal(apiUrl('http://x', '/api/state', 'a/b'), 'http://x/api/state?model=a%2Fb')
  assert.equal(apiUrl('', '/api/h?x=1', 'a'), '/api/h?x=1&model=a')
  assert.equal(addressOf('a/b', { pathname: '/' }), '/?model=a%2Fb')
})

/** Folders `names` deep under `root`, ending in a flowy/ model. */
async function deep(root: string, ...names: string[]) {
  const dir = join(root, ...names, 'flowy')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  thing:\n    type: system\n    name: Deep\n')
}

test('a search goes only as deep as it is told, and says that it left folders unopened', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await deep(root, 'a')
  await deep(root, 'a', 'b', 'c', 'd')
  const quick = await scanModels(root, QUICK)
  assert.deepEqual(quick.models.map(m => m.where), ['a/flowy'])
  assert.equal(quick.leftUnopened, true)
  assert.equal(quick.stoppedBy, undefined)
  const more = await scanModels(root, { ...QUICK, depth: 6 })
  assert.deepEqual(more.models.map(m => m.where), ['a/flowy', 'a/b/c/d/flowy'])
  assert.equal(more.leftUnopened, false)
})

test('a search stops at its folder count and keeps what it found', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await deep(root, 'first')
  for (let i = 0; i < 40; i++) await mkdir(join(root, `wide-${i}`, 'inner'), { recursive: true })
  const stopped = await scanModels(root, { depth: 5, folders: 10, ms: Infinity })
  assert.equal(stopped.stoppedBy, 'folders')
  assert.ok(stopped.looked <= 10, `looked in ${stopped.looked}`)
  assert.deepEqual(stopped.models.map(m => m.where), ['first/flowy']) // the nearest the top came first
})

test('a search stops when it is told to', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await deep(root, 'a')
  const abort = new AbortController()
  abort.abort()
  const stopped = await scanModels(root, QUICK, { signal: abort.signal })
  assert.equal(stopped.stoppedBy, 'user')
  assert.equal(stopped.looked, 0)
})

test('the catalog offers a deeper search only where one could find more, and keeps earlier finds', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await deep(root, 'a')
  await deep(root, 'a', 'b', 'c', 'd')
  const catalog = new Catalog(root)
  await catalog.scan(QUICK)
  const quick = catalog.list()
  assert.deepEqual(quick.models.map(m => m.where), ['a/flowy'])
  assert.deepEqual([quick.state, quick.canDeepen, quick.deeper, quick.scope?.depth], ['done', true, false, 3])
  await catalog.scan({ depth: 6, folders: 1000, ms: 10_000 }, true)
  const deeper = catalog.list()
  assert.deepEqual(deeper.models.map(m => m.where), ['a/flowy', 'a/b/c/d/flowy'])
  assert.deepEqual([deeper.canDeepen, deeper.deeper], [false, true])
  const small = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(small, { recursive: true, force: true }))
  await deep(small, 'a')
  const whole = new Catalog(small)
  await whole.scan(QUICK)
  assert.equal(whole.list().canDeepen, false) // it looked everywhere
})

test('a drive or the home folder is called out as broad', () => {
  assert.equal(broadOf(parse(process.cwd()).root), 'drive')
  assert.equal(broadOf(process.cwd()), undefined)
})

test('the server lists what a search finds, opens a found model when it is asked for, and searches deeper on request', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-models-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await deep(root, 'a')
  await deep(root, 'a', 'b', 'c', 'd')
  const catalog = new Catalog(root)
  await catalog.scan(QUICK)
  const first = catalog.entries()[0]
  const server = await startServer({ dir: first.dir, ui: join(root, 'ui'), port: 0, models: [{ ...first }], discovery: { catalog } })
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.port}`
  const list = async () => (await (await fetch(`${base}/api/models`)).json()) as ReturnType<Catalog['list']>
  assert.deepEqual((await list()).models.map(m => m.where), ['a/flowy'])
  assert.equal((await fetch(`${base}/api/models/scan`, { method: 'POST' })).status, 403) // the header other sites can't send
  assert.equal((await fetch(`${base}/api/state?model=a%2Fb%2Fc%2Fd%2Fflowy`)).status, 404) // not found yet
  assert.equal((await fetch(`${base}/api/models/scan`, { method: 'POST', headers: { 'X-Flowy': '1' } })).status, 202)
  for (let i = 0; i < 100 && (await list()).state === 'scanning'; i++) await new Promise(r => setTimeout(r, 20))
  assert.deepEqual((await list()).models.map(m => m.where), ['a/flowy', 'a/b/c/d/flowy'])
  const state = (await (await fetch(`${base}/api/state?model=a%2Fb%2Fc%2Fd%2Fflowy`)).json()) as Extract<State, { model: unknown }>
  assert.equal(state.model.objects.thing.name, 'Deep') // opened on its first request
})

test('the folder view holds only the folders that lead to a model', () => {
  const at = (where: string) => ({ id: where, name: where.split('/').slice(-2)[0], where })
  const names = (nodes: FolderNode[]): unknown[] => nodes.map(n => (n.children.length > 0 ? [n.name, n.model !== undefined, names(n.children)] : n.name))
  const tree = folderTree([at('folder 1/level2/flowy'), at('folder 1/level2/level3/flowy'), at('folder 2/two/three/flowy')])
  assert.deepEqual(names(tree), [['folder 1', false, [['level2', true, ['level3']]]], ['folder 2', false, [['two', false, ['three']]]]])
  assert.equal(tree[0].children[0].model?.id, 'folder 1/level2/flowy')
  assert.equal(tree[0].children[0].children[0].path, 'folder 1/level2/level3')
})

test('a model at the top of the searched folder is the first row, and a query keeps its way down', () => {
  const top = { id: 'flowy', name: 'Plum', where: 'flowy' }
  const api = { id: 'services/api/flowy', name: 'api', where: 'services/api/flowy' }
  const web = { id: 'web/flowy', name: 'web', where: 'web/flowy' }
  const all = folderTree([top, api, web])
  assert.deepEqual([all.length, all[0].name, all[0].model?.id, all[0].children.map(c => c.name)], [1, 'Plum', 'flowy', ['services', 'web']])
  const found = folderTree([top, api, web], 'API')
  assert.deepEqual(found.map(n => n.name), ['services'])
  assert.equal(found[0].children[0].model?.id, 'services/api/flowy')
  assert.deepEqual(folderTree([top, api, web], 'zzz'), [])
})
