import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/node/mcp.ts'

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
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const [first] = result.content as { text: string }[]
    return { error: result.isError === true, text: first.text }
  }
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('put_object', { id: 'web', type: 'app', name: 'Web app', in: 'shop' })
  await call('put_object', { id: 'api', type: 'app', name: 'API', in: 'shop' })
  const model = async () => JSON.parse((await call('get_model')).text)
  return { dir, call, client, model }
}

const order = { id: 'order', name: 'Order', about: 'What the web app sends at checkout.', example: { language: 'json', text: '{ "id": "o-1" }' } }

test('put_payload saves a payload and get_model shows it', async t => {
  const { dir, call, model } = await setup(t)
  const saved = await call('put_payload', order)
  assert.equal(saved.error, false, saved.text)
  assert.deepEqual((await model()).payloads, { order: { name: 'Order', about: order.about, example: order.example } })
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^payloads:\n {2}order:\n {4}name: Order$/m)
  const silent = await call('put_payload', { id: 'empty', name: 'Empty' })
  assert.equal(silent.error, true)
  assert.match(silent.text, /says nothing/)
})

test('connect and set_payloads attach payloads to a line, and an unknown one is refused', async t => {
  const { call, model } = await setup(t)
  await call('put_payload', order)
  const linked = await call('connect', { from: 'web', to: 'api', label: 'REST', payloads: ['order', { name: 'Cart', about: 'The basket.' }] })
  assert.equal(linked.error, false, linked.text)
  assert.deepEqual((await model()).connections[0].payloads, ['order', { name: 'Cart', about: 'The basket.' }])
  assert.equal((await call('set_payloads', { from: 'web', to: 'api', label: 'REST', payloads: ['order'] })).error, false)
  assert.deepEqual((await model()).connections[0].payloads, ['order'])
  const unknown = await call('set_payloads', { from: 'web', to: 'api', label: 'REST', payloads: ['nope'] })
  assert.equal(unknown.error, true)
  assert.match(unknown.text, /unknown payload "nope"/)
})

const flow = (step: Record<string, unknown>) => ({ id: 'checkout', name: 'Checkout', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'Places the order', animation: 'call', ...step }] })

test('put_flow keeps a step\'s payload and reply when they are sent, and refuses neither shape', async t => {
  const { call, model } = await setup(t)
  await call('put_payload', order)
  await call('connect', { from: 'web', to: 'api', label: 'REST' })
  const saved = await call('put_flow', flow({ payload: 'order', reply: { name: 'Receipt', about: 'What comes back.' } }))
  assert.equal(saved.error, false, saved.text)
  const [step] = (await model()).flows.checkout.steps
  assert.equal(step.payload, 'order')
  assert.deepEqual(step.reply, { name: 'Receipt', about: 'What comes back.' })
  assert.equal((await call('get_problems')).text, 'No problems.')
})

test('delete_payload is refused while a step names it, and works once the flow no longer does', async t => {
  const { call, model } = await setup(t)
  await call('put_payload', order)
  await call('connect', { from: 'web', to: 'api', label: 'REST' })
  await call('put_flow', flow({ payload: 'order' }))
  const refused = await call('delete_payload', { id: 'order' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /used by flow checkout step 1/)
  await call('put_flow', flow({}))
  assert.equal((await call('delete_payload', { id: 'order' })).error, false)
  assert.equal((await model()).payloads, undefined)
})

test('the agent instructions say when to write a payload', async t => {
  const { client } = await setup(t)
  assert.match(client.getInstructions() ?? '', /put_payload/)
})

test('an inline payload takes no null: null only removes a block from a payload put_payload already holds', async t => {
  const { call } = await setup(t)
  const sent = await call('connect', { from: 'web', to: 'api', payloads: [{ name: 'Cart', about: 'x', shape: null }] })
  assert.equal(sent.error, true)
  assert.match(sent.text, /Input validation|invalid/i)
})
