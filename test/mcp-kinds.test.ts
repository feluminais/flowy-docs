import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { newDraft } from '../src/core/drafts.ts'
import type { Model } from '../src/core/model.ts'
import { createMcpServer } from '../src/node/mcp.ts'
import { shop } from './fixtures.ts'

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-kinds-'))
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
  await call('put_object', { id: 'ui', type: 'system', name: 'Screen' })
  await call('put_object', { id: 'management', type: 'system', name: 'Management' })
  await call('put_object', { id: 'linux', type: 'system', name: 'Linux' })
  const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await call(name, args)).text)
  return { dir, call, json, client }
}

test('connect takes a kind, and get_model, get_view and the file show it', async t => {
  const { dir, call, json } = await setup(t)
  const made = await call('connect', { from: 'ui', to: 'management', label: 'Start scan', kind: 'stream' })
  assert.equal(made.error, false, made.text)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^ {2}- from: ui\r?\n {4}to: management\r?\n {4}label: Start scan\r?\n {4}kind: stream$/m)
  assert.deepEqual((await json('get_model', { object: 'ui' })).connections, [{ from: 'ui', to: 'management', label: 'Start scan', kind: 'stream' }])
  assert.deepEqual((await json('get_model', { summary: true })).connections, ['ui → management: Start scan (stream)'])
  const view = await json('get_view', { view: 'root' })
  assert.deepEqual(view.edges, [{ from: 'ui', to: 'management', label: 'Start scan', count: 1, kind: 'stream', look: { pattern: 'solid', head: 'filled', tail: 'double' } }])
  // A connection with no kind reads as before.
  await call('connect', { from: 'management', to: 'linux', label: 'Apply config' })
  assert.deepEqual((await json('get_model', { summary: true })).connections, ['ui → management: Start scan (stream)', 'management → linux: Apply config'])
  assert.deepEqual((await json('get_view', { view: 'root' })).edges[1], { from: 'management', to: 'linux', label: 'Apply config', count: 1 })
})

test('connect refuses a word that is no kind, and the schema lists the six', async t => {
  const { call, client } = await setup(t)
  const refused = await call('connect', { from: 'ui', to: 'management', kind: 'rpc' })
  assert.equal(refused.error, true)
  const tools = (await client.listTools()).tools
  for (const name of ['connect', 'set_kind']) {
    const schema = JSON.stringify(tools.find(x => x.name === name)!.inputSchema)
    assert.match(schema, /"enum":\[("",)?"request","stream","publish","cached","object","extension"\]/, name)
  }
})

test('set_kind sets, changes and clears the kind of one connection', async t => {
  const { dir, call, json } = await setup(t)
  await call('connect', { from: 'ui', to: 'management', label: 'Radio state' })
  await call('connect', { from: 'ui', to: 'management', label: 'Client list' })
  const set = await call('set_kind', { from: 'ui', to: 'management', label: 'Radio state', kind: 'cached' })
  assert.equal(set.error, false, set.text)
  assert.match(set.text, /ui → management/)
  const connections = () => json('get_model', { object: 'ui' }).then(m => m.connections)
  assert.deepEqual(await connections(), [{ from: 'ui', to: 'management', label: 'Radio state', kind: 'cached' }, { from: 'ui', to: 'management', label: 'Client list' }])
  await call('set_kind', { from: 'ui', to: 'management', label: 'Radio state', kind: 'object' })
  assert.equal((await connections())[0].kind, 'object')
  // Two kinds on one pair: the pair's one line is plain, and says nothing of a kind.
  await call('set_kind', { from: 'ui', to: 'management', label: 'Client list', kind: 'publish' })
  assert.deepEqual((await json('get_view', { view: 'root' })).edges, [{ from: 'ui', to: 'management', label: '2 connections', count: 2 }])
  const cleared = await call('set_kind', { from: 'ui', to: 'management', label: 'Radio state', kind: '' })
  assert.equal(cleared.error, false, cleared.text)
  assert.match(cleared.text, /Took the kind off/)
  assert.equal('kind' in (await connections())[0], false)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /kind: object/)
  // The one that is not there, and a word that is not a kind, are refused and change nothing.
  assert.equal((await call('set_kind', { from: 'ui', to: 'management', label: 'Nope', kind: 'request' })).error, true)
  assert.equal((await call('set_kind', { from: 'ui', to: 'management', label: 'Client list', kind: 'rpc' })).error, true)
  assert.equal((await connections())[1].kind, 'publish')
})

test('what get_model shows goes back to connect and set_kind as it is', async t => {
  const { call, json } = await setup(t)
  await call('connect', { from: 'management', to: 'linux', label: 'Vendor hooks', kind: 'extension' })
  const [shown] = (await json('get_model', { object: 'linux' })).connections
  await call('disconnect', { from: 'management', to: 'linux' })
  assert.equal((await call('connect', shown)).error, false)
  assert.deepEqual((await json('get_model', { object: 'linux' })).connections, [shown])
  assert.equal((await call('set_kind', shown)).error, false)
  assert.deepEqual((await json('get_model', { object: 'linux' })).connections, [shown])
})

test('a file with a kind that is none of the six loads, says so in get_problems, and draws plain', async t => {
  const { dir, call } = await setup(t)
  await call('connect', { from: 'ui', to: 'management', label: 'a' })
  await call('set_kind', { from: 'ui', to: 'management', label: 'a', kind: 'request' })
  assert.equal((await call('get_problems')).text, 'No problems.')
  const text = await readFile(join(dir, 'model.yaml'), 'utf8')
  await writeFile(join(dir, 'model.yaml'), text.replace('kind: request', 'kind: rpc'))
  assert.match((await call('get_problems')).text, /unknown kind "rpc" \(use request, stream, publish, cached, object, extension\)/)
  const view = JSON.parse((await call('get_view', { view: 'root' })).text)
  assert.deepEqual(view.edges, [{ from: 'ui', to: 'management', label: 'a', count: 1 }])
})

test('a draft made from the model keeps the kinds of the connections it copies', () => {
  const model: Model = { ...shop(), connections: [{ from: 'web', to: 'api', label: 'REST', kind: 'request' }, { from: 'api', to: 'db', label: 'saves' }, { from: 'api', to: 'mail', label: 'hook', kind: 'extension' }] }
  const draft = newDraft(model, { name: 'Sketch', copy: ['web', 'api', 'db'] })
  assert.deepEqual(draft.connections, [{ from: 'web', to: 'api', label: 'REST', kind: 'request' }, { from: 'api', to: 'db', label: 'saves' }])
  // A copy, not the same object: changing the draft does not change the model.
  draft.connections[0].kind = 'stream'
  assert.equal(model.connections[0].kind, 'request')
})
