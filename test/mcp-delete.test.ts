import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/node/mcp.ts'

type Reply = { error: boolean; text: string; structured?: { dependents?: { key: string; kind: string; actions: string[] }[] } }

/** A shop with a web app and a database, a flow through both, and a failure analysis with a mode on the database and one on the line to it. */
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-'))
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(async () => {
    await client.close()
    await rm(dir, { recursive: true, force: true })
  })
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Reply> => {
    const result = await client.callTool({ name, arguments: args })
    const [first] = result.content as { text: string }[]
    return { error: result.isError === true, text: first.text, structured: result.structuredContent as Reply['structured'] }
  }
  const model = async () => JSON.parse((await call('get_model')).text)
  for (const o of [{ id: 'shop', type: 'system', name: 'Shop' }, { id: 'web', type: 'app', in: 'shop', name: 'Web' }, { id: 'db', type: 'store', in: 'shop', name: 'Orders DB' }, { id: 'cache', type: 'store', in: 'shop', name: 'Cache' }])
    assert.equal((await call('put_object', o)).error, false)
  assert.equal((await call('connect', { from: 'web', to: 'db', label: 'reads' })).error, false)
  const flow = await call('put_flow', { id: 'visit', name: 'Visit', view: 'shop', steps: [{ from: 'web', to: 'db', text: 'Reads' }, { from: 'db', to: 'web', text: 'Answers' }, { from: 'web', text: 'Shows' }] })
  assert.equal(flow.error, false, flow.text)
  const failures = await call('put_failures', {
    id: 'ordering', name: 'Ordering',
    modes: { 'db-down': { mode: 'The database is down', on: 'db', severity: 9, occurrence: 2, detection: 3 }, 'slow-read': { mode: 'Reads are slow', from: 'web', to: 'db', severity: 4, occurrence: 4, detection: 4 } },
  })
  assert.equal(failures.error, false, failures.text)
  return { call, model }
}

test('mcp: delete_object refused for what depends on it lists a row for each, in words and as structured content', async t => {
  const { call } = await setup(t)
  const refused = await call('delete_object', { id: 'db' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /^"db" is used by flow visit\. Change or delete those first\./)
  assert.match(refused.text, /- step:visit:1 \(flow visit, step 1\): removeStep, reroute, deleteFlow/)
  assert.match(refused.text, /- mode:ordering:db-down:on \(mode db-down of ordering\): removeMode, repoint/)
  assert.match(refused.text, /call this tool again with "resolve"/)
  const keys = refused.structured?.dependents?.map(r => r.key)
  assert.deepEqual(keys, ['step:visit:1', 'step:visit:2', 'mode:ordering:db-down:on', 'mode:ordering:slow-read:to'])
  assert.deepEqual(refused.structured?.dependents?.[0].actions, ['removeStep', 'reroute', 'deleteFlow'])
})

test('mcp: delete_object with resolve settles every row and deletes in one edit', async t => {
  const { call, model } = await setup(t)
  const done = await call('delete_object', {
    id: 'db',
    resolve: [
      { key: 'step:visit:1', action: 'reroute', to: 'cache' }, { key: 'step:visit:2', action: 'removeStep' },
      { key: 'mode:ordering:db-down:on', action: 'removeMode' }, { key: 'mode:ordering:slow-read:to', action: 'removeMode' },
    ],
  })
  assert.equal(done.error, false, done.text)
  const after = await model()
  assert.equal(after.objects.db, undefined)
  assert.deepEqual(after.flows.visit.steps.map((s: { from: string; to?: string }) => [s.from, s.to]), [['web', 'cache'], ['web', undefined]])
  assert.equal(Object.hasOwn(after.failures.ordering.modes, 'db-down'), false)
  assert.equal(Object.hasOwn(after.failures.ordering.modes, 'slow-read'), false)
  assert.equal((await call('get_problems')).text, 'No problems.')
})

test('mcp: delete_object with a resolve that leaves a row open, names a row that is not there or points at what goes saves nothing', async t => {
  const { call, model } = await setup(t)
  const before = JSON.stringify(await model())
  const open = await call('delete_object', { id: 'db', resolve: [{ key: 'step:visit:1', action: 'removeStep' }] })
  assert.equal(open.error, true)
  assert.match(open.text, /flow visit, step 2 needs a choice: removeStep, reroute, deleteFlow/)
  const unknown = await call('delete_object', { id: 'db', resolve: [{ key: 'step:visit:9', action: 'removeStep' }] })
  assert.match(unknown.text, /nothing is waiting on "step:visit:9"/)
  const toGoing = await call('delete_object', { id: 'db', resolve: [{ key: 'step:visit:1', action: 'reroute', to: 'db' }, { key: 'step:visit:2', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'removeMode' }, { key: 'mode:ordering:slow-read:to', action: 'removeMode' }] })
  assert.match(toGoing.text, /reroute for flow visit, step 1 needs "to": a shape that stays/)
  const emptied = await call('delete_object', { id: 'web', resolve: [{ key: 'step:visit:1', action: 'removeStep' }, { key: 'step:visit:2', action: 'removeStep' }, { key: 'step:visit:3', action: 'removeStep' }, { key: 'mode:ordering:slow-read:from', action: 'removeMode' }] })
  assert.match(emptied.text, /leave flow visit with no steps/)
  assert.equal(JSON.stringify(await model()), before)
})

test('mcp: disconnect refused for a mode on the line lists it, and resolve removes the mode and the line together', async t => {
  const { call, model } = await setup(t)
  const refused = await call('disconnect', { from: 'web', to: 'db' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /^connection web → db is used by failure analysis ordering\./)
  assert.deepEqual(refused.structured?.dependents?.map(r => r.key), ['mode:ordering:slow-read:line'])
  const done = await call('disconnect', { from: 'web', to: 'db', resolve: [{ key: 'mode:ordering:slow-read:line', action: 'removeMode' }] })
  assert.equal(done.error, false, done.text)
  const after = await model()
  assert.deepEqual(after.connections, [])
  assert.equal(Object.hasOwn(after.failures.ordering.modes, 'slow-read'), false)
})
