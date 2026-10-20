import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openHistory } from '../src/node/history.ts'
import { startServer } from '../src/node/server.ts'
import { httpHistory } from '../ui/src/historyclient.ts'
import { hostTransport, httpTransport } from '../ui/src/transport.ts'

/** A server with history over a temp folder, and the page's client for it. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-client-'))
  const dir = join(root, 'flowy')
  await mkdir(dir, { recursive: true })
  const history = openHistory(dir, { app: 'browser', stateDir: join(root, 'state'), log: () => undefined })
  const server = await startServer({ dir, ui: join(root, 'ui'), port: 0, history })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.port}`
  const put = (rel: string, text: string) => writeFile(join(dir, rel), text)
  return { base, client: httpHistory(base), put }
}

test('an empty folder has no steps, and history is saving', async t => {
  const { client } = await setup(t)
  assert.deepEqual(await client.list(), { saving: true, steps: [] })
})

test('a recorded step is listed and can be read with its files', async t => {
  const { client, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  assert.equal(await client.record('Added a'), true)
  const { steps } = await client.list()
  assert.deepEqual(steps.map(s => [s.label, s.source, s.changed]), [['Added a', 'you', ['model.yaml']]])
  const view = await client.step(steps[0].id)
  assert.deepEqual(view?.files, { 'model.yaml': { text: 'a: 1\n' } })
  assert.equal(await client.step('nope'), undefined)
})

test('recording when nothing changed says so', async t => {
  const { client, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await client.record('Added a')
  assert.equal(await client.record('Again'), false)
})

test('yaml() gives the files as they are, with their versions', async t => {
  const { client, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const now = await client.yaml()
  assert.deepEqual(now.files, { 'model.yaml': { text: 'a: 1\n' } })
  assert.deepEqual(Object.keys(now.versions), ['model.yaml'])
})

test('restore puts an earlier version back, and says what went wrong when it cannot', async t => {
  const { client, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await client.record('One')
  await put('model.yaml', 'a: 2\n')
  await client.record('Two')
  const [two, one] = (await client.list()).steps
  const seen = (await client.yaml()).versions

  const restored = await client.restore(one.id, seen, 'Restored the version from 10:00')
  assert.ok(restored.ok && restored.before === two.id)
  assert.deepEqual((await client.yaml()).files, { 'model.yaml': { text: 'a: 1\n' } })

  assert.deepEqual(await client.restore('nope', {}, 'x'), { ok: false, status: 404, message: 'That version is gone.' })
  const stale = await client.restore(two.id, seen, 'x') // `seen` is out of date now
  assert.ok(!stale.ok && stale.status === 409)
})

test('clear empties the list', async t => {
  const { client, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await client.record('One')
  await client.clear()
  assert.deepEqual((await client.list()).steps, [])
})

test('recording never rejects, even with no server to answer', async () => {
  assert.equal(await httpHistory('http://127.0.0.1:1').record('x'), false)
})

test('the server transport has a history client; a host transport does not', async t => {
  const { base } = await setup(t)
  assert.ok(httpTransport(base).history)
  assert.equal(hostTransport(() => undefined, () => undefined).history, undefined)
})
