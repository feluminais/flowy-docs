import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { State } from '../src/core/state.ts'
import { hashText } from '../src/node/files.ts'
import { startServer } from '../src/node/server.ts'

/** A server on a free port, over a flowy/ folder that doesn't exist yet. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-server-'))
  const dir = join(root, 'flowy')
  const ui = join(root, 'ui')
  const server = await startServer({ dir, ui, port: 0 })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.port}`
  const send = (method: string, rel: string, body: unknown, headers: Record<string, string> = { 'X-Flowy': '1' }) =>
    fetch(`${base}/api/file/${rel}`, { method, headers, body: JSON.stringify(body) })
  const getState = async () => (await (await fetch(`${base}/api/state`)).json()) as State
  return { root, dir, ui, base, port: server.port, send, getState }
}

const versionOf = async (res: Response) => ((await res.json()) as { version: string | null }).version

/** fetch() always sends the real Host, so requests with another Host, or a raw path, go through node:http. */
function rawGet(port: number, path: string, host = `127.0.0.1:${port}`): Promise<number> {
  return new Promise((done, fail) => {
    request({ host: '127.0.0.1', port, path, headers: { host } }, res => {
      res.resume()
      done(res.statusCode ?? 0)
    }).on('error', fail).end()
  })
}

test('state of an empty folder', async t => {
  const { getState } = await setup(t)
  assert.deepEqual(await getState(), {
    model: { objects: {}, connections: [], meta: {} },
    layout: {},
    flows: {},
    problems: [],
    versions: { 'model.yaml': null, 'layout.yaml': null },
  })
})

test('PUT writes YAML when the version matches, and a stale version gets 409 with the current one', async t => {
  const { dir, send, getState } = await setup(t)
  const data = { objects: { shop: { type: 'system', name: 'Shop' } }, connections: [] }
  const created = await send('PUT', 'model.yaml', { version: null, data })
  assert.equal(created.status, 200)
  const version = await versionOf(created)
  const text = await readFile(join(dir, 'model.yaml'), 'utf8')
  assert.equal(version, hashText(text))
  assert.match(text, /shop:\n {4}type: system/)
  const state = await getState()
  assert.ok('versions' in state)
  assert.equal(state.versions['model.yaml'], version)
  assert.deepEqual(state.model.objects, data.objects)

  const stale = await send('PUT', 'model.yaml', { version: null, data: { objects: {} } })
  assert.equal(stale.status, 409)
  assert.equal(await versionOf(stale), version)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), text)
})

test('writes without X-Flowy, and any request with a foreign Host, are refused', async t => {
  const { dir, port, send } = await setup(t)
  const noHeader = await send('PUT', 'model.yaml', { version: null, data: { objects: {} } }, {})
  assert.equal(noHeader.status, 403)
  await assert.rejects(readFile(join(dir, 'model.yaml')), { code: 'ENOENT' })
  assert.equal(await rawGet(port, '/api/state'), 200)
  assert.equal(await rawGet(port, '/api/state', `localhost:${port}`), 200)
  assert.equal(await rawGet(port, '/api/state', `evil.example:${port}`), 403)
  assert.equal(await rawGet(port, '/', 'evil.example'), 403)
})

test('only model.yaml, layout.yaml and flow files can be written, and only flows deleted', async t => {
  const { send } = await setup(t)
  for (const rel of ['notes.txt', 'flows/Bad.yaml', 'flows/root.yaml', 'flows/a/b.yaml', 'flows%2Fa.yaml'])
    assert.equal((await send('PUT', rel, { version: null, data: {} })).status, 400, rel)
  assert.equal((await send('DELETE', 'model.yaml', { version: null })).status, 400)
})

test('a body without version or data, or content that is not a valid file, is refused', async t => {
  const { send } = await setup(t)
  assert.equal((await send('PUT', 'model.yaml', { data: {} })).status, 400)
  assert.equal((await send('PUT', 'model.yaml', { version: null })).status, 400)
  assert.equal((await send('PUT', 'model.yaml', 'not an object')).status, 400)
  const bad = await send('PUT', 'flows/visit.yaml', { version: null, data: { name: 'Visit', steps: 'many' } })
  assert.equal(bad.status, 400)
  assert.match(((await bad.json()) as { error: string }).error, /"steps" must be a list/)
  assert.equal((await send('PUT', 'layout.yaml', { version: null, data: { root: { a: [1, 2] } } })).status, 200)
})

test('DELETE removes a flow when the version matches', async t => {
  const { dir, send } = await setup(t)
  const flow = { name: 'Visit', view: 'root', steps: [{ from: 'a', to: 'b', text: 'Hi' }] }
  const version = await versionOf(await send('PUT', 'flows/visit.yaml', { version: null, data: flow }))
  assert.equal((await send('DELETE', 'flows/visit.yaml', { version: 'stale' })).status, 409)
  assert.equal((await send('DELETE', 'flows/visit.yaml', { version })).status, 200)
  await assert.rejects(readFile(join(dir, 'flows/visit.yaml')), { code: 'ENOENT' })
})

test('a file that does not parse is reported, and blocks every write until fixed', async t => {
  const { dir, send, getState } = await setup(t)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  a: {}\n  a: {}\n')
  const state = await getState()
  assert.ok('parseError' in state)
  assert.equal(state.parseError.file, 'model.yaml')
  assert.equal(state.parseError.line, 3)
  assert.doesNotMatch(state.parseError.message, /model\.yaml/)
  assert.equal((await send('PUT', 'layout.yaml', { version: null, data: {} })).status, 409)
  await assert.rejects(readFile(join(dir, 'layout.yaml')), { code: 'ENOENT' })
})

test('serves the built canvas, and nothing outside its folder', async t => {
  const { root, ui, base, port } = await setup(t)
  await mkdir(join(ui, 'assets'), { recursive: true })
  await writeFile(join(ui, 'index.html'), '<!doctype html><title>Flowy</title>')
  await writeFile(join(ui, 'assets', 'app.js'), 'console.log(1)')
  await writeFile(join(root, 'secret.txt'), 'secret')
  const page = await fetch(`${base}/`)
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.equal(await page.text(), '<!doctype html><title>Flowy</title>')
  assert.equal((await fetch(`${base}/assets/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8')
  for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt'])
    assert.equal(await rawGet(port, path), 404, path)
})

test('a taken port moves on to the next free one', async t => {
  const first = await setup(t)
  const root = await mkdtemp(join(tmpdir(), 'flowy-server-'))
  const second = await startServer({ dir: root, ui: root, port: first.port })
  t.after(async () => {
    await second.close()
    await rm(root, { recursive: true, force: true })
  })
  assert.ok(second.port > first.port && second.port <= first.port + 20, `got ${second.port} after ${first.port}`)
})
