import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { check } from '../src/core/check.ts'
import { folderOf, isValidFolder, isValidTag, ParseError, tagsOf } from '../src/core/model.ts'
import { changedFiles, modelFiles, parseFile, parseFlowFile, serializeFile } from '../src/core/modelfiles.ts'
import { deleteFlow, moveFlow, OpError, putFlow, setFlowTags } from '../src/core/ops.ts'
import { createMcpServer } from '../src/node/mcp.ts'
import { loadDir, loadReport, loadState, saveFile } from '../src/node/files.ts'
import { writtenPath } from '../src/node/server.ts'
import { shop } from './fixtures.ts'

const steps = [{ from: 'customer', to: 'web', text: 'x' }]

test('a folder is names joined by slashes, and a name may not hide, end in a dot, or hold what a file name cannot', () => {
  for (const ok of ['', 'payments', 'payments/refunds', 'Pay & refund', 'a b', 'v1.2', 'é']) assert.equal(isValidFolder(ok), true, ok)
  for (const bad of ['/a', 'a/', 'a//b', '.hidden', 'a/.b', 'a.', 'a ', ' a', 'a:b', 'a*', 'a?b', 'a"b', 'a<b', 'a|b', 'a#b', 'a%b', 'a\\b', 'nul', 'COM1', 'a/b/c/d/e/f/g', 'x'.repeat(65), 'a\u0001b'])
    assert.equal(isValidFolder(bad), false, JSON.stringify(bad))
})

test('a tag is short text with no space at either end, and a flow lists each once whatever its case', () => {
  assert.equal(isValidTag('happy path'), true)
  for (const bad of ['', ' a', 'a ', 'x'.repeat(33), 'a\nb', 3, null]) assert.equal(isValidTag(bad), false, JSON.stringify(bad))
  assert.deepEqual(tagsOf({ tags: ['happy path', 'Happy Path', ' bad', 'recovery', 'x'.repeat(40), 7] }), ['happy path', 'recovery'])
  assert.deepEqual(tagsOf({ tags: 'happy path' }), [])
  assert.deepEqual(tagsOf({}), [])
})

test('a flow file reads its tags, and refuses tags that are not a list of words', () => {
  assert.deepEqual(parseFlowFile('a', 'name: A\nview: shop\ntags: [happy path, recovery]\nsteps: []\n').tags, ['happy path', 'recovery'])
  assert.equal(parseFlowFile('a', 'name: A\nview: shop\ntags:\nsteps: []\n').tags, '') // a blank key is left as it is, and check() reports what is wrong
  assert.throws(() => parseFlowFile('a', 'name: A\ntags: happy\nsteps: []\n'), (e: unknown) => e instanceof ParseError && e.reason === '"tags" must be a list of words' && e.file === 'flows/a.yaml')
  assert.throws(() => parseFlowFile('a', 'name: A\ntags: [[x]]\nsteps: []\n', 'pay/stripe'), (e: unknown) => e instanceof ParseError && e.file === 'flows/pay/stripe/a.yaml')
})

test('parseFile and serializeFile take a flow in a folder, named by the file alone', () => {
  const flow = parseFile('flows/pay/stripe/refund.yaml', 'name: Refund\nview: shop\nsteps: []\n')
  assert.equal((flow as { name: string }).name, 'Refund')
  assert.throws(() => parseFile('flows/pay/refund.yaml', 'name: Refund\ntags: no\nsteps: []\n'), (e: unknown) => e instanceof ParseError && e.file === 'flows/pay/refund.yaml')
  assert.equal(serializeFile('flows/pay/refund.yaml', { name: 'Refund', view: 'shop', tags: ['a'], steps: [] }), 'name: Refund\nview: shop\ntags:\n  - a\nsteps: []\n')
})

test('check reports a tag that is not text, a tag listed twice, and a folder that can not be used, at the flow file in its folder', () => {
  const m = putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps, folder: 'billing' })
  m.flows.pay = { ...m.flows.pay, tags: ['ok', 'OK', ' bad', 'x'.repeat(40)] }
  m.folders = { pay: 'a:b' }
  const found = check(m).filter(p => p.file.startsWith('flows/')).map(p => `${p.file}: ${p.message}`)
  assert.deepEqual(found, [
    'flows/a:b/pay.yaml: the folder "a:b" can\'t be used: use names with no \\ / : * ? " < > | # % and no control characters, not starting with a dot or a space, not ending in a dot or a space, 64 characters at most, and nest no deeper than 6 folders',
    'flows/a:b/pay.yaml: tag "OK" is listed twice',
    'flows/a:b/pay.yaml: tag " bad" must be 1 to 32 characters of text, with no space at either end',
    `flows/a:b/pay.yaml: tag "${'x'.repeat(40)}" must be 1 to 32 characters of text, with no space at either end`,
  ])
})

test('putFlow puts a flow in a folder, writes its tags after the view, and a replace keeps both unless it says otherwise', () => {
  const m = putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps, folder: ' billing \\ refunds ', tags: ['happy path', ' recovery ', 'Happy Path', ''] })
  assert.equal(folderOf(m, 'pay'), 'billing/refunds')
  assert.deepEqual(Object.keys(m.flows.pay), ['name', 'view', 'tags', 'steps'])
  assert.deepEqual(m.flows.pay.tags, ['happy path', 'recovery'])
  const again = putFlow(m, { id: 'pay', name: 'Pay 2', view: 'shop', steps })
  assert.equal(folderOf(again, 'pay'), 'billing/refunds')
  assert.deepEqual(again.flows.pay.tags, ['happy path', 'recovery'])
  const moved = putFlow(again, { id: 'pay', name: 'Pay 2', view: 'shop', steps, folder: '', tags: [] })
  assert.equal(moved.folders, undefined) // the map is left out when no flow is in a folder
  assert.equal('tags' in moved.flows.pay, false)
  assert.throws(() => putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps, folder: 'a:b' }), OpError)
  assert.throws(() => putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps, tags: ['x'.repeat(33)] }), /1 to 32 characters/)
})

test('a folder is spelled as one that differs only in case already is, name by name', () => {
  let m = putFlow(shop(), { id: 'a', name: 'A', view: 'shop', steps, folder: 'Billing/Refunds' })
  m = putFlow(m, { id: 'b', name: 'B', view: 'shop', steps, folder: 'billing/refunds/stripe' })
  m = putFlow(m, { id: 'c', name: 'C', view: 'shop', steps, folder: 'BILLING' })
  assert.deepEqual(m.folders, { a: 'Billing/Refunds', b: 'Billing/Refunds/stripe', c: 'Billing' })
})

test('moveFlow changes only where the file is, and refuses an unknown flow or a folder it can not use', () => {
  const before = putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps })
  const m = moveFlow(before, 'pay', 'billing')
  assert.equal(m.flows, before.flows)
  assert.deepEqual(m.folders, { pay: 'billing' })
  assert.equal(moveFlow(m, 'pay', '').folders, undefined)
  assert.throws(() => moveFlow(m, 'nope', 'x'), /unknown flow "nope"/)
  assert.throws(() => moveFlow(m, 'pay', '../x'), /not a folder Flowy can use/)
})

test('setFlowTags sets exactly these tags, keeps every other key where it is, and none takes them out', () => {
  const before = putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps })
  const m = setFlowTags(before, 'pay', ['error path', 'Error Path', 'recovery'])
  assert.deepEqual(m.flows.pay.tags, ['error path', 'recovery'])
  assert.deepEqual(Object.keys(m.flows.pay), ['name', 'view', 'tags', 'steps'])
  const changed = setFlowTags(m, 'pay', ['edge case'])
  assert.deepEqual(changed.flows.pay.tags, ['edge case'])
  assert.equal('tags' in setFlowTags(m, 'pay', []).flows.pay, false)
  assert.throws(() => setFlowTags(m, 'nope', []), /unknown flow/)
})

test('deleteFlow forgets the folder of the flow', () => {
  const m = putFlow(putFlow(shop(), { id: 'a', name: 'A', view: 'shop', steps, folder: 'x' }), { id: 'b', name: 'B', view: 'shop', steps, folder: 'y' })
  assert.deepEqual(deleteFlow(m, 'a').folders, { b: 'y' })
  assert.equal(deleteFlow(deleteFlow(m, 'a'), 'b').folders, undefined)
})

test('the files of a model put a flow in its folder, and moving a flow deletes the old file and writes the new one', () => {
  const before = putFlow(shop(), { id: 'pay', name: 'Pay', view: 'shop', steps })
  const after = moveFlow(before, 'pay', 'billing/refunds')
  assert.ok('flows/pay.yaml' in modelFiles(before))
  assert.ok('flows/billing/refunds/pay.yaml' in modelFiles(after))
  const changes = changedFiles(before, after)
  assert.deepEqual(changes.map(([path, text]) => [path, text === null]), [['flows/pay.yaml', true], ['flows/billing/refunds/pay.yaml', false]])
})

test('writtenPath decodes each part, and refuses a slash or a bad escape inside one', () => {
  assert.equal(writtenPath('flows/Pay%20%26%20refund/a.yaml'), 'flows/Pay & refund/a.yaml')
  assert.equal(writtenPath('flows/a.yaml'), 'flows/a.yaml')
  assert.equal(writtenPath('flows%2Fa.yaml'), '')
  assert.equal(writtenPath('flows/a%5Cb/c.yaml'), '')
  assert.equal(writtenPath('flows/%E0%A4%A/c.yaml'), '')
})

async function folder(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-folders-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const put = async (rel: string, text: string) => {
    await mkdir(join(dir, rel, '..'), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  await put('model.yaml', 'objects:\n  shop: { type: system, name: Shop }\n  web: { type: app, in: shop, name: Web app }\n  db: { type: store, in: shop, name: Orders DB }\nconnections:\n  - { from: web, to: db, label: reads }\n')
  return { dir, put }
}
const flowText = (name: string, extra = '') => `name: ${name}\nview: shop\n${extra}steps:\n  - { from: web, to: db, text: Saves }\n`

test('loadDir reads flows through the folders of flows/, by file name, and remembers where each is', async t => {
  const { dir, put } = await folder(t)
  await put('flows/top.yaml', flowText('Top'))
  await put('flows/billing/pay.yaml', flowText('Pay', 'tags: [happy path]\n'))
  await put('flows/billing/refunds/refund.yaml', flowText('Refund'))
  await put('flows/billing/notes.txt', 'not a flow')
  await put('flows/.drafts/hidden.yaml', flowText('Hidden'))
  const { model, versions, unusable } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.flows), ['pay', 'refund', 'top'])
  assert.deepEqual(model.folders, { pay: 'billing', refund: 'billing/refunds' })
  assert.deepEqual(Object.keys(versions).filter(k => k.startsWith('flows/')), ['flows/billing/pay.yaml', 'flows/billing/refunds/refund.yaml', 'flows/top.yaml'])
  assert.deepEqual(unusable, [])
  const state = await loadState(dir)
  assert.ok('folders' in state)
  assert.deepEqual((state as { folders: object }).folders, { pay: 'billing', refund: 'billing/refunds' })
})

test('a state has no folders when every flow is at the top', async t => {
  const { dir, put } = await folder(t)
  await put('flows/top.yaml', flowText('Top'))
  const state = await loadState(dir)
  assert.equal('folders' in state, false)
})

test('a second flow file with a name that is taken is left out and reported, and the first in path order is kept', async t => {
  const { dir, put } = await folder(t)
  await put('flows/a/pay.yaml', flowText('Pay in a'))
  await put('flows/b/pay.yaml', flowText('Pay in b'))
  await put('flows/pay.yaml', flowText('Pay at the top'))
  const { model, unusable } = await loadDir(dir)
  assert.equal(model.flows.pay.name, 'Pay in a')
  assert.deepEqual(unusable.map(p => p.file), ['flows/b/pay.yaml', 'flows/pay.yaml'])
  assert.match(unusable[0].message, /one flow for each name, and flows\/a\/pay\.yaml already has "pay"/)
  const report = await loadReport(dir)
  assert.equal(report.problems.filter(p => p.message.includes('one flow for each name')).length, 2)
})

test('a folder whose name can not be used is skipped with a problem, and so is everything in it', async t => {
  const { dir, put } = await folder(t)
  await put('flows/a#b/pay.yaml', flowText('Pay'))
  await put('flows/fine/ok.yaml', flowText('Ok'))
  const { model, unusable } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.flows), ['ok'])
  assert.deepEqual(unusable.map(p => p.file), ['flows/a#b'])
  assert.match(unusable[0].message, /^Flowy skips this folder, since its name can't be used: /)
})

test('a flow in a folder reports its problems at its own path, and an error in it names that path', async t => {
  const { dir, put } = await folder(t)
  await put('flows/billing/pay.yaml', 'name: Pay\nview: nowhere\nsteps:\n  - { from: web, to: db, text: Saves }\n')
  const report = await loadReport(dir)
  assert.deepEqual(report.problems.map(p => p.file), ['flows/billing/pay.yaml'])
  await put('flows/billing/bad.yaml', 'name: Bad\ntags: oops\nsteps: []\n')
  await assert.rejects(loadDir(dir), (e: unknown) => e instanceof ParseError && e.file === 'flows/billing/bad.yaml')
})

test('saveFile makes the folders of a flow, a move is a write and a delete, and the empty folder it leaves is no flow', async t => {
  const { dir, put } = await folder(t)
  await put('flows/pay.yaml', flowText('Pay'))
  const loaded = await loadDir(dir)
  const text = await readFile(join(dir, 'flows/pay.yaml'), 'utf8')
  await saveFile(dir, 'flows/Pay & refund/deep/pay.yaml', text, null)
  await saveFile(dir, 'flows/pay.yaml', null, loaded.versions['flows/pay.yaml'])
  const { model } = await loadDir(dir)
  assert.deepEqual(model.folders, { pay: 'Pay & refund/deep' })
  assert.deepEqual(await readdir(join(dir, 'flows')), ['Pay & refund'])
})

const MODEL = 'objects:\n  shop: { type: system, name: Shop }\n  web: { type: app, in: shop, name: Web app }\n  db: { type: store, in: shop, name: Orders DB }\nconnections:\n  - { from: web, to: db, label: reads }\n'

async function mcp(t: TestContext) {
  const { dir, put } = await folder(t)
  await put('model.yaml', MODEL)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  await createMcpServer(dir).connect(serverSide)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientSide)
  t.after(() => client.close())
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const [first] = result.content as { text: string }[]
    return { error: result.isError === true, text: first.text }
  }
  return { dir, put, call }
}

test('put_flow takes a folder and tags, get_model shows them and move_flow and tag_flow change them', async t => {
  const { dir, call } = await mcp(t)
  const body = { id: 'pay', name: 'Pay', view: 'shop', steps: [{ from: 'web', to: 'db', text: 'Saves' }] }
  assert.equal((await call('put_flow', { ...body, folder: 'billing/refunds', tags: ['happy path'] })).error, false)
  assert.equal(await readFile(join(dir, 'flows/billing/refunds/pay.yaml'), 'utf8').then(s => s.includes('tags:\n  - happy path\n')), true)
  const summary = JSON.parse((await call('get_model', { summary: true })).text) as { flows: unknown[] }
  assert.deepEqual(summary.flows, [{ id: 'pay', name: 'Pay', view: 'shop', steps: 1, folder: 'billing/refunds', tags: ['happy path'] }])
  const one = JSON.parse((await call('get_model', { flow: 'pay' })).text) as { flow: { folder: string; tags: string[] } }
  assert.equal(one.flow.folder, 'billing/refunds')
  const full = JSON.parse((await call('get_model')).text) as { flows: { pay: { folder: string } } }
  assert.equal(full.flows.pay.folder, 'billing/refunds')

  assert.deepEqual(await call('move_flow', { id: 'pay', folder: 'misc' }), { error: false, text: 'Moved flow pay into misc.' })
  assert.deepEqual(await readdir(join(dir, 'flows/misc')), ['pay.yaml'])
  await assert.rejects(readFile(join(dir, 'flows/billing/refunds/pay.yaml')))
  assert.deepEqual(await call('tag_flow', { id: 'pay', tags: ['error path', 'recovery'] }), { error: false, text: 'Tagged flow pay: error path, recovery.' })
  assert.match(await readFile(join(dir, 'flows/misc/pay.yaml'), 'utf8'), /tags:\n {2}- error path\n {2}- recovery\n/)
  assert.deepEqual(await call('move_flow', { id: 'pay', folder: '' }), { error: false, text: 'Moved flow pay to the top of flows/.' })
  assert.equal((await readFile(join(dir, 'flows/pay.yaml'), 'utf8')).includes('name: Pay'), true)
  assert.equal((await call('put_flow', { ...body, name: 'Pay again' })).error, false) // a replace keeps the tags
  assert.match(await readFile(join(dir, 'flows/pay.yaml'), 'utf8'), /tags:/)
  assert.deepEqual(await call('tag_flow', { id: 'pay', tags: [] }), { error: false, text: 'Took the tags off flow pay.' })
  assert.deepEqual(await call('move_flow', { id: 'nope', folder: 'x' }), { error: true, text: 'unknown flow "nope"' })
  assert.equal((await call('move_flow', { id: 'pay', folder: 'a:b' })).error, true)
})
