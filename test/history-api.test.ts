import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { hashText } from '../src/node/files.ts'
import { openHistory } from '../src/node/history.ts'
import { createHistoryApi } from '../src/node/history-api.ts'

/** A model folder, a history over it, and the history routes behind a real HTTP server, so request bodies arrive as real streams. */
async function setup(t: TestContext, blockStateDir = false) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-api-'))
  const dir = join(root, 'flowy')
  await mkdir(dir, { recursive: true })
  const stateDir = join(root, 'state')
  if (blockStateDir) await writeFile(stateDir, 'in the way')
  let tick = 0
  const history = openHistory(dir, { app: 'browser', stateDir, now: () => new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + tick++), random: () => tick.toString(16).padStart(6, '0') })
  const api = createHistoryApi(history)
  const server = createServer(async (req, res) => {
    const answer = await api.handle(req, new URL(req.url ?? '/', 'http://localhost'))
    res.writeHead(answer?.status ?? 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(answer?.body ?? { error: 'not found' }))
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  t.after(async () => {
    api.close()
    await new Promise(done => server.close(done))
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`)
    return { status: res.status, body: (await res.json()) as any }
  }
  const post = async (path: string, body: unknown, headers: Record<string, string> = { 'X-Flowy': '1' }) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
    return { status: res.status, body: (await res.json()) as any }
  }
  const put = async (rel: string, content: string | Uint8Array) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), content)
  }
  return { root, dir, history, get, post, put }
}

test('GET /api/history lists the steps and says history is saving', async t => {
  const { get, put, history } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await history.record('One', 'you')
  const { status, body } = await get('/api/history')
  assert.equal(status, 200)
  assert.equal(body.saving, true)
  assert.equal('reason' in body, false)
  assert.deepEqual(body.steps.map((s: any) => [s.label, s.source, s.app, s.changed]), [['One', 'you', 'browser', ['model.yaml']]])
})

test('GET /api/history says why history is not saving', async t => {
  const { get, put, history } = await setup(t, true)
  await put('model.yaml', 'a: 1\n')
  await history.record('One', 'you')
  const { body } = await get('/api/history')
  assert.equal(body.saving, false)
  assert.ok(typeof body.reason === 'string' && body.reason.length > 0)
  assert.deepEqual(body.steps, [])
})

test('GET /api/history/steps/<id> gives the step, its files and the step before', async t => {
  const { get, put, history } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  const two = await history.record('Two', 'you')
  assert.ok(one && two)
  const { status, body } = await get(`/api/history/steps/${two.id}`)
  assert.equal(status, 200)
  assert.equal(body.step.label, 'Two')
  assert.deepEqual(body.files, { 'model.yaml': { text: 'a: 2\n' } })
  assert.deepEqual(body.previous, { id: one.id, files: { 'model.yaml': { text: 'a: 1\n' } } })
  const missing = await get('/api/history/steps/nope')
  assert.equal(missing.status, 404)
  assert.ok(typeof missing.body.error === 'string')
})

test('GET /api/yaml gives the files as they are, with their versions', async t => {
  const { get, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await put('layout.yaml', new Uint8Array([0xff, 0xfe, 0x00]))
  const { status, body } = await get('/api/yaml')
  assert.equal(status, 200)
  assert.deepEqual(body.files, { 'model.yaml': { text: 'a: 1\n' }, 'layout.yaml': { notText: true } })
  assert.equal(body.versions['model.yaml'], hashText('a: 1\n'))
  assert.equal(Object.keys(body.versions).length, 2)
})

test('POST /api/history/steps records the label when the files changed', async t => {
  const { get, post, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  assert.deepEqual(await post('/api/history/steps', { label: 'Added a' }), { status: 200, body: { recorded: true } })
  assert.deepEqual(await post('/api/history/steps', { label: 'Again' }), { status: 200, body: { recorded: false } })
  assert.deepEqual((await get('/api/history')).body.steps.map((s: any) => s.label), ['Added a'])
})

test('POST /api/history/steps refuses a missing, empty or long label and a body that is not JSON', async t => {
  const { post } = await setup(t)
  for (const body of [{}, { label: '' }, { label: 5 }, { label: 'x'.repeat(201) }, 'not json']) {
    assert.equal((await post('/api/history/steps', body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await post('/api/history/steps', { label: 'x'.repeat(200) })).status, 200)
})

test('every POST needs the X-Flowy header', async t => {
  const { post } = await setup(t)
  for (const path of ['/api/history/steps', '/api/history/restore', '/api/history/clear']) {
    const answer = await post(path, {}, {})
    assert.deepEqual(answer, { status: 403, body: { error: 'missing X-Flowy: 1 header' } }, path)
  }
})

test('POST /api/history/restore puts a version back and says where to undo to', async t => {
  const { post, put, history, dir } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  const two = await history.record('Two', 'you')
  assert.ok(one && two)
  const seen = (await history.now()).versions
  const { status, body } = await post('/api/history/restore', { id: one.id, versions: seen, label: 'Restored the version from 10:00' })
  assert.equal(status, 200)
  assert.deepEqual(body, { versions: { 'model.yaml': hashText('a: 1\n') }, before: two.id })
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'a: 1\n')
})

test('restore answers 404 for an unknown step, 409 for a file that changed, 503 when history cannot be saved, 500 when a copy is gone', async t => {
  const { post, put, history } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  await history.record('Two', 'you')
  assert.ok(one)
  const seen = (await history.now()).versions

  assert.equal((await post('/api/history/restore', { id: 'nope', versions: seen, label: 'x' })).status, 404)

  await put('model.yaml', 'a: 3\n')
  const conflict = await post('/api/history/restore', { id: one.id, versions: seen, label: 'x' })
  assert.deepEqual(conflict, { status: 409, body: { error: 'This file changed outside Flowy. Reloaded.' } })

  await rm(join(history.root, 'blobs', hashText('a: 1\n')))
  const gone = await post('/api/history/restore', { id: one.id, versions: (await history.now()).versions, label: 'x' })
  assert.equal(gone.status, 500)

  await rm(join(history.root, 'blobs'), { recursive: true })
  await writeFile(join(history.root, 'blobs'), 'in the way')
  await put('model.yaml', 'a: 4\n')
  const unsaved = await post('/api/history/restore', { id: one.id, versions: (await history.now()).versions, label: 'x' })
  assert.equal(unsaved.status, 503)
  assert.match(unsaved.body.error, /history isn't being saved/)
})

test('restore refuses a body without an id, a versions object or a label', async t => {
  const { post } = await setup(t)
  for (const body of [{}, { id: 'x', label: 'y' }, { id: 'x', versions: [], label: 'y' }, { id: 'x', versions: { 'model.yaml': 5 }, label: 'y' }, { id: 'x', versions: {}, label: '' }, { id: '', versions: {}, label: 'y' }]) {
    assert.equal((await post('/api/history/restore', body)).status, 400, JSON.stringify(body))
  }
})

test('POST /api/history/clear empties the trail', async t => {
  const { get, post, put, history } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await history.record('One', 'you')
  assert.deepEqual(await post('/api/history/clear', {}), { status: 200, body: {} })
  assert.deepEqual((await get('/api/history')).body.steps, [])
})

test('other paths and methods are not for the history routes', async t => {
  const { get, post } = await setup(t)
  assert.equal((await get('/api/state')).status, 404)
  assert.equal((await get('/api/history/nope')).status, 404)
  assert.equal((await post('/api/history', {})).status, 404)
})
