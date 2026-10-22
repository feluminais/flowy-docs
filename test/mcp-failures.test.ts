import { test } from 'node:test'
import { RULES } from '../src/node/rules.ts'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/node/mcp.ts'

const SHOP = 'objects:\n  shop: { type: system, name: Shop }\n  web: { type: app, in: shop, name: Web app }\n  db: { type: store, in: shop, name: Orders DB }\nconnections:\n  - { from: web, to: db, label: reads }\n'
const MODES = {
  'db-down': { mode: 'The database is unreachable', on: 'db', effect: "Orders can't be saved.", severity: 10, occurrence: 2, detection: 2 },
  'web-slow': { mode: 'The page is slow', on: 'web', severity: 4, occurrence: 5, detection: 3 },
}

async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-mcp-failures-'))
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
  await put('model.yaml', SHOP)
  return { dir, call, put, client }
}

const exists = (path: string) => access(path).then(() => true, () => false)

test('put_failures then get_failures round-trips and ranks', async t => {
  const { dir, call } = await setup(t)
  const saved = await call('put_failures', { id: 'ordering', name: 'Ordering', scope: 'shop', modes: MODES })
  assert.deepEqual(saved, { error: false, text: 'Saved failure analysis ordering: 2 modes, 1 High, 1 Medium, 0 Low, 0 Not rated.' })
  assert.match(await readFile(join(dir, 'failures', 'ordering.yaml'), 'utf8'), /severity: 10/)
  const got = await call('get_failures')
  assert.equal(got.error, false)
  assert.ok(got.text.startsWith('## Ordering (ordering)\n\nAnalysed 2 of 2\n\n| Risk band | Part |'), got.text)
  assert.ok(got.text.indexOf('The database is unreachable') < got.text.indexOf('The page is slow'))
})

test('get_failures with format csv gives csv, with one analysis by name, and refuses an unknown one', async t => {
  const { call } = await setup(t)
  await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  await call('put_failures', { id: 'other', name: 'Other', modes: {} })
  const csv = await call('get_failures', { analysis: 'ordering', format: 'csv' })
  assert.ok(csv.text.startsWith('Risk band,Part,Mode,Effect,Cause,Severity,Likelihood,Hard to spot,Risk,'), csv.text)
  assert.doesNotMatch(csv.text, /## /)
  assert.deepEqual(await call('get_failures', { analysis: 'nope' }), { error: true, text: 'unknown analysis "nope"' })
  const all = await call('get_failures')
  assert.match(all.text, /## Ordering \(ordering\)[^]*## Other \(other\)/)
})

test('get_failures says so when there is nothing yet', async t => {
  const { call } = await setup(t)
  assert.deepEqual(await call('get_failures'), { error: false, text: 'No failure analyses yet. Add one with put_failures.' })
})

test('put_failure replaces one mode and answers with its risk and band', async t => {
  const { call } = await setup(t)
  await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  assert.deepEqual(await call('put_failure', { analysis: 'ordering', id: 'web-slow', mode: 'The page is very slow', on: 'web', severity: 6, occurrence: 5, detection: 5 }),
    { error: false, text: 'Saved web-slow in ordering: Risk 150, High.' })
  assert.deepEqual(await call('put_failure', { analysis: 'ordering', id: 'sev', mode: 'Everything stops', on: 'db', severity: 10 }), { error: false, text: 'Saved sev in ordering: High.' })
  assert.deepEqual(await call('put_failure', { analysis: 'ordering', id: 'half', mode: 'Maybe slow', on: 'web', severity: 5 }), { error: false, text: 'Saved half in ordering: Not rated.' })
  const got = (await call('get_failures', { format: 'csv' })).text
  assert.match(got, /The page is very slow/)
  assert.doesNotMatch(got, /The page is slow/)
  assert.match(got, /The database is unreachable/)
})

test('put_failure with an unknown part, an unknown analysis or a bad flow link is refused and nothing is saved', async t => {
  const { dir, call } = await setup(t)
  await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  const before = await readFile(join(dir, 'failures', 'ordering.yaml'), 'utf8')
  const bad = await call('put_failure', { analysis: 'ordering', id: 'x', mode: 'x', on: 'gone' })
  assert.equal(bad.error, true)
  assert.match(bad.text, /Refused, nothing saved\. This would add:\n- failures\/ordering\.yaml: x: unknown object "gone"/)
  assert.match((await call('put_failure', { analysis: 'ordering', id: 'x', mode: 'x', on: 'web', flow: 'nope' })).text, /x: flow "nope" doesn't exist/)
  assert.deepEqual(await call('put_failure', { analysis: 'nope', id: 'x', mode: 'x', on: 'web' }), { error: true, text: 'unknown analysis "nope"' })
  assert.equal(await readFile(join(dir, 'failures', 'ordering.yaml'), 'utf8'), before)
})

test('delete_failure removes a mode and delete_failures removes the file', async t => {
  const { dir, call } = await setup(t)
  await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  assert.equal((await call('delete_failure', { analysis: 'ordering', id: 'web-slow' })).error, false)
  assert.doesNotMatch(await readFile(join(dir, 'failures', 'ordering.yaml'), 'utf8'), /web-slow/)
  assert.deepEqual(await call('delete_failure', { analysis: 'ordering', id: 'web-slow' }), { error: true, text: 'unknown failure mode "web-slow" in "ordering"' })
  assert.equal((await call('delete_failures', { id: 'ordering' })).error, false)
  assert.equal(await exists(join(dir, 'failures', 'ordering.yaml')), false)
})

test('a shape or connection a mode names cannot be deleted, and the answer says why', async t => {
  const { call } = await setup(t)
  await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  assert.deepEqual(await call('delete_object', { id: 'db' }), { error: true, text: '"db" is used by failure analysis ordering. Change or delete those first.' })
})

test('a file in the way, with the name of a new analysis in other letters, is never written over', async t => {
  const { dir, call, put } = await setup(t)
  await put('failures/Ordering.yaml', 'name: Mine\n')
  const reply = await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  assert.deepEqual(reply, { error: true, text: "Refused, nothing saved. failures/Ordering.yaml is in the way (the same file name in other letters), so failures/ordering.yaml isn't written. Rename or delete it by hand." })
  assert.equal(await readFile(join(dir, 'failures', 'Ordering.yaml'), 'utf8'), 'name: Mine\n')
})

test('a failures file that cannot be read is a problem in get_failures, other tools still work, and writing to it is refused with the file untouched', async t => {
  const { dir, call, put } = await setup(t)
  await put('failures/bad.yaml', 'name: [unclosed\n')
  assert.match((await call('get_failures')).text, /^Problems:\n- failures\/bad\.yaml: line \d+: /)
  assert.equal((await call('put_object', { id: 'cache', type: 'store', name: 'Cache', in: 'shop' })).error, false)
  const refused = await call('put_failures', { id: 'bad', name: 'Fixed', modes: {} })
  assert.deepEqual(refused, { error: true, text: "Refused, nothing saved. failures/bad.yaml can't be read, so it isn't replaced. Fix or delete it by hand." })
  assert.equal((await call('delete_failures', { id: 'bad' })).error, true)
  assert.equal(await readFile(join(dir, 'failures', 'bad.yaml'), 'utf8'), 'name: [unclosed\n')
})

test('get_failures lists the problems of the analyses it shows', async t => {
  const { call, put } = await setup(t)
  await put('failures/ordering.yaml', 'name: Ordering\nmodes:\n  bad:\n    mode: x\n    on: gone\n')
  const got = await call('get_failures')
  assert.match(got.text, /Problems:\n- failures\/ordering\.yaml: bad: unknown object "gone"$/)
})

test('get_model includes the failures, and a rating the schema does not allow is refused', async t => {
  const { call } = await setup(t)
  await call('put_failures', { id: 'ordering', name: 'Ordering', modes: MODES })
  const model = JSON.parse((await call('get_model')).text) as { failures: { ordering: { name: string } } }
  assert.equal(model.failures.ordering.name, 'Ordering')
  for (const severity of [11, 5.5, 0]) {
    assert.equal((await call('put_failure', { analysis: 'ordering', id: 'x', mode: 'x', on: 'web', severity })).error, true, String(severity))
  }
  assert.equal((await call('put_failures', { id: 'ordering', name: 'O', modes: { x: { mode: 'x', on: 'web', status: 'finished' } } })).error, true)
})

test('the instructions tell how to write failure modes', async t => {
  const { client } = await setup(t)
  assert.match(((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' ')), /Writing failure modes/)
})

test('a replace is read from get_model, which holds every field of a mode, not from get_failures, which is only the table', async t => {
  const { client } = await setup(t)
  assert.match(((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' ')), /put_failure replaces the whole mode: read it with get_model first/)
  const tools = (await client.listTools()).tools
  assert.match(tools.find(tool => tool.name === 'put_failure')?.description ?? '', /get_model/)
  assert.doesNotMatch(((client.getInstructions() ?? '') + Object.values(RULES).map(r => r.text).join(' ')), /read get_failures first/)
})
