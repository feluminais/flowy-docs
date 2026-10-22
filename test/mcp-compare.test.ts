import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/node/mcp.ts'

const MODEL = 'objects:\n  shop: { type: system, name: Shop }\n  web: { type: app, in: shop, name: Web app }\n  db: { type: store, in: shop, name: Orders DB }\nconnections:\n  - { from: web, to: db, label: reads }\n'
const flow = (name: string) => `name: ${name}\nview: shop\nsteps:\n  - { from: web, to: db, text: Saves the order }\n`
const run = (name: string) => `# ${name}\nname: ${name}\nunit: req/s\nlevels:\n  - load: 1\n  - load: 2\n`

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-compare-'))
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(async () => {
    await client.close()
    await rm(dir, { recursive: true, force: true })
  })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const [first] = result.content as { text: string }[]
    return { error: result.isError === true, text: first.text }
  }
  const put = async (rel: string, text: string) => {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  await put('model.yaml', MODEL)
  await put('flows/before.yaml', flow('Before'))
  await put('flows/after.yaml', flow('After'))
  await put('perf/old.yaml', run('Old'))
  await put('perf/new.yaml', run('New'))
  return { dir, call, put }
}

test('set_compare tags a flow, get_model shows it, and leaving with out removes it', async t => {
  const { dir, call } = await setup(t)
  assert.equal((await call('set_compare', { kind: 'flow', id: 'after', with: 'before' })).error, false)
  assert.match(await readFile(join(dir, 'flows', 'after.yaml'), 'utf8'), /compare: before/)
  assert.equal(JSON.parse((await call('get_model', { flow: 'after' })).text).flow.compare, 'before') // as the file holds it
  const summary = JSON.parse((await call('get_model', { summary: true })).text)
  assert.deepEqual(summary.flows.find((f: { id: string }) => f.id === 'after').compare, { with: 'before' })
  assert.equal(summary.flows.find((f: { id: string }) => f.id === 'before').compare, undefined)

  assert.equal((await call('set_compare', { kind: 'flow', id: 'after', with: 'before', note: 'Retries added' })).error, false)
  assert.deepEqual(JSON.parse((await call('get_model', { flow: 'after' })).text).flow.compare, { with: 'before', note: 'Retries added' })

  assert.equal((await call('set_compare', { kind: 'flow', id: 'after' })).error, false)
  assert.doesNotMatch(await readFile(join(dir, 'flows', 'after.yaml'), 'utf8'), /compare/)
  assert.equal(JSON.parse((await call('get_model', { flow: 'after' })).text).flow.compare, undefined)
})

test('put_flow over a tagged flow keeps its compare tag', async t => {
  const { dir, call } = await setup(t)
  await call('set_compare', { kind: 'flow', id: 'after', with: 'before', note: 'Retries added' })
  const steps = [{ from: 'web', to: 'db', text: 'Saves the order twice' }]
  assert.equal((await call('put_flow', { id: 'after', name: 'After', view: 'shop', steps })).error, false)
  const text = await readFile(join(dir, 'flows', 'after.yaml'), 'utf8')
  assert.match(text, /Saves the order twice/)
  assert.match(text, /compare:\n {2}with: before\n {2}note: Retries added/)
})

test('set_compare refuses a flow that is not there, itself, and an unknown holder, and saves nothing', async t => {
  const { dir, call } = await setup(t)
  const before = await readFile(join(dir, 'flows', 'after.yaml'), 'utf8')
  assert.deepEqual(await call('set_compare', { kind: 'flow', id: 'after', with: 'nope' }), { error: true, text: 'unknown flow "nope"' })
  assert.deepEqual(await call('set_compare', { kind: 'flow', id: 'after', with: 'after' }), { error: true, text: 'flow "after" cannot compare with itself' })
  assert.equal((await call('set_compare', { kind: 'flow', id: 'missing', with: 'before' })).error, true)
  assert.equal(await readFile(join(dir, 'flows', 'after.yaml'), 'utf8'), before)
})

test('set_compare writes a run\'s compare in place and nothing else', async t => {
  const { dir, call } = await setup(t)
  const was = await readFile(join(dir, 'perf', 'new.yaml'), 'utf8')
  assert.equal((await call('set_compare', { kind: 'run', id: 'new', with: 'old', note: 'After the cache' })).error, false)
  const tagged = await readFile(join(dir, 'perf', 'new.yaml'), 'utf8')
  assert.equal(tagged, `${was}compare:\n  with: old\n  note: "After the cache"\n`)
  const runs: { id: string }[] = JSON.parse((await call('get_model')).text).runs
  assert.deepEqual(runs.find(r => r.id === 'new'), { id: 'new', name: 'New', compare: { with: 'old', note: 'After the cache' } })
  assert.deepEqual(runs.find(r => r.id === 'old'), { id: 'old', name: 'Old' })
  assert.equal((await call('set_compare', { kind: 'run', id: 'new' })).error, false)
  assert.equal(await readFile(join(dir, 'perf', 'new.yaml'), 'utf8'), was)
})

test('set_compare refuses a run that is not there, a target that is not a run, and itself', async t => {
  const { dir, call } = await setup(t)
  const was = await readFile(join(dir, 'perf', 'new.yaml'), 'utf8')
  assert.deepEqual(await call('set_compare', { kind: 'run', id: 'new', with: 'nope' }), { error: true, text: 'unknown run "nope"' })
  assert.deepEqual(await call('set_compare', { kind: 'run', id: 'new', with: 'new' }), { error: true, text: 'run "new" cannot compare with itself' })
  assert.deepEqual(await call('set_compare', { kind: 'run', id: 'nope', with: 'old' }), { error: true, text: 'unknown run "nope"' })
  assert.equal(await readFile(join(dir, 'perf', 'new.yaml'), 'utf8'), was)
})
