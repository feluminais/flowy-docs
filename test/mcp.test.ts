import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/node/mcp.ts'

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-'))
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const [first] = result.content as { text: string }[]
    return { error: result.isError === true, text: first.text }
  }
  return { dir, client, call }
}

test('builds a model and shows a view', async t => {
  const { dir, client, call } = await setup()
  t.after(() => client.close())
  assert.equal((await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })).error, false)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('put_object', { id: 'web', type: 'app', name: 'Web app', in: 'shop' })
  await call('connect', { from: 'customer', to: 'web', label: 'browses' })
  const view = JSON.parse((await call('get_view', { view: 'root' })).text)
  assert.deepEqual(view.edges, [{ from: 'customer', to: 'shop', label: 'browses', count: 1 }])
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /web:\n {4}type: app/)
})

test('a write that adds a problem is refused and nothing is saved', async t => {
  const { dir, client, call } = await setup()
  t.after(() => client.close())
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const before = await readFile(join(dir, 'model.yaml'), 'utf8')
  const result = await call('put_object', { id: 'web', type: 'app', name: 'Web app' })
  assert.equal(result.error, true)
  assert.match(result.text, /web: app must be inside system/)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), before)
})

test('flows round-trip, and delete_object explains refusals', async t => {
  const { client, call } = await setup()
  t.after(() => client.close())
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const saved = await call('put_flow', { id: 'visit', name: 'Visit', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Visits' }] })
  assert.equal(saved.error, false, saved.text)
  assert.equal(JSON.parse((await call('get_model')).text).flows.visit.name, 'Visit')
  const refused = await call('delete_object', { id: 'customer' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /used by flow visit/)
})

test('calls sent at the same time run in arrival order', async t => {
  const { client, call } = await setup()
  t.after(() => client.close())
  const [system, app] = await Promise.all([
    call('put_object', { id: 'shop', type: 'system', name: 'Shop' }),
    call('put_object', { id: 'api', type: 'app', name: 'API', in: 'shop' }),
  ])
  assert.equal(system.error, false, system.text)
  assert.equal(app.error, false, app.text)
})

test('a broken file is reported, not overwritten', async t => {
  const { dir, client, call } = await setup()
  t.after(() => client.close())
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  a: { type: actor\n')
  const result = await call('put_object', { id: 'b', type: 'actor', name: 'B' })
  assert.equal(result.error, true)
  assert.match(result.text, /^model\.yaml:\d+:/)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects:\n  a: { type: actor\n')
})
