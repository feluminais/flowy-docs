import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openHistory } from '../src/node/history.ts'
import { startServer } from '../src/node/server.ts'

type Options = { blockStateDir?: boolean; gateMs?: number; folder?: 'empty' | 'missing' | 'with-model' }

/** A server over a model folder with history turned on, its state in a temp folder. The gate waits `gateMs` for a label (400 unless a test says). */
async function setup(t: TestContext, { blockStateDir = false, gateMs = 400, folder = 'empty' }: Options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-server-history-'))
  const dir = join(root, 'flowy')
  if (folder !== 'missing') await mkdir(dir, { recursive: true })
  if (folder === 'with-model') await writeFile(join(dir, 'model.yaml'), 'objects: {}\nconnections: []\n')
  const stateDir = join(root, 'state')
  if (blockStateDir) await writeFile(stateDir, 'in the way')
  const history = openHistory(dir, { app: 'browser', stateDir, log: () => undefined })
  const server = await startServer({ dir, ui: join(root, 'ui'), port: 0, history, gateMs })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.port}`
  const headers = { 'X-Flowy': '1' }
  const write = async (rel: string, body: unknown) => {
    const res = await fetch(`${base}/api/file/${rel}`, { method: 'PUT', headers, body: JSON.stringify(body) })
    return { status: res.status, version: ((await res.json()) as { version?: string }).version }
  }
  const label = async (text: string) => (await fetch(`${base}/api/history/steps`, { method: 'POST', headers, body: JSON.stringify({ label: text }) })).json()
  const steps = async () => ((await (await fetch(`${base}/api/history`)).json()) as { steps: { id: string; label: string; source: string; app: string; changed: string[] }[] }).steps
  const state = async () => (await (await fetch(`${base}/api/history`)).json()) as { saving: boolean; reason?: string; steps: unknown[] }
  const yaml = async () => (await (await fetch(`${base}/api/yaml`)).json()) as { versions: Record<string, string> }
  const restore = async (id: string, versions: Record<string, string | null>, text = 'Restored') => {
    const res = await fetch(`${base}/api/history/restore`, { method: 'POST', headers, body: JSON.stringify({ id, versions, label: text }) })
    return { status: res.status, body: (await res.json()) as { versions?: Record<string, string | null>; before?: string; error?: string } }
  }
  return { dir, base, headers, write, label, steps, state, yaml, restore }
}

const pause = (ms: number) => new Promise(done => setTimeout(done, ms))
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const value = await read()
    if (ok(value) || Date.now() > end) return value
    await pause(40)
  }
}

const shop = { objects: { shop: { type: 'system', name: 'Shop' } }, connections: [] }
const shopAndCart = { objects: { shop: { type: 'system', name: 'Shop' }, cart: { type: 'system', name: 'Cart' } }, connections: [] }

test('an existing model gets a "First seen" step when the server opens', async t => {
  const { steps } = await setup(t, { folder: 'with-model' })
  assert.deepEqual((await steps()).map(s => [s.label, s.source]), [['First seen', 'first']])
})

test('Review Focus: a folder that does not exist yet starts, with no steps', async t => {
  const { state } = await setup(t, { folder: 'missing' })
  assert.deepEqual(await state(), { saving: true, steps: [] })
})

test('one edit that writes two files and then posts a label is one step', async t => {
  const { write, label, steps } = await setup(t)
  assert.equal((await write('model.yaml', { version: null, data: shop })).status, 200)
  assert.equal((await write('layout.yaml', { version: null, data: { root: { shop: [1, 2] } } })).status, 200)
  assert.deepEqual(await label('Added the Shop system'), { recorded: true })
  const [top, ...rest] = await steps()
  assert.deepEqual([top.label, top.source, top.app, top.changed], ['Added the Shop system', 'you', 'browser', ['layout.yaml', 'model.yaml']])
  assert.deepEqual(rest, [])
})

test('an edit the page never labels still gets a step once the gate runs out', async t => {
  const { write, steps } = await setup(t, { gateMs: 80 })
  await write('model.yaml', { version: null, data: shop })
  const list = await until(steps, s => s.length > 0)
  assert.deepEqual(list.map(s => [s.label, s.source]), [['Changed model.yaml', 'you']])
})

test("Flowy's own writes are never recorded as outside changes", async t => {
  const { write, label, steps } = await setup(t)
  const first = await write('model.yaml', { version: null, data: shop })
  await label('Added the Shop system')
  await write('model.yaml', { version: first.version, data: shopAndCart })
  await label('Added the Cart system')
  await pause(700) // the folder watcher has fired by now
  assert.deepEqual((await steps()).map(s => s.label), ['Added the Cart system', 'Added the Shop system'])
})

test('a change made by another program becomes an outside step', async t => {
  const { dir, steps } = await setup(t, { folder: 'with-model' })
  await writeFile(join(dir, 'model.yaml'), 'objects: { x: { type: actor, name: X } }\nconnections: []\n')
  const list = await until(steps, s => s.length > 1)
  assert.deepEqual(list.map(s => s.label), ['Changed outside Flowy: model.yaml', 'First seen'])
})

test('Review Focus: an unwritable history never fails an edit, and says so', async t => {
  const { write, label, state } = await setup(t, { blockStateDir: true })
  assert.equal((await write('model.yaml', { version: null, data: shop })).status, 200)
  assert.deepEqual(await label('Added the Shop system'), { recorded: false })
  const answer = await state()
  assert.equal(answer.saving, false)
  assert.ok(answer.reason && answer.reason.length > 0)
})

test('restore through the server puts the first version back and records it', async t => {
  const { dir, write, label, steps, yaml, restore } = await setup(t)
  const one = await write('model.yaml', { version: null, data: shop })
  await label('One')
  await write('model.yaml', { version: one.version, data: shopAndCart })
  await label('Two')
  const firstId = (await steps()).find(s => s.label === 'One')!.id
  const secondId = (await steps()).find(s => s.label === 'Two')!.id
  const seen = (await yaml()).versions

  const answer = await restore(firstId, seen, 'Restored the version from 10:00')
  assert.equal(answer.status, 200)
  assert.equal(answer.body.before, secondId)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /shop:/)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /cart:/)
  assert.equal((await steps())[0].label, 'Restored the version from 10:00')

  assert.equal((await restore(firstId, seen)).status, 409) // `seen` is out of date now
})

test('Review Focus: restore works while model.yaml is not UTF-8, when an edit is refused', async t => {
  const { dir, write, label, steps, yaml, restore } = await setup(t)
  const one = await write('model.yaml', { version: null, data: shop })
  await label('One')
  await writeFile(join(dir, 'model.yaml'), new Uint8Array([0xff, 0xfe, 0x00]))
  assert.equal((await write('model.yaml', { version: one.version, data: shopAndCart })).status, 409)
  const firstId = (await steps()).find(s => s.label === 'One')!.id
  const answer = await restore(firstId, (await yaml()).versions)
  assert.equal(answer.status, 200)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /shop:/)
})

test('clear empties the list', async t => {
  const { base, headers, steps } = await setup(t, { folder: 'with-model' })
  assert.equal((await steps()).length, 1)
  await fetch(`${base}/api/history/clear`, { method: 'POST', headers, body: '{}' })
  assert.deepEqual(await steps(), [])
})
