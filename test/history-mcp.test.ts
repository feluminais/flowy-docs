import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { openHistory } from '../src/node/history.ts'
import { createMcpServer } from '../src/node/mcp.ts'

/** An MCP server over a temp model folder, with history on in a temp state folder. */
async function setup(t: TestContext, blockStateDir = false) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-mcp-history-'))
  const dir = join(root, 'flowy')
  const stateDir = join(root, 'state')
  if (blockStateDir) await writeFile(stateDir, 'in the way')
  let tick = 0
  const history = openHistory(dir, { app: 'mcp', stateDir, log: () => undefined, now:() => new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + tick++) })
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir, history).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(async () => {
    await client.close()
    await rm(root, { recursive: true, force: true })
  })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const [first] = result.content as { text: string }[]
    return { error: result.isError === true, text: first.text }
  }
  const labels = async () => (await history.list()).map(s => s.label)
  return { dir, history, call, labels }
}

test('a write records one Claude step', async t => {
  const { history, call } = await setup(t)
  assert.equal((await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })).error, false)
  assert.deepEqual((await history.list()).map(s => [s.label, s.source, s.app, s.changed]), [['Claude: put_object shop', 'claude', 'mcp', ['model.yaml']]])
})

test('the first write over an existing model records a baseline first', async t => {
  const { dir, labels, call } = await setup(t)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'model.yaml'), 'objects: {}\nconnections: []\n')
  await call('put_object', { id: 'x', type: 'system', name: 'X' })
  assert.deepEqual(await labels(), ['Claude: put_object x', 'First seen'])
})

test('a hand edit between two writes is an outside step', async t => {
  const { dir, labels, call } = await setup(t)
  await call('put_object', { id: 'a', type: 'system', name: 'A' })
  await writeFile(join(dir, 'model.yaml'), `${await readFile(join(dir, 'model.yaml'), 'utf8')}# a note by hand\n`)
  await call('put_object', { id: 'b', type: 'system', name: 'B' })
  assert.deepEqual(await labels(), ['Claude: put_object b', 'Changed outside Flowy: model.yaml', 'Claude: put_object a'])
})

test('connect and disconnect read "a → b"', async t => {
  const { labels, call } = await setup(t)
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('connect', { from: 'customer', to: 'shop', label: 'buys' })
  await call('disconnect', { from: 'customer', to: 'shop' })
  assert.deepEqual((await labels()).slice(0, 2), ['Claude: disconnect customer → shop', 'Claude: connect customer → shop'])
})

test('a flow and an icon are named by their id and name', async t => {
  const { labels, call } = await setup(t)
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('put_icon', { name: 'stripe', path: 'M4 4h16v16h-16z' })
  await call('put_flow', { id: 'checkout', name: 'Checkout', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Buys' }] })
  await call('delete_flow', { id: 'checkout' })
  assert.deepEqual((await labels()).slice(0, 3), ['Claude: delete_flow checkout', 'Claude: put_flow checkout', 'Claude: put_icon stripe'])
})

test('a refused write and a read record nothing', async t => {
  const { labels, call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  assert.equal((await call('delete_object', { id: 'nope' })).error, true)
  assert.equal((await call('get_model')).error, false)
  assert.deepEqual(await labels(), ['Claude: put_object shop'])
})

test('Review Focus: an unwritable history never fails a tool call', async t => {
  const { dir, call } = await setup(t, true)
  const result = await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  assert.equal(result.error, false)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /shop:/)
})
