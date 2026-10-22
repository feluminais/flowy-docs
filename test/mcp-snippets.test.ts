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
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('put_object', { id: 'pricing', type: 'app', name: 'Pricing', in: 'shop' })
  const snippetsOf = async (id = 'pricing') => JSON.parse((await call('get_model')).text).objects[id].snippets
  return { dir, call, client, snippetsOf }
}

const fee = { title: 'Delivery fee', language: 'ts', text: 'const fee = base + km * rate' }

test('put_object saves snippets, writes the language as its id, and the file holds the code as lines', async t => {
  const { dir, call, snippetsOf } = await setup(t)
  const saved = await call('put_object', { id: 'pricing', snippets: [{ ...fee, text: 'const a = 1\nconst b = 2' }] })
  assert.equal(saved.error, false, saved.text)
  assert.deepEqual(await snippetsOf(), [{ title: 'Delivery fee', language: 'typescript', text: 'const a = 1\nconst b = 2' }])
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^ {8}text: \|-\n {10}const a = 1\n {10}const b = 2$/m)
})

test('a second put_object replaces the snippets, other fields keep them, and an empty list removes them', async t => {
  const { call, snippetsOf } = await setup(t)
  await call('put_object', { id: 'pricing', snippets: [fee, { text: 'SELECT 1' }] })
  await call('put_object', { id: 'pricing', snippets: [{ text: 'SELECT 2' }] })
  assert.deepEqual((await snippetsOf()).map((s: { text: string }) => s.text), ['SELECT 2'])
  await call('put_object', { id: 'pricing', tech: 'Node' })
  assert.equal((await snippetsOf()).length, 1)
  await call('put_object', { id: 'pricing', snippets: [] })
  assert.equal(await snippetsOf(), undefined)
})

test('a snippet that adds a problem is refused and nothing is saved', async t => {
  const { call, snippetsOf } = await setup(t)
  const unknown = await call('put_object', { id: 'pricing', snippets: [{ text: 'x', language: 'klingon' }] })
  assert.equal(unknown.error, true)
  assert.match(unknown.text, /unknown language "klingon"/)
  const long = await call('put_object', { id: 'pricing', snippets: [{ text: Array.from({ length: 41 }, () => 'x').join('\n') }] })
  assert.equal(long.error, true)
  assert.match(long.text, /41 lines, at most 40/)
  const blank = await call('put_object', { id: 'pricing', snippets: [{ text: '  ' }] })
  assert.equal(blank.error, true)
  assert.match(blank.text, /snippet 1 has no text/)
  assert.equal(await snippetsOf(), undefined)
})

test('the tool takes snippets and the instructions say how to write them', async t => {
  const { client } = await setup(t)
  const tool = (await client.listTools()).tools.find(x => x.name === 'put_object')!
  assert.ok('snippets' in (tool.inputSchema.properties as object))
  assert.match(((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' ')), /Writing code \(put_object's snippets\)/)
})

test('a key Flowy does not know on a snippet survives a put_object that sends it back', async t => {
  const { call, snippetsOf } = await setup(t)
  await call('put_object', { id: 'pricing', snippets: [{ text: 'a = 1', owner: 'pricing-team' }] })
  const [first] = await snippetsOf()
  assert.equal(first.owner, 'pricing-team')
  await call('put_object', { id: 'pricing', snippets: [{ ...first, title: 'Now titled' }] })
  const [again] = await snippetsOf()
  assert.deepEqual(again, { title: 'Now titled', text: 'a = 1', owner: 'pricing-team' })
})

test('code over the character limit is refused with the check\'s words', async t => {
  const { call, snippetsOf } = await setup(t)
  const refused = await call('put_object', { id: 'pricing', snippets: [{ text: 'x'.repeat(8001) }] })
  assert.equal(refused.error, true)
  assert.match(refused.text, /8001 characters, at most 8000/)
  assert.equal(await snippetsOf(), undefined)
})
