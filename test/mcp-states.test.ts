import { test } from 'node:test'
import { RULES } from '../src/node/rules.ts'
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
  await call('put_object', { id: 'checkout', type: 'system', name: 'Checkout' })
  await call('put_object', { id: 'stripe', type: 'system', name: 'Stripe', external: true })
  return { dir, call, client }
}

const steps = [
  { from: 'checkout', to: 'stripe', text: 'Charges the card' },
  { from: 'stripe', text: 'Stops answering', states: { stripe: 'stopped' } },
  { from: 'checkout', to: 'stripe', text: 'The hold times out', animation: { kind: 'call', outcome: 'timeout' } },
  { from: 'stripe', text: 'It answers again', states: { stripe: 'running', checkout: 'running' } },
]

test('mcp: put_flow accepts states on the flow and on a step, and writes them', async t => {
  const { dir, call } = await setup(t)
  const saved = await call('put_flow', { id: 'outage', name: 'Payments goes down', view: 'root', states: { checkout: 'degraded' }, steps })
  assert.equal(saved.error, false, saved.text)
  const flow = JSON.parse((await call('get_model')).text).flows.outage
  assert.deepEqual(flow.states, { checkout: 'degraded' })
  assert.deepEqual(flow.steps[1].states, { stripe: 'stopped' })
  assert.deepEqual(flow.steps[3].states, { stripe: 'running', checkout: 'running' })
  const file = await readFile(join(dir, 'flows', 'outage.yaml'), 'utf8')
  assert.match(file, /^name: Payments goes down\nview: root\nstates:\n {2}checkout: degraded\nsteps:/)
  assert.match(file, /states:\n {6}stripe: stopped/)
})

test('mcp: a bad state is refused with the checker\'s words, and nothing is saved', async t => {
  const { call } = await setup(t)
  const word = await call('put_flow', { id: 'bad', name: 'Bad', view: 'root', steps: [{ from: 'checkout', to: 'stripe', text: 'x', states: { stripe: 'asleep' } }] })
  assert.equal(word.error, true)
  assert.match(word.text, /step 1: states: unknown state "asleep" for "stripe" \(use running, starting, stopping, stopped, restarting, degraded\)/)
  const shape = await call('put_flow', { id: 'bad', name: 'Bad', view: 'root', states: { ghost: 'stopped' }, steps })
  assert.equal(shape.error, true)
  assert.match(shape.text, /states: unknown shape "ghost"/)
  assert.deepEqual(JSON.parse((await call('get_model')).text).flows, {})
})

test('mcp: delete_object takes a shape out of the states that name it', async t => {
  const { call } = await setup(t)
  await call('put_object', { id: 'cache', type: 'system', name: 'Cache' })
  const saved = await call('put_flow', { id: 'warm', name: 'Warm', view: 'root', states: { cache: 'starting' }, steps: [{ from: 'checkout', to: 'stripe', text: 'x' }] })
  assert.equal(saved.error, false, saved.text)
  const deleted = await call('delete_object', { id: 'cache' })
  assert.equal(deleted.error, false, deleted.text)
  assert.equal('states' in JSON.parse((await call('get_model')).text).flows.warm, false)
})

test('mcp: the instructions and the put_flow fields tell the AI about states', async t => {
  const { client } = await setup(t)
  const text = ((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' '))
  for (const phrase of ['A shape is Running unless a flow says otherwise', 'set the shape back to running when it recovers', 'running, starting, stopping, stopped, restarting, degraded']) assert.ok(text.includes(phrase), phrase)
  const put = (await client.listTools()).tools.find(tool => tool.name === 'put_flow')!
  const schema = JSON.stringify(put.inputSchema)
  for (const phrase of ['Where shapes stand before step 1', 'The shapes this step changes', 'until another step changes it']) assert.ok(schema.includes(phrase), phrase)
})
