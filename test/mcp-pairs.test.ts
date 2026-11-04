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
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-pairs-'))
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
  const json = async (name: string, args: Record<string, unknown> = {}) => JSON.parse((await call(name, args)).text)
  for (const [id, name] of [['ui', 'Screen'], ['management', 'Management'], ['linux', 'Linux']]) await call('put_object', { id, type: 'system', name })
  await call('connect', { from: 'ui', to: 'management', label: 'Request and reply', kind: 'request' })
  await call('connect', { from: 'ui', to: 'management', label: 'Start scan', kind: 'stream' })
  await call('connect', { from: 'management', to: 'ui', label: 'Scan results', kind: 'publish' })
  await call('connect', { from: 'management', to: 'linux', label: 'Apply config' })
  return { dir, call, json, client }
}

test('put_project sets pairs, merged takes it off, and the schema lists the two words', async t => {
  const { dir, call, client } = await setup(t)
  const set = await call('put_project', { name: 'WLAN', pairs: 'separate' })
  assert.equal(set.error, false, set.text)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^name: WLAN\r?\npairs: separate\r?$/m)
  assert.equal((await call('put_project', { about: 'Radios.' })).error, false) // left out: it stays
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^pairs: separate\r?$/m)
  assert.equal((await call('put_project', { pairs: 'merged' })).error, false)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /pairs/)
  assert.equal((await call('put_project', { pairs: 'each' })).error, true)
  const schema = JSON.stringify((await client.listTools()).tools.find(x => x.name === 'put_project')!.inputSchema)
  assert.match(schema, /"pairs":\{[^}]*"enum":\["merged","separate"\]/)
})

test('get_view lists the strands of a project that draws a line for each connection, and no others', async t => {
  const { call, json } = await setup(t)
  assert.equal((await json('get_view', { view: 'root' })).strands, undefined)
  await call('put_project', { pairs: 'separate' })
  const view = await json('get_view', { view: 'root' })
  assert.equal(view.edges.length, 2) // the edges are still one for each pair
  assert.deepEqual(view.strands.map((s: { id: string; lane: number; lanes: number }) => [s.id, s.lane, s.lanes]), [
    ['management ui|ui>management|Request and reply', 0, 3], ['management ui|ui>management|Start scan', 1, 3], ['management ui|management>ui|Scan results', 2, 3],
    ['linux management|management>linux|Apply config', 0, 1],
  ])
  assert.deepEqual(view.strands[1].connections, [1])
})

test('put_flow keeps a via, says which line a step rides, and refuses a via that names no connection', async t => {
  const { dir, call, json } = await setup(t)
  await call('put_project', { pairs: 'separate' })
  const steps = [
    { from: 'ui', to: 'management', text: 'The screen starts a scan', via: 'Start scan' },
    { from: 'management', to: 'ui', text: 'Results reach the screen' },
    { from: 'management', to: 'linux', text: 'The config is applied' },
  ]
  const saved = await call('put_flow', { id: 'scan', name: 'Scan', view: 'root', steps })
  assert.equal(saved.error, false, saved.text)
  // Only a step that could ride several lines says which it does.
  assert.match(saved.text, /1\. Screen → Management: The screen starts a scan \(rides "Start scan"\)/)
  assert.match(saved.text, /2\. Management → Screen: Results reach the screen \(rides "Scan results"\)/)
  assert.match(saved.text, /3\. Management → Linux: The config is applied$/m)
  assert.match(await readFile(join(dir, 'flows', 'scan.yaml'), 'utf8'), /via: Start scan/)
  assert.equal((await json('get_model', { flow: 'scan' })).flow.steps[0].via, 'Start scan')
  // What get_model shows goes back as it is.
  assert.equal((await call('put_flow', { id: 'scan', name: 'Scan', view: 'root', steps: (await json('get_model', { flow: 'scan' })).flow.steps })).error, false)
  assert.equal((await json('get_model', { flow: 'scan' })).flow.steps[0].via, 'Start scan')
  const wrong = await call('put_flow', { id: 'scan', name: 'Scan', view: 'root', steps: [{ from: 'ui', to: 'management', text: 'x', via: 'Nope' }] })
  assert.equal(wrong.error, true)
  assert.match(wrong.text, /"via" "Nope" matches no connection from ui to management/)
  assert.equal((await json('get_model', { flow: 'scan' })).flow.steps[0].via, 'Start scan') // nothing was saved
})

test('the readout of a project with a line for each pair names no line', async t => {
  const { call } = await setup(t)
  const saved = await call('put_flow', { id: 'scan', name: 'Scan', view: 'root', steps: [{ from: 'ui', to: 'management', text: 'The screen starts a scan', via: 'Start scan' }] })
  assert.equal(saved.error, false, saved.text)
  assert.doesNotMatch(saved.text, /rides/)
})

test('disconnect is refused while a step names the connection with via, and says which steps', async t => {
  const { call, json } = await setup(t)
  await call('put_project', { pairs: 'separate' })
  await call('put_flow', { id: 'scan', name: 'Scan', view: 'root', steps: [{ from: 'ui', to: 'management', text: 'The screen starts a scan', via: 'start scan' }] })
  const refused = await call('disconnect', { from: 'ui', to: 'management', label: 'Start scan' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /connection ui → management is named by flow scan step 1\. Change those first\./)
  assert.equal((await json('get_model', { summary: true })).connections.length, 4)
  // A connection no step names goes as before.
  assert.equal((await call('disconnect', { from: 'ui', to: 'management', label: 'Request and reply' })).error, false)
})

test('new_sketch makes a sketch that draws a line for each connection', async t => {
  const { dir, call } = await setup(t)
  assert.equal((await call('new_sketch', { id: 'wlan', name: 'WLAN', copy: ['ui', 'management'] })).error, false)
  assert.match(await readFile(join(dir, 'sketches', 'wlan', 'model.yaml'), 'utf8'), /^pairs: separate\r?$/m)
  const view = JSON.parse((await call('get_view', { sketch: 'wlan', view: 'root' })).text)
  assert.equal(view.strands.length, 3)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /pairs/) // the model keeps one line for each pair
})

test('disconnect with no label is refused when several connections run between the two shapes and each is a line, and lists the labels', async t => {
  const { call, json } = await setup(t)
  await call('put_project', { pairs: 'separate' })
  const refused = await call('disconnect', { from: 'ui', to: 'management' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /2 connections run ui → management/)
  assert.match(refused.text, /"Request and reply", "Start scan"/)
  assert.equal((await json('get_model', { summary: true })).connections.length, 4)
  // The same call with `resolve` is no way round it.
  assert.equal((await call('disconnect', { from: 'ui', to: 'management', resolve: [] })).error, true)
  assert.equal((await call('disconnect', { from: 'ui', to: 'management', label: 'Start scan' })).error, false)
})
