import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashText } from '../src/node/files.ts'
import { applyWrite } from '../src/node/writes.ts'

/** A flowy/ folder that doesn't exist yet. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-writes-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { dir: join(root, 'flowy') }
}

const shop = { objects: { shop: { type: 'system', name: 'Shop' } }, connections: [] }
const exists = (path: string) => access(path).then(() => true, () => false)

test('a write answers 200 with the new version, and a stale one gets 409 with the current version', async t => {
  const { dir } = await setup(t)
  const created = await applyWrite(dir, 'PUT', 'model.yaml', { version: null, data: shop })
  assert.equal(created.status, 200)
  const text = await readFile(join(dir, 'model.yaml'), 'utf8')
  assert.deepEqual(created.body, { version: hashText(text) })

  const stale = await applyWrite(dir, 'PUT', 'model.yaml', { version: null, data: { objects: {} } })
  assert.deepEqual(stale, { status: 409, body: { version: hashText(text) } })
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), text)
})

test('a flow is deleted when the version matches, and only a flow can be', async t => {
  const { dir } = await setup(t)
  const flow = { name: 'Tour', view: 'root', steps: [] }
  const made = await applyWrite(dir, 'PUT', 'flows/tour.yaml', { version: null, data: flow })
  assert.equal(made.status, 200)
  assert.deepEqual(await applyWrite(dir, 'DELETE', 'model.yaml', { version: null }), { status: 400, body: { error: `can't write "model.yaml"` } })
  const { version } = made.body as { version: string }
  assert.deepEqual(await applyWrite(dir, 'DELETE', 'flows/tour.yaml', { version }), { status: 200, body: { version: null } })
  assert.equal(await exists(join(dir, 'flows', 'tour.yaml')), false)
})

test('a path that is not a model file, and a body that is not a write, are refused 400 and nothing is written', async t => {
  const { dir } = await setup(t)
  for (const rel of ['../x.yaml', 'flows/Bad Name.yaml', 'flows/x.yml', 'notes.yaml'])
    assert.deepEqual(await applyWrite(dir, 'PUT', rel, { version: null, data: {} }), { status: 400, body: { error: `can't write "${rel}"` } }, rel)
  for (const body of [undefined, null, {}, { version: 3 }, { version: undefined, data: shop }])
    assert.equal((await applyWrite(dir, 'PUT', 'model.yaml', body)).status, 400, JSON.stringify(body))
  assert.deepEqual(await applyWrite(dir, 'PUT', 'model.yaml', { version: null }), { status: 400, body: { error: 'the body needs "data"' } })
  assert.equal(await exists(join(dir, 'model.yaml')), false)
})

test('data that would not read back is refused, and a folder with a file that cannot be read takes no writes', async t => {
  const { dir } = await setup(t)
  const refused = await applyWrite(dir, 'PUT', 'model.yaml', { version: null, data: { objects: 'nope' } })
  assert.equal(refused.status, 400)
  assert.match((refused.body as { error: string }).error, /^not a valid model\.yaml: /)
  await mkdir(join(dir, 'flows'), { recursive: true })
  await writeFile(join(dir, 'flows', 'bad.yaml'), 'name: [broken\n')
  const blocked = await applyWrite(dir, 'PUT', 'model.yaml', { version: null, data: shop })
  assert.equal(blocked.status, 409)
  assert.match((blocked.body as { error: string }).error, /^flows\/bad\.yaml/)
  assert.equal(await exists(join(dir, 'model.yaml')), false)
})

test('beforeWrite runs once the write is certain to be tried, and sees the files as they were', async t => {
  const { dir } = await setup(t)
  const seen: boolean[] = []
  const before = async () => { seen.push(await exists(join(dir, 'model.yaml'))) }
  await applyWrite(dir, 'PUT', 'notes.yaml', { version: null, data: {} }, before) // refused: no step to record
  assert.deepEqual(seen, [])
  await applyWrite(dir, 'PUT', 'model.yaml', { version: null, data: shop }, before)
  assert.deepEqual(seen, [false])
})
