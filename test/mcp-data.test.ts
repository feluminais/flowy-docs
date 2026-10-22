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
  await call('put_object', { id: 'db', type: 'store', name: 'Orders DB', in: 'shop', tech: 'Postgres' })
  const dataOf = async (id = 'db') => JSON.parse((await call('get_model')).text).objects[id].data
  return { dir, call, client, dataOf }
}

const orders = { name: 'orders', kind: 'table', columns: [{ name: 'id', key: 'primary' }, 'total'], rows: [['o_1042', 2490], ['o_1043', 1380]] }

test('put_object saves a store\'s data, get_model gives it back as text, and the file holds the rows on one line each', async t => {
  const { dir, call, dataOf } = await setup(t)
  const saved = await call('put_object', { id: 'db', data: [orders] })
  assert.equal(saved.error, false, saved.text)
  assert.deepEqual(await dataOf(), [{ name: 'orders', kind: 'table', columns: [{ name: 'id', key: 'primary' }, 'total'], rows: [['o_1042', '2490'], ['o_1043', '1380']] }])
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^ {10}- \[o_1042, 2490\]$/m)
})

test('a second put_object replaces the data, and an empty list removes it', async t => {
  const { call, dataOf } = await setup(t)
  await call('put_object', { id: 'db', data: [orders] })
  await call('put_object', { id: 'db', data: [{ name: 'refunds', columns: ['id', 'amount'] }] })
  assert.deepEqual((await dataOf()).map((e: { name: string }) => e.name), ['refunds'])
  await call('put_object', { id: 'db', tech: 'MySQL' })
  assert.equal((await dataOf()).length, 1)
  await call('put_object', { id: 'db', data: [] })
  assert.equal(await dataOf(), undefined)
})

test('data that adds a problem is refused and nothing is saved', async t => {
  const { call, dataOf } = await setup(t)
  const refused = await call('put_object', { id: 'db', data: [{ name: 'orders', columns: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3']] }] })
  assert.equal(refused.error, true)
  assert.match(refused.text, /row 1 has 3 cells but there are 4 columns/)
  assert.equal(await dataOf(), undefined)
})

test('a key other than primary is refused by the tool', async t => {
  const { call } = await setup(t)
  assert.equal((await call('put_object', { id: 'db', data: [{ name: 'orders', columns: [{ name: 'id', key: 'foreign' }] }] })).error, true)
})

test('data on anything but a store is refused', async t => {
  const { call } = await setup(t)
  const refused = await call('put_object', { id: 'shop', data: [orders] })
  assert.equal(refused.error, true)
  assert.match(refused.text, /only a store can have data/)
})

test('the tool takes data and the instructions say how to write it', async t => {
  const { client } = await setup(t)
  const tool = (await client.listTools()).tools.find(x => x.name === 'put_object')!
  assert.ok('data' in (tool.inputSchema.properties ?? {}))
  assert.match(((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' ')), /never copied from a real/)
})
