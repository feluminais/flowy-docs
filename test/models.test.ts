import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { State } from '../src/core/state.ts'
import { entryOf, findModels } from '../src/node/models.ts'
import { startServer } from '../src/node/server.ts'
import { addressOf, labelOf, modelOfPage } from '../ui/src/models.ts'
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
  assert.deepEqual(await (await fetch(`${base}/api/models`)).json(), models.map(({ id, name, where }) => ({ id, name, where })))
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

test('a switcher shows the folder only when names collide', () => {
  const a = { id: 'a/flowy', name: 'api', where: 'a/flowy' }
  const b = { id: 'b/flowy', name: 'api', where: 'b/flowy' }
  const c = { id: 'c/flowy', name: 'web', where: 'c/flowy' }
  assert.equal(labelOf([a, b, c], a), 'api (a/flowy)')
  assert.equal(labelOf([a, b, c], c), 'web')
})
