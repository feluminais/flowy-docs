import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashText, saveFiles, VersionConflict } from '../src/node/files.ts'

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-files-'))
  await mkdir(join(root, 'flows'))
  await writeFile(join(root, 'model.yaml'), 'old model\n')
  await writeFile(join(root, 'layout.yaml'), 'old layout\n')
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, read: (rel: string) => readFile(join(root, rel), 'utf8') }
}

test('saveFiles writes every file, a new one and a deleted one included', async t => {
  const { root, read } = await setup(t)
  await writeFile(join(root, 'flows/gone.yaml'), 'x\n')
  await saveFiles(root, [
    { rel: 'model.yaml', text: 'new model\n', expected: hashText('old model\n') },
    { rel: 'flows/fresh.yaml', text: 'fresh\n', expected: null },
    { rel: 'flows/gone.yaml', text: null, expected: hashText('x\n') },
  ])
  assert.equal(await read('model.yaml'), 'new model\n')
  assert.equal(await read('flows/fresh.yaml'), 'fresh\n')
  assert.equal(existsSync(join(root, 'flows/gone.yaml')), false)
})

test('saveFiles writes nothing when any file has changed since it was read', async t => {
  const { root, read } = await setup(t)
  await assert.rejects(
    saveFiles(root, [
      { rel: 'model.yaml', text: 'new model\n', expected: hashText('old model\n') },
      { rel: 'layout.yaml', text: 'new layout\n', expected: hashText('somebody else was here\n') },
    ]),
    (e: unknown) => e instanceof VersionConflict && e.message === 'layout.yaml changed since it was read',
  )
  assert.equal(await read('model.yaml'), 'old model\n')
  assert.equal(await read('layout.yaml'), 'old layout\n')
})

test('saveFiles puts back the files already written when a later write fails, and throws that failure', async t => {
  const { root, read } = await setup(t)
  await assert.rejects(
    saveFiles(root, [
      { rel: 'model.yaml', text: 'new model\n', expected: hashText('old model\n') },
      { rel: 'flows/fresh.yaml', text: 'fresh\n', expected: null },
      { rel: 'notes.txt', text: 'not a file Flowy writes\n', expected: null }, // refused when its turn comes, after the other two are written
    ]),
    /refusing to write "notes.txt"/,
  )
  assert.equal(await read('model.yaml'), 'old model\n')
  assert.equal(existsSync(join(root, 'flows/fresh.yaml')), false)
  assert.equal(existsSync(join(root, 'notes.txt')), false)
})
