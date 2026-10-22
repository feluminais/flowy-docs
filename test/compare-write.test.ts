import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { isAllowedPath, isRunPath } from '../src/core/filekinds.ts'
import { hashText } from '../src/node/files.ts'
import { applyWrite } from '../src/node/writes.ts'

const SHOP = 'objects:\n  shop: { type: system, name: Shop }\n'
const RUN = '# a run\nname: Dinner rush\nunit: orders/min\nlevels:\n  - { load: 10, overall: { rate: 1, p50: 10, p95: 20, errors: 0 } }\n  - { load: 20, overall: { rate: 2, p50: 11, p95: 22, errors: 0 } }\n'

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-compare-write-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  const put = async (rel: string, text: string) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  await put('model.yaml', SHOP)
  await put('perf/after.yaml', RUN)
  for (const other of ['before', 'a', 'b']) await put(`perf/${other}.yaml`, RUN) // the runs the tests tag it with
  return { dir, put, read: (rel: string) => readFile(join(dir, rel), 'utf8') }
}

test('isRunPath accepts perf/<id>.yaml with a valid id and nothing else; isAllowedPath still refuses it', () => {
  assert.equal(isRunPath('perf/after.yaml'), true)
  for (const rel of ['perf/After.yaml', 'perf/a.yml', 'perf/a/b.yaml', 'perf/.yaml', 'flows/a.yaml', 'model.yaml', 'perf/a.yaml.tmp']) assert.equal(isRunPath(rel), false, rel)
  assert.equal(isAllowedPath('perf/after.yaml'), false)
})

test('PUT perf/<id>.yaml with a tag changes only that line and answers with the new version', async t => {
  const { dir, read } = await setup(t)
  const reply = await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: hashText(RUN), data: { compare: 'before' } })
  const text = await read('perf/after.yaml')
  assert.equal(text, `${RUN}compare: before\n`)
  assert.deepEqual(reply, { status: 200, body: { version: hashText(text) } })
  const noted = await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: hashText(text), data: { compare: { with: 'before', note: 'After the cache' } } })
  assert.equal(await read('perf/after.yaml'), `${RUN}compare:\n  with: before\n  note: "After the cache"\n`)
  assert.equal(noted.status, 200)
})

test('PUT with compare null takes the tag out and gives back the original text', async t => {
  const { dir, read } = await setup(t)
  const first = await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: hashText(RUN), data: { compare: 'before' } })
  const version = (first.body as { version: string }).version
  const reply = await applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: null } })
  assert.equal(await read('perf/after.yaml'), RUN)
  assert.deepEqual(reply, { status: 200, body: { version: hashText(RUN) } })
})

test('a stale version gives 409 with the current version and changes nothing', async t => {
  const { dir, read } = await setup(t)
  const reply = await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: 'stale', data: { compare: 'before' } })
  assert.deepEqual(reply, { status: 409, body: { version: hashText(RUN) } })
  assert.equal(await read('perf/after.yaml'), RUN)
})

test('a run that is not there gives 409 and writes nothing', async t => {
  const { dir } = await setup(t)
  const reply = await applyWrite(dir, 'PUT', 'perf/missing.yaml', { version: null, data: { compare: 'before' } })
  assert.deepEqual(reply, { status: 409, body: { version: null } })
  await assert.rejects(readFile(join(dir, 'perf/missing.yaml')))
})

test('a body that is not a tag is refused with 400', async t => {
  const { dir, read } = await setup(t)
  const version = hashText(RUN)
  const bodies: unknown[] = [
    { version, data: { levels: [] } },
    { version, data: { compare: 'before', levels: [] } },
    { version, data: { compare: 3 } },
    { version, data: { compare: '' } },
    { version, data: { compare: { note: 'no partner' } } },
    { version, data: { compare: ['before'] } },
    { version, data: 'compare: before' },
    { version, data: null },
    { version },
    { data: { compare: 'before' } },
    undefined,
  ]
  for (const body of bodies) assert.equal((await applyWrite(dir, 'PUT', 'perf/after.yaml', body)).status, 400, JSON.stringify(body))
  assert.equal(await read('perf/after.yaml'), RUN)
})

test('a tag to a run that is not there, or to the run itself, is refused with 400 and nothing is written', async t => {
  const { dir, read } = await setup(t)
  const version = hashText(RUN)
  assert.deepEqual(await applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: 'nope' } }), { status: 400, body: { error: 'unknown run "nope"' } })
  assert.deepEqual(await applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: { with: 'nope', note: 'x' } } }), { status: 400, body: { error: 'unknown run "nope"' } })
  assert.deepEqual(await applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: 'after' } }), { status: 400, body: { error: 'run "after" cannot compare with itself' } })
  assert.equal(await read('perf/after.yaml'), RUN)
  assert.equal((await applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: null } })).status, 200, 'taking a tag out needs no target')
})

test('DELETE of a run and a run id with capitals are refused with 400', async t => {
  const { dir, put, read } = await setup(t)
  await put('perf/After.yaml', RUN)
  assert.equal((await applyWrite(dir, 'DELETE', 'perf/after.yaml', { version: hashText(RUN) })).status, 400)
  assert.equal((await applyWrite(dir, 'PUT', 'perf/After.yaml', { version: hashText(RUN), data: { compare: 'before' } })).status, 400)
  assert.equal(await read('perf/after.yaml'), RUN)
  assert.equal(await read('perf/After.yaml'), RUN)
})

test('a run that is not a mapping is not written over, and the model failing to parse blocks the write', async t => {
  const { dir, put, read } = await setup(t)
  await put('perf/list.yaml', '- a\n- b\n')
  const reply = await applyWrite(dir, 'PUT', 'perf/list.yaml', { version: hashText('- a\n- b\n'), data: { compare: 'before' } })
  assert.equal(reply.status, 400)
  assert.equal(await read('perf/list.yaml'), '- a\n- b\n')
  await put('model.yaml', 'objects: [oops')
  assert.equal((await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: hashText(RUN), data: { compare: 'before' } })).status, 409)
  assert.equal(await read('perf/after.yaml'), RUN)
})

test('beforeWrite runs once for a write that goes ahead and not for one that is refused', async t => {
  const { dir, put } = await setup(t)
  let calls = 0
  const before = async () => { calls += 1 }
  await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: hashText(RUN), data: { levels: [] } }, before)
  await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: 'stale', data: { compare: 'before' } }, before)
  await put('perf/list.yaml', '- a\n')
  await applyWrite(dir, 'PUT', 'perf/list.yaml', { version: hashText('- a\n'), data: { compare: 'before' } }, before)
  assert.equal(calls, 0)
  await applyWrite(dir, 'PUT', 'perf/after.yaml', { version: hashText(RUN), data: { compare: 'before' } }, before)
  assert.equal(calls, 1)
})

test('two writes racing on the same version: one wins, the other gets 409', async t => {
  const { dir } = await setup(t)
  const version = hashText(RUN)
  const replies = await Promise.all([
    applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: 'a' } }),
    applyWrite(dir, 'PUT', 'perf/after.yaml', { version, data: { compare: 'b' } }),
  ])
  assert.deepEqual(replies.map(r => r.status).sort(), [200, 409])
})
