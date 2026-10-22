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
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  return { dir, call, client }
}

const steps = [
  { from: 'customer', to: 'shop', text: 'Asks', group: 'try' },
  { from: 'shop', to: 'customer', text: 'Answers', group: 'try' },
  { from: 'shop', to: 'customer', text: 'Mails', group: 'tell', lane: 'Mail' },
  { from: 'shop', to: 'customer', text: 'Rings', group: 'tell', lane: 'Phone', flow: 'pays' },
]

test('put_flow takes groups and a step\'s group, lane and flow, and writes a number times as text', async t => {
  const { dir, call } = await setup(t)
  const saved = await call('put_flow', { id: 'pays', name: 'Pays', view: 'root', groups: { try: { kind: 'repeat', times: 3, text: 'Backs off' }, tell: { kind: 'parallel' } }, steps })
  assert.equal(saved.error, false, saved.text)
  const flow = JSON.parse((await call('get_model')).text).flows.pays
  assert.deepEqual(flow.groups, { try: { kind: 'repeat', times: '3', text: 'Backs off' }, tell: { kind: 'parallel' } })
  assert.deepEqual(flow.steps[3], { from: 'shop', to: 'customer', text: 'Rings', group: 'tell', lane: 'Phone', flow: 'pays' })
  assert.match(await readFile(join(dir, 'flows', 'pays.yaml'), 'utf8'), /groups:\n {2}try:\n {4}kind: repeat\n {4}times: 3\n {4}text: Backs off\n {2}tell:\n {4}kind: parallel\nsteps:/)
})

test('put_flow refuses a group of no known kind, an option it does not know, and a group a step names but nobody declared', async t => {
  const { call } = await setup(t)
  const flow = (groups: Record<string, unknown>, group = 'try') => call('put_flow', { id: 'bad', name: 'Bad', view: 'root', groups, steps: [{ from: 'customer', to: 'shop', text: 'x', group }] })
  assert.equal((await flow({ try: { kind: 'loop' } })).error, true)
  assert.equal((await flow({ try: { kind: 'repeat', times: 2, in: 'x' } })).error, true)
  const undeclared = await flow({ try: { kind: 'repeat', times: 2 } }, 'other')
  assert.equal(undeclared.error, true)
  assert.match(undeclared.text, /group "other" is not declared under groups/)
})

test('delete_flow is refused while another flow continues in it', async t => {
  const { call } = await setup(t)
  await call('put_flow', { id: 'child', name: 'Child', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Visits' }] })
  const parent = await call('put_flow', { id: 'parent', name: 'Parent', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Starts', flow: 'child' }] })
  assert.equal(parent.error, false, parent.text)
  const refused = await call('delete_flow', { id: 'child' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /unknown flow "child"/)
  assert.ok(JSON.parse((await call('get_model')).text).flows.child)
  assert.equal((await call('put_flow', { id: 'wrong', name: 'Wrong', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'x', flow: 'nowhere' }] })).error, true)
})

test('the instructions and the put_flow fields tell Claude about groups, lanes and flow links', async t => {
  const { client } = await setup(t)
  const text = (((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' '))).toLowerCase()
  for (const word of ['repeat', 'branch', 'parallel', 'lane', 'flow:', 'times is the limit the code really has']) assert.ok(text.includes(word), word)
  const put = (await client.listTools()).tools.find(tool => tool.name === 'put_flow')!
  const schema = JSON.stringify(put.inputSchema)
  for (const phrase of ['the first run included', 'Groups of neighbouring steps', 'starts a lane at this step', 'tells what happens next']) assert.ok(schema.includes(phrase), phrase)
})
