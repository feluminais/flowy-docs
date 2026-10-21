import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/node/mcp.ts'

const MODEL = `objects:
  shop: { type: system, name: Shop }
  web: { type: app, in: shop, name: Web app, color: blue, opacity: 40 }
  db: { type: store, in: shop, name: Orders DB }
  stripe: { type: system, name: Stripe, external: true }
connections:
  - { from: web, to: db, label: reads orders }
  - { from: web, to: stripe, label: holds the card }
`
const FLOW = `name: Checkout
view: root
steps:
  - { from: web, to: stripe, text: Holds the card, animation: { kind: call, outcome: timeout }, states: { stripe: stopped } }
`
const FAILURES = `name: Ordering
modes:
  stripe-timeout:
    mode: Stripe doesn't answer
    on: stripe
    severity: 8
    occurrence: 4
    detection: 3
    status: done
    after: { severity: 8, occurrence: 2, detection: 3 }
    flow: checkout
    step: 1
`

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-roundtrip-'))
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
  for (const [rel, text] of [['model.yaml', MODEL], ['flows/checkout.yaml', FLOW], ['failures/ordering.yaml', FAILURES]]) {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  return { dir, call, client }
}

const FILES = ['model.yaml', 'flows/checkout.yaml', 'failures/ordering.yaml']

test('everything get_model shows goes back through the write tools unchanged', async t => {
  const { dir, call } = await setup(t)
  const before = await Promise.all(FILES.map(f => readFile(join(dir, f), 'utf8')))
  const model = JSON.parse((await call('get_model')).text)
  // The values are text there, as in the files: "true", "40", "8", "1".
  assert.equal(model.objects.stripe.external, 'true')
  assert.equal(model.failures.ordering.modes['stripe-timeout'].severity, '8')
  for (const [id, o] of Object.entries(model.objects)) {
    const r = await call('put_object', { id, ...(o as object) })
    assert.equal(r.error, false, `put_object ${id}: ${r.text}`)
  }
  const flow = await call('put_flow', { id: 'checkout', ...model.flows.checkout })
  assert.equal(flow.error, false, flow.text)
  for (const [mid, m] of Object.entries(model.failures.ordering.modes)) {
    const r = await call('put_failure', { analysis: 'ordering', id: mid, ...(m as object) })
    assert.equal(r.error, false, `put_failure ${mid}: ${r.text}`)
  }
  const all = await call('put_failures', { id: 'ordering', ...model.failures.ordering })
  assert.equal(all.error, false, all.text)
  assert.deepEqual(await Promise.all(FILES.map(f => readFile(join(dir, f), 'utf8'))), before)
})

test('text for a number or a flag is taken only when it says one', async t => {
  const { call } = await setup(t)
  const mode = { analysis: 'ordering', id: 'stripe-timeout', mode: 'Stripe is slow', on: 'stripe', flow: 'checkout' }
  const first = await call('put_failure', { ...mode, severity: ' 9 ', occurrence: '3', detection: '4', step: '1' })
  assert.equal(first.error, false, first.text)
  for (const bad of ['7.5', 'ten', '', '-1', '0x10']) {
    const r = await call('put_failure', { ...mode, severity: bad })
    assert.equal(r.error, true, `severity ${JSON.stringify(bad)} should be refused`)
  }
  assert.equal((await call('put_failure', { ...mode, severity: '11' })).error, true) // still 1 to 10
  assert.equal((await call('put_object', { id: 'stripe', external: 'maybe' })).error, true)
  assert.equal((await call('put_object', { id: 'web', opacity: 'a lot' })).error, true)
  assert.equal((await call('put_object', { id: 'stripe', external: 'false' })).error, false)
  assert.equal(JSON.parse((await call('get_model')).text).objects.stripe.external, undefined)
})

test('the tools still tell a model that these are numbers and flags', async t => {
  const { client } = await setup(t)
  const tools = (await client.listTools()).tools
  const failure = tools.find(x => x.name === 'put_failure')!.inputSchema.properties as Record<string, { type?: string }>
  for (const key of ['severity', 'occurrence', 'detection', 'step']) assert.match(failure[key].type ?? '', /^(number|integer)$/, key)
  const object = tools.find(x => x.name === 'put_object')!.inputSchema.properties as Record<string, { type?: string }>
  assert.equal(object.external.type, 'boolean')
})

test('put_flow takes the effect of a step, keeps it through a read and write back, and refuses one that is not there', async t => {
  const { dir, call } = await setup(t)
  const steps = (effect: string) => [{ from: 'web', to: 'stripe', text: 'Holds the card', animation: { kind: 'send', carries: 'order 42', effect } }]
  assert.equal((await call('put_flow', { id: 'fun', name: 'Fun', view: 'root', steps: steps('bounce') })).error, false)
  assert.match(await readFile(join(dir, 'flows/fun.yaml'), 'utf8'), /effect: bounce/)
  const flow = JSON.parse((await call('get_model')).text).flows.fun
  assert.equal(flow.steps[0].animation.effect, 'bounce')
  const before = await readFile(join(dir, 'flows/fun.yaml'), 'utf8')
  assert.equal((await call('put_flow', { id: 'fun', ...flow })).error, false)
  assert.equal(await readFile(join(dir, 'flows/fun.yaml'), 'utf8'), before)
  const refused = await call('put_flow', { id: 'fun', name: 'Fun', view: 'root', steps: steps('spin') })
  assert.equal(refused.error, true)
  assert.equal(await readFile(join(dir, 'flows/fun.yaml'), 'utf8'), before)
  assert.equal((await call('get_problems')).text, 'No problems.')
})
