import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParseError } from '../src/core/model.ts'
import { hashText, loadDir, saveFile, VersionConflict } from '../src/node/files.ts'

const tempDir = () => mkdtemp(join(tmpdir(), 'flowy-'))

test('a missing folder loads as an empty model', async () => {
  const { model, versions } = await loadDir(join(await tempDir(), 'flowy'))
  assert.deepEqual(model.objects, {})
  assert.deepEqual(versions, { 'model.yaml': null, 'layout.yaml': null })
})

test('saveFile writes, and loadDir reads it back with the same version', async () => {
  const dir = await tempDir()
  const text = 'objects:\n  a: { type: actor, name: A }\n'
  const version = await saveFile(dir, 'model.yaml', text, null)
  assert.equal(version, hashText(text))
  const { model, versions } = await loadDir(dir)
  assert.equal(model.objects.a.name, 'A')
  assert.equal(versions['model.yaml'], version)
})

test('flows are loaded by file name', async () => {
  const dir = await tempDir()
  await saveFile(dir, 'flows/login.yaml', 'name: Login\nview: root\nsteps: []\n', null)
  const { model, versions } = await loadDir(dir)
  assert.equal(model.flows.login.name, 'Login')
  assert.ok(versions['flows/login.yaml'])
})

test('a stale version is refused and the file is left alone', async () => {
  const dir = await tempDir()
  await saveFile(dir, 'model.yaml', 'objects: {}\n', null)
  await assert.rejects(saveFile(dir, 'model.yaml', 'objects:\n  x: {}\n', 'not-the-version'), VersionConflict)
  await assert.rejects(saveFile(dir, 'model.yaml', 'x', null), VersionConflict)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects: {}\n')
})

test('null deletes, and paths outside the folder are refused', async () => {
  const dir = await tempDir()
  const version = await saveFile(dir, 'flows/a.yaml', 'name: A\n', null)
  assert.equal(await saveFile(dir, 'flows/a.yaml', null, version), null)
  assert.equal((await loadDir(dir)).model.flows.a, undefined)
  await assert.rejects(saveFile(dir, '../evil.yaml', 'x', null), /refusing/)
  await assert.rejects(saveFile(dir, 'flows/../../evil.yaml', 'x', null), /refusing/)
})

test('a broken file is reported with its name and line', async () => {
  const dir = await tempDir()
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  a: { type: actor\n')
  await assert.rejects(loadDir(dir), (e: unknown) => e instanceof ParseError && e.file === 'model.yaml' && typeof e.line === 'number')
})
