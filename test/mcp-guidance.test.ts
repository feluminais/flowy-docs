import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { SNIPPET_MAX } from '../src/core/snippets.ts'
import { STATE_NAMES } from '../src/core/states.ts'
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

test('the server offers the guide pages and the topic rules as resources, the pages as they are in docs/', async t => {
  const client = await setup(t)
  const listed = (await client.listResources()).resources
  const pages = (await readdir('docs/guide')).map(n => `flowy://docs/guide/${n}`)
  assert.deepEqual(listed.map(r => r.uri).sort(), ['flowy://docs/format.md', 'flowy://docs/guide.md', ...pages, 'flowy://docs/writing.md', 'flowy://rules/code', 'flowy://rules/data', 'flowy://rules/failures', 'flowy://rules/flows'].sort())
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

test('the guide lists every tool, and SECURITY.md and the guide count them as the server does', async t => {
  const client = await setup(t)
  const tools = (await client.listTools()).tools.map(x => x.name)
  const guide = await readFile('docs/guide/claude.md', 'utf8')
  const security = await readFile('SECURITY.md', 'utf8')
  const table = guide.slice(guide.indexOf('**The tools.**'), guide.indexOf('Not over MCP:'))
  assert.deepEqual(tools.filter(name => !table.includes(`\`${name}\``)), [], 'tools missing from the guide table')
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
  assert.match(guide, new RegExp(`The server has ${words[tools.length]}\\.`))
  const reads = tools.filter(name => name.startsWith('get_')).length
  assert.match(security, new RegExp(`Claude gets ${words[tools.length]} tools: ${words[reads]} read the model and ${words[tools.length - reads]} change`))
})

test('the instructions give the default, ask for the rest by name, and end on what Flowy could add', async t => {
  const client = await setup(t)
  const instructions = client.getInstructions() ?? ''
  assert.match(instructions, /make Flowy docs[^]*the default and nothing else/)
  assert.match(instructions, /Don't read the topic rules/)
  assert.match(instructions, /ask which parts/)
  assert.match(instructions, /what Flowy could add, from what you saw/)
  // The long rules for the parts most requests leave out are not in the instructions; they are read on request.
  for (const rule of ['Writing code (put_object', 'Writing data (put_object', 'Writing failure modes (put_failures']) assert.ok(!instructions.includes(rule), rule)
  for (const topic of ['flows', 'data', 'code', 'failures']) assert.ok(instructions.includes(`flowy://rules/${topic}`), topic)
})

test('each topic rule is a resource, with the limits the code enforces', async t => {
  const client = await setup(t)
  const text = async (topic: string) => ((await client.readResource({ uri: `flowy://rules/${topic}` })).contents[0] as { text: string }).text
  assert.match(await text('code'), new RegExp(`At most ${SNIPPET_MAX.snippets} snippets of ${SNIPPET_MAX.lines} lines`))
  assert.match(await text('flows'), new RegExp(STATE_NAMES.join(', ')))
  assert.match(await text('flows'), /Animate only when the user asked for motion/)
  assert.match(await text('data'), /Sample rows are invented/)
  assert.match(await text('failures'), /put_failure replaces the whole mode/)
})

test('docs/guide.md routes to every page, and every relative link in the guide pages lands on a file', async () => {
  const index = await readFile('docs/guide.md', 'utf8')
  const pages = await readdir('docs/guide')
  for (const page of pages) assert.ok(index.includes(`(guide/${page})`), `${page} is not linked from guide.md`)
  for (const file of ['docs/guide.md', ...pages.map(p => `docs/guide/${p}`)]) {
    const text = await readFile(file, 'utf8')
    for (const [, target] of text.matchAll(/\]\(([A-Za-z0-9./-]+?)(?:#[^)\s]*)?\)/g)) {
      assert.ok(existsSync(join(dirname(file), target)), `${file} links to ${target}, which is not there`)
    }
  }
})
