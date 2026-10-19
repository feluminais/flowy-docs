import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
  return { dir, call }
}

test('builds a model and shows a view', async t => {
  const { dir, call } = await setup(t)
  assert.equal((await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })).error, false)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('put_object', { id: 'web', type: 'app', name: 'Web app', in: 'shop' })
  await call('connect', { from: 'customer', to: 'web', label: 'browses' })
  const view = JSON.parse((await call('get_view', { view: 'root' })).text)
  assert.deepEqual(view.edges, [{ from: 'customer', to: 'shop', label: 'browses', count: 1 }])
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /web:\n {4}type: app/)
})

test('a write that adds a problem is refused and nothing is saved', async t => {
  const { dir, call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const before = await readFile(join(dir, 'model.yaml'), 'utf8')
  const result = await call('put_object', { id: 'web', type: 'app', name: 'Web app' })
  assert.equal(result.error, true)
  assert.match(result.text, /web: app must be inside system/)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), before)
})

test('flows round-trip, and delete_object explains refusals', async t => {
  const { call } = await setup(t)
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const saved = await call('put_flow', { id: 'visit', name: 'Visit', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Visits' }] })
  assert.equal(saved.error, false, saved.text)
  assert.equal(JSON.parse((await call('get_model')).text).flows.visit.name, 'Visit')
  const refused = await call('delete_object', { id: 'customer' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /used by flow visit/)
})

test('calls sent at the same time run in arrival order', async t => {
  const { call } = await setup(t)
  const [system, app] = await Promise.all([
    call('put_object', { id: 'shop', type: 'system', name: 'Shop' }),
    call('put_object', { id: 'api', type: 'app', name: 'API', in: 'shop' }),
  ])
  assert.equal(system.error, false, system.text)
  assert.equal(app.error, false, app.text)
})

test('a read sent together with a write sees the write', async t => {
  const { call } = await setup(t)
  const [, model] = await Promise.all([call('put_object', { id: 'shop', type: 'system', name: 'Shop' }), call('get_model')])
  assert.deepEqual(Object.keys(JSON.parse(model.text).objects), ['shop'])
})

test('old problems never block an unrelated write, and only the changed file is written', async t => {
  const { dir, call } = await setup(t)
  const model = 'objects:\n  customer: { type: actor, name: Customer }\n  shop: { type: system, name: Shop }\nconnections:\n  - { from: shop, to: ghost }\n'
  await writeFile(join(dir, 'model.yaml'), model)
  await writeFile(join(dir, 'layout.yaml'), 'root:\n  shop: [0, 0]\n')
  const saved = await call('put_flow', { id: 'tour', name: 'Tour', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Visits' }] })
  assert.equal(saved.error, false, saved.text)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), model)
  assert.equal(await readFile(join(dir, 'layout.yaml'), 'utf8'), 'root:\n  shop: [0, 0]\n')
  assert.equal((await call('put_object', { id: 'mail', type: 'system', name: 'Mail' })).text, 'Created mail.')
  assert.equal((await call('put_object', { id: 'mail', tech: 'SMTP' })).text, 'Updated mail.')
})

// U+2028 and U+2029, built in code so no copy or paste step can turn them into spaces
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

test('values with line separators save and load again', async t => {
  const { call } = await setup(t)
  const description = `a${LS}=======${PS}<<<<<<< x`
  assert.equal((await call('put_object', { id: 'o', type: 'actor', name: 'N', description })).error, false)
  const model = await call('get_model')
  assert.equal(model.error, false, model.text)
  assert.equal(JSON.parse(model.text).objects.o.description, description)
})

test('unknown views, overlong ids and unreadable files come back as errors', async t => {
  const { dir, call } = await setup(t)
  assert.match((await call('get_view', { view: 'nope' })).text, /unknown view "nope"/)
  assert.equal((await call('get_view', { view: '__proto__' })).error, true)
  assert.equal((await call('get_view', { view: 'root' })).error, false)
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const long = await call('put_flow', { id: 'f'.repeat(300), name: 'F', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'x' }] })
  assert.equal(long.error, true)
  assert.match(long.text, /<=64 characters/)
  await mkdir(join(dir, 'flows'), { recursive: true })
  await writeFile(join(dir, 'flows/x.yaml'), 'steps: nope\n')
  assert.match((await call('get_model')).text, /^flows\/x\.yaml: /)
})

test('a broken file is reported, not overwritten', async t => {
  const { dir, call } = await setup(t)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  a: { type: actor\n')
  const result = await call('put_object', { id: 'b', type: 'actor', name: 'B' })
  assert.equal(result.error, true)
  assert.match(result.text, /^model\.yaml:\d+:/)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects:\n  a: { type: actor\n')
})

test('code paths are checked against the folder that holds the flowy folder', async t => {
  const { dir, call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const here = `${basename(dir)}/` // the flowy folder itself sits in its parent, so this path exists
  assert.equal((await call('put_object', { id: 'shop', code: [here] })).error, false)
  const refused = await call('put_object', { id: 'shop', code: [here, 'no-such-folder-for-flowy/'] })
  assert.equal(refused.error, true)
  assert.match(refused.text, /code path "no-such-folder-for-flowy\/" doesn't exist/)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), new RegExp(`code:\\n\\s+- ${here.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`))
  assert.equal((await call('put_object', { id: 'shop', code: [] })).error, false)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /code/)
})

test('links are checked like code paths, and web addresses are not looked up', async t => {
  const { dir, call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const here = `${basename(dir)}/` // the flowy folder itself sits in its parent, so this path exists
  assert.equal((await call('put_object', { id: 'shop', links: [{ title: 'Folder', url: here }, { title: 'Status', url: 'https://status.example.com' }] })).error, false)
  const refused = await call('put_object', { id: 'shop', links: [{ url: here }, { url: 'no-such-doc-for-flowy.md' }] })
  assert.equal(refused.error, true)
  assert.match(refused.text, /link path "no-such-doc-for-flowy\.md" doesn't exist/)
  const scheme = await call('put_object', { id: 'shop', links: [{ url: 'file:///etc/passwd' }] })
  assert.equal(scheme.error, true)
  assert.match(scheme.text, /must be a web address/)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /links:\n\s+- title: Folder\n\s+url: /)
  assert.equal((await call('put_object', { id: 'shop', links: [] })).error, false)
  assert.doesNotMatch(await readFile(join(dir, 'model.yaml'), 'utf8'), /links/)
})

test('get_mermaid draws a view or a flow, and wants exactly one of them', async t => {
  const { call } = await setup(t)
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('connect', { from: 'customer', to: 'shop', label: 'buys' })
  await call('put_flow', { id: 'buy', name: 'Buying', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Buys' }] })
  assert.match((await call('get_mermaid', { view: 'root' })).text, /^flowchart TB\n[\s\S]*n0 -- "buys" --> n1\n$/)
  assert.match((await call('get_mermaid', { flow: 'buy' })).text, /^sequenceDiagram\n {2}actor n0 as Customer\n[\s\S]*n0->>n1: Buys\n$/)
  for (const args of [{}, { view: 'root', flow: 'buy' }]) assert.equal((await call('get_mermaid', args)).error, true)
  assert.match((await call('get_mermaid', { flow: 'nope' })).text, /unknown flow "nope"/)
})

test('put_flow takes a step one box does on its own, and a longer detail', async t => {
  const { dir, call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const saved = await call('put_flow', { id: 'think', name: 'Thinking', view: 'root', steps: [{ from: 'shop', text: 'Thinks', description: 'For a **while**.' }] })
  assert.equal(saved.error, false, saved.text)
  assert.equal(await readFile(join(dir, 'flows', 'think.yaml'), 'utf8'), 'name: Thinking\nview: root\nsteps:\n  - from: shop\n    text: Thinks\n    description: For a **while**.\n')
})

test('put_object marks an outside service', async t => {
  const { dir, call } = await setup(t)
  const saved = await call('put_object', { id: 'stripe', type: 'system', name: 'Stripe', external: true })
  assert.equal(saved.error, false, saved.text)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /stripe:\n {4}type: system\n {4}name: Stripe\n {4}external: true\n/)
})

test('put_flow answers with how each step reads on its view, naming the part inside a box', async t => {
  const { call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  await call('put_object', { id: 'web', type: 'app', name: 'Web app', in: 'shop' })
  await call('put_object', { id: 'api', type: 'app', name: 'API', in: 'shop' })
  await call('put_object', { id: 'auth', type: 'component', name: 'Auth', in: 'api' })
  await call('put_object', { id: 'orders', type: 'component', name: 'Orders', in: 'api' })
  // Played on Shop, Auth and Orders are both drawn as API: the readout says so.
  const saved = await call('put_flow', { id: 'buy', name: 'Buying', view: 'shop', steps: [
    { from: 'web', to: 'auth', text: 'Asks Auth to check the user' },
    { from: 'orders', text: 'Saves the order' },
    { from: 'orders', to: 'web', text: 'Sends the receipt' },
  ] })
  assert.equal(saved.error, false, saved.text)
  assert.equal(saved.text, [
    'Saved flow buy. On Shop it reads:',
    '1. Web app → Auth in API: Asks Auth to check the user',
    '2. Orders in API: Saves the order',
    '3. Orders in API → Web app: Sends the receipt',
    'Ends written "X in Y" are drawn as Y on this view. If two steps then seem to go to Y and back, say in the text which part of Y is meant, or play the flow inside Y.',
  ].join('\n'))
  // Played inside API, every end is a box of its own, and there's no hint.
  const inside = await call('put_flow', { id: 'check', name: 'Checking', view: 'api', steps: [{ from: 'auth', to: 'orders', text: 'Lets the order through' }] })
  assert.equal(inside.text, 'Saved flow check. On API it reads:\n1. Auth → Orders: Lets the order through')
})

test('put_object draws an object its own way, and put_icon defines the icon it names', async t => {
  const { dir, call } = await setup(t)
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const refused = await call('put_object', { id: 'jobs', type: 'actor', name: 'Jobs', icon: 'stripe', color: 'bluish' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /jobs: color "bluish" must be a name/)
  assert.match(refused.text, /jobs: unknown icon "stripe"/)
  assert.equal((await call('put_icon', { name: 'stripe', path: 'M4 4h16v16h-16z' })).error, false)
  assert.equal((await call('put_icon', { name: 'cloud', path: 'M4 4h16v16h-16z' })).error, true, 'a built-in name is taken')
  const saved = await call('put_object', { id: 'jobs', type: 'actor', name: 'Jobs', shape: 'hexagon', icon: 'stripe', color: 'blue', opacity: 40 })
  assert.equal(saved.error, false, saved.text)
  const yaml = await readFile(join(dir, 'model.yaml'), 'utf8')
  assert.match(yaml, /^icons:\n {2}stripe: M4 4h16v16h-16z\n/m)
  assert.match(yaml, /jobs:\n {4}type: actor\n {4}name: Jobs\n {4}shape: hexagon\n {4}color: blue\n {4}opacity: 40\n {4}icon: stripe\n/)
  const inUse = await call('delete_icon', { name: 'stripe' })
  assert.match(inUse.text, /used by jobs/)
  await call('put_object', { id: 'jobs', icon: '', opacity: '' })
  assert.equal((await call('delete_icon', { name: 'stripe' })).error, false)
})

test('put_flow takes a step animation, and refuses one that is not a kind', async t => {
  const { dir, call } = await setup(t)
  await call('put_object', { id: 'customer', type: 'actor', name: 'Customer' })
  await call('put_object', { id: 'shop', type: 'system', name: 'Shop' })
  const saved = await call('put_flow', { id: 'visit', name: 'Visit', view: 'root', steps: [
    { from: 'customer', to: 'shop', text: 'Visits', animation: 'call' },
    { from: 'shop', to: 'customer', text: 'Rings back', animation: { kind: 'callback', trigger: 'outside', carries: 'receipt' } },
  ] })
  assert.equal(saved.error, false, saved.text)
  const flow = JSON.parse((await call('get_model')).text).flows.visit
  assert.equal(flow.steps[0].animation, 'call')
  assert.deepEqual(flow.steps[1].animation, { kind: 'callback', trigger: 'outside', carries: 'receipt' })
  assert.match(await readFile(join(dir, 'flows', 'visit.yaml'), 'utf8'), /animation: call/)

  const refused = await call('put_flow', { id: 'bad', name: 'Bad', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'x', animation: 'zoom' }] })
  assert.equal(refused.error, true)
  assert.match(refused.text, /unknown animation "zoom"/)
  const misspelled = await call('put_flow', { id: 'bad', name: 'Bad', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'x', animation: { kind: 'send', carry: 'x' } }] })
  assert.equal(misspelled.error, true)
})
