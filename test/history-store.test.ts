import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Step } from '../src/core/history.ts'
import { defaultStateDir, historyKey, openStore } from '../src/node/history-store.ts'

const H1 = '1111111111111111'
const H2 = '2222222222222222'
const H3 = '3333333333333333'
const bytes = (text: string) => new TextEncoder().encode(text)
const step = (id: string, files: Record<string, string>): Step =>
  ({ id, time: '2026-10-20T10:00:00.000Z', label: `label ${id}`, source: 'you', app: 'browser', files })

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, store: openStore(join(root, 'trail')) }
}

test('defaultStateDir: FLOWY_STATE_DIR wins over everything', () => {
  assert.equal(defaultStateDir({ FLOWY_STATE_DIR: '/state', APPDATA: 'C:\\x' }, 'win32', '/h'), '/state')
})

test('defaultStateDir: the application data folder on Windows', () => {
  assert.equal(defaultStateDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a'), 'C:\\Users\\a\\AppData\\Roaming\\Flowy Docs')
})

test('defaultStateDir: XDG_CONFIG_HOME, else ~/.config, elsewhere', () => {
  assert.equal(defaultStateDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/h'), '/x/Flowy Docs')
  assert.equal(defaultStateDir({}, 'linux', '/h'), '/h/.config/Flowy Docs')
  assert.equal(defaultStateDir({ FLOWY_STATE_DIR: '' }, 'darwin', '/Users/a'), '/Users/a/.config/Flowy Docs')
})

test('historyKey is 16 hex digits and ignores one trailing separator', () => {
  assert.match(historyKey('/home/a/shop/flowy', 'linux'), /^[0-9a-f]{16}$/)
  assert.equal(historyKey('/home/a/shop/flowy/', 'linux'), historyKey('/home/a/shop/flowy', 'linux'))
  assert.equal(historyKey('C:\\p\\flowy\\', 'win32'), historyKey('C:\\p\\flowy', 'win32'))
})

test('historyKey folds ASCII case on Windows and macOS only', () => {
  assert.equal(historyKey('m:\\p\\flowy', 'win32'), historyKey('M:\\P\\FLOWY', 'win32'))
  assert.equal(historyKey('/Users/a/Flowy', 'darwin'), historyKey('/USERS/A/flowy', 'darwin'))
  assert.notEqual(historyKey('/p/Flowy', 'linux'), historyKey('/p/flowy', 'linux'))
})

test('historyKey leaves other letters as they are', () => {
  assert.notEqual(historyKey('/p/é a/flowy', 'win32'), historyKey('/p/É a/flowy', 'win32'))
  assert.match(historyKey('/p/é a/flowy', 'win32'), /^[0-9a-f]{16}$/)
})

test('a step round-trips with its blobs', async t => {
  const { store } = await setup(t)
  const first = step('20261020T100000000Z-aaaaaa', { 'model.yaml': H1 })
  await store.putStep(first, new Map([[H1, bytes('objects: {}\n')]]))
  assert.deepEqual(await store.steps(), [first])
  assert.deepEqual(await store.blob(H1), bytes('objects: {}\n'))
})

test('steps come back oldest first, and a blob two steps share is stored once', async t => {
  const { root, store } = await setup(t)
  await store.putStep(step('20261020T100002000Z-bbbbbb', { 'model.yaml': H1 }), new Map([[H1, bytes('x')]]))
  await store.putStep(step('20261020T100001000Z-aaaaaa', { 'model.yaml': H1, 'layout.yaml': H2 }), new Map([[H1, bytes('x')], [H2, bytes('y')]]))
  assert.deepEqual((await store.steps()).map(s => s.id), ['20261020T100001000Z-aaaaaa', '20261020T100002000Z-bbbbbb'])
  assert.deepEqual((await readdir(join(root, 'trail', 'blobs'))).sort(), [H1, H2])
})

test('a store that was never written to has no steps', async t => {
  const { store } = await setup(t)
  assert.deepEqual(await store.steps(), [])
  assert.equal(await store.blob(H1), undefined)
})

test('a truncated or misshapen step file is skipped', async t => {
  const { root, store } = await setup(t)
  await store.putStep(step('20261020T100000000Z-aaaaaa', { 'model.yaml': H1 }), new Map([[H1, bytes('x')]]))
  const dir = join(root, 'trail', 'steps')
  await writeFile(join(dir, '20261020T100001000Z-bbbbbb.json'), '{"time"')
  await writeFile(join(dir, '20261020T100002000Z-cccccc.json'), '{"time":"x","label":"y"}')
  await writeFile(join(dir, '20261020T100003000Z-dddddd.json'), JSON.stringify({ time: 't', label: 'l', source: 'you', app: 'browser', files: { 'model.yaml': 5 } }))
  assert.deepEqual((await store.steps()).map(s => s.id), ['20261020T100000000Z-aaaaaa'])
})

test('a temporary file is not a step', async t => {
  const { root, store } = await setup(t)
  await mkdir(join(root, 'trail', 'steps'), { recursive: true })
  const body = JSON.stringify({ time: 't', label: 'l', source: 'you', app: 'browser', files: {} })
  await writeFile(join(root, 'trail', 'steps', '20261020T100000000Z-aaaaaa.json.0f0f.tmp'), body)
  assert.deepEqual(await store.steps(), [])
})

test('a blob name that is not 16 hex digits is refused and never read', async t => {
  const { store } = await setup(t)
  await assert.rejects(store.putStep(step('20261020T100000000Z-aaaaaa', { 'model.yaml': '../x' }), new Map([['../x', bytes('x')]])))
  assert.equal(await store.blob('../x'), undefined)
})

test('prune drops steps and old unreferenced blobs but keeps a fresh unreferenced one', async t => {
  const { root, store } = await setup(t)
  const old = step('20261020T100000000Z-aaaaaa', { 'model.yaml': H1 })
  const kept = step('20261020T100001000Z-bbbbbb', { 'model.yaml': H2 })
  await store.putStep(old, new Map([[H1, bytes('1')]]))
  await store.putStep(kept, new Map([[H2, bytes('2')]]))
  await writeFile(join(root, 'trail', 'blobs', H3), '3')
  const anHourAgo = new Date(Date.now() - 3_600_000)
  await utimes(join(root, 'trail', 'blobs', H3), anHourAgo, anHourAgo)

  const plan = { dropSteps: [old.id], keepBlobs: new Set([H2]) }
  await store.prune(plan, 60_000)
  assert.deepEqual((await store.steps()).map(s => s.id), [kept.id])
  assert.deepEqual((await readdir(join(root, 'trail', 'blobs'))).sort(), [H1, H2]) // H1 is unreferenced but too fresh to delete; H3 was old

  await store.prune(plan, 0)
  assert.deepEqual(await readdir(join(root, 'trail', 'blobs')), [H2])
})

test('latest is the newest readable step, and count counts step files', async t => {
  const { root, store } = await setup(t)
  assert.equal(await store.latest(), undefined)
  assert.equal(await store.count(), 0)
  const first = step('20261020T100000000Z-aaaaaa', { 'model.yaml': H1 })
  await store.putStep(first, new Map([[H1, bytes('1')]]))
  await store.putStep(step('20261020T100001000Z-bbbbbb', { 'model.yaml': H2 }), new Map([[H2, bytes('2')]]))
  assert.equal((await store.latest())?.id, '20261020T100001000Z-bbbbbb')
  await writeFile(join(root, 'trail', 'steps', '20261020T100002000Z-cccccc.json'), '{"time"') // cut off: the newest file, but not a step
  assert.equal((await store.latest())?.id, '20261020T100001000Z-bbbbbb')
  assert.equal(await store.count(), 3)
})

test('prune does not throw when a blob cannot be deleted, and still deletes the others', async t => {
  const { root, store } = await setup(t)
  await store.putStep(step('20261020T100000000Z-aaaaaa', { 'model.yaml': H1 }), new Map([[H1, bytes('1')]]))
  const blobs = join(root, 'trail', 'blobs')
  await mkdir(join(blobs, H2)) // a directory where a blob should be: deleting it as a file fails
  await writeFile(join(blobs, H3), '3')
  const anHourAgo = new Date(Date.now() - 3_600_000)
  await utimes(join(blobs, H2), anHourAgo, anHourAgo)
  await utimes(join(blobs, H3), anHourAgo, anHourAgo)
  await store.prune({ dropSteps: [], keepBlobs: new Set([H1]) }, 60_000)
  assert.deepEqual((await readdir(blobs)).sort(), [H1, H2])
})

test('tail is the last readable steps, oldest first, reading only as many as it needs', async t => {
  const { root, store } = await setup(t)
  const ids = ['20261020T100000000Z-aaaaaa', '20261020T100001000Z-bbbbbb', '20261020T100002000Z-cccccc']
  for (const [i, id] of ids.entries()) await store.putStep(step(id, { 'model.yaml': [H1, H2, H3][i] }), new Map([[[H1, H2, H3][i], bytes('x')]]))
  await writeFile(join(root, 'trail', 'steps', '20261020T100003000Z-dddddd.json'), '{"time"') // cut off: skipped
  assert.deepEqual((await store.tail(2)).map(s => s.id), [ids[1], ids[2]])
  assert.deepEqual((await store.tail(9)).map(s => s.id), ids)
  assert.deepEqual(await store.tail(0), [])
})

test('clear removes everything', async t => {
  const { store } = await setup(t)
  await store.putStep(step('20261020T100000000Z-aaaaaa', { 'model.yaml': H1 }), new Map([[H1, bytes('1')]]))
  await store.clear()
  assert.deepEqual(await store.steps(), [])
  assert.equal(await store.blob(H1), undefined)
})
