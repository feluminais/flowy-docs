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
  web: { type: app, in: shop, name: Web app, tech: React }
  db: { type: store, in: shop, name: Orders DB }
  stripe: { type: system, name: Stripe, external: true }
connections:
  - { from: web, to: db, label: reads orders }
  - { from: web, to: stripe, label: holds the card }
`
const FLOW = 'name: Checkout\nview: shop\nsteps:\n  - { from: web, to: db, text: Saves the order }\n'
const FAILURES = 'name: Ordering\nmodes:\n  db-down:\n    mode: The database is unreachable\n    on: db\n    severity: 9\n    occurrence: 2\n    detection: 2\n'
const RUN = 'name: Dinner rush\nunit: req/s\nlevels:\n  - load: 1\n  - load: 2\n'

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-read-'))
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
  const put = async (rel: string, text: string) => {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  await put('model.yaml', MODEL)
  await put('flows/checkout.yaml', FLOW)
  await put('failures/ordering.yaml', FAILURES)
  await put('perf/dinner-rush.yaml', RUN)
  return { dir, call, put, client }
}

test('get_model lists the load-test runs, so a failure mode can name one', async t => {
  const { call } = await setup(t)
  const model = JSON.parse((await call('get_model')).text)
  assert.deepEqual(model.runs, [{ id: 'dinner-rush', name: 'Dinner rush' }])
  assert.deepEqual(model.problems, [])
})

test('a failure mode naming a run that is not in perf/ is refused, and the answer lists the runs there are', async t => {
  const { dir, call } = await setup(t)
  const before = await readFile(join(dir, 'failures/ordering.yaml'), 'utf8')
  const mode = { analysis: 'ordering', id: 'db-down', mode: 'The database is unreachable', on: 'db', severity: 9, occurrence: 2, detection: 2 }
  const refused = await call('put_failure', { ...mode, run: 'no-such-run' })
  assert.equal(refused.error, true)
  assert.match(refused.text, /^Refused, nothing saved\. This would add:\n- failures\/ordering\.yaml: db-down: run "no-such-run" doesn't exist\nThe runs in perf\/ are: dinner-rush\.$/)
  assert.equal(await readFile(join(dir, 'failures/ordering.yaml'), 'utf8'), before)
  assert.equal((await call('put_failure', { ...mode, run: 'dinner-rush' })).error, false)
  // A whole analysis is held to the same rule.
  const all = await call('put_failures', { id: 'other', name: 'Other', modes: { m: { mode: 'It breaks', on: 'web', run: 'ghost' } } })
  assert.equal(all.error, true)
  assert.match(all.text, /other\.yaml: m: run "ghost" doesn't exist/)
})

test('with no runs in perf/, the refusal says to leave run out, and a run that was already missing never blocks another edit', async t => {
  const { dir, call, put } = await setup(t)
  await rm(join(dir, 'perf'), { recursive: true })
  const refused = await call('put_failure', { analysis: 'ordering', id: 'db-down', mode: 'x', on: 'db', run: 'gone' })
  assert.match(refused.text, /There are no load-test runs in perf\/, so leave run out\.$/)
  await put('failures/ordering.yaml', `${FAILURES}    run: gone\n`)
  assert.match((await call('get_problems')).text, /ordering\.yaml: db-down: run "gone" doesn't exist/)
  assert.equal((await call('put_object', { id: 'web', tech: 'Vue' })).error, false) // an old problem is not new
})

test('get_problems is the whole list in one line each, or "No problems."', async t => {
  const { call, put } = await setup(t)
  assert.equal((await call('get_problems')).text, 'No problems.')
  await put('flows/comma.yaml', 'name: Comma\nview: shop\nsteps:\n  - { from: web, to: db, text: Saves it, then waits }\n')
  await put('flows/old.yml', 'name: Old\nview: root\nsteps: []\n')
  assert.deepEqual((await call('get_problems')).text.split('\n'), [
    'flows/comma.yaml: step 1: "then waits" has no value (a comma ends unquoted text: put text that has a comma in double quotes)',
    'flows/old.yml: Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to flows/old.yaml.',
  ])
})

test('get_model gives a summary, or one object, flow or analysis in full, and refuses two at once', async t => {
  const { call } = await setup(t)
  const full = (await call('get_model')).text
  const summary = await call('get_model', { summary: true })
  assert.ok(summary.text.length < full.length)
  assert.deepEqual(JSON.parse(summary.text), {
    objects: [
      { id: 'shop', type: 'system', name: 'Shop' },
      { id: 'web', type: 'app', name: 'Web app', in: 'shop', tech: 'React' },
      { id: 'db', type: 'store', name: 'Orders DB', in: 'shop' },
      { id: 'stripe', type: 'system', name: 'Stripe', external: true },
    ],
    connections: ['web → db: reads orders', 'web → stripe: holds the card'],
    flows: [{ id: 'checkout', name: 'Checkout', view: 'shop', steps: 1 }],
    failures: [{ id: 'ordering', name: 'Ordering', modes: 1 }],
    icons: [],
    runs: [{ id: 'dinner-rush', name: 'Dinner rush' }],
    problems: [],
  })
  const db = JSON.parse((await call('get_model', { object: 'db' })).text)
  assert.equal(db.object.name, 'Orders DB')
  assert.deepEqual(db.connections, [{ from: 'web', to: 'db', label: 'reads orders' }])
  assert.deepEqual(db.flows, ['checkout'])
  assert.deepEqual(db.failureModes, ['ordering/db-down'])
  assert.equal(JSON.parse((await call('get_model', { flow: 'checkout' })).text).flow.steps[0].text, 'Saves the order')
  assert.equal(JSON.parse((await call('get_model', { analysis: 'ordering' })).text).analysis.modes['db-down'].severity, '9')
  for (const args of [{ object: 'nope' }, { flow: 'nope' }, { analysis: 'nope' }]) {
    const r = await call('get_model', args)
    assert.equal(r.error, true)
    assert.match(r.text, /^unknown (object|flow|analysis) "nope"$/)
  }
  const two = await call('get_model', { object: 'db', flow: 'checkout' })
  assert.equal(two.error, true)
  assert.match(two.text, /at most one/)
})

test('a filtered get_model carries the problems of that thing only', async t => {
  const { call, put } = await setup(t)
  await put('flows/ghost.yaml', 'name: Ghost\nview: shop\nsteps:\n  - { from: web, to: nope, text: Calls }\n')
  assert.deepEqual(JSON.parse((await call('get_model', { flow: 'ghost' })).text).problems.map((p: { message: string }) => p.message), ['step 1: unknown object "nope"'])
  assert.deepEqual(JSON.parse((await call('get_model', { flow: 'checkout' })).text).problems, [])
  assert.equal(JSON.parse((await call('get_model', { summary: true })).text).problems.length, 1)
})
