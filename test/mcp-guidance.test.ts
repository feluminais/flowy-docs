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
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-guidance-'))
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(async () => {
    await client.close()
    await rm(dir, { recursive: true, force: true })
  })
  return client
}

test('the server offers the three guides as resources, as they are in docs/', async t => {
  const client = await setup(t)
  const listed = (await client.listResources()).resources
  assert.deepEqual(listed.map(r => r.uri).sort(), ['flowy://docs/format.md', 'flowy://docs/guide.md', 'flowy://docs/writing.md'])
  for (const r of listed) assert.ok(r.description && r.mimeType === 'text/markdown', r.uri)
  const read = await client.readResource({ uri: 'flowy://docs/format.md' })
  assert.equal((read.contents[0] as { text: string }).text, await readFile('docs/format.md', 'utf8'))
})

test('the prompts hold the usual jobs, and the ones that take an argument put it in', async t => {
  const client = await setup(t)
  const names = (await client.listPrompts()).prompts.map(p => p.name)
  assert.deepEqual(names.sort(), ['failure-analysis', 'map-repo', 'review-model', 'update-after-change', 'write-flow'])
  const text = async (name: string, args?: Record<string, string>) => {
    const r = await client.getPrompt({ name, arguments: args })
    const [m] = r.messages
    assert.equal(m.role, 'user')
    return (m.content as { text: string }).text
  }
  assert.match(await text('map-repo', { focus: 'a new backend developer finding where pricing lives' }), /The reader: a new backend developer finding where pricing lives/)
  assert.match(await text('map-repo'), /First ask me who will read the model/)
  assert.match(await text('update-after-change', { change: 'branch pricing-fix' }), /for this change: branch pricing-fix\./)
  assert.match(await text('update-after-change'), /the uncommitted changes in the repo/)
  assert.match(await text('write-flow', { goal: 'Customer places an order' }), /flow for: Customer places an order\./)
  assert.match(await text('failure-analysis', { scope: 'ordering' }), /failure analysis for ordering\./)
  assert.match(await text('review-model'), /Change nothing: report\./)
  // Each job that writes ends by checking and by owning up to what was guessed.
  for (const name of ['map-repo', 'update-after-change']) assert.match(await text(name), /call get_problems[^]*what you inferred/, name)
  await assert.rejects(client.getPrompt({ name: 'write-flow' }), /goal/)
})

test('every tool, prompt and guide the instructions name is really there', async t => {
  const client = await setup(t)
  const instructions = client.getInstructions() ?? ''
  const tools = new Set((await client.listTools()).tools.map(x => x.name))
  const named = [...instructions.matchAll(/\b((?:get|put|delete)_[a-z]+)\b/g)].map(m => m[1]).filter(n => n !== 'delete_')
  for (const name of named) assert.ok(tools.has(name), `${name} is named in the instructions and is not a tool`)
  for (const tool of ['get_model', 'get_problems', 'put_object', 'put_flow', 'put_failure']) assert.ok(named.includes(tool), `${tool} is not in the instructions`)
  const prompts = (await client.listPrompts()).prompts.map(p => p.name)
  for (const p of ['map-repo', 'update-after-change', 'write-flow', 'failure-analysis', 'review-model']) assert.ok(instructions.includes(p) && prompts.includes(p), p)
  const resources = (await client.listResources()).resources.map(r => r.uri)
  assert.ok(instructions.includes('flowy://docs/format.md') && resources.includes('flowy://docs/format.md'))
})

test('the guide lists every tool, and the README and guide count them as the server does', async t => {
  const client = await setup(t)
  const tools = (await client.listTools()).tools.map(x => x.name)
  const guide = await readFile('docs/guide.md', 'utf8')
  const readme = await readFile('README.md', 'utf8')
  const table = guide.slice(guide.indexOf('**The tools.**'), guide.indexOf('Not over MCP:'))
  assert.deepEqual(tools.filter(name => !table.includes(`\`${name}\``)), [], 'tools missing from the guide table')
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
  assert.match(guide, new RegExp(`The server has ${words[tools.length]}\\.`))
  const reads = tools.filter(name => name.startsWith('get_')).length
  assert.match(readme, new RegExp(`Claude gets ${words[tools.length]} tools: ${words[reads]} read the model and ${words[tools.length - reads]} change`))
})
